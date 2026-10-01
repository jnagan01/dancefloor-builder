import { createServerFn } from "@tanstack/react-start";

/**
 * Cross-platform trending charts.
 *
 * Pulls four independent "what is hot right now" feeds and merges them into a
 * single consensus ranking of tracks and artists:
 *  - Apple Music most-played (US)
 *  - Billboard Hot 100
 *  - Last.fm global top tracks / top artists (needs LASTFM_API_KEY)
 *  - Shazam top 200 (US) — what people hear out and try to identify
 *
 * Any feed can fail; the rest still render.
 */

export type ChartSource = "apple" | "billboard" | "lastfm" | "shazam";

export type ChartEntry = {
  rank: number;
  title: string;
  artist: string;
  source: ChartSource;
  artwork?: string;
  genre?: string;
  djGenre?: DjGenre;

  url?: string;
  releaseDate?: string;
  listeners?: number;
};

export type SourceRank = { source: ChartSource; rank: number };

/** Broad DJ-facing genre buckets the raw chart metadata is folded into. */
export type DjGenre =
  | "pop"
  | "hiphop"
  | "dance"
  | "rnb"
  | "country"
  | "latin"
  | "rock"
  | "other";

export const DJ_GENRES: Array<{ id: DjGenre; label: string }> = [
  { id: "pop", label: "Pop" },
  { id: "hiphop", label: "Hip-Hop / Rap" },
  { id: "dance", label: "Dance / EDM" },
  { id: "rnb", label: "R&B / Soul" },
  { id: "country", label: "Country" },
  { id: "latin", label: "Latin" },
  { id: "rock", label: "Rock / Alt" },
  { id: "other", label: "Other" },
];

export type ConsensusTrack = {
  rank: number;
  title: string;
  artist: string;
  artwork?: string;
  genre?: string;
  djGenre?: DjGenre;
  score: number;
  sources: SourceRank[];
};

export type ConsensusArtist = {
  rank: number;
  artist: string;
  artwork?: string;
  genre?: string;
  djGenre?: DjGenre;
  score: number;
  hits: number;
  topTrack?: string;
  listeners?: number;
  sources: ChartSource[];
};


export type ChartsResult = {
  apple: ChartEntry[];
  billboard: ChartEntry[];
  lastfm: ChartEntry[];
  shazam: ChartEntry[];
  lastfmArtists: ConsensusArtist[];
  topTracks: ConsensusTrack[];
  topArtists: ConsensusArtist[];
  errors: Partial<Record<ChartSource, string>>;
  fetchedAt: string;
};

const TTL_MS = 30 * 60 * 1000;
let cache: { at: number; value: ChartsResult } | null = null;

const UA = "DancefloorBuilder/1.0";

async function getText(url: string, timeoutMs = 9000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url: string, timeoutMs = 9000): Promise<unknown> {
  const text = await getText(url, timeoutMs);
  return JSON.parse(text) as unknown;
}

function bigArtwork(url?: string): string | undefined {
  if (!url) return undefined;
  return url.replace(/\/\d+x\d+bb\.(jpg|png)/i, "/300x300bb.$1");
}

/** Last.fm serves a placeholder star for most images — treat it as no image. */
const PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f";
const realImage = (u?: string): string | undefined =>
  u && !u.includes(PLACEHOLDER) ? u : undefined;

/* ------------------------------------------------------------------ feeds */

async function fetchApple(): Promise<ChartEntry[]> {
  const json = (await getJson(
    "https://rss.marketingtools.apple.com/api/v2/us/music/most-played/50/songs.json",
  )) as { feed?: { results?: Array<Record<string, unknown>> } };
  const results = json.feed?.results ?? [];
  return results
    .slice(0, 50)
    .map((r, i) => ({
      rank: i + 1,
      title: String(r["name"] ?? "").trim(),
      artist: String(r["artistName"] ?? "").trim(),
      source: "apple" as const,
      artwork: bigArtwork(typeof r["artworkUrl100"] === "string" ? r["artworkUrl100"] : undefined),
      genre: Array.isArray(r["genres"])
        ? String((r["genres"] as Array<{ name?: string }>)[0]?.name ?? "")
        : undefined,
      url: typeof r["url"] === "string" ? r["url"] : undefined,
      releaseDate: typeof r["releaseDate"] === "string" ? r["releaseDate"] : undefined,
    }))
    .filter(e => e.title && e.artist);
}

