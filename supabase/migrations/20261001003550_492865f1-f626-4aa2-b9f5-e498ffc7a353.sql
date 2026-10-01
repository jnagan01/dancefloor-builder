create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('weekly-error-digest') where exists (select 1 from cron.job where jobname = 'weekly-error-digest');

select cron.schedule(
  'weekly-error-digest',
  '0 14 * * 1',
  $$
  select net.http_post(
    url := 'https://project--7afbfd53-f801-46a5-b9fd-99f89f38b576.lovable.app/api/public/hooks/weekly-error-digest',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "Qw_YxCiBepY0HtyZkB1UbfGFtPysNaFG"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);