-- Ascend Academy — Supabase sxemasi
-- Edge Functions service_role kaliti bilan ishlaydi; RLS yoqilgan, tashqi siyosat yo'q.
-- SQL Editor'da xavfsiz qayta ishga tushiriladi (IF NOT EXISTS / CREATE OR REPLACE).

create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  group_chat_id bigint,
  group_title text,
  tasks_thread_id bigint,
  self_study_thread_id bigint,
  staff_thread_id bigint,
  questions_thread_id bigint,
  invite_code text,
  tz text not null default 'Asia/Tashkent',
  self_study_points numeric(4, 1) not null default 2 check (self_study_points >= 0),
  bot_task_points numeric(4, 1) not null default 3 check (bot_task_points >= 0),
  daily_penalty numeric(4, 1) not null default 5 check (daily_penalty >= 0),
  bot_tasks_per_day integer not null default 3 check (bot_tasks_per_day >= 0),
  ai_tutor_per_day integer not null default 20 check (ai_tutor_per_day >= 0),
  ai_enabled boolean not null default true,
  ai_model text,
  last_penalty_day date,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.users (
  id bigserial primary key,
  tg_id bigint not null unique,
  role text not null default 'student' check (role in ('admin', 'teacher', 'student')),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'rejected', 'blocked')),
  full_name text,
  username text,
  group_name text,
  phone text,
  teacher_id bigint references public.users (id) on delete set null,
  topic_thread_id bigint,
  bot_tasks_date date,
  bot_tasks_count integer not null default 0,
  ai_date date,
  ai_count integer not null default 0,
  approved_at timestamptz,
  approved_by bigint references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_status_idx on public.users (status);
create index if not exists users_role_idx on public.users (role);
create unique index if not exists users_topic_uidx
  on public.users (topic_thread_id) where topic_thread_id is not null;

