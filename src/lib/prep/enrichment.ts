/**
 * Client-side guards for on-demand lookups: a result is applied only if the account,
 * subject (track) and request generation are all still the ones that started it.
 */
export function createLookupGuard() {
  let gen = 0, controller: AbortController | null = null;
  return {
    begin(account: string | null, subject: string) {
      controller?.abort(); controller = new AbortController();
      const token = { gen: ++gen, account, subject, signal: controller.signal };
      return token;
    },
    current(token: { gen: number; account: string | null; subject: string }, account: string | null, subject: string) {
      return token.gen === gen && token.account === account && token.subject === subject && !!account;
    },
    cancel() { gen++; controller?.abort(); controller = null; },
  };
}

const VERSION_WORDS = /\b(remix|mix|edit|version|live|acoustic|instrumental|extended|radio|clean|dirty|explicit|remaster(?:ed)?|dub|vip|bootleg|mashup|cover|karaoke|acapella)\b/gi;
const VW = new RegExp(VERSION_WORDS.source, "i");
const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\(.*?\)|\[.*?\]/g, m => ` ${m} `).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
const versionSet = (s: string) => new Set((s.match(VERSION_WORDS) ?? []).map(w => w.toLowerCase()));

/** Compare a local file to an external candidate without merging different versions. */
export function compareCandidate(local: { artist: string; title: string; remix?: string; durationSec?: number }, cand: { artist: string; title: string; disambiguation?: string; lengthSec?: number | null }) {
  const lt = new Set(words(local.title).filter(w => !VW.test(w))), ct = new Set(words(cand.title).filter(w => !VW.test(w)));
  const overlap = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let n = 0; a.forEach(x => { if (b.has(x)) n++; }); return n / Math.max(a.size, b.size); };
  const titleSim = overlap(lt, ct), artistSim = overlap(new Set(words(local.artist)), new Set(words(cand.artist)));
  const lv = versionSet(`${local.title} ${local.remix ?? ""}`), cv = versionSet(`${cand.title} ${cand.disambiguation ?? ""}`);
  const versionMismatch = [...lv].some(w => !cv.has(w)) || [...cv].some(w => !lv.has(w));
  const durationDiff = local.durationSec && cand.lengthSec ? Math.abs(local.durationSec - cand.lengthSec) : null;
  const warnings: string[] = [];
  if (versionMismatch) warnings.push("Different version words (remix/edit/clean/live) — may be another recording");
  if (durationDiff !== null && durationDiff > 15) warnings.push(`Length differs by ${durationDiff} s from your file`);
  if (artistSim < 0.5) warnings.push("Artist name differs");
  const confidence = Math.round(100 * (0.55 * titleSim + 0.35 * artistSim + (durationDiff === null ? 0.05 : durationDiff <= 5 ? 0.1 : durationDiff <= 15 ? 0.05 : 0)) * (versionMismatch ? 0.6 : 1));
  return { confidence: Math.min(100, confidence), warnings, versionMismatch, durationDiff };
}
