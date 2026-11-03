-- Sistema de objetivos personales: esquema inicial
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.objectives (
  id text primary key,
  emoji text not null,
  name text not null,
  short text not null,
  goal text not null,
  start_date date not null,
  end_date date not null,
  sort int not null default 0
);

create table public.holidays (
  day date primary key,
  name text not null,
  type text not null check (type in ('feriado', 'no_laborable'))
);

-- Cada fila es una pregunta de seguimiento: qué meta, qué día, cuándo avisar y qué respondió.
create table public.checks (
  id bigint generated always as identity primary key,
  objective_id text not null references public.objectives(id),
  kind text not null,              -- ahorro | gym | detox_trabajo | detox_dia | ruso
  day date not null,               -- día al que se refiere la meta
  meta text not null,
  question text not null,
  notify_at timestamptz,           -- cuándo preguntar (null = registro manual, sin pregunta)
  status text not null default 'pendiente' check (status in ('pendiente', 'cumplido', 'no_cumplido')),
  answered_at timestamptz,
  sent_at timestamptz,
  tg_message_id bigint,
  value jsonb,                     -- ahorro: {mes, monto, saldo, mep, usd}
  week int,
  created_at timestamptz not null default now(),
  unique (kind, day)
);
create index checks_due_idx on public.checks (notify_at) where status = 'pendiente' and sent_at is null;
create index checks_obj_day_idx on public.checks (objective_id, day);

create table public.settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

create table public.daily_log (
  day date primary key,
  sent_at timestamptz not null default now()
);

create table public.app_secrets (
  key text primary key,
  value text not null
);

-- Solo la Edge Function (service role) accede a los datos.
alter table public.objectives enable row level security;
alter table public.holidays enable row level security;
alter table public.checks enable row level security;
alter table public.settings enable row level security;
alter table public.daily_log enable row level security;
alter table public.app_secrets enable row level security;
revoke all on public.objectives, public.holidays, public.checks, public.settings, public.daily_log, public.app_secrets from anon, authenticated;
