-- Bir nechta guruhda ishlash, guruh bo'yicha o'quvchilar va jarima sozlamalari.
-- Xavfsiz qayta ishga tushiriladi (IF NOT EXISTS).

-- 1) Botga ulangan guruhlar: har bir guruh o'z vazifalari va bo'limlari bilan ishlaydi.
create table if not exists public.bot_chats (
  chat_id    bigint primary key,
  title      text,
  linked_at  timestamptz not null default now()
);

insert into public.bot_chats (chat_id, title)
select group_chat_id, group_title from public.app_settings where group_chat_id is not null
on conflict (chat_id) do nothing;

insert into public.bot_chats (chat_id)
select distinct chat_id from public.tasks where chat_id is not null
on conflict (chat_id) do nothing;

-- 2) Guruh a'zoligi: "O'quvchilar" ro'yxati faqat shu guruhdagilarni ko'rsatadi.
create table if not exists public.chat_members (
  chat_id    bigint not null,
  user_id    bigint not null references public.users (id) on delete cascade,
  last_seen  timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create index if not exists chat_members_user_idx on public.chat_members (user_id);

insert into public.chat_members (chat_id, user_id)
select distinct s.chat_id, s.user_id
from public.submissions s
where s.chat_id is not null
on conflict do nothing;

insert into public.chat_members (chat_id, user_id)
select distinct bc.chat_id, u.id
from public.bot_chats bc
join public.users u on u.group_name = bc.title
where u.role = 'student'
on conflict do nothing;

-- 3) Past natija uchun jarima (qo'shimcha vazifa) chegarasi va uning muddati.
alter table public.app_settings
  add column if not exists penalty_min_percent integer not null default 40
  check (penalty_min_percent between 0 and 100);

alter table public.app_settings
  add column if not exists remedial_due_hours integer not null default 24
  check (remedial_due_hours between 1 and 720);