async function fetchBillboard(): Promise<ChartEntry[]> {
  const json = (await getJson(
    "https://raw.githubusercontent.com/mhollingshead/billboard-hot-100/main/recent.json",
  )) as { data?: Array<Record<string, unknown>> };
  const rows = json.data ?? [];
  return rows
    .slice(0, 100)
    .map((r, i) => ({
      rank: typeof r["this_week"] === "number" ? (r["this_week"] as number) : i + 1,
      title: String(r["song"] ?? "").trim(),
      artist: String(r["artist"] ?? "").trim(),
      source: "billboard" as const,
    }))
    .filter(e => e.title && e.artist);
}

type LfmImage = Array<{ "#text"?: string; size?: string }>;
const pickImage = (images?: LfmImage): string | undefined =>
  realImage(
    images?.find(i => i.size === "extralarge")?.["#text"] ??
      images?.find(i => i.size === "large")?.["#text"],
  );

async function fetchLastfmTracks(key: string): Promise<ChartEntry[]> {
  const json = (await getJson(
    `https://ws.audioscrobbler.com/2.0/?method=chart.gettoptracks&limit=50&format=json&api_key=${encodeURIComponent(key)}`,
  )) as { tracks?: { track?: Array<Record<string, unknown>> } };
  const rows = json.tracks?.track ?? [];
  return rows
    .slice(0, 50)
    .map((r, i) => ({
      rank: i + 1,
      title: String(r["name"] ?? "").trim(),
      artist: String((r["artist"] as { name?: string } | undefined)?.name ?? "").trim(),
      source: "lastfm" as const,
      artwork: pickImage(r["image"] as LfmImage | undefined),
      url: typeof r["url"] === "string" ? r["url"] : undefined,
      listeners: Number(r["listeners"]) || undefined,
    }))
    .filter(e => e.title && e.artist);
}

async function fetchLastfmArtists(key: string): Promise<ConsensusArtist[]> {
  const json = (await getJson(
    `https://ws.audioscrobbler.com/2.0/?method=chart.gettopartists&limit=30&format=json&api_key=${encodeURIComponent(key)}`,
  )) as { artists?: { artist?: Array<Record<string, unknown>> } };
  const rows = json.artists?.artist ?? [];
  return rows
    .slice(0, 30)
    .map((r, i) => ({
      rank: i + 1,
      artist: String(r["name"] ?? "").trim(),
      artwork: pickImage(r["image"] as LfmImage | undefined),
      score: 0,
      hits: 0,
      listeners: Number(r["listeners"]) || undefined,
      sources: ["lastfm" as const],
    }))
    .filter(a => a.artist);
}

/** Shazam publishes its top 200 as a CSV: Rank,Artist,Title */
async function fetchShazam(): Promise<ChartEntry[]> {
  const csv = await getText("https://www.shazam.com/services/charts/csv/top-200/united-states/");
  const out: ChartEntry[] = [];
  for (const raw of csv.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^rank\s*,/i.test(line)) continue;
    const cells = parseCsvLine(line);
    if (cells.length < 3) continue;
    const rank = parseInt(cells[0] ?? "", 10);
    const artist = (cells[1] ?? "").trim();
    const title = (cells[2] ?? "").trim();
    if (!Number.isFinite(rank) || !artist || !title) continue;
    out.push({ rank, title, artist, source: "shazam" });
    if (out.length >= 100) break;
  }
  return out;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      cells.push(cur);
      cur = "";
    } else cur += c;
  }
  cells.push(cur);
  return cells;
}

/* ------------------------------------------------------------- consensus */

const normKey = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\b(feat|ft|featuring|with|x)\b.*$/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** First credited artist only — charts list collaborators inconsistently. */
const primaryArtist = (artist: string): string =>
  artist
    .split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b|\bx\b|\/)\s*/i)[0]
    ?.trim() || artist.trim();

/** #1 scores 100, falling off gently so deep chart positions still count. */
const rankPoints = (rank: number): number => Math.max(5, 101 - rank);

