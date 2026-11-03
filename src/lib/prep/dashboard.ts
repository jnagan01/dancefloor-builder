import { exportApproved, type SongMatch } from "@/lib/virtualDj";

export interface DashSong { artist: string; song: string; fromUpload?: boolean; genre?: string; year?: number; metaSource?: string }
export interface DashSection { key: string; label: string; songs: DashSong[] }
/** Facts about a library index entry. `undefined` from trackAt means the index no longer exists. */
export interface DashTrack { durationSec?: number; genre?: string; decade?: string; cleanReason?: string | null; fileIdentity?: string }
export interface DrillItem { section: string; index: number; label: string; detail?: string }
export interface SectionDash {
  key: string; label: string; count: number; confirmed: number;
  pending: DrillItem[]; notLinked: DrillItem[]; linkedMissing: DrillItem[]; excluded: DrillItem[]; alternates: DrillItem[]; unknownDuration: DrillItem[];
  knownSec: number; estimatedSec: number | null; estimateBasis: string | null;
}
export interface Dashboard {
  sections: SectionDash[];
  totals: { songs: number; confirmed: number; pending: number; notLinked: number; linkedMissing: number; excluded: number; alternates: number; unknownDuration: number; knownSec: number };
  artistRepeats: { artist: string; count: number; where: DrillItem[] }[];
  genres: { label: string; count: number }[]; decades: { label: string; count: number }[];
  unknownGenre: number; unknownDecade: number;
  /** How many genre/decade values came from event metadata (tentative) rather than approved track tags. */
  tentativeGenre: number; tentativeDecade: number;
}

const decadeFromYear = (y?: number) => y && y > 1000 ? `${String(y).slice(0, 3)}0s` : undefined;

/**
 * Planning summary using the same approval rule as export readiness (`exportApproved`, primary +
 * explicitly selected extra tracks). Rows can have both eligible files and policy-blocked files:
 *   excluded → not linked → linked track missing from the library index → waiting for approval → confirmed.
 * File presence on disk is not checked here (export readiness does that).
 * Lengths add every approved track (including extras); unknown lengths are listed and any estimate
 * is labelled with its basis. Genre/decade prefer approved track tags; event metadata is counted as tentative.
 */
