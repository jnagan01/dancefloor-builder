import { z } from 'zod';
import { META_ATTRS, sourceRank, type MetaAttr } from '../prep/provenance';

const text = (n: number) => z.string().max(n).refine(v => !/[\u0000-\u001f\u007f]/.test(v));
const score = z.number().finite().min(0).max(10);
const tags = z.array(text(60)).max(20);
const similar = z.array(z.object({ artist: text(300), title: text(300), match: z.number().min(0).max(1) }).strict()).max(30);
const url = z.string().max(1800).refine(v => { try { const u = new URL(v); return u.protocol === 'https:' && ['musicbrainz.org', 'www.last.fm', 'last.fm'].includes(u.hostname); } catch { return false; } });
export const MetadataSchema = z.object({ artist: text(300), song: text(300), source: z.enum(['ReccoBeats+MusicBrainz','ReccoBeats+AI','ReccoBeats','MusicBrainz','AI','cache','none']), energy: score.optional(), danceability: score.optional(), valence: score.optional(), popularity: score.optional(), bpm: z.number().min(1).max(400).optional(), year: z.number().int().min(1900).max(2099).optional(), camelot: text(8).optional(), genre: text(60).optional(), prov: z.partialRecord(z.enum(META_ATTRS), z.enum(['provider','ai','estimate','measured','user','tags','virtualdj','catalogue','filename','unknown']).optional()).optional(), checked: z.partialRecord(z.enum(META_ATTRS),z.number().finite().min(0)).optional(), updated: z.partialRecord(z.enum(META_ATTRS),z.number().finite().min(0)).optional(), missed: z.partialRecord(z.enum(META_ATTRS),z.number().finite().min(0)).optional(), incomplete: z.boolean().optional() }).strip();
export const schemas = {
  metadata: MetadataSchema,
  artist: z.object({ name: text(300), listeners: z.number().finite().min(0).max(1e12), playcount: z.number().finite().min(0).max(1e15), tags, similar: z.array(z.object({ name: text(300), match:z.number().min(0).max(1) }).strict()).max(20) }).strict(),
  similar: z.object({ seed: z.object({ artist:text(300), title:text(300) }).strict(), status:z.enum(['ok','notFound']), similar }).strict(),
  community: z.object({ source:z.literal('lastfm'), listeners:z.number().int().min(0).max(1e10).optional(), slowTags:tags, upbeatTags:tags }).strict(),
  mb: z.array(z.object({ id:text(60), title:text(300), artist:text(300), disambiguation:text(200), lengthSec:z.number().finite().min(0).max(86400).nullable(), firstRelease:text(20).nullable(), releases:z.array(text(200)).max(5), tags, isrcs:z.array(text(20)).max(5), score:z.number().finite().min(0).max(100), url }).strict()).max(8),
  lastfm: z.object({ available:z.literal(true), tags, similar, url:url.nullable(), compatible:z.array(z.object({key:text(1400),kind:z.enum(['similar','community']),value:z.unknown(),at:z.number().finite().min(0)}).strict()).max(2).optional() }).strict(),
};
export type Kind = keyof typeof schemas;
export const DAY = 86400_000;
export const FRESH_MS: Record<Kind,number> = { metadata:365*DAY, artist:6*3600_000, similar:6*3600_000, community:DAY, mb:365*DAY, lastfm:DAY };
export function entryLifetime(e:Entry):number { return (e.kind==='mb'&&Array.isArray(e.value)&&e.value.length===0)||(e.kind==='similar'&&(e.value as {status?:string}).status==='notFound')?DAY:FRESH_MS[e.kind]; }
export const MAX_ENTRY_BYTES=65536;
export const MAX_LOCAL_ENTRIES=3000;
export const MAX_RETAIN_MS=365*DAY;
export type WireEntry = Omit<Entry,'value'> & {value:import('@/integrations/supabase/types').Json};
export interface Entry { key:string; kind:Kind; value:unknown; at:number }
export interface ReuseCounts { local:number; database:number; external:number; missing:number; readFailed:number; writeFailed:number; refreshFailed:number }
export const emptyCounts = ():ReuseCounts => ({ local:0,database:0,external:0,missing:0,readFailed:0,writeFailed:0,refreshFailed:0 });
// Complete credit and literal version descriptors remain in the key. No basename or primary-only aliases.
/** Exact literal identity (NFC, collapsed whitespace, case-folded); every credit and version word is retained. */
export const literalKey=(s:string)=>s.normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase();
export function informationKey(kind:Kind, artist:string, title='', shape=''):string {
  return JSON.stringify([kind,literalKey(artist),literalKey(title),shape]);
}
export function validatedEntry(input:unknown, now=Date.now()):Entry|null {
  if (!input || typeof input!=='object') return null;
  const e=input as Entry;
  if (typeof e.kind!=='string' || !Object.hasOwn(schemas,e.kind) || typeof e.key!=='string' || e.key.length>1400 || !Number.isFinite(e.at) || e.at<0 || e.at>now+60000 || now-e.at>(e.kind==='metadata'?730*DAY:MAX_RETAIN_MS)) return null;
  const parsed=schemas[e.kind].safeParse(e.value);
  if (!parsed.success) return null;
  let parts:unknown;
  try {parts=JSON.parse(e.key);}catch{return null;}
  if(!Array.isArray(parts)||parts.length!==4||parts[0]!==e.kind||parts.some(v=>typeof v!=='string')||informationKey(e.kind,parts[1],parts[2],parts[3])!==e.key)return null;
  const value=parsed.data as Record<string,unknown>;
  if(e.kind==='metadata' && informationKey(e.kind,String(value.artist),String(value.song),parts[3])!==e.key)return null;
  if(e.kind==='similar') {const seed=value.seed as {artist:string;title:string};if(informationKey(e.kind,seed.artist,seed.title,parts[3])!==e.key)return null;}
  if(e.kind==='artist' && informationKey(e.kind,String(value.name),'',parts[3])!==e.key)return null;
  for(const dates of [value.updated,value.checked,value.missed])if(dates&&typeof dates==='object'&&Object.values(dates).some(t=>typeof t!=='number'||t>now+60000))return null;
  if(e.kind==='lastfm'&&Array.isArray(value.compatible)&&value.compatible.some(c=>!validatedEntry(c,now)))return null;
  const clean={key:e.key,kind:e.kind,value:parsed.data,at:e.at};
  return new TextEncoder().encode(JSON.stringify(clean)).length<=MAX_ENTRY_BYTES ? clean:null;
}
export function fieldLifetime(attr:MetaAttr, prov:unknown):number {
  return attr==='popularity'?7*DAY:sourceRank(prov as Parameters<typeof sourceRank>[0])>=sourceRank('provider')?365*DAY:30*DAY;
}
/** A definitive provider miss (catalogue 404/no exact recording, never a transient failure) defers re-asking providers. */
export const MISS_COOLDOWN_MS=DAY;
type Dated={prov?:Partial<Record<MetaAttr,unknown>>;checked?:Partial<Record<MetaAttr,number>>;updated?:Partial<Record<MetaAttr,number>>;missed?:Partial<Record<MetaAttr,number>>}&Partial<Record<MetaAttr,unknown>>;
const lastChecked=(v:Dated,a:MetaAttr,at:number)=>v.checked?.[a]??v.updated?.[a]??at;
/** Known value older than its provenance lifetime (by last successful check, not value-change date). */
export function fieldStale(v:Dated,a:MetaAttr,at:number,now=Date.now()):boolean { return v[a]!=null && now-lastChecked(v,a,at)>=fieldLifetime(a,v.prov?.[a]); }
export function recentMiss(v:Dated,a:MetaAttr,now=Date.now()):boolean { const m=v.missed?.[a]; return typeof m==='number'&&m<=now+60000&&now-m<MISS_COOLDOWN_MS; }
/** Shared server/local decision: a stale known field needs a provider refresh unless providers definitively missed it recently. */
export function fieldDue(v:Dated,a:MetaAttr,at:number,now=Date.now()):boolean { return fieldStale(v,a,at,now)&&!recentMiss(v,a,now); }
/** Stale AI-or-weaker value: eligible for one bounded advisory re-estimate (renews its check date only on success). */
export function advisoryStale(v:Dated,a:MetaAttr,at:number,now=Date.now()):boolean { return fieldStale(v,a,at,now)&&sourceRank((v.prov?.[a]??'estimate') as Parameters<typeof sourceRank>[0])<=sourceRank('ai'); }
/** Local reuse is allowed only when the server would do no refresh work for any needed known field. */
export function freshMetadata(value:unknown, at:number, needPopularity=false, now=Date.now()):boolean {
  const p=MetadataSchema.safeParse(value); if(!p.success || p.data.incomplete) return false;
  const e=p.data as Dated;
  if(e.energy==null||e.danceability==null||(needPopularity&&e.popularity==null))return false;
  return META_ATTRS.filter(a=>a!=='popularity'||needPopularity).every(a=>!fieldDue(e,a,at,now)&&!advisoryStale(e,a,at,now));
}
const rankOf=(p:unknown)=>sourceRank((p??'unknown') as Parameters<typeof sourceRank>[0]);
/** Per-field provenance/date merge (same ordering as the SQL trigger): a weaker, older or absent field never replaces a
 * stronger/newer stored one; unchanged values keep their value-change date; checked and missed dates stay independent. */