function buildConsensusTracks(all: ChartEntry[][]): ConsensusTrack[] {
  const map = new Map<
    string,
    { title: string; artist: string; artwork?: string; genre?: string; sources: SourceRank[] }
  >();

  for (const feed of all) {
    for (const e of feed) {
      const key = `${normKey(primaryArtist(e.artist))}|${normKey(e.title)}`;
      if (!key.trim() || key === "|") continue;
      const hit = map.get(key);
      if (hit) {
        if (!hit.sources.some(s => s.source === e.source))
          hit.sources.push({ source: e.source, rank: e.rank });
        if (!hit.artwork && e.artwork) hit.artwork = e.artwork;
        if (!hit.genre && e.genre) hit.genre = e.genre;
      } else {
        map.set(key, {
          title: e.title,
          artist: e.artist,
          artwork: e.artwork,
          genre: e.genre,
          sources: [{ source: e.source, rank: e.rank }],
        });
      }
    }
  }

  const scored = [...map.values()].map(v => {
    const base = v.sources.reduce((n, s) => n + rankPoints(s.rank), 0);
    // Multi-platform agreement is the whole point — reward it hard.
    const bonus = 1 + (v.sources.length - 1) * 0.6;
    return {
      title: v.title,
      artist: v.artist,
      artwork: v.artwork,
      genre: v.genre,
      sources: v.sources.sort((a, b) => a.rank - b.rank),
      score: Math.round(base * bonus),
    };
  });

  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  // Deeper than the 15 shown, so each genre filter still has a full list.
  return scored.slice(0, 90).map((t, i) => ({ ...t, rank: i + 1 }));

}

function buildConsensusArtists(
  tracks: ConsensusTrack[],
  lastfmArtists: ConsensusArtist[],
): ConsensusArtist[] {
  const map = new Map<
    string,
    {
      artist: string;
      artwork?: string;
      score: number;
      hits: number;
      topTrack?: string;
      topScore: number;
      listeners?: number;
      sources: Set<ChartSource>;
    }
  >();

  for (const t of tracks) {
    const name = primaryArtist(t.artist);
    const key = normKey(name);
    if (!key) continue;
    const hit = map.get(key) ?? {
      artist: name,
      artwork: undefined,
      score: 0,
      hits: 0,
      topTrack: undefined,
      topScore: -1,
      listeners: undefined,
      sources: new Set<ChartSource>(),
    };
    hit.score += t.score;
    hit.hits += 1;
    if (t.score > hit.topScore) {
      hit.topScore = t.score;
      hit.topTrack = t.title;
    }
    if (!hit.artwork && t.artwork) hit.artwork = t.artwork;
    for (const s of t.sources) hit.sources.add(s.source);
    map.set(key, hit);
  }

  for (const a of lastfmArtists) {
    const key = normKey(a.artist);
    if (!key) continue;
    const hit = map.get(key);
    const points = rankPoints(a.rank) * 2;
    if (hit) {
      hit.score += points;
      hit.listeners = hit.listeners ?? a.listeners;
      hit.sources.add("lastfm");
      if (!hit.artwork && a.artwork) hit.artwork = a.artwork;
    } else {
      map.set(key, {
        artist: a.artist,
        artwork: a.artwork,
        score: points,
        hits: 0,
        topTrack: undefined,
        topScore: -1,
        listeners: a.listeners,
        sources: new Set<ChartSource>(["lastfm"]),
      });
    }
  }

  const out = [...map.values()].map(v => ({
    artist: v.artist,
    artwork: v.artwork,
    score: v.score,
    hits: v.hits,
    topTrack: v.topTrack,
    listeners: v.listeners,
    sources: [...v.sources],
    rank: 0,
  }));
  out.sort((a, b) => b.score - a.score || a.artist.localeCompare(b.artist));
  return out.slice(0, 60).map((a, i) => ({ ...a, rank: i + 1 }));
}

/* --------------------------------------------- artwork + genre back-fill */

type Meta = { url?: string; genre?: string };
const metaCache = new Map<string, { at: number; value: Meta }>();
const ART_TTL = 24 * 60 * 60 * 1000;

async function itunesMeta(term: string, entity: "song" | "album"): Promise<Meta> {
  const key = `${entity}:${term.toLowerCase()}`;
  const hit = metaCache.get(key);
  if (hit && Date.now() - hit.at < ART_TTL) return hit.value;
  try {
    const json = (await getJson(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&limit=1&country=US`,
      6000,
    )) as { results?: Array<{ artworkUrl100?: string; primaryGenreName?: string }> };
    const first = json.results?.[0];
    const value: Meta = { url: bigArtwork(first?.artworkUrl100), genre: first?.primaryGenreName };
    metaCache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    const value: Meta = {};
    metaCache.set(key, { at: Date.now(), value });
    return value;
  }
}

/** Last.fm crowd tags, used when iTunes has no match for an artist. */
async function lastfmArtistTags(key: string, artist: string): Promise<string | undefined> {
  const cacheKey = `tags:${artist.toLowerCase()}`;
  const hit = metaCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ART_TTL) return hit.value.genre;
  try {
    const json = (await getJson(
      `https://ws.audioscrobbler.com/2.0/?method=artist.gettoptags&artist=${encodeURIComponent(artist)}&format=json&api_key=${encodeURIComponent(key)}`,
      6000,
    )) as { toptags?: { tag?: Array<{ name?: string }> } };
    const tags = (json.toptags?.tag ?? []).map(t => String(t.name ?? "")).filter(Boolean);
    // Pick the first tag that maps to a real bucket, so "female vocalists" loses to "pop".
    const useful = tags.find(t => classifyGenre(t) !== "other");
    metaCache.set(cacheKey, { at: Date.now(), value: { genre: useful } });
    return useful;
  } catch {
    metaCache.set(cacheKey, { at: Date.now(), value: {} });
    return undefined;
  }
}

