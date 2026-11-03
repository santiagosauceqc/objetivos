# Objetivos personales

Seguimiento de objetivos con recordatorios por Telegram y un dashboard con calendario de calor.

- **Bot** (`supabase/functions/bot`): una Edge Function de Supabase.
  - `/bot/telegram`: webhook con los botones ✅/❌/⏰ y los comandos `/hoy`, `/pendientes`, `/entrene`, `/resumen`, `/dashboard`.
  - `/bot/tick`: lo llama `pg_cron` cada minuto. Manda las preguntas que vencen y el resumen de las 7:10.
  - `/bot/api`: lectura y edición para el dashboard. Se autentica con los datos firmados de Telegram o con la clave privada.
  - `/bot/setup`: carga inicial (objetivos, feriados, calendario de preguntas) e instalación del webhook.
- **Dashboard** (`index.html`): página estática publicada en GitHub Pages. Se abre como Mini App dentro de Telegram.
- **Reglas** (`supabase/functions/bot/core.ts`): calendario de preguntas, plan del detox, feriados, avance y cumplimiento.

## Reglas acordadas
- Avance = porcentaje del tiempo transcurrido del objetivo. Cumplimiento = cumplidas / respondidas; no cuenta lo que falta.
- Detox: a las 18:00 se pregunta "no fumar hasta salir del trabajo" en días hábiles permitidos, sin feriados ni no laborables. A las 22:30 se pregunta "no fumar en todo el día" en los días del plan. Fines de semana libres hasta la semana 10.
- Gym: la meta es 3 sesiones por semana. La pregunta va lun/mié/vie a las 20:00. Una sesión extra en otra fecha se carga con `/entrene` y compensa la semana.
- Ahorro: la pregunta va el 5.º día hábil a las 18:00, con "Todavía no cobré" para pasarla al día hábil siguiente. El piso es AR$ 200.000 y el avance se mide en USD al MEP del día (dolarapi.com).
- Ruso: todos los días a las 22:30, durante 90 días.
- Si una pregunta no se responde queda pendiente; nunca se marca sola como no cumplida.
