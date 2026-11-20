-- Additive table for synthetic desktop synchronization. Existing events and
-- service-only music caches are neither read nor modified by this migration.
CREATE TABLE public.prototype_sync_documents (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('event','prep','library')),
  entity_id text NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 100),
  revision uuid NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 262144),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id, kind, entity_id)
);
ALTER TABLE public.prototype_sync_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prototype_sync_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.prototype_sync_documents TO authenticated;
GRANT ALL ON public.prototype_sync_documents TO service_role;
CREATE POLICY prototype_sync_select ON public.prototype_sync_documents FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id AND (SELECT auth.jwt()->'app_metadata'->>'setarchitect_environment') = 'prototype-test');
CREATE POLICY prototype_sync_insert ON public.prototype_sync_documents FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT auth.jwt()->'app_metadata'->>'setarchitect_environment') = 'prototype-test');
CREATE POLICY prototype_sync_update ON public.prototype_sync_documents FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id AND (SELECT auth.jwt()->'app_metadata'->>'setarchitect_environment') = 'prototype-test') WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT auth.jwt()->'app_metadata'->>'setarchitect_environment') = 'prototype-test');
CREATE TRIGGER prototype_sync_updated BEFORE UPDATE ON public.prototype_sync_documents FOR EACH ROW EXECUTE FUNCTION public.prototype_event_updated_at();
COMMENT ON TABLE public.prototype_sync_documents IS 'Isolated synthetic desktop event/preparation/library-index copies; no audio, OS paths, sessions or credentials. Revision-checked API; no client delete grant.';