/** Folds raw chart/tag genre strings into the broad DJ buckets. */
export function classifyGenre(raw?: string): DjGenre {
  const g = (raw ?? "").toLowerCase();
  if (!g) return "other";
  if (/latin|reggaeton|regional mexican|salsa|bachata|cumbia|k-pop ?latin|musica/.test(g))
    return "latin";
  if (/hip.?hop|rap|trap|drill|grime/.test(g)) return "hiphop";
  if (/dance|electronic|edm|house|techno|trance|dubstep|club|disco|drum and bass|dnb/.test(g))
    return "dance";
  if (/r&b|rnb|soul|funk|motown|neo.?soul/.test(g)) return "rnb";
  if (/country|americana|bluegrass/.test(g)) return "country";
  if (/rock|alternative|indie|metal|punk|grunge/.test(g)) return "rock";
  if (/pop|singer.?songwriter/.test(g)) return "pop";
  return "other";
}

/** Fills genre/artwork on raw platform entries that the consensus pass missed. */
async function backfillEntries(feeds: ChartEntry[][]): Promise<void> {
  const jobs: Array<() => Promise<void>> = [];
  for (const feed of feeds)
    for (const e of feed.slice(0, 60)) {
      if (e.genre) continue;
      jobs.push(async () => {
        const meta = await itunesMeta(`${primaryArtist(e.artist)} ${e.title}`, "song");
        if (!e.artwork) e.artwork = meta.url;
        if (!e.genre) e.genre = meta.genre;
      });
    }
  const workers = Array.from({ length: Math.min(8, jobs.length) }, async () => {
    for (;;) {
      const job = jobs.shift();
      if (!job) return;
      await job();
    }
  });
  await Promise.all(workers);
}


async function backfillMeta(
  tracks: ConsensusTrack[],
  artists: ConsensusArtist[],
  lfmKey?: string,
): Promise<void> {
  const run = async (jobs: Array<() => Promise<void>>) => {
    const workers = Array.from({ length: Math.min(8, jobs.length) }, async () => {
      for (;;) {
        const job = jobs.shift();
        if (!job) return;
        await job();
      }
    });
    await Promise.all(workers);
  };

  // 1. Tracks: artwork + official genre from iTunes.
  await run(
    tracks
      .filter(t => !t.artwork || !t.genre)
      .map(t => async () => {
        const meta = await itunesMeta(`${primaryArtist(t.artist)} ${t.title}`, "song");
        if (!t.artwork) t.artwork = meta.url;
        if (!t.genre) t.genre = meta.genre;
      }),
  );
  for (const t of tracks) t.djGenre = classifyGenre(t.genre);

  // 2. Artists inherit the dominant genre of their own charting tracks.
  const byArtist = new Map<string, Map<string, number>>();
  for (const t of tracks) {
    if (!t.genre) continue;
    const key = normKey(primaryArtist(t.artist));
    const counts = byArtist.get(key) ?? new Map<string, number>();
    counts.set(t.genre, (counts.get(t.genre) ?? 0) + 1);
    byArtist.set(key, counts);
  }
  for (const a of artists) {
    if (a.genre) continue;
    const counts = byArtist.get(normKey(a.artist));
    if (!counts) continue;
    a.genre = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  }

  // 3. Anything still unknown (mostly Last.fm-only artists) gets looked up.
  await run(
    artists
      .filter(a => !a.artwork || classifyGenre(a.genre) === "other")
      .map(a => async () => {
        if (!a.artwork || !a.genre) {
          const meta = await itunesMeta(a.artist, "album");
          if (!a.artwork) a.artwork = meta.url;
          if (!a.genre) a.genre = meta.genre;
        }
        if (classifyGenre(a.genre) === "other" && lfmKey) {
          const tag = await lastfmArtistTags(lfmKey, a.artist);
          if (tag) a.genre = tag;
        }
      }),
  );
  for (const a of artists) a.djGenre = classifyGenre(a.genre);
}



