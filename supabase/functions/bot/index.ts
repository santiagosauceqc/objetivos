// Bot de objetivos personales — una sola Edge Function con cuatro rutas:
//   /bot/telegram  webhook de Telegram (botones y comandos)
//   /bot/tick      reloj: lo llama pg_cron cada minuto (preguntas + resumen 7:10)
//   /bot/api       datos y ediciones del dashboard
//   /bot/setup     carga inicial e instalación del webhook (una vez)
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  addDays, atLocal, buildSchedule, Check, computeStats, fmtArs, fmtShort, fmtUsd, Holiday, HOLIDAYS,
  helpText, hhmmLocal, isOverdue, localNow, Mep, mondayOf, nextBusinessDay, Objective, OBJECTIVES,
  parseAmount, questionKeyboard, questionText, resultLine, summaryText, weekOf, AHORRO_PISO,
} from "./core.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-tg-init-data, x-dash-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });

// ---------- Secretos y ajustes ----------

let SECRETS: Record<string, string> | null = null;
async function secrets(): Promise<Record<string, string>> {
  if (!SECRETS) {
    const { data, error } = await sb.from("app_secrets").select("key,value");
    if (error) throw error;
    SECRETS = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  }
  return SECRETS!;
}

async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const { data } = await sb.from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? null) as T | null;
}
async function setSetting(key: string, value: unknown) {
  await sb.from("settings").upsert({ key, value, updated_at: new Date().toISOString() });
}

// ---------- Telegram ----------

