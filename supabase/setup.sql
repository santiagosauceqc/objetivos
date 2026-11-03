-- Se ejecuta una vez, después de la migración y del despliegue de la función "bot".
-- Reemplazar __BOT_TOKEN__ y __PROJECT_URL__ antes de correrlo.
insert into public.app_secrets (key, value) values
  ('bot_token', '__BOT_TOKEN__'),
  ('functions_url', '__PROJECT_URL__/functions/v1'),
  ('webhook_secret', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  ('cron_secret',    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  ('dash_key',       replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- Reloj: cada minuto revisa qué preguntas toca mandar y el resumen de las 7:10.
select cron.schedule('objetivos-tick', '* * * * *', $$
  select net.http_post(
    url := (select value from public.app_secrets where key = 'functions_url') || '/bot/tick',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select value from public.app_secrets where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$$);