export function buildDashboard(sections: DashSection[], matches: Record<string, SongMatch>, keyOf: (section: string, i: number, s: DashSong) => string, trackAt: (i: number) => DashTrack | undefined): Dashboard {
  const artists = new Map<string, { artist: string; where: DrillItem[] }>();
  const genres = new Map<string, { label: string; count: number }>(), decades = new Map<string, number>();
  let unknownGenre = 0, unknownDecade = 0, tentativeGenre = 0, tentativeDecade = 0;
  const allKnown: number[] = [];
  const seenFiles = new Set<string>();
  const out: SectionDash[] = sections.map(sec => {
    const d: SectionDash = { key: sec.key, label: sec.label, count: sec.songs.length, confirmed: 0, pending: [], notLinked: [], linkedMissing: [], excluded: [], alternates: [], unknownDuration: [], knownSec: 0, estimatedSec: null, estimateBasis: null };
    sec.songs.forEach((s, i) => {
      const item: DrillItem = { section: sec.key, index: i, label: `${s.artist} – ${s.song}` };
      const m = matches[keyOf(sec.key, i, s)];
      const ids = m?.trackIndex != null ? [...new Set([m.trackIndex, ...(m.extraTrackIndices ?? [])])] : [];
      const facts = ids.map(id => trackAt(id));
      const missing = facts.filter(f => !f).length;
      let approvedTracks: DashTrack[] = [];
      if (m?.excludedFromVdj) d.excluded.push({ ...item, detail: "Excluded from DJ export" });
      else if (!ids.length) d.notLinked.push({ ...item, detail: s.fromUpload ? "Client request — no track linked" : "No track linked" });
      else if (missing) d.linkedMissing.push({ ...item, detail: missing === ids.length ? "Linked track is no longer in your library index" : `${missing} of ${ids.length} selected tracks are no longer in your library index` });
      else if (!exportApproved(m)) { d.pending.push({ ...item, detail: m!.status }); if (m!.alternatives.length) d.alternates.push({ ...item, detail: `${m!.alternatives.length + 1} candidate tracks` }); }
      else {
        if (facts.some(f => f?.cleanReason)) d.pending.push({ ...item, detail: facts.find(f => f?.cleanReason)?.cleanReason ?? "Clean version needed" });
        approvedTracks = facts.filter((f): f is DashTrack => {
          if (!f || f.cleanReason) return false;
          if (f.fileIdentity) { if (seenFiles.has(f.fileIdentity)) { d.pending.push({ ...item, detail: "Repeated selected file — not counted in unique length" }); return false; } seenFiles.add(f.fileIdentity); }
          return true;
        });
        d.confirmed += approvedTracks.length;
      }
      const lens = approvedTracks.map(t => t.durationSec);
      const known = lens.filter((l): l is number => typeof l === "number" && Number.isFinite(l) && l > 0);
      d.knownSec += known.reduce((a, b) => a + b, 0); allKnown.push(...known);
      if (approvedTracks.length) {
        for (let n = known.length; n < lens.length; n++) d.unknownDuration.push({ ...item, detail: "Approved track has no length in your VirtualDJ data" });
      } else if (!m?.excludedFromVdj && !d.pending.some(p => p.index === i && p.detail?.startsWith("Repeated selected file"))) d.unknownDuration.push({ ...item, detail: "No approved track yet" });
      const a = s.artist.toLowerCase().replace(/^the\s+/, "").trim();
      if (a) { const e = artists.get(a) ?? { artist: s.artist, where: [] }; e.where.push(item); artists.set(a, e); }
      const tagGenre = approvedTracks.find(t => t.genre)?.genre, tagDecade = approvedTracks.find(t => t.decade)?.decade;
      const g = (tagGenre || s.genre || "").trim();
      if (g) { if (!tagGenre) tentativeGenre++; const e = genres.get(g.toLowerCase()) ?? { label: g, count: 0 }; e.count++; genres.set(g.toLowerCase(), e); } else unknownGenre++;
      const dec = tagDecade || decadeFromYear(s.year);
      if (dec) { if (!tagDecade) tentativeDecade++; decades.set(dec, (decades.get(dec) ?? 0) + 1); } else unknownDecade++;
    });
    return d;
  });
  const avg = allKnown.length ? allKnown.reduce((a, b) => a + b, 0) / allKnown.length : null;
  for (const d of out) {
    if (!d.unknownDuration.length) { d.estimatedSec = d.knownSec; continue; }
    const n = d.unknownDuration.length, plural = n > 1 ? "s" : "";
    d.estimatedSec = d.knownSec + n * (avg ?? 240);
    d.estimateBasis = avg ? `Estimate: ${n} unknown length${plural} counted at your approved-track average (${Math.round(avg)} s)` : `Estimate: ${n} unknown length${plural} counted at an assumed 4:00 each`;
  }
  const sum = (f: (d: SectionDash) => number) => out.reduce((n, d) => n + f(d), 0);
  return {
    sections: out,
    totals: { songs: sum(d => d.count), confirmed: sum(d => d.confirmed), pending: sum(d => d.pending.length), notLinked: sum(d => d.notLinked.length), linkedMissing: sum(d => d.linkedMissing.length), excluded: sum(d => d.excluded.length), alternates: sum(d => d.alternates.length), unknownDuration: sum(d => d.unknownDuration.length), knownSec: sum(d => d.knownSec) },
    artistRepeats: [...artists.values()].filter(a => a.where.length > 1).sort((a, b) => b.where.length - a.where.length).slice(0, 30).map(a => ({ artist: a.artist, count: a.where.length, where: a.where })),
    genres: [...genres.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    decades: [...decades.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, count]) => ({ label, count })),
    unknownGenre, unknownDecade, tentativeGenre, tentativeDecade,
  };
}
