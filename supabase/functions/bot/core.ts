// core.ts — lógica pura del sistema de objetivos (sin red ni base de datos).
// Todo lo que depende de fechas se calcula en hora de Argentina (UTC-3, sin horario de verano).

export const TZ = "-03:00";
export const START = "2026-11-02";
export const AHORRO_PISO = 200000;
export const AHORRO_META_USD = 1000;

export type Status = "pendiente" | "cumplido" | "no_cumplido";

export interface Objective {
  id: string;
  emoji: string;
  name: string;
  short: string;
  goal: string;
  start_date: string;
  end_date: string;
  sort: number;
}

export interface Check {
  id?: number;
  objective_id: string;
  kind: string;
  day: string;
  meta: string;
  question: string;
  notify_at: string | null;
  status: Status;
  answered_at?: string | null;
  sent_at?: string | null;
  tg_message_id?: number | null;
  value?: Record<string, unknown> | null;
  week?: number | null;
}

export interface Holiday {
  day: string;
  name: string;
  type: "feriado" | "no_laborable";
}

export const OBJECTIVES: Objective[] = [
  {
    id: "ahorro",
    emoji: "💰",
    name: "Ahorrar mis primeros USD 1.000",
    short: "Ahorro",
    goal: "Invertir al menos AR$ 200.000 por mes (7 meses)",
    start_date: "2026-11-02",
    end_date: "2027-05-31",
    sort: 1,
  },
  {
    id: "fisico",
    emoji: "🏋️",
    name: "Notar cambios en mi físico",
    short: "Físico",
    goal: "Entrenar 3 días por semana (preferencia lun, mié y vie)",
    start_date: "2026-11-02",
    end_date: "2027-01-31",
    sort: 2,
  },
  {
    id: "detox",
    emoji: "🚭",
    name: "Detox total de 21 días",
    short: "Detox",
    goal: "Plan progresivo de 12 semanas hasta 21 días sin fumar",
    start_date: "2026-11-02",
    end_date: "2027-01-24",
    sort: 3,
  },
  {
    id: "ruso",
    emoji: "🇷🇺",
    name: "Racha de 90 días de ruso",
    short: "Ruso",
    goal: "Al menos una sesión de ruso en Duolingo por día",
    start_date: "2026-11-02",
    end_date: "2027-01-30",
    sort: 4,
  },
];

// Feriados nacionales y días no laborables dentro del período del reto.
// "feriado" no cuenta como día hábil para el día de cobro.
// Ambos tipos se tratan como fin de semana para la meta "no fumar hasta salir del trabajo".
export const HOLIDAYS: Holiday[] = [
  { day: "2026-11-23", name: "Día de la Soberanía Nacional", type: "feriado" },
  { day: "2026-12-07", name: "Día no laborable con fines turísticos", type: "no_laborable" },
  { day: "2026-12-08", name: "Inmaculada Concepción de María", type: "feriado" },
  { day: "2026-12-25", name: "Navidad", type: "feriado" },
  { day: "2027-01-01", name: "Año Nuevo", type: "feriado" },
  { day: "2027-02-08", name: "Carnaval", type: "feriado" },
  { day: "2027-02-09", name: "Carnaval", type: "feriado" },
  { day: "2027-03-24", name: "Día de la Memoria", type: "feriado" },
  { day: "2027-03-25", name: "Jueves Santo", type: "no_laborable" },
  { day: "2027-03-26", name: "Viernes Santo", type: "feriado" },
  { day: "2027-04-02", name: "Día del Veterano y de los Caídos en Malvinas", type: "feriado" },
  { day: "2027-05-01", name: "Día del Trabajador", type: "feriado" },
  { day: "2027-05-25", name: "Revolución de Mayo", type: "feriado" },
];

// ---------- Fechas ----------

const pad = (n: number) => String(n).padStart(2, "0");

