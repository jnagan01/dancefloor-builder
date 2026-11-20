-- Dedicated empty test project only. No production records or roles are copied.
CREATE TABLE public.workflow_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(name) <= 200 AND name LIKE 'Prototype %'),
 inputs jsonb NOT NULL,
 lists jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workflow_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_history FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.workflow_history TO authenticated;
GRANT ALL ON public.workflow_history TO service_role;
CREATE POLICY own_event_select ON public.workflow_history FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY own_event_insert ON public.workflow_history FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY own_event_update ON public.workflow_history FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE INDEX workflow_history_user_id_created_at_idx ON public.workflow_history(user_id,created_at DESC);
CREATE FUNCTION public.prototype_event_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN NEW.updated_at = pg_catalog.clock_timestamp(); RETURN NEW; END; $$;
REVOKE ALL ON FUNCTION public.prototype_event_updated_at() FROM PUBLIC, anon;
CREATE TRIGGER prototype_event_updated_at BEFORE UPDATE ON public.workflow_history FOR EACH ROW EXECUTE FUNCTION public.prototype_event_updated_at();
CREATE TABLE public.song_metadata_cache (
  artist_key text NOT NULL,
  song_key text NOT NULL,
  energy real,
  danceability real,
  valence real,
  popularity real,
  bpm real,
  camelot text,
  musical_key text,
  genre text,
  year integer,
  source text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artist_key, song_key)
);


ALTER TABLE public.song_metadata_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.song_metadata_cache FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.song_metadata_cache TO service_role;
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
REVOKE ALL ON TABLE public.track_evidence_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.track_evidence_cache TO service_role;
CREATE OR REPLACE FUNCTION public.merge_track_evidence_update() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE a text; m jsonb; mk text; mt numeric; old_rank integer; new_rank integer; old_time numeric; new_time numeric; v jsonb;
BEGIN
 IF OLD.kind <> NEW.kind THEN RAISE EXCEPTION 'Evidence kind mismatch'; END IF;
 IF NEW.kind <> 'metadata' THEN
   IF NEW.fetched_at < OLD.fetched_at THEN RETURN OLD; END IF;
   RETURN NEW;
 END IF;
 v := NEW.value;
 FOREACH a IN ARRAY ARRAY['energy','danceability','valence','popularity','bpm','camelot','genre','year'] LOOP
  IF OLD.value ? a THEN
   old_rank := CASE OLD.value->'prov'->>a WHEN 'user' THEN 12 WHEN 'measured' THEN 10 WHEN 'tags' THEN 8 WHEN 'virtualdj' THEN 8 WHEN 'provider' THEN 6 WHEN 'catalogue' THEN 4 WHEN 'ai' THEN 3 WHEN 'estimate' THEN 2 WHEN 'filename' THEN 2 ELSE 0 END;
   new_rank := CASE NEW.value->'prov'->>a WHEN 'user' THEN 12 WHEN 'measured' THEN 10 WHEN 'tags' THEN 8 WHEN 'virtualdj' THEN 8 WHEN 'provider' THEN 6 WHEN 'catalogue' THEN 4 WHEN 'ai' THEN 3 WHEN 'estimate' THEN 2 WHEN 'filename' THEN 2 ELSE 0 END;
   old_time := COALESCE((OLD.value->'checked'->>a)::numeric,(OLD.value->'updated'->>a)::numeric,extract(epoch FROM OLD.fetched_at)*1000);
   new_time := COALESCE((NEW.value->'checked'->>a)::numeric,(NEW.value->'updated'->>a)::numeric,extract(epoch FROM NEW.fetched_at)*1000);
   IF NOT (NEW.value ? a) OR new_rank < old_rank OR (new_rank = old_rank AND new_time < old_time) THEN
    v := jsonb_set(v,ARRAY[a],OLD.value->a);
    v := jsonb_set(v,'{prov}',COALESCE(v->'prov','{}'::jsonb) || jsonb_build_object(a,COALESCE(OLD.value->'prov'->a,'"unknown"'::jsonb)));
    v := jsonb_set(v,'{updated}',COALESCE(v->'updated','{}'::jsonb) || jsonb_build_object(a,COALESCE(OLD.value->'updated'->a,to_jsonb(old_time))));
    v := jsonb_set(v,'{checked}',COALESCE(v->'checked','{}'::jsonb) || jsonb_build_object(a,to_jsonb(old_time)));
   ELSIF NEW.value->a = OLD.value->a AND NEW.value->'prov'->a IS NOT DISTINCT FROM OLD.value->'prov'->a THEN
    v := jsonb_set(v,'{updated}',COALESCE(v->'updated','{}'::jsonb) || jsonb_build_object(a,COALESCE(OLD.value->'updated'->a,to_jsonb(old_time))));
   END IF;
  END IF;
 END LOOP;
 -- Definitive-miss cooldown dates merge per field as max(old,new), independently of value/checked/updated dates.
 m := CASE WHEN jsonb_typeof(OLD.value->'missed')='object' THEN OLD.value->'missed' ELSE '{}'::jsonb END;
 IF jsonb_typeof(NEW.value->'missed')='object' THEN
  FOR mk, mt IN SELECT key, (value#>>'{}')::numeric FROM jsonb_each(NEW.value->'missed') WHERE jsonb_typeof(value)='number' LOOP
   IF NOT (m ? mk) OR jsonb_typeof(m->mk)<>'number' OR (m->>mk)::numeric <= mt THEN m := m || jsonb_build_object(mk,mt); END IF;
  END LOOP;
 END IF;
 IF m = '{}'::jsonb THEN v := v - 'missed'; ELSE v := jsonb_set(v,'{missed}',m); END IF;
 NEW.value := v; NEW.fetched_at := greatest(NEW.fetched_at,OLD.fetched_at); RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.merge_track_evidence_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_track_evidence_update() TO service_role;
CREATE TRIGGER preserve_track_evidence BEFORE UPDATE ON public.track_evidence_cache FOR EACH ROW EXECUTE FUNCTION public.merge_track_evidence_update();
