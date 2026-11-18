import { z } from 'zod';
import { META_ATTRS, sourceRank, type MetaAttr } from '../prep/provenance';

const text = (n: number) => z.string().max(n).refine(v => !/[\u0000-\u001f\u007f]/.test(v));
const score = z.number().finite().min(0).max(10);
const tags = z.array(text(60)).max(20);
const similar = z.array(z.object({ artist: text(300), title: text(300), match: z.number().min(0).max(1) }).strict()).max(30);
const url = z.string().max(1800).refine(v => { try { const u = new URL(v); return u.protocol === 'https:' && ['musicbrainz.org', 'www.last.fm', 'last.fm'].includes(u.hostname); } catch { return false; } });
export const MetadataSchema = z.object({ artist: text(300), song: text(300), source: z.enum(['ReccoBeats+MusicBrainz','ReccoBeats','MusicBrainz','AI','cache','none']), energy: score.optional(), danceability: score.optional(), valence: score.optional(), popularity: score.optional(), bpm: z.number().min(1).max(400).optional(), year: z.number().int().min(1900).max(2099).optional(), camelot: text(8).optional(), genre: text(60).optional(), prov: z.partialRecord(z.enum(META_ATTRS), z.enum(['provider','ai','estimate','measured','user','tags','virtualdj','catalogue','filename','unknown']).optional()).optional(), updated: z.partialRecord(z.enum(META_ATTRS),z.number().finite().min(0)).optional(), incomplete: z.boolean().optional() }).strip();
export const schemas = {
  metadata: MetadataSchema,
  artist: z.object({ name: text(300), listeners: z.number().finite().min(0).max(1e12), playcount: z.number().finite().min(0).max(1e15), tags, similar: z.array(z.object({ name: text(300), match:z.number().min(0).max(1) }).strict()).max(20) }).strict(),
  similar: z.object({ seed: z.object({ artist:text(300), title:text(300) }).strict(), status:z.enum(['ok','notFound']), similar }).strict(),
  community: z.object({ source:z.literal('lastfm'), listeners:z.number().int().min(0).max(1e10).optional(), slowTags:tags, upbeatTags:tags }).strict(),
  mb: z.array(z.object({ id:text(60), title:text(300), artist:text(300), disambiguation:text(200), lengthSec:z.number().finite().min(0).max(86400).nullable(), firstRelease:text(20).nullable(), releases:z.array(text(200)).max(5), tags, isrcs:z.array(text(20)).max(5), score:z.number().finite().min(0).max(100), url }).strict()).max(8),
  lastfm: z.object({ available:z.literal(true), tags, similar, url:url.nullable() }).strict(),
};
export type Kind = keyof typeof schemas;
export const DAY = 86400_000;
export const FRESH_MS: Record<Kind,number> = { metadata:365*DAY, artist:6*3600_000, similar:6*3600_000, community:DAY, mb:365*DAY, lastfm:DAY };
export const MAX_ENTRY_BYTES=65536;
export const MAX_LOCAL_ENTRIES=3000;
export const MAX_RETAIN_MS=365*DAY;
export interface Entry { key:string; kind:Kind; value:unknown; at:number }
export interface ReuseCounts { local:number; database:number; external:number; missing:number; readFailed:number; writeFailed:number; refreshFailed:number }
export const emptyCounts = ():ReuseCounts => ({ local:0,database:0,external:0,missing:0,readFailed:0,writeFailed:0,refreshFailed:0 });
// Complete credit and literal version descriptors remain in the key. No basename or primary-only aliases.
export function informationKey(kind:Kind, artist:string, title='', shape=''):string {
  const norm=(s:string)=>s.normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase();
  return JSON.stringify([kind,norm(artist),norm(title),shape]);
}
export function validatedEntry(input:unknown, now=Date.now()):Entry|null {
  if (!input || typeof input!=='object') return null;
  const e=input as Entry;
  if (!(e.kind in schemas) || typeof e.key!=='string' || e.key.length>1400 || !Number.isFinite(e.at) || e.at<0 || e.at>now+60000 || now-e.at>MAX_RETAIN_MS) return null;
  const parsed=schemas[e.kind].safeParse(e.value);
  if (!parsed.success) return null;
  const clean={key:e.key,kind:e.kind,value:parsed.data,at:e.at};
  return new TextEncoder().encode(JSON.stringify(clean)).length<=MAX_ENTRY_BYTES ? clean:null;
}
export function fieldLifetime(attr:MetaAttr, prov:unknown):number {
  return attr==='popularity'?7*DAY:sourceRank(prov as Parameters<typeof sourceRank>[0])>=sourceRank('provider')?365*DAY:30*DAY;
}
export function freshMetadata(value:unknown, at:number, needPopularity=false, now=Date.now()):boolean {
  const p=MetadataSchema.safeParse(value); if(!p.success || p.data.incomplete) return false;
  const e=p.data;
  return (['energy','danceability',...(needPopularity?['popularity']:[])] as MetaAttr[]).every(a => e[a]!=null && now-(e.updated?.[a]??at)<fieldLifetime(a,e.prov?.[a]));
}
export function reuseSummary(c:ReuseCounts):string {
  return `Track information: ${c.local} reused on this device, ${c.database} reused from saved online information, ${c.external} new provider checks, ${c.missing} missing details. ${c.readFailed+c.writeFailed} storage failures; ${c.refreshFailed} refresh failures.`;
}
