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

export type VibeFit = "inside" | "low" | "high" | "unknown";
type FitSection = "warmUp" | "transition" | "peak";
/** Section-aware fit: warm-up may sit lower, peak higher, so the build is kept. */
export function vibeRange(v: Vibe, section?: FitSection) {
  const dE = section === "warmUp" ? [-1, 0] : section === "peak" ? [0, 1] : [0, 0];
  const dB = section === "warmUp" ? [-8, 0] : section === "peak" ? [0, 8] : [0, 0];
  return { energy: [v.energy[0] + dE[0], v.energy[1] + dE[1]] as [number, number], bpm: [v.bpm[0] + dB[0], v.bpm[1] + dB[1]] as [number, number] };
}
export function vibeFit(song: { energy?: number; bpm?: number }, v: Vibe, section?: FitSection): VibeFit {
  const r = vibeRange(v, section);
  if (typeof song.energy === "number") {
    if (song.energy < r.energy[0] - 0.5) return "low";
    if (song.energy > r.energy[1] + 0.5) return "high";
    return "inside";
  }
  if (typeof song.bpm === "number" && song.bpm > 0) {
    if (song.bpm < r.bpm[0] - 4) return "low";
    if (song.bpm > r.bpm[1] + 4) return "high";
    return "inside";
  }
  return "unknown";
}

export function vibeNote(id?: string | null) {
  const v = getVibe(id);
  if (!v) return "";
  return `Event music style/vibe: ${v.label} (${v.description}). Favor songs with energy ${v.energy[0]}-${v.energy[1]} out of 10 and around ${v.bpm[0]}-${v.bpm[1]} BPM, while keeping the normal warm-up to peak build.`;
}
