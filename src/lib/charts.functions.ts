import { createServerFn } from "@tanstack/react-start";

export type ChartEntry = {
  rank: number;
  title: string;
  artist: string;
  source: "apple" | "billboard";
  artwork?: string;
  genre?: string;
  url?: string;
  releaseDate?: string;
};

export type ChartsResult = {
  apple: ChartEntry[];
  billboard: ChartEntry[];
  appleError?: string;
  billboardError?: string;
  fetchedAt: string;
};

const TTL_MS = 30 * 60 * 1000;
let cache: { at: number; value: ChartsResult } | null = null;

async function getJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": "DancefloorBuilder/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function bigArtwork(url?: string): string | undefined {
  if (!url) return undefined;
  return url.replace(/\/\d+x\d+bb\.(jpg|png)/i, "/300x300bb.$1");
}

async function fetchApple(): Promise<ChartEntry[]> {
  const json = (await getJson(
    "https://rss.applemarketingtools.com/api/v2/us/music/most-played/50/songs.json",
  )) as { feed?: { results?: Array<Record<string, unknown>> } };
  const results = json.feed?.results ?? [];
  return results.slice(0, 50).map((r, i) => ({
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
  })).filter(e => e.title && e.artist);
}

async function fetchBillboard(): Promise<ChartEntry[]> {
  const json = (await getJson(
    "https://raw.githubusercontent.com/mhollingshead/billboard-hot-100/main/recent.json",
  )) as { data?: Array<Record<string, unknown>> };
  const rows = json.data ?? [];
  return rows.slice(0, 100).map((r, i) => ({
    rank: typeof r["this_week"] === "number" ? (r["this_week"] as number) : i + 1,
    title: String(r["song"] ?? "").trim(),
    artist: String(r["artist"] ?? "").trim(),
    source: "billboard" as const,
  })).filter(e => e.title && e.artist);
}

export const getTrendingCharts = createServerFn({ method: "GET" }).handler(async (): Promise<ChartsResult> => {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const [appleRes, billboardRes] = await Promise.allSettled([fetchApple(), fetchBillboard()]);

  const value: ChartsResult = {
    apple: appleRes.status === "fulfilled" ? appleRes.value : [],
    billboard: billboardRes.status === "fulfilled" ? billboardRes.value : [],
    fetchedAt: new Date().toISOString(),
  };
  if (appleRes.status === "rejected") {
    console.error("[charts] apple failed:", appleRes.reason);
    value.appleError = "Apple Music charts are temporarily unavailable.";
  }
  if (billboardRes.status === "rejected") {
    console.error("[charts] billboard failed:", billboardRes.reason);
    value.billboardError = "Billboard Hot 100 is temporarily unavailable.";
  }

  if (value.apple.length || value.billboard.length) cache = { at: Date.now(), value };
  return value;
});
