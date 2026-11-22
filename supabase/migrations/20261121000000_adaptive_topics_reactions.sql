-- Moslashuvchan bo'limlar, DM holati, fikr-mulohazalar.
-- Xavfsiz qayta ishga tushiriladi (IF NOT EXISTS).

-- 1) Bo'lim turlariga "announce" (reyting / e'lonlar) qo'shiladi.
alter table public.topics drop constraint if exists topics_type_check;
alter table public.topics
  add constraint topics_type_check
  check (type in ('task', 'questions', 'announce', 'ignore'));

-- Bot yangi bo'limni ustozlarga bir marta xabar qiladi.
alter table public.topics add column if not exists announced boolean not null default false;
update public.topics set announced = true where type <> 'ignore';

-- 2) O'quvchiga shaxsiy xabar yuborish mumkinmi (u botga /start bosganmi).
alter table public.users add column if not exists dm_open boolean not null default false;
alter table public.users add column if not exists dm_nudged_at timestamptz;

-- 3) Fikr-mulohazalar: o'quvchilar nimani yangilash kerakligini yozadi.
create table if not exists public.feedback (
  id          bigserial primary key,
  user_id     bigint references public.users (id) on delete set null,
  text        text not null check (char_length(text) between 3 and 2000),
  status      text not null default 'new' check (status in ('new', 'seen', 'done')),
  created_at  timestamptz not null default now()
);
create index if not exists feedback_status_idx on public.feedback (status, created_at desc);
alter table public.feedback enable row level security;
revoke all on table public.feedback from anon, authenticated;

-- 4) Onboarding bir marta ko'rsatiladi.
alter table public.users add column if not exists onboarded boolean not null default false;

-- 5) Hafta o'rtasidagi tezkor "bugungi topshirganlar" so'rovi uchun indeks.
create index if not exists submissions_created_idx on public.submissions (created_at desc);
