-- O'quvchi qaysi ustozda o'qishi: ro'yxatdan o'tishda tanlanadi.
-- Yangi o'quvchi so'rovi faqat shu ustozga yuboriladi.
alter table public.users
  add column if not exists teacher_id bigint references public.users (id) on delete set null;

create index if not exists users_teacher_idx
  on public.users (teacher_id) where teacher_id is not null;

comment on column public.users.teacher_id is
  'O''quvchi o''qiydigan ustoz (users.id); tasdiqlash so''rovi shu ustozga boradi.';
