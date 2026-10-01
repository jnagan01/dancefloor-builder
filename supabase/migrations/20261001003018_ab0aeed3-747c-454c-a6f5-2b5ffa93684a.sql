CREATE TABLE public.app_errors (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  severity text NOT NULL DEFAULT 'minor',
  category text NOT NULL DEFAULT 'runtime',
  message text NOT NULL,
  stack text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  fingerprint text NOT NULL DEFAULT '',
  alerted_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX app_errors_created_at_idx ON public.app_errors (created_at DESC);
CREATE INDEX app_errors_fingerprint_idx ON public.app_errors (fingerprint, created_at DESC);

GRANT SELECT ON public.app_errors TO authenticated;
GRANT ALL ON public.app_errors TO service_role;

ALTER TABLE public.app_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view error log"
ON public.app_errors
FOR SELECT
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role));