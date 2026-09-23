-- ============================================================
-- Phase 12 — Schedule confirmation runner
-- ============================================================
--
-- Runs every minute.
--
-- Reads the scheduler secret from Supabase Vault and performs
-- an authenticated POST to the internal HelloPx scheduler
-- endpoint.
--
-- The endpoint itself decides whether there is actual work.
-- ============================================================


-- Remove previous job with the same name if this migration
-- is ever reapplied in a reconstructed environment.
do $$
declare
  v_job_id bigint;
begin

  select jobid
  into v_job_id
  from cron.job
  where jobname = 'hellopx-confirmation-scheduler'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

end;
$$;


-- Schedule one global runner every minute.
select cron.schedule(
  'hellopx-confirmation-scheduler',
  '* * * * *',
  $cron$

    select net.http_post(
      url := 'https://hellopx.app/api/internal/scheduler/confirmations',

      body := '{}'::jsonb,

      params := '{}'::jsonb,

      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'hellopx_scheduler_secret'
          limit 1
        ),

        'Content-Type',
        'application/json'
      ),

      timeout_milliseconds := 15000
    );

  $cron$
);