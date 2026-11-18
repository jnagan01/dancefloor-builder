CREATE TABLE public.track_evidence_cache (
  cache_key text PRIMARY KEY,
  kind text NOT NULL,
  value jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT track_evidence_key_bound CHECK (length(cache_key) <= 1400),
  CONSTRAINT track_evidence_kind CHECK (kind IN ('artist','similar','community','mb','lastfm','metadata')),
  CONSTRAINT track_evidence_value_bound CHECK (octet_length(value::text) <= 65536)
);
GRANT ALL ON public.track_evidence_cache TO service_role;
ALTER TABLE public.track_evidence_cache ENABLE ROW LEVEL SECURITY;
CREATE INDEX track_evidence_fetched_idx ON public.track_evidence_cache (fetched_at);
COMMENT ON TABLE public.track_evidence_cache IS 'Service-only bounded parsed public evidence; no event, library, audio, user notes or credentials.';