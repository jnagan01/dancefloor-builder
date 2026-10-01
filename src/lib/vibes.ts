export type Vibe = {
  id: string;
  label: string;
  description: string;
  energy: [number, number];
  bpm: [number, number];
};

export const VIBES: Vibe[] = [
  { id: "mellow", label: "Sophisticated & Mellow", description: "Acoustic, jazz, neo-soul, soft grooves", energy: [3, 5], bpm: [70, 100] },
  { id: "lounge", label: "Cocktail Lounge Chic", description: "Deep house, downtempo, classy chill", energy: [4, 6], bpm: [95, 118] },
  { id: "sunset", label: "Tropical / Sunset Groove", description: "Afrobeats, reggaeton, warm melodic house", energy: [5, 7], bpm: [98, 115] },
  { id: "indie", label: "Indie / Alternative Cool", description: "Indie rock, synth-pop, alt dance", energy: [5, 8], bpm: [110, 126] },
  { id: "crowd", label: "All-Ages Crowd Pleaser", description: "Sing-alongs, classic pop, funk, universal hits", energy: [6, 8], bpm: [100, 128] },
  { id: "throwback", label: "Nostalgic Throwback", description: "Retro party anthems everyone knows", energy: [6, 9], bpm: [105, 130] },
  { id: "club", label: "Modern Chart & Club Hype", description: "Current hits, hip-hop, EDM bangers", energy: [8, 10], bpm: [120, 135] },
];

export const getVibe = (id?: string | null) => VIBES.find((v) => v.id === id);

export type Range = [number, number];
export type VibeFit = "inside" | "low" | "high" | "unknown";
type FitSection = "warmUp" | "transition" | "peak";

/** Effective targets: custom ranges override the vibe preset. */
export type Targets = { label?: string; description?: string; energy?: Range; bpm?: Range; dance?: Range };

export function resolveTargets(vibeId?: string | null, bpmRange?: Range | null, danceRange?: Range | null): Targets | null {
  const v = getVibe(vibeId);
  const t: Targets = {
    label: v?.label,
    description: v?.description,
    energy: v?.energy,
    bpm: bpmRange ?? v?.bpm,
    dance: danceRange ?? undefined,
  };
  return t.energy || t.bpm || t.dance ? t : null;
}

/** Section-aware ranges: warm-up may sit lower, peak higher, so the build is kept. */
export function vibeRange(t: Targets, section?: FitSection): Targets {
  const sh = (r: Range | undefined, lo: number, hi: number): Range | undefined =>
    r && [r[0] + (section === "warmUp" ? lo : 0), r[1] + (section === "peak" ? hi : 0)];
  return { ...t, energy: sh(t.energy, -1, 1), bpm: sh(t.bpm, -8, 8), dance: sh(t.dance, -1, 1) };
}

export function vibeFit(song: { energy?: number; bpm?: number; danceability?: number }, t: Targets, section?: FitSection): VibeFit {
  const r = vibeRange(t, section);
  const checks: [number | undefined, Range | undefined, number][] = [
    [song.energy, r.energy, 0.5],
    [song.bpm && song.bpm > 0 ? song.bpm : undefined, r.bpm, 4],
    [song.danceability, r.dance, 0.5],
  ];
  let any = false;
  for (const [val, rg, tol] of checks) {
    if (typeof val !== "number" || !rg) continue;
    any = true;
    if (val < rg[0] - tol) return "low";
    if (val > rg[1] + tol) return "high";
  }
  return any ? "inside" : "unknown";
}

/** Prompt line for the AI recommender. */
export function targetsNote(vibeId?: string | null, bpmRange?: Range | null, danceRange?: Range | null) {
  const t = resolveTargets(vibeId, bpmRange, danceRange);
  if (!t) return "";
  const parts: string[] = [];
  if (t.label) parts.push(`Event music style/vibe: ${t.label} (${t.description}).`);
  if (t.energy) parts.push(`Favor energy ${t.energy[0]}-${t.energy[1]} out of 10.`);
  if (t.bpm) parts.push(`Target tempo ${t.bpm[0]}-${t.bpm[1]} BPM.`);
  if (t.dance) parts.push(`Target danceability ${t.dance[0]}-${t.dance[1]} out of 10.`);
  parts.push("Keep the normal warm-up to peak build; treat these as strong preferences for every pick.");
  return parts.join(" ");
}
