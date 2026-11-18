import { validatedEntry, type Entry } from './schema';
export interface EvidenceStorage { read(keys:string[]):Promise<Entry[]>; write(entry:Entry):Promise<void> }
export function createEvidenceStorage():EvidenceStorage {
  return {
    async read(keys) {
      const { supabaseAdmin }=await import('@/integrations/supabase/client.server');
      const {data,error}=await supabaseAdmin.from('track_evidence_cache').select('cache_key,kind,value,fetched_at').in('cache_key',keys.slice(0,200));
      if(error) throw new Error('Evidence cache read unavailable');
      return (data??[]).flatMap(r=>{const e=validatedEntry({key:r.cache_key,kind:r.kind,value:r.value,at:Date.parse(r.fetched_at)});return e?[e]:[];});
    },
    async write(input) {
      const e=validatedEntry(input); if(!e) throw new Error('Invalid evidence');
      const { supabaseAdmin }=await import('@/integrations/supabase/client.server');
      const {error}=await supabaseAdmin.from('track_evidence_cache').upsert({cache_key:e.key,kind:e.kind,value:e.value as import('@/integrations/supabase/types').Json,fetched_at:new Date(e.at).toISOString()});
      if(error) throw new Error('Evidence cache write unavailable');
    },
  };
}
