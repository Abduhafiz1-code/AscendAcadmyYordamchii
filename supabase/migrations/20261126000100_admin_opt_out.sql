alter table public.users
  add column if not exists admin_opt_out boolean not null default false;