async function tg(method: string, body: Record<string, unknown>) {
  const { bot_token } = await secrets();
  const r = await fetch(`https://api.telegram.org/bot${bot_token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) console.error("telegram", method, JSON.stringify(j));
  return j;
}

async function ownerId(): Promise<number | null> {
  return await getSetting<number>("owner_chat_id");
}

async function send(text: string, extra: Record<string, unknown> = {}) {
  const chat_id = await ownerId();
  if (!chat_id) return { ok: false };
  return await tg("sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
}

async function dashboardUrl(): Promise<string | null> {
  return await getSetting<string>("dashboard_url");
}

async function dashButton(label = "📊 Abrir dashboard") {
  const url = await dashboardUrl();
  return url ? { text: label, web_app: { url } } : null;
}

// ---------- Datos ----------

async function loadAll() {
  const [o, c, h] = await Promise.all([
    sb.from("objectives").select("*").order("sort"),
    sb.from("checks").select("*").order("day").order("notify_at"),
    sb.from("holidays").select("*").order("day"),
  ]);
  if (o.error) throw o.error;
  if (c.error) throw c.error;
  return {
    objectives: (o.data ?? []) as Objective[],
    checks: (c.data ?? []) as Check[],
    holidays: (h.data ?? []) as Holiday[],
  };
}

async function getCheck(id: number): Promise<Check | null> {
  const { data } = await sb.from("checks").select("*").eq("id", id).maybeSingle();
  return data as Check | null;
}

async function getMep(): Promise<Mep | null> {
  const cached = await getSetting<{ venta: number; fecha: string; at: number }>("mep");
  if (cached && Date.now() - cached.at < 3 * 3600000) return cached;
  try {
    const r = await fetch("https://dolarapi.com/v1/dolares/bolsa", { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    if (typeof j.venta === "number") {
      const v = { venta: j.venta, fecha: j.fechaActualizacion ?? "", at: Date.now() };
      await setSetting("mep", v);
      return v;
    }
  } catch (e) {
    console.error("mep", e);
  }
  return cached;
}

// ---------- Registro de respuestas ----------

async function setStatus(c: Check, status: Check["status"], value?: Record<string, unknown>) {
  const patch: Record<string, unknown> = {
    status,
    answered_at: status === "pendiente" ? null : new Date().toISOString(),
  };
  if (value) patch.value = { ...(c.value ?? {}), ...value };
  // Si se respondió antes de la hora, ya no hace falta mandar la pregunta.
  if (status !== "pendiente" && !c.sent_at) patch.sent_at = new Date().toISOString();
  const { data } = await sb.from("checks").update(patch).eq("id", c.id!).select().single();
  const updated = data as Check;
  if (updated.tg_message_id) {
    await tg("editMessageText", {
      chat_id: await ownerId(),
      message_id: updated.tg_message_id,
      text: questionText(updated) + "\n\n" + resultLine(updated),
      parse_mode: "HTML",
      reply_markup: status === "pendiente" ? questionKeyboard(updated) : { inline_keyboard: [] },
    });
  }
  return updated;
}

async function sendQuestion(c: Check) {
  const r = await send(questionText(c), { reply_markup: questionKeyboard(c) });
  if (r.ok) await sb.from("checks").update({ tg_message_id: r.result.message_id }).eq("id", c.id!);
  return r.ok;
}

async function weekGymCount(day: string): Promise<number> {
  const m = mondayOf(day);
  const { count } = await sb.from("checks").select("id", { count: "exact", head: true })
    .eq("objective_id", "fisico").eq("status", "cumplido").gte("day", m).lte("day", addDays(m, 6));
  return count ?? 0;
}

async function registerGym(day: string, on: boolean) {
  const { data } = await sb.from("checks").select("*").eq("kind", "gym").eq("day", day).maybeSingle();
  const existing = data as Check | null;
  if (on) {
    if (existing) return await setStatus(existing, "cumplido");
    const now = new Date().toISOString();
    const { data: ins } = await sb.from("checks").insert({
      objective_id: "fisico", kind: "gym", day, week: weekOf(day), meta: "Sesión extra (meta semanal: 3)",
      question: "¿Entrenaste hoy?", notify_at: null, status: "cumplido", answered_at: now, sent_at: now,
    }).select().single();
    return ins as Check;
  }
  if (!existing) return null;
  if (existing.notify_at === null) {
    await sb.from("checks").delete().eq("id", existing.id!);
    return null;
  }
  return await setStatus(existing, "no_cumplido");
}

// ---------- Mensajes compuestos ----------

async function sendSummary() {
  const { objectives, checks } = await loadAll();
  const now = new Date();
  const today = localNow(now).day;
  const mep = await getMep();
  const stats = computeStats(objectives, checks, today, now, mep);
  const pend = checks.filter((c) => c.day < today && c.status === "pendiente").length;
  const rows: unknown[][] = [];
  if (pend) rows.push([{ text: `📝 Responder pendientes (${pend})`, callback_data: "pend" }]);
  const db = await dashButton();
  if (db) rows.push([db]);
  return await send(summaryText(objectives, checks, stats, today, now), rows.length ? { reply_markup: { inline_keyboard: rows } } : {});
}

async function sendPending() {
  const { checks } = await loadAll();
  const now = new Date();
  const today = localNow(now).day;
  const pend = checks.filter((c) => isOverdue(c, now, today));
  if (!pend.length) return await send("🎉 No tienes preguntas sin responder.");
  const shown = pend.slice(0, 8);
  for (const c of shown) {
    const r = await send(questionText(c), { reply_markup: questionKeyboard(c) });
    if (r.ok) await sb.from("checks").update({ tg_message_id: r.result.message_id, sent_at: c.sent_at ?? now.toISOString() }).eq("id", c.id!);
  }
  if (pend.length > shown.length) {
    const db = await dashButton("📊 Ver el resto en el dashboard");
    await send(`Hay ${pend.length - shown.length} más.`, db ? { reply_markup: { inline_keyboard: [[db]] } } : {});
  }
}

async function sendToday() {
  const { checks } = await loadAll();
  const today = localNow().day;
  const hoy = checks.filter((c) => c.day === today);
  if (!hoy.length) return await send("Hoy no hay metas con pregunta 🙌");
  await send(`<b>Metas de hoy</b> · ${fmtShort(today)}\nPuedes responder ahora; si lo haces, no te pregunto después.`);
  for (const c of hoy) {
    if (c.status === "pendiente") {
      const r = await send(questionText(c), { reply_markup: questionKeyboard(c) });
      if (r.ok) await sb.from("checks").update({ tg_message_id: r.result.message_id }).eq("id", c.id!);
    } else {
      await send(questionText(c) + "\n\n" + resultLine(c));
    }
  }
}

function parseDayArg(arg: string, today: string): string | null {
  const a = arg.trim().toLowerCase();
  if (!a || a === "hoy") return today;
  if (a === "ayer") return addDays(today, -1);
  const m = a.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const mm = Number(m[2]);
  const year = Number(today.slice(0, 4)) - (mm > Number(today.slice(5, 7)) ? 1 : 0);
  const d = `${year}-${String(mm).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return d <= today ? d : null;
}

// ---------- Flujo del ahorro (montos escritos) ----------

interface PendingInput { check_id: number; step: "monto" | "saldo"; choice: "y" | "n"; monto?: number }

async function ahorroAsk(step: "monto" | "saldo") {
  const q = step === "monto"
    ? "✍️ ¿Cuánto invertiste este mes? Escribe solo el número (ej: 200000)."
    : "✍️ ¿Y cuál es el saldo total de tu inversión hoy (todo lo acumulado, con intereses)?";
  await send(q, { reply_markup: { force_reply: true, input_field_placeholder: "200000" } });
}

async function ahorroInput(pi: PendingInput, text: string) {
  const n = parseAmount(text);
  if (n === null) return await send("No entendí el número. Escríbelo sin letras (ej: 200000) o usa /cancelar.");
  if (pi.step === "monto") {
    await setSetting("pending_input", { ...pi, step: "saldo", monto: n });
    return await ahorroAsk("saldo");
  }
  const c = await getCheck(pi.check_id);
  await setSetting("pending_input", null);
  if (!c) return;
  const monto = pi.monto ?? 0;
  const mep = await getMep();
  const ok = pi.choice === "y" && monto >= AHORRO_PISO;
  const updated = await setStatus(c, ok ? "cumplido" : "no_cumplido", {
    monto, saldo: n, mep: mep?.venta ?? null, usd: mep?.venta ? n / mep.venta : null,
  });
  const { checks } = await loadAll();
  const stats = computeStats(OBJECTIVES, checks, localNow().day, new Date(), mep);
  const a = stats.ahorro;
  const lines = [
    ok ? "✅ <b>Meta del mes cumplida</b>" : (pi.choice === "y" ? `❌ Quedó por debajo del piso de ${fmtArs(AHORRO_PISO)}` : "❌ <b>Registrado como no cumplido</b>"),
    `Invertiste ${fmtArs(monto)} · saldo ${fmtArs(n)}`,
  ];
  if (a.usd !== null && mep) {
    lines.push(`≈ <b>${fmtUsd(a.usd)}</b> de USD 1.000 (MEP ${fmtArs(mep.venta)})`);
    if (a.restantes > 0) {
      lines.push(`Con el piso en los ${a.restantes} aportes que quedan llegarías a ~${fmtUsd(a.proyeccionUsd!)} (sin intereses, al dólar de hoy).`);
      if (a.faltanArs! > 0) lines.push(`Para llegar a USD 1.000 te faltan ${fmtArs(a.faltanArs!)} ≈ ${fmtArs(a.porMes!)} por mes.`);
    }
  }
  await send(lines.join("\n"));
}

// ---------- Webhook ----------

async function onCallback(cq: { id: string; data?: string; message?: { message_id: number } }) {
  const data = cq.data ?? "";
  if (data === "pend") {
    await tg("answerCallbackQuery", { callback_query_id: cq.id });
    return await sendPending();
  }
  const [t, idStr, op] = data.split(":");
  if (t !== "a") return await tg("answerCallbackQuery", { callback_query_id: cq.id });
  const c = await getCheck(Number(idStr));
  if (!c) return await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Esa pregunta ya no existe" });
  // El mensaje tocado pasa a ser el que se edita con el resultado.
  const mid = cq.message?.message_id;
  if (mid && mid !== c.tg_message_id) {
    await sb.from("checks").update({ tg_message_id: mid }).eq("id", c.id!);
    c.tg_message_id = mid;
  }

  if (op === "l") {
    const at = new Date(Date.now() + 3600000).toISOString();
    await sb.from("checks").update({ notify_at: at, sent_at: null }).eq("id", c.id!);
    await tg("editMessageText", {
      chat_id: await ownerId(), message_id: c.tg_message_id,
      text: questionText(c) + `\n\n⏰ Te lo vuelvo a preguntar a las ${hhmmLocal(at)}.`, parse_mode: "HTML",
    });
    return await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Te lo recuerdo en 1 hora" });
  }

  if (op === "c" && c.kind === "ahorro") {
    const { holidays } = await loadAll();
    const today = localNow().day;
    const nd = nextBusinessDay(c.day > today ? c.day : today, holidays);
    await sb.from("checks").update({ day: nd, week: weekOf(nd), notify_at: atLocal(nd, "18:00"), sent_at: null }).eq("id", c.id!);
    await tg("editMessageText", {
      chat_id: await ownerId(), message_id: c.tg_message_id,
      text: questionText(c) + `\n\n⏳ Ok, te pregunto de nuevo el ${fmtShort(nd)} a las 18:00.`, parse_mode: "HTML",
    });
    return await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Lo muevo al próximo día hábil" });
  }

  if (c.kind === "ahorro" && (op === "y" || op === "n")) {
    await setSetting("pending_input", { check_id: c.id, step: "monto", choice: op });
    await tg("editMessageText", {
      chat_id: await ownerId(), message_id: c.tg_message_id,
      text: questionText(c) + `\n\n→ ${op === "y" ? "✅ Sí" : "❌ No"} (falta cargar los montos)`, parse_mode: "HTML",
    });
    await tg("answerCallbackQuery", { callback_query_id: cq.id });
    return await ahorroAsk("monto");
  }

  if (op === "y" || op === "n") {
    const updated = await setStatus(c, op === "y" ? "cumplido" : "no_cumplido");
    let toast = op === "y" ? "¡Bien! ✅" : "Registrado";
    if (updated.kind === "gym") toast += ` · semana ${await weekGymCount(updated.day)}/3`;
    return await tg("answerCallbackQuery", { callback_query_id: cq.id, text: toast });
  }
  await tg("answerCallbackQuery", { callback_query_id: cq.id });
}

async function onText(msg: { text: string }) {
  const text = msg.text.trim();
  const cmd = text.startsWith("/") ? text.split(/[\s@]/)[0].toLowerCase() : "";
  const arg = text.includes(" ") ? text.slice(text.indexOf(" ") + 1) : "";

  if (!cmd) {
    const pi = await getSetting<PendingInput>("pending_input");
    if (pi) return await ahorroInput(pi, text);
    return await send("Usa los botones de cada pregunta o uno de estos comandos:\n\n" + helpText());
  }
  switch (cmd) {
    case "/start": {
      const db = await dashButton();
      return await send(
        "👋 <b>Listo, Santiago.</b> Te voy a preguntar por tus metas a la hora acordada y cada mañana a las 7:10 te mando el resumen.\n\n" + helpText(),
        db ? { reply_markup: { inline_keyboard: [[db]] } } : {},
      );
    }
    case "/hoy":
      return await sendToday();
    case "/pendientes":
      return await sendPending();
    case "/resumen":
      return await sendSummary();
    case "/entrene": {
      const today = localNow().day;
      const day = parseDayArg(arg, today);
      if (!day) return await send("No entendí la fecha. Usa /entrene, /entrene ayer o /entrene 05/11.");
      await registerGym(day, true);
      return await send(`💪 Sesión registrada (${fmtShort(day)}). Esa semana: ${await weekGymCount(day)}/3.`);
    }
    case "/cancelar":
      await setSetting("pending_input", null);
      return await send("Cancelado.");
    case "/dashboard": {
      const db = await dashButton();
      const { dash_key } = await secrets();
      const url = await dashboardUrl();
      const pc = url ? `\n\nPara abrirlo en la PC (enlace privado, no lo compartas):\n${url}#k=${dash_key}` : "";
      return await send("📊 Tu reporte de avance:" + pc, db ? { reply_markup: { inline_keyboard: [[db]] } } : {});
    }
    default:
      return await send(helpText());
  }
}

async function handleTelegram(req: Request) {
  const s = await secrets();
  if (req.headers.get("x-telegram-bot-api-secret-token") !== s.webhook_secret) return new Response("forbidden", { status: 403 });
  const upd = await req.json();
  const chat = upd.message?.chat ?? upd.callback_query?.message?.chat;
  if (!chat) return new Response("ok");
  let owner = await ownerId();
  if (!owner && chat.type === "private" && upd.message?.text?.startsWith("/start")) {
    await setSetting("owner_chat_id", chat.id);
    owner = chat.id;
  }
  if (String(chat.id) !== String(owner)) return new Response("ok");
  try {
    if (upd.callback_query) await onCallback(upd.callback_query);
    else if (upd.message?.text) await onText(upd.message);
  } catch (e) {
    console.error("webhook", e);
    await send("⚠️ Algo falló procesando eso. Prueba de nuevo en un momento.");
  }
  return new Response("ok");
}

// ---------- Reloj (pg_cron, cada minuto) ----------

async function handleTick(req: Request) {
  const s = await secrets();
  if (req.headers.get("x-cron-secret") !== s.cron_secret) return new Response("forbidden", { status: 403 });
  if (!(await ownerId())) return json({ skipped: "sin dueño" });
  const nowIso = new Date().toISOString();
  const { data: due } = await sb.from("checks").select("*")
    .eq("status", "pendiente").is("sent_at", null).lte("notify_at", nowIso).order("notify_at").limit(20);
  let sent = 0;
  for (const c of (due ?? []) as Check[]) {
    const { data: claimed } = await sb.from("checks").update({ sent_at: nowIso }).eq("id", c.id!).is("sent_at", null).select("id");
    if (!claimed?.length) continue;
    if (await sendQuestion(c)) sent++;
    else await sb.from("checks").update({ sent_at: null }).eq("id", c.id!);
  }
  const ln = localNow();
  let summary = false;
  if (ln.minutes >= 7 * 60 + 10 && ln.minutes < 12 * 60 && ln.day <= "2027-05-31") {
    const { data: claimed } = await sb.from("daily_log").upsert({ day: ln.day }, { onConflict: "day", ignoreDuplicates: true }).select();
    if (claimed?.length) {
      await sendSummary();
      summary = true;
    }
  }
  return json({ sent, summary });
}

// ---------- API del dashboard ----------

async function validateInitData(initData: string, botToken: string): Promise<number | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheck = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
  const enc = new TextEncoder();
  const k1 = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", k1, enc.encode(botToken));
  const k2 = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k2, enc.encode(dataCheck)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== hash) return null;
  if (Date.now() / 1000 - Number(params.get("auth_date") ?? 0) > 7 * 86400) return null;
  try {
    return JSON.parse(params.get("user") ?? "{}").id ?? null;
  } catch {
    return null;
  }
}

