alter table public.submissions
  add column if not exists media_file_ids text[] not null default '{}';

alter table public.submissions
  add column if not exists media_message_ids bigint[] not null default '{}';

create table if not exists public.telegram_media_group_items (
  chat_id bigint not null,
  media_group_id text not null,
  message_id bigint not null,
  payload jsonb not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (chat_id, media_group_id, message_id)
);

create index if not exists telegram_media_group_items_pending_idx
  on public.telegram_media_group_items (chat_id, media_group_id, created_at)
  where claimed_at is null;
