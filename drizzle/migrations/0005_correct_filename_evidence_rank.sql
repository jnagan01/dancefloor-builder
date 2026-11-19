CREATE OR REPLACE FUNCTION public.merge_track_evidence_update() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE a text; old_rank integer; new_rank integer; old_time numeric; new_time numeric; v jsonb;
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
 NEW.value := v; NEW.fetched_at := greatest(NEW.fetched_at,OLD.fetched_at); RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.merge_track_evidence_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_track_evidence_update() TO service_role;