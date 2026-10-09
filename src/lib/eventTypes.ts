/**
 * Event types shape WHO is in the room: how era drives the ramp, where the
 * night starts on the energy curve, and how explicit songs are handled.
 * Vibes (vibes.ts) shape the musical texture; the two combine.
 */
export type EraMode = "vintage" | "neutral" | "modern";
export type ExplicitPolicy = "clean_early" | "strict_clean" | "open";

export type EventType = {
  id: string;
  label: string;
  description: string;
  eraMode: EraMode;
  /** Added fill-in songs released before this year are left out. */
  minYear?: number;
  /** Where the energy curve starts (1–10). The curve always ends near 9.5. */
  startEnergy: number;
  explicit: ExplicitPolicy;
  defaultDecades: string[];
  prompt: string;
};

export const EVENT_TYPES: EventType[] = [
  {
    id: "wedding_traditional", label: "Traditional Wedding", description: "Multi-generational: classics early for older guests, modern hits late",
    eraMode: "vintage", startEnergy: 4.5, explicit: "clean_early",
    defaultDecades: ["1970s", "1980s", "1990s", "2000s", "2010s", "2020s"],
    prompt: "Multi-generational wedding reception. Warm Up favors Motown, funk, disco and 80s classics so older guests dance early; Transition leans on 90s/2000s sing-alongs; Peak is current party hits. Universal recognition matters most. Clean songs in Warm Up; radio edits only later.",
  },
  {
    id: "wedding_modern", label: "Modern Wedding", description: "Young crowd, older guests not expected to dance: 2000s to now",
    eraMode: "modern", minYear: 1995, startEnergy: 6, explicit: "clean_early",
    defaultDecades: ["2000s", "2010s", "2020s"],
    prompt: "Wedding with a young crowd; older guests are not expected to dance. Millennial and Gen Z party favorites, 2000s/2010s nostalgia and current hits from the start. Skip legacy wedding staples (Shout, Sweet Caroline, classic disco) unless requested. Clean early, club edits allowed later.",
  },
  {
    id: "school_dance", label: "School Dance / Prom", description: "Teens: current hits, viral trends, 2010s throwbacks, strictly clean",
    eraMode: "modern", minYear: 2008, startEnergy: 6.5, explicit: "strict_clean",
    defaultDecades: ["2010s", "2020s"],
    prompt: "School dance or prom for teens (ages 12–18) with chaperones present. Current chart hits, viral TikTok dance songs, clean hip-hop, festival EDM, group line dances, and 2010s party throwbacks from their childhood. Clean radio edits ONLY — never explicit, and avoid songs whose themes are sexual, drug or violence-focused even in clean versions. Never suggest pre-2000 songs.",
  },
  {
    id: "corporate", label: "Corporate / Gala", description: "Energy-driven, any era, workplace-appropriate clean edits all night",
    eraMode: "neutral", startEnergy: 5, explicit: "strict_clean",
    defaultDecades: ["1980s", "1990s", "2000s", "2010s", "2020s"],
    prompt: "Corporate event or gala with a diverse-age professional crowd. Era does not matter; build energy steadily with polished, universally loved hits: funk, nu-disco, feel-good pop and celebratory anthems. Nothing aggressive, no hard drops, and clean radio edits only all night.",
  },
  {
    id: "club", label: "Club / Bar", description: "Millennials and Gen Z: modern only, high energy from the start, explicit OK",
    eraMode: "modern", minYear: 2005, startEnergy: 7, explicit: "open",
    defaultDecades: ["2010s", "2020s"],
    prompt: "Nightclub or bar crowd of millennials and Gen Z (21–35). Modern club bangers, hip-hop, house, EDM, Latin/reggaeton and trending hits. High energy from the start with tight tempo flow and no slow breathers. Explicit club versions are fine. Avoid anything before the late 2000s unless requested.",
  },
  {
    id: "milestone", label: "Milestone / Reunion", description: "Birthday or reunion: built around the guests' coming-of-age decades",
    eraMode: "neutral", startEnergy: 5, explicit: "clean_early",
    defaultDecades: [],
    prompt: "Milestone birthday or reunion where the crowd shares a generation. Center picks on the selected decades (their high-school and college years) mixed with high-energy party staples.",
  },
];

export const getEventType = (id?: string | null) => EVENT_TYPES.find((t) => t.id === id);

/** Whether an added (non-uploaded) song is allowed for this event type. */
export function allowedForEventType(s: { year?: number; explicit?: boolean }, t?: EventType): boolean {
  if (!t) return true;
  if (t.explicit === "strict_clean" && s.explicit) return false;
  if (t.minYear && typeof s.year === "number" && s.year < t.minYear) return false;
  return true;
}

/**
 * Library songs only know their decade. Treat the decade's last year as the
 * latest possible release: "1990s" passes a 1995 cutoff, "1980s" does not.
 */
export function libraryAllowedForEventType(
  s: { decade?: string; year?: number; explicit?: boolean },
  t?: EventType,
): boolean {
  if (!t) return true;
  const start = s.decade ? parseInt(s.decade, 10) : NaN;
  const year = typeof s.year === "number" ? s.year : Number.isFinite(start) ? start + 9 : undefined;
  return allowedForEventType({ year, explicit: s.explicit }, t);
}

export function eventTypeNote(id?: string | null): string {
  const t = getEventType(id);
  return t ? `EVENT TYPE: ${t.label}. ${t.prompt}` : "";
}