export function addDays(d: string, n: number): string {
  const t = new Date(d + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado */
export function dow(d: string): number {
  return new Date(d + "T12:00:00Z").getUTCDay();
}

/** b - a en días */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
}

export function localNow(now: Date = new Date()) {
  const t = new Date(now.getTime() - 3 * 3600000);
  const iso = t.toISOString();
  return {
    day: iso.slice(0, 10),
    hhmm: iso.slice(11, 16),
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

export function atLocal(day: string, hhmm: string): string {
  return new Date(`${day}T${hhmm}:00${TZ}`).toISOString();
}

export function hhmmLocal(iso: string): string {
  return localNow(new Date(iso)).hhmm;
}

export function weekOf(day: string): number {
  return Math.floor(diffDays(START, day) / 7) + 1;
}

export function mondayOf(day: string): string {
  return addDays(day, -((dow(day) + 6) % 7));
}

export function isHoliday(day: string, holidays: Holiday[]): boolean {
  return holidays.some((h) => h.day === day);
}

export function isBusinessDay(day: string, holidays: Holiday[]): boolean {
  const w = dow(day);
  return w >= 1 && w <= 5 && !holidays.some((h) => h.day === day && h.type === "feriado");
}

export function nextBusinessDay(day: string, holidays: Holiday[]): string {
  let d = addDays(day, 1);
  while (!isBusinessDay(d, holidays)) d = addDays(d, 1);
  return d;
}

export function nthBusinessDay(year: number, month: number, n: number, holidays: Holiday[]): string {
  let d = `${year}-${pad(month)}-01`;
  let c = 0;
  for (;;) {
    if (isBusinessDay(d, holidays) && ++c === n) return d;
    d = addDays(d, 1);
  }
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function fmtShort(day: string): string {
  return `${DIAS_CORTOS[dow(day)]} ${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

export function fmtLong(day: string): string {
  const d = DIAS[dow(day)];
  return `${d.charAt(0).toUpperCase() + d.slice(1)} ${Number(day.slice(8, 10))} de ${MESES[Number(day.slice(5, 7)) - 1]}`;
}

export function fmtArs(n: number): string {
  return "AR$ " + Math.round(n).toLocaleString("es-AR");
}

export function fmtUsd(n: number): string {
  return "USD " + Math.round(n).toLocaleString("es-AR");
}

/** Interpreta montos escritos a mano: "200000", "200.000", "$ 200.000,50", "200k". */
export function parseAmount(text: string): number | null {
  let t = text.trim().toLowerCase().replace(/ars|ar\$|\$|\s/g, "");
  let mult = 1;
  if (t.endsWith("k")) {
    mult = 1000;
    t = t.slice(0, -1);
  }
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t) * mult;
  return Number.isFinite(n) ? n : null;
}

// ---------- Plan del detox ----------

/** Días de la semana (0=dom) en los que no se fuma en todo el día. */
export function detoxFullDays(week: number): number[] {
  if (week <= 1) return [];
  if (week <= 3) return [2];
  if (week <= 5) return [2, 4];
  if (week <= 7) return [2, 3, 4];
  if (week <= 9) return [1, 2, 3, 6]; // ajuste por las fiestas: lun-mié + sábado
  return [0, 1, 2, 3, 4, 5, 6];
}

export function detoxPlanLabel(week: number): string {
  if (week <= 1) return "no fumar hasta salir del trabajo";
  if (week <= 3) return "martes sin fumar";
  if (week <= 5) return "martes y jueves sin fumar";
  if (week <= 7) return "martes a jueves sin fumar";
  if (week <= 9) return "lunes a miércoles y sábado sin fumar";
  return "detox total: ningún día";
}

// ---------- Calendario de preguntas ----------

export function objectiveById(id: string, objectives: Objective[] = OBJECTIVES): Objective {
  return objectives.find((o) => o.id === id)!;
}

export function buildSchedule(holidays: Holiday[] = HOLIDAYS): Check[] {
  const out: Check[] = [];
  const ruso = objectiveById("ruso");
  const fisico = objectiveById("fisico");
  const detox = objectiveById("detox");
  const last = [ruso, fisico, detox].map((o) => o.end_date).sort().at(-1)!;

  for (let d = START; d <= last; d = addDays(d, 1)) {
    const w = weekOf(d);
    const wd = dow(d);

    if (d <= detox.end_date) {
      if (detoxFullDays(w).includes(wd)) {
        out.push({
          objective_id: "detox", kind: "detox_dia", day: d, week: w, status: "pendiente",
          meta: "No fumar en todo el día",
          question: "¿Cumpliste la meta?",
          notify_at: atLocal(d, "22:30"),
        });
      } else if (wd >= 1 && wd <= 5 && !isHoliday(d, holidays)) {
        out.push({
          objective_id: "detox", kind: "detox_trabajo", day: d, week: w, status: "pendiente",
          meta: "No fumar hasta salir del trabajo",
          question: "¿Cumpliste la meta?",
          notify_at: atLocal(d, "18:00"),
        });
      }
    }

    if (d <= fisico.end_date && [1, 3, 5].includes(wd)) {
      out.push({
        objective_id: "fisico", kind: "gym", day: d, week: w, status: "pendiente",
        meta: "Entrenar (meta semanal: 3 sesiones)",
        question: "¿Entrenaste hoy?",
        notify_at: atLocal(d, "20:00"),
      });
    }

    if (d <= ruso.end_date) {
      out.push({
        objective_id: "ruso", kind: "ruso", day: d, week: w, status: "pendiente",
        meta: "Al menos una sesión de ruso en Duolingo",
        question: "¿Hiciste tu sesión de ruso?",
        notify_at: atLocal(d, "22:30"),
      });
    }
  }

  const months: [number, number][] = [[2026, 11], [2026, 12], [2027, 1], [2027, 2], [2027, 3], [2027, 4], [2027, 5]];
  months.forEach(([y, m], i) => {
    const d = nthBusinessDay(y, m, 5, holidays);
    out.push({
      objective_id: "ahorro", kind: "ahorro", day: d, week: weekOf(d), status: "pendiente",
      meta: `Invertir al menos ${fmtArs(AHORRO_PISO)} (aporte ${i + 1} de 7)`,
      question: `¿Invertiste al menos ${fmtArs(AHORRO_PISO)} este mes?`,
      notify_at: atLocal(d, "18:00"),
      value: { mes: i + 1 },
    });
  });

  return out.sort((a, b) => (a.notify_at! < b.notify_at! ? -1 : 1));
}

// ---------- Estadísticas ----------

export interface Mep { venta: number; fecha?: string }

export interface ObjStats {
  id: string;
  avance: number; // 0..1, en tiempo
  cumplimiento: number | null; // 0..1, sobre lo respondido
  cumplidos: number;
  evaluados: number;
  sinResponder: number;
  racha: number;
  detalle: string;
}

export interface AhorroStats {
  saldo: number;
  invertido: number;
  usd: number | null;
  restantes: number;
  proyeccionUsd: number | null;
  faltanArs: number | null;
  porMes: number | null;
}

/** Una pregunta está "vencida" si ya pasó su horario o su día. */
export function isOverdue(c: Check, now: Date, today: string): boolean {
  if (c.status !== "pendiente") return false;
  if (c.day < today) return true;
  return !!c.notify_at && Date.parse(c.notify_at) <= now.getTime();
}

function avanceOf(o: Objective, today: string): number {
  const total = diffDays(o.start_date, o.end_date) + 1;
  const done = Math.min(Math.max(diffDays(o.start_date, today) + 1, 0), total);
  return done / total;
}

function sortChecks(list: Check[]): Check[] {
  return [...list].sort((a, b) => (a.day + (a.notify_at ?? "")).localeCompare(b.day + (b.notify_at ?? "")));
}

/** Racha: cumplidos consecutivos hacia atrás; la pregunta de hoy aún sin responder no la corta. */
function streak(list: Check[], today: string): number {
  const past = sortChecks(list.filter((c) => c.day <= today)).reverse();
  let n = 0;
  for (const c of past) {
    if (c.status === "cumplido") n++;
    else if (c.status === "pendiente" && c.day === today) continue; // lo de hoy todavía no corta la racha
    else break;
  }
  return n;
}

export function gymWeeks(checks: Check[], fisico: Objective, today: string) {
  const weeks: { monday: string; sessions: number; closed: boolean; pend: number; met: boolean | null }[] = [];
  const gym = checks.filter((c) => c.objective_id === "fisico");
  for (let m = mondayOf(fisico.start_date); m <= fisico.end_date && m <= today; m = addDays(m, 7)) {
    const sun = addDays(m, 6);
    const inWeek = gym.filter((c) => c.day >= m && c.day <= sun);
    const sessions = inWeek.filter((c) => c.status === "cumplido").length;
    const pend = inWeek.filter((c) => c.status === "pendiente" && c.day < today).length;
    const closed = sun < today;
    let met: boolean | null = null;
    if (sessions >= 3) met = true;
    else if (closed && pend === 0) met = false;
    weeks.push({ monday: m, sessions, closed, pend, met });
  }
  return weeks;
}

export function ahorroStats(checks: Check[], today: string, mep: Mep | null): AhorroStats {
  const list = sortChecks(checks.filter((c) => c.objective_id === "ahorro"));
  const withData = list.filter((c) => c.value && typeof c.value.saldo === "number");
  const saldo = withData.length ? (withData.at(-1)!.value!.saldo as number) : 0;
  const invertido = list.reduce((s, c) => s + (typeof c.value?.monto === "number" ? (c.value.monto as number) : 0), 0);
  const restantes = list.filter((c) => c.status === "pendiente").length;
  if (!mep?.venta) return { saldo, invertido, usd: null, restantes, proyeccionUsd: null, faltanArs: null, porMes: null };
  const usd = saldo / mep.venta;
  const proyeccionUsd = (saldo + AHORRO_PISO * restantes) / mep.venta;
  const faltanArs = Math.max(0, AHORRO_META_USD * mep.venta - saldo);
  const porMes = restantes > 0 ? faltanArs / restantes : null;
  return { saldo, invertido, usd, restantes, proyeccionUsd, faltanArs, porMes };
}

export function computeStats(
  objectives: Objective[],
  checks: Check[],
  today: string,
  now: Date,
  mep: Mep | null,
): { byId: Record<string, ObjStats>; ahorro: AhorroStats; general: { cumplidos: number; evaluados: number; sinResponder: number } } {
  const byId: Record<string, ObjStats> = {};
  for (const o of objectives) {
    const list = checks.filter((c) => c.objective_id === o.id && c.day <= today);
    const cumplidosN = list.filter((c) => c.status === "cumplido").length;
    const evaluadosN = list.filter((c) => c.status !== "pendiente").length;
    const sinResponder = list.filter((c) => isOverdue(c, now, today)).length;
    const s: ObjStats = {
      id: o.id,
      avance: avanceOf(o, today),
      cumplimiento: evaluadosN ? cumplidosN / evaluadosN : null,
      cumplidos: cumplidosN,
      evaluados: evaluadosN,
      sinResponder,
      racha: streak(list, today),
      detalle: "",
    };

    if (o.id === "fisico") {
      const weeks = gymWeeks(checks, o, today);
      const judged = weeks.filter((w) => w.met !== null);
      const met = judged.filter((w) => w.met).length;
      s.cumplidos = met;
      s.evaluados = judged.length;
      s.cumplimiento = judged.length ? met / judged.length : null;
      const cur = weeks.at(-1);
      s.racha = 0;
      for (const w of [...weeks].reverse()) {
        if (w.met) s.racha++;
        else if (!w.closed) continue;
        else break;
      }
      s.detalle = today <= o.end_date && cur ? `esta semana ${cur.sessions}/3` : "";
    }
    if (o.id === "detox") {
      const w = weekOf(today);
      if (today > o.end_date) s.detalle = "reto terminado";
      else if (w >= 10) {
        const fin = checks.filter((c) => c.objective_id === "detox" && c.day >= addDays(START, 63) && c.day <= today);
        s.detalle = `detox total ${fin.filter((c) => c.status === "cumplido").length}/21 días`;
      } else s.detalle = `semana ${w}: ${detoxPlanLabel(w)}`;
    }
    if (o.id === "ruso") s.detalle = `racha ${s.racha} ${s.racha === 1 ? "día" : "días"}`;
    byId[o.id] = s;
  }
  const ahorro = ahorroStats(checks, today, mep);
  byId.ahorro.detalle = ahorro.usd !== null ? `${fmtUsd(ahorro.usd)}/1.000` : "";

  const general = Object.values(byId).reduce(
    (g, s) => ({ cumplidos: g.cumplidos + s.cumplidos, evaluados: g.evaluados + s.evaluados, sinResponder: g.sinResponder + s.sinResponder }),
    { cumplidos: 0, evaluados: 0, sinResponder: 0 },
  );
  return { byId, ahorro, general };
}

// ---------- Textos del bot (HTML de Telegram) ----------

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function questionText(c: Check, objectives: Objective[] = OBJECTIVES): string {
  const o = objectiveById(c.objective_id, objectives);
  const header = c.objective_id === "detox" ? `${o.short} · Semana ${c.week ?? weekOf(c.day)}` : o.short;
  return `${o.emoji} <b>${esc(header)}</b> · ${fmtShort(c.day)}\nMeta: ${esc(c.meta)}\n\n<b>${esc(c.question)}</b>`;
}

export function resultLine(c: Check): string {
  if (c.status === "cumplido") return "→ ✅ <b>Cumplido</b>";
  if (c.status === "no_cumplido") return "→ ❌ <b>No cumplido</b>";
  return "→ ⏳ Sin responder";
}

export function questionKeyboard(c: Check) {
  const row1 = [
    { text: "✅ Sí", callback_data: `a:${c.id}:y` },
    { text: "❌ No", callback_data: `a:${c.id}:n` },
  ];
  const row2 = c.kind === "ahorro"
    ? [{ text: "⏳ Todavía no cobré", callback_data: `a:${c.id}:c` }]
    : [{ text: "⏰ Más tarde (+1 h)", callback_data: `a:${c.id}:l` }];
  return { inline_keyboard: [row1, row2] };
}

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

export function summaryText(
  objectives: Objective[],
  checks: Check[],
  stats: ReturnType<typeof computeStats>,
  today: string,
  now: Date,
): string {
  const lines: string[] = [];
  lines.push(`☀️ <b>${fmtLong(today)}</b> · Semana ${weekOf(today)} del reto`);
  lines.push("");

  const hoy = sortChecks(checks.filter((c) => c.day === today));
  lines.push("<b>HOY</b>");
  if (!hoy.length) lines.push("Sin metas con pregunta hoy 🙌");
  for (const c of hoy) {
    const o = objectiveById(c.objective_id, objectives);
    const hora = c.notify_at ? hhmmLocal(c.notify_at) : "";
    const mark = c.status === "cumplido" ? " ✅" : c.status === "no_cumplido" ? " ❌" : "";
    lines.push(`${o.emoji} ${esc(c.meta)}${hora ? ` · ${hora}` : ""}${mark}`);
  }

  const pend = checks.filter((c) => c.day < today && c.status === "pendiente");
  if (pend.length) {
    lines.push("");
    lines.push(`⚠️ <b>${pend.length} sin responder</b> de días anteriores`);
  }

  lines.push("");
  lines.push("<b>AVANCE (tiempo) · CUMPLIMIENTO</b>");
  for (const o of objectives) {
    const s = stats.byId[o.id];
    if (today > o.end_date && o.id !== "ahorro") continue;
    const frac = s.evaluados ? ` (${s.cumplidos}/${s.evaluados})` : "";
    const det = s.detalle ? ` · ${esc(s.detalle)}` : "";
    lines.push(`${o.emoji} ${o.short}: ${pct(s.avance)} · ${pct(s.cumplimiento)}${frac}${det}`);
  }
  return lines.join("\n");
}

export function helpText(): string {
  return [
    "<b>Comandos</b>",
    "/hoy — metas de hoy (puedes responder antes de la hora)",
    "/pendientes — preguntas sin responder",
    "/entrene — registrar una sesión de gym hoy (o /entrene ayer, /entrene 05/11)",
    "/resumen — el resumen de la mañana, ahora",
    "/dashboard — abrir el reporte",
    "/cancelar — cancelar una carga de montos en curso",
  ].join("\n");
}