/* ---------------------------------------------------------------- handler */

export const getTrendingCharts = createServerFn({ method: "GET" }).handler(
  async (): Promise<ChartsResult> => {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

    const lfmKey = process.env["LASTFM_API_KEY"];

    const [appleRes, billboardRes, lfmTrackRes, lfmArtistRes, shazamRes] = await Promise.allSettled([
      fetchApple(),
      fetchBillboard(),
      lfmKey ? fetchLastfmTracks(lfmKey) : Promise.resolve<ChartEntry[]>([]),
      lfmKey ? fetchLastfmArtists(lfmKey) : Promise.resolve<ConsensusArtist[]>([]),
      fetchShazam(),
    ]);

    const errors: Partial<Record<ChartSource, string>> = {};
    const apple = appleRes.status === "fulfilled" ? appleRes.value : [];
    const billboard = billboardRes.status === "fulfilled" ? billboardRes.value : [];
    const lastfm = lfmTrackRes.status === "fulfilled" ? lfmTrackRes.value : [];
    const lastfmArtists = lfmArtistRes.status === "fulfilled" ? lfmArtistRes.value : [];
    const shazam = shazamRes.status === "fulfilled" ? shazamRes.value : [];

    if (appleRes.status === "rejected") {
      console.error("[charts] apple failed:", appleRes.reason);
      errors.apple = "Apple Music charts are temporarily unavailable.";
    }
    if (billboardRes.status === "rejected") {
      console.error("[charts] billboard failed:", billboardRes.reason);
      errors.billboard = "Billboard Hot 100 is temporarily unavailable.";
    }
    if (shazamRes.status === "rejected") {
      console.error("[charts] shazam failed:", shazamRes.reason);
      errors.shazam = "The Shazam chart is temporarily unavailable.";
    }
    if (!lfmKey) errors.lastfm = "Last.fm charts are not connected yet.";
    else if (lfmTrackRes.status === "rejected" || lfmArtistRes.status === "rejected") {
      console.error("[charts] lastfm failed");
      errors.lastfm = "Last.fm charts are temporarily unavailable.";
    }

    const topTracks = buildConsensusTracks([apple, billboard, lastfm, shazam]);
    const topArtists = buildConsensusArtists(topTracks, lastfmArtists);
    // Enrichment mutates entries in place; cap how long the page waits on it so
    // charts appear quickly and any lookups still running fill in later.
    const deadline = Date.now() + 5000;
    const withinBudget = (p: Promise<void>) =>
      Promise.race([
        p.catch(() => undefined),
        new Promise<void>((r) => setTimeout(r, Math.max(0, deadline - Date.now()))),
      ]);
    await withinBudget(backfillMeta(topTracks, topArtists, lfmKey));

    // Give the per-platform lists the artwork and genre resolved for the merged view.
    const metaByKey = new Map<string, { artwork?: string; genre?: string }>();
    for (const t of topTracks)
      metaByKey.set(`${normKey(primaryArtist(t.artist))}|${normKey(t.title)}`, {
        artwork: t.artwork,
        genre: t.genre,
      });
    for (const feed of [apple, billboard, lastfm, shazam])
      for (const e of feed) {
        const m = metaByKey.get(`${normKey(primaryArtist(e.artist))}|${normKey(e.title)}`);
        if (!e.artwork) e.artwork = m?.artwork;
        if (!e.genre) e.genre = m?.genre;
      }
    await withinBudget(backfillEntries([apple, billboard, lastfm, shazam]));
    for (const t of topTracks) if (!t.djGenre) t.djGenre = classifyGenre(t.genre);
    for (const a of topArtists) if (!a.djGenre) a.djGenre = classifyGenre(a.genre);
    for (const feed of [apple, billboard, lastfm, shazam])
      for (const e of feed) e.djGenre = classifyGenre(e.genre);
    for (const a of lastfmArtists) a.djGenre = classifyGenre(a.genre);



    const value: ChartsResult = {
      apple,
      billboard,
      lastfm,
      shazam,
      lastfmArtists,
      topTracks,
      topArtists,
      errors,
      fetchedAt: new Date().toISOString(),
    };

    if (apple.length || billboard.length || lastfm.length || shazam.length)
      cache = { at: Date.now(), value };
    return value;
  },
);
