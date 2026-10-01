/**
 * Spotify playlist import.
 *
 * Uses the Spotify Client Credentials flow (app-level token, no end-user
 * login) to read PUBLIC playlists and albums by link. Returns a plain list
 * of { artist, song } entries for the event builder's uploaded song list.
 *
 * Secrets: SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (read inside handler).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({ url: z.string().max(500) });

export interface SpotifyImportResult {
  songs: { artist: string; song: string }[];
  name?: string;
  truncated?: boolean;
  error?: string;
}

type SpotifyRef = { kind: "playlist" | "album"; id: string };

export function parseSpotifyUrl(raw: string): SpotifyRef | undefined {
  const s = (raw || "").trim();
  if (!s) return undefined;
  const uri = s.match(/^spotify:(playlist|album):([A-Za-z0-9]+)/i);
  if (uri) return { kind: uri[1].toLowerCase() as SpotifyRef["kind"], id: uri[2] };
  const web = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album)\/([A-Za-z0-9]+)/i);
  if (web) return { kind: web[1].toLowerCase() as SpotifyRef["kind"], id: web[2] };
  return undefined;
}

async function getToken(id: string, secret: string): Promise<string | undefined> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as { access_token?: string };
  return json.access_token;
}

const MAX_TRACKS = 1000;

/**
 * Fallback reader for PUBLIC playlists/albums.
 *
 * Spotify's Web API no longer serves most editorial/user playlists to
 * client-credential (app-only) tokens, but the public embed page still
 * exposes the full track list as JSON. No auth required.
 */
export function parseEmbedHtml(html: string): { songs: { artist: string; song: string }[]; name?: string } {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return { songs: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return { songs: [] };
  }
  const entity = (
    parsed as {
      props?: { pageProps?: { state?: { data?: { entity?: unknown } } } };
    }
  )?.props?.pageProps?.state?.data?.entity as
    | { name?: string; trackList?: Array<{ title?: string; subtitle?: string }> }
    | undefined;
  if (!entity?.trackList?.length) return { songs: [], name: entity?.name };
  const songs: { artist: string; song: string }[] = [];
  for (const t of entity.trackList) {
    const song = (t?.title || "").trim();
    // subtitle holds the credited artists, comma separated
    const artist = (t?.subtitle || "").split(",")[0]?.trim() || "";
    if (!song || !artist) continue;
    songs.push({ artist: artist.slice(0, 200), song: song.slice(0, 200) });
    if (songs.length >= MAX_TRACKS) break;
  }
  return { songs, name: entity.name };
}

async function fetchViaEmbed(ref: SpotifyRef): Promise<{ songs: { artist: string; song: string }[]; name?: string }> {
  try {
    const res = await fetch(`https://open.spotify.com/embed/${ref.kind}/${ref.id}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });
    if (!res.ok) return { songs: [] };
    return parseEmbedHtml(await res.text());
  } catch {
    return { songs: [] };
  }
}

export const importSpotifyPlaylist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<SpotifyImportResult> => {
    const ref = parseSpotifyUrl(data.url);
    if (!ref) {
      return {
        songs: [],
        error: "That doesn't look like a Spotify playlist or album link.",
      };
    }

    const clientId = process.env["SPOTIFY_CLIENT_ID"];
    const clientSecret = process.env["SPOTIFY_CLIENT_SECRET"];

    const songs: { artist: string; song: string }[] = [];
    let name: string | undefined;
    let truncated = false;

    // 1) Official Web API (works for albums and any playlist the app token can read)
    if (clientId && clientSecret) {
      const token = await getToken(clientId, clientSecret);
      if (token) {
        const auth = { Authorization: `Bearer ${token}` };
        try {
          const metaRes = await fetch(`https://api.spotify.com/v1/${ref.kind}s/${ref.id}`, { headers: auth });
          if (metaRes.ok) {
            const meta = (await metaRes.json()) as { name?: string };
            name = meta.name;
          }
        } catch {
          /* name is optional */
        }

        let url: string | undefined =
          ref.kind === "playlist"
            ? `https://api.spotify.com/v1/playlists/${ref.id}/tracks?limit=100&fields=next,items(track(name,artists(name)))`
            : `https://api.spotify.com/v1/albums/${ref.id}/tracks?limit=50`;

        try {
          while (url) {
            const res: Response = await fetch(url, { headers: auth });
            if (!res.ok) break;
            const page = (await res.json()) as {
              next?: string | null;
              items?: Array<
                | { track?: { name?: string; artists?: { name?: string }[] } | null }
                | { name?: string; artists?: { name?: string }[] }
              >;
            };
            for (const item of page.items ?? []) {
              const t =
                ref.kind === "playlist"
                  ? (item as { track?: { name?: string; artists?: { name?: string }[] } | null }).track
                  : (item as { name?: string; artists?: { name?: string }[] });
              const song = (t?.name || "").trim();
              const artist = (t?.artists?.[0]?.name || "").trim();
              if (!song || !artist) continue;
              songs.push({ artist: artist.slice(0, 200), song: song.slice(0, 200) });
              if (songs.length >= MAX_TRACKS) break;
            }
            if (songs.length >= MAX_TRACKS) {
              truncated = true;
              break;
            }
            url = page.next || undefined;
          }
        } catch {
          /* fall through to the embed reader */
        }
      }
    }

    // 2) Public embed fallback — no credentials needed, covers the playlists
    //    Spotify no longer serves to app-only tokens.
    if (!songs.length) {
      const embed = await fetchViaEmbed(ref);
      if (embed.songs.length) {
        songs.push(...embed.songs);
        name = name || embed.name;
        truncated = embed.songs.length >= MAX_TRACKS;
      }
    }

    if (!songs.length) {
      return {
        songs: [],
        error: "No songs could be read from that link. Make sure the playlist is public, then try again.",
      };
    }
    return { songs, name, truncated };
  });
