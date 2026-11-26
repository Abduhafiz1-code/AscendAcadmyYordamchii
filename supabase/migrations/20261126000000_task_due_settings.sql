alter table public.app_settings
  add column if not exists default_due_hours integer not null default 48
  check (default_due_hours between 1 and 720);