async function authorized(req: Request): Promise<boolean> {
  const s = await secrets();
  const key = req.headers.get("x-dash-key");
  if (key && key === s.dash_key) return true;
  const init = req.headers.get("x-tg-init-data");
  if (!init) return false;
  const uid = await validateInitData(init, s.bot_token);
  const owner = await ownerId();
  return uid !== null && owner !== null && String(uid) === String(owner);
}

async function handleApi(req: Request, path: string) {
  if (!(await authorized(req))) return json({ error: "no autorizado" }, 401);
  if (req.method === "GET" && path.startsWith("/api/state")) {
    const { objectives, checks, holidays } = await loadAll();
    const now = new Date();
    const today = localNow(now).day;
    const mep = await getMep();
    const stats = computeStats(objectives, checks, today, now, mep);
    return json({
      now: now.toISOString(), today, week: weekOf(today), objectives, holidays, mep, stats,
      checks: checks.map((c) => ({
        id: c.id, objective_id: c.objective_id, kind: c.kind, day: c.day, meta: c.meta, question: c.question,
        notify_at: c.notify_at, status: c.status, answered_at: c.answered_at, value: c.value, week: c.week,
        overdue: isOverdue(c, now, today),
      })),
    });
  }
  if (req.method === "POST" && path.startsWith("/api/answer")) {
    const body = await req.json();
    const c = await getCheck(Number(body.id));
    if (!c) return json({ error: "no existe" }, 404);
    if (!["pendiente", "cumplido", "no_cumplido"].includes(body.status)) return json({ error: "estado inválido" }, 400);
    let value: Record<string, unknown> | undefined;
    let status = body.status;
    if (c.kind === "ahorro" && body.status !== "pendiente") {
      const monto = Number(body.monto ?? 0), saldo = Number(body.saldo ?? 0);
      const mep = await getMep();
      value = { monto, saldo, mep: mep?.venta ?? null, usd: mep?.venta ? saldo / mep.venta : null };
      if (body.status === "cumplido" && monto < AHORRO_PISO) status = "no_cumplido";
    }
    const updated = await setStatus(c, status, value);
    return json({ ok: true, check: updated });
  }
  if (req.method === "POST" && path.startsWith("/api/gym")) {
    const body = await req.json();
    const today = localNow().day;
    if (typeof body.day !== "string" || body.day > today) return json({ error: "fecha inválida" }, 400);
    await registerGym(body.day, !!body.on);
    return json({ ok: true });
  }
  return json({ error: "ruta desconocida" }, 404);
}

