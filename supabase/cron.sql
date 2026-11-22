-- Supabase cron: worker Edge Function'ni muntazam chaqirish (ixtiyoriy, lekin tavsiya).
--
-- 1) Dashboard -> Integrations -> Cron orqali ham sozlash mumkin (Docker kerak emas).
-- 2) SQL bilan sozlash uchun avval Vault'da ikkita sirni saqlang:
--
--    select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/worker',
--                               'ascend_worker_url');
--    select vault.create_secret('<WORKER_SECRET>', 'ascend_worker_secret');
--
-- 3) So'ng shu faylni SQL Editor'da ishga tushiring.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Har 30 daqiqada: muddat eslatmalari va o'tib ketgan vazifalar.
select cron.schedule(
  'ascend-worker-tick',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'ascend_worker_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets
                          where name = 'ascend_worker_secret')
    ),
    body := jsonb_build_object('action', 'tick')::jsonb
  );
  $$
);

-- Har kuni 16:00 UTC = 21:00 Toshkent: kunlik jarima, hisobot va haftalik reyting.
select cron.schedule(
  'ascend-worker-daily',
  '0 16 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'ascend_worker_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets
                          where name = 'ascend_worker_secret')
    ),
    body := jsonb_build_object('action', 'daily')::jsonb
  );
  $$
);

-- Har yakshanba 15:00 UTC = 20:00 Toshkent: haftalik reyting e'loni (rasm bilan).
select cron.schedule(
  'ascend-worker-weekly',
  '0 15 * * 0',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'ascend_worker_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets
                          where name = 'ascend_worker_secret')
    ),
    body := jsonb_build_object('action', 'weekly')::jsonb
  );
  $$
);

-- Tekshirish:
-- select jobname, schedule, active from cron.job order by jobname;
-- select * from cron.job_run_details order by start_time desc limit 10;
