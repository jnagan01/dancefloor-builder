DROP POLICY IF EXISTS "Authenticated users can read cached song metadata" ON public.song_metadata_cache;
REVOKE ALL ON public.song_metadata_cache FROM anon, authenticated;
GRANT ALL ON public.song_metadata_cache TO service_role;

CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.cron_tokens (name text PRIMARY KEY, token text NOT NULL);
REVOKE ALL ON private.cron_tokens FROM PUBLIC, anon, authenticated;
INSERT INTO private.cron_tokens(name, token)
VALUES ('weekly-error-digest', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO UPDATE SET token = EXCLUDED.token;

CREATE OR REPLACE FUNCTION public.verify_error_digest_secret(_provided text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(length(_provided) > 0 AND _provided = (
    SELECT token FROM private.cron_tokens WHERE name = 'weekly-error-digest'
  ), false)
$$;
REVOKE ALL ON FUNCTION public.verify_error_digest_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_error_digest_secret(text) TO service_role;

select cron.unschedule('weekly-error-digest') where exists (select 1 from cron.job where jobname = 'weekly-error-digest');
select cron.schedule(
  'weekly-error-digest',
  '0 14 * * 1',
  $cron$
  select net.http_post(
    url := 'https://project--7afbfd53-f801-46a5-b9fd-99f89f38b576.lovable.app/api/public/hooks/weekly-error-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select token from private.cron_tokens where name = 'weekly-error-digest')
    ),
    body := '{}'::jsonb
  );
  $cron$
);