export function mergeEntries(old:Entry|null, next:Entry):Entry {
  if(!old||old.key!==next.key||old.kind!==next.kind)return next;
  if(next.kind!=='metadata')return old.at>next.at?old:next;
  const o=old.value as Dated&Record<string,unknown>, n=next.value as Dated&Record<string,unknown>;
  const v:Record<string,unknown>&Dated={...n,prov:{...n.prov},checked:{...n.checked},updated:{...n.updated},missed:{...o.missed}};
  for(const [a,t] of Object.entries(n.missed??{}))if(typeof t==='number'&&!(((v.missed as Record<string,number>)[a]??-1)>t))(v.missed as Record<string,number>)[a]=t;
  for(const a of META_ATTRS){
    if(o[a]==null)continue;
    const ot=lastChecked(o,a,old.at), nt=lastChecked(n,a,next.at), or=rankOf(o.prov?.[a]), nr=rankOf(n.prov?.[a]);
    if(n[a]==null||nr<or||(nr===or&&nt<ot)){
      v[a]=o[a];v.prov![a]=o.prov?.[a]??'unknown';v.updated![a]=o.updated?.[a]??ot;v.checked![a]=ot;
    } else if(n[a]===o[a]&&n.prov?.[a]===o.prov?.[a]) v.updated![a]=o.updated?.[a]??ot;
  }
  if(!Object.keys(v.missed!).length)delete v.missed;
  return {key:next.key,kind:next.kind,value:v,at:Math.max(old.at,next.at)};
}
export function reuseSummary(c:ReuseCounts):string {
  return `Track information: ${c.local} reused on this device, ${c.database} reused from saved online information, ${c.external} new provider checks, ${c.missing} missing details. ${c.readFailed+c.writeFailed} storage failures; ${c.refreshFailed} refresh failures.`;
}
