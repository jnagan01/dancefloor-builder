REVOKE ALL ON TABLE public.track_evidence_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.track_evidence_cache TO service_role;