import type { SongMatch } from "@/lib/virtualDj";

export interface DashSong { artist: string; song: string; fromUpload?: boolean; genre?: string; year?: number }
export interface DashSection { key: string; label: string; songs: DashSong[]; targetMinutes?: number }
export interface DashTrack { durationSec?: number; genre?: string; decade?: string }
export interface DrillItem { section: string; index: number; label: string; detail?: string }
export interface SectionDash {
  key: string; label: string; count: number; confirmed: number;
  pending: DrillItem[]; missing: DrillItem[]; alternates: DrillItem[]; unknownDuration: DrillItem[];
  knownSec: number; estimatedSec: number | null; estimateBasis: string | null; targetMinutes?: number;
}
export interface Dashboard {
  sections: SectionDash[]; totals: { songs: number; confirmed: number; pending: number; missing: number; alternates: number; unknownDuration: number; knownSec: number };
  artistRepeats: { artist: string; count: number; where: DrillItem[] }[];
  genres: { label: string; count: number }[]; decades: { label: string; count: number }[]; unknownGenre: number; unknownDecade: number;
}

const decadeFromYear = (y?: number) => y && y > 1000 ? `${String(y).slice(0, 3)}0s` : undefined;

/**
 * Pure readiness summary over existing event sections and match approvals.
 * Durations come only from matched local files; unknown durations are counted and
 * any estimate is explicitly labelled with its basis. Never mutates inputs.
 */
export function buildDashboard(sections: DashSection[], matches: Record<string, SongMatch>, keyOf: (section: string, i: number, s: DashSong) => string, trackAt: (i: number) => DashTrack | undefined): Dashboard {
  const artists = new Map<string, { artist: string; where: DrillItem[] }>();
  const genres = new Map<string, { label: string; count: number }>(), decades = new Map<string, number>();
  let unknownGenre = 0, unknownDecade = 0;
  const allKnown: number[] = [];
  const out: SectionDash[] = sections.map(sec => {
    const d: SectionDash = { key: sec.key, label: sec.label, count: sec.songs.length, confirmed: 0, pending: [], missing: [], alternates: [], unknownDuration: [], knownSec: 0, estimatedSec: null, estimateBasis: null, targetMinutes: sec.targetMinutes };
    sec.songs.forEach((s, i) => {
      const item: DrillItem = { section: sec.key, index: i, label: `${s.artist} – ${s.song}` };
      const m = matches[keyOf(sec.key, i, s)];
      const track = m?.trackIndex != null ? trackAt(m.trackIndex) : undefined;
      if (m?.trackIndex == null) d.missing.push({ ...item, detail: s.fromUpload ? "Client request — no local file" : "No local file" });
      else if (m.confirmed) d.confirmed++;
      else d.pending.push({ ...item, detail: m.status });
      if (m?.trackIndex != null && !m.confirmed && m.alternatives.length) d.alternates.push({ ...item, detail: `${m.alternatives.length + 1} candidate files` });
      const len = m?.confirmed ? track?.durationSec : undefined;
      if (len) { d.knownSec += len; allKnown.push(len); } else d.unknownDuration.push(item);
      const a = s.artist.toLowerCase().replace(/^the\s+/, "").trim();
      if (a) { const e = artists.get(a) ?? { artist: s.artist, where: [] }; e.where.push(item); artists.set(a, e); }
      const g = (track?.genre || s.genre || "").trim();
      if (g) { const e = genres.get(g.toLowerCase()) ?? { label: g, count: 0 }; e.count++; genres.set(g.toLowerCase(), e); } else unknownGenre++;
      const dec = track?.decade || decadeFromYear(s.year);
      if (dec) decades.set(dec, (decades.get(dec) ?? 0) + 1); else unknownDecade++;
    });
    return d;
  });
  const avg = allKnown.length ? allKnown.reduce((a, b) => a + b, 0) / allKnown.length : null;
  for (const d of out) {
    if (!d.unknownDuration.length) { d.estimatedSec = d.knownSec; d.estimateBasis = null; continue; }
    d.estimatedSec = d.knownSec + d.unknownDuration.length * (avg ?? 240);
    d.estimateBasis = avg ? `Estimate: ${d.unknownDuration.length} unknown length${d.unknownDuration.length > 1 ? "s" : ""} counted at your confirmed-track average (${Math.round(avg)} s)` : `Estimate: ${d.unknownDuration.length} unknown length${d.unknownDuration.length > 1 ? "s" : ""} counted at an assumed 4:00 each`;
  }
  const sum = (f: (d: SectionDash) => number) => out.reduce((n, d) => n + f(d), 0);
  return {
    sections: out,
    totals: { songs: sum(d => d.count), confirmed: sum(d => d.confirmed), pending: sum(d => d.pending.length), missing: sum(d => d.missing.length), alternates: sum(d => d.alternates.length), unknownDuration: sum(d => d.unknownDuration.length), knownSec: sum(d => d.knownSec) },
    artistRepeats: [...artists.values()].filter(a => a.where.length > 1).sort((a, b) => b.where.length - a.where.length).slice(0, 30).map(a => ({ artist: a.artist, count: a.where.length, where: a.where })),
    genres: [...genres.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    decades: [...decades.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, count]) => ({ label, count })),
    unknownGenre, unknownDecade,
  };
}
