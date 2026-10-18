-- Apply AFTER deploying crm-mail and saving MAIL_WORKER_SECRET in Vault.
-- Store the same worker secret in Supabase Vault with name crm_mail_worker_secret.
-- No secret value should be committed to GitHub or embedded in frontend files.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('crm-mail-every-minute','* * * * *', $$
  select net.http_post(
    url := 'https://bccatmfiaawocpgagzzf.supabase.co/functions/v1/crm-mail',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='crm_mail_worker_secret' limit 1)),
    body := '{"action":"worker"}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
