-- Guruh bo'limlari (topics): bot bo'limni o'zi o'rganadi, admin /bolim bilan tur beradi.
-- Kodda thread_id qotirilmaydi — bo'limlar o'zgarsa ham bot moslashadi.
create table if not exists public.topics (
  id          bigserial primary key,
  chat_id     bigint not null,
  thread_id   bigint not null default 0,          -- 0 = General
  name        text,
  type        text not null default 'ignore'
              check (type in ('task', 'questions', 'ignore')),
  track       text,                                -- self_study / writing / speaking ...
  last_seen   timestamptz not null default now(),
  unique (chat_id, thread_id)
);

create index if not exists topics_chat_idx on public.topics (chat_id);

-- Ustoz taklif havolalari: bir martalik, muddatli, rol beradi.
create table if not exists public.invites (
  code        text primary key,
  role        text not null default 'teacher' check (role in ('teacher', 'admin')),
  created_by  bigint references public.users (id) on delete set null,
  expires_at  timestamptz not null,
  used_by     bigint,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.topics enable row level security;
alter table public.invites enable row level security;

revoke all on table public.topics from anon, authenticated;
revoke all on table public.invites from anon, authenticated;

comment on table public.topics is
  'Guruh bo''limlari: type = task | questions | ignore; track = self_study va h.k.';
comment on table public.invites is
  'Bir martalik taklif havolalari (/ustoz_taklif).';