create table if not exists public.tasks (
  id bigserial primary key,
  kind text not null check (kind in ('personal', 'class', 'self_study', 'bot')),
  prompt text not null,
  title text,
  answer_key text,
  criteria text,
  chat_id bigint,
  thread_id bigint,
  message_id bigint,
  assigned_user_id bigint references public.users (id) on delete cascade,
  points_mode text not null default 'graded' check (points_mode in ('graded', 'fixed')),
  fixed_points numeric(4, 1),
  attachment_file_id text,
  attachment_type text,
  due_at timestamptz,
  reminded_at timestamptz,
  status text not null default 'active' check (status in ('active', 'closed', 'deleted')),
  created_by bigint references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists tasks_kind_idx on public.tasks (kind, status);
create index if not exists tasks_assigned_idx on public.tasks (assigned_user_id, status);
create unique index if not exists tasks_chat_message_uidx
  on public.tasks (chat_id, message_id) where message_id is not null;

create table if not exists public.submissions (
  id bigserial primary key,
  task_id bigint not null references public.tasks (id) on delete cascade,
  user_id bigint not null references public.users (id) on delete cascade,
  chat_id bigint,
  thread_id bigint,
  message_id bigint,
  content_type text not null
    check (content_type in ('text', 'photo', 'voice', 'audio', 'video', 'video_note', 'document', 'sticker')),
  text_content text,
  file_id text,
  file_name text,
  status text not null default 'pending'
    check (status in ('pending', 'ai_graded', 'manual', 'graded', 'missed', 'rejected')),
  ai_score numeric(4, 1),
  ai_feedback text,
  ai_confidence numeric(4, 2),
  ai_model text,
  final_score numeric(4, 1),
  reviewed_by bigint references public.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  graded_at timestamptz
);

create index if not exists submissions_task_idx on public.submissions (task_id, user_id);
create index if not exists submissions_user_idx on public.submissions (user_id, created_at desc);
create index if not exists submissions_status_idx on public.submissions (status);
create unique index if not exists submissions_message_uidx
  on public.submissions (chat_id, message_id) where message_id is not null;

-- Ball daftari: reyting shu jadval yig'indisidan hisoblanadi.
create table if not exists public.point_events (
  id bigserial primary key,
  user_id bigint not null references public.users (id) on delete cascade,
  kind text not null
    check (kind in ('task', 'self_study', 'bot_task', 'penalty', 'adjustment', 'bonus')),
  points numeric(5, 1) not null,
  task_id bigint references public.tasks (id) on delete set null,
  submission_id bigint references public.submissions (id) on delete set null,
  note text,
  day date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists point_events_user_idx on public.point_events (user_id, created_at desc);
create index if not exists point_events_day_idx on public.point_events (day);
-- Bitta vazifa uchun bitta yozuv (qayta baholashda yangilanadi).
create unique index if not exists point_events_user_task_uidx
  on public.point_events (user_id, task_id);
-- Kunlik jarima bir marta.
create unique index if not exists point_events_penalty_uidx
  on public.point_events (user_id, day) where kind = 'penalty';

create table if not exists public.bot_sessions (
  chat_id bigint not null,
  user_id bigint not null references public.users (id) on delete cascade,
  state text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create index if not exists bot_sessions_age_idx on public.bot_sessions (updated_at);

create table if not exists public.processed_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Reyting: p_since = null bo'lsa umumiy, aks holda davr bo'yicha.
-- ---------------------------------------------------------------------------
create or replace function public.leaderboard(
  p_since timestamptz default null,
  p_group_name text default null
)
returns table (
  user_id bigint,
  tg_id bigint,
  full_name text,
  group_name text,
  points numeric,
  tasks_done integer,
  self_study_done integer,
  bot_tasks_done integer,
  penalties integer,
  place integer
)
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select pe.user_id, pe.kind, pe.points
    from point_events pe
    where p_since is null or pe.created_at >= p_since
  ),
  agg as (
    select
      u.id as u_id,
      u.tg_id as u_tg_id,
      coalesce(nullif(btrim(u.full_name), ''), 'O''quvchi') as u_full_name,
      coalesce(nullif(btrim(u.group_name), ''), '—') as u_group_name,
      coalesce(sum(ev.points), 0)::numeric(8, 1) as u_points,
      (count(ev.user_id) filter (where ev.kind = 'task'))::int as u_tasks,
      (count(ev.user_id) filter (where ev.kind = 'self_study'))::int as u_self,
      (count(ev.user_id) filter (where ev.kind = 'bot_task'))::int as u_bot,
      (count(ev.user_id) filter (where ev.kind = 'penalty'))::int as u_penalties
    from users u
    left join ev on ev.user_id = u.id
    where u.role = 'student'
      and u.status = 'active'
      and (p_group_name is null or u.group_name = p_group_name)
    group by u.id, u.tg_id, u.full_name, u.group_name
  )
  select
    agg.u_id,
    agg.u_tg_id,
    agg.u_full_name,
    agg.u_group_name,
    agg.u_points,
    agg.u_tasks,
    agg.u_self,
    agg.u_bot,
    agg.u_penalties,
    (row_number() over (order by agg.u_points desc, agg.u_tasks desc, agg.u_full_name asc))::int
  from agg
  order by agg.u_points desc, agg.u_tasks desc, agg.u_full_name asc;
$$;

revoke all on function public.leaderboard(timestamptz, text) from public;
revoke all on function public.leaderboard(timestamptz, text) from anon, authenticated;
grant execute on function public.leaderboard(timestamptz, text) to service_role;

-- ---------------------------------------------------------------------------
-- Kunlik jarima: o'sha kuni "Vazifalar" ham, "Self study" ham bajarilmasa
-- (ya'ni vazifalar/self-study bo'yicha birorta topshiriq bo'lmasa) -5 ball.
-- Faqat o'sha kuni kamida bitta vazifa mavjud bo'lsa qo'llanadi.
-- ---------------------------------------------------------------------------
create or replace function public.apply_daily_penalties(p_day date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
  v_tz text;
  v_penalty numeric(5, 1);
  v_count integer;
begin
  select s.tz, s.daily_penalty into v_tz, v_penalty
  from app_settings s where s.id;

  v_day := coalesce(p_day, (now() at time zone v_tz)::date);

  insert into point_events (user_id, kind, points, note, day)
  select u.id, 'penalty', -v_penalty, 'Kunlik vazifa bajarilmadi', v_day
  from users u
  where u.role = 'student'
    and u.status = 'active'
    and u.approved_at is not null
    and (u.approved_at at time zone v_tz)::date < v_day
    and exists (
      select 1 from tasks t
      where t.status = 'active'
        and (t.created_at at time zone v_tz)::date <= v_day
        and (
          t.kind in ('class', 'self_study')
          or (t.kind = 'personal' and t.assigned_user_id = u.id)
        )
    )
    and not exists (
      select 1
      from submissions s
      join tasks t on t.id = s.task_id
      where s.user_id = u.id
        and (s.created_at at time zone v_tz)::date = v_day
        and t.kind in ('personal', 'class', 'self_study')
        and s.status <> 'rejected'
    )
  on conflict (user_id, day) where kind = 'penalty' do nothing;

  get diagnostics v_count = row_count;

  update app_settings
  set last_penalty_day = greatest(coalesce(last_penalty_day, v_day), v_day),
      updated_at = now()
  where id;

  return v_count;
end;
$$;

revoke all on function public.apply_daily_penalties(date) from public;
revoke all on function public.apply_daily_penalties(date) from anon, authenticated;
grant execute on function public.apply_daily_penalties(date) to service_role;

-- ---------------------------------------------------------------------------
-- Xavfsizlik: RLS yoqilgan, siyosatlar yo'q => faqat service_role ko'radi.
-- ---------------------------------------------------------------------------
alter table public.app_settings enable row level security;
alter table public.users enable row level security;
alter table public.tasks enable row level security;
alter table public.submissions enable row level security;
alter table public.point_events enable row level security;
alter table public.bot_sessions enable row level security;
alter table public.processed_updates enable row level security;

revoke all on table public.app_settings from anon, authenticated;
revoke all on table public.users from anon, authenticated;
revoke all on table public.tasks from anon, authenticated;
revoke all on table public.submissions from anon, authenticated;
revoke all on table public.point_events from anon, authenticated;
revoke all on table public.bot_sessions from anon, authenticated;
revoke all on table public.processed_updates from anon, authenticated;

comment on table public.point_events is
  'Ball daftari: task (0.5-10), self_study (+2), bot_task (+3), penalty (-5/kun).';
comment on function public.apply_daily_penalties(date) is
  'Kunlik -5 jarimani idempotent qo''llaydi; cron orqali chaqiriladi.';