// ---------- Instalación inicial ----------

async function handleSetup(req: Request) {
  const s = await secrets();
  if (req.headers.get("x-cron-secret") !== s.cron_secret) return new Response("forbidden", { status: 403 });
  const body = await req.json().catch(() => ({}));
  const report: Record<string, unknown> = {};

  await sb.from("objectives").upsert(OBJECTIVES);
  await sb.from("holidays").upsert(HOLIDAYS);
  const sched = buildSchedule(HOLIDAYS).map((c) => ({ ...c, value: c.value ?? null }));
  const { error: e1 } = await sb.from("checks").upsert(sched, { onConflict: "kind,day", ignoreDuplicates: true });
  report.schedule = e1 ? String(e1.message) : sched.length;
  // Lo que ya pasó antes de encender el sistema queda pendiente, sin mandar mensajes viejos.
  await sb.from("checks").update({ sent_at: new Date().toISOString() }).is("sent_at", null).lt("notify_at", new Date().toISOString());

  if (body.dashboard_url) await setSetting("dashboard_url", body.dashboard_url);

  report.me = (await tg("getMe", {})).result?.username;
  if (!(await ownerId())) {
    const upd = await tg("getUpdates", { allowed_updates: ["message"] });
    const chats = new Set<number>();
    for (const u of upd.result ?? []) if (u.message?.chat?.type === "private") chats.add(u.message.chat.id);
    if (chats.size === 1) await setSetting("owner_chat_id", [...chats][0]);
    report.owner_from_updates = [...chats].length;
  }
  const hook = `${Deno.env.get("SUPABASE_URL")}/functions/v1/bot/telegram`;
  report.webhook = (await tg("setWebhook", {
    url: hook, secret_token: s.webhook_secret, allowed_updates: ["message", "callback_query"],
  })).ok;
  await tg("setMyCommands", {
    commands: [
      { command: "hoy", description: "Metas de hoy" },
      { command: "pendientes", description: "Preguntas sin responder" },
      { command: "entrene", description: "Registrar una sesión de gym" },
      { command: "resumen", description: "Resumen de avance" },
      { command: "dashboard", description: "Abrir el reporte" },
    ],
  });
  const url = await dashboardUrl();
  if (url) {
    report.menu = (await tg("setChatMenuButton", { menu_button: { type: "web_app", text: "Dashboard", web_app: { url } } })).ok;
  }
  report.owner = !!(await ownerId());
  if (body.welcome && report.owner) {
    const db = await dashButton();
    await send(
      "👋 <b>Bot conectado.</b> Desde ahora te pregunto por tus metas a la hora acordada, y cada mañana a las 7:10 te mando el resumen.\n\n" +
        "Lo que ya pasó desde el 2/11 quedó como pendiente: toca abajo para registrarlo.\n\n" + helpText(),
      { reply_markup: { inline_keyboard: [[{ text: "📝 Responder pendientes", callback_data: "pend" }], ...(db ? [[db]] : [])] } },
    );
  }
  return json(report);
}

// ---------- Router ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const path = new URL(req.url).pathname.replace(/^.*?\/bot(?=\/|$)/, "") || "/";
  try {
    if (path.startsWith("/telegram")) return await handleTelegram(req);
    if (path.startsWith("/tick")) return await handleTick(req);
    if (path.startsWith("/api")) return await handleApi(req, path);
    if (path.startsWith("/setup")) return await handleSetup(req);
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
