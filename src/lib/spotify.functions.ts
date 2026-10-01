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

export const importSpotifyPlaylist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<SpotifyImportResult> => {
    const clientId = process.env["SPOTIFY_CLIENT_ID"];
    const clientSecret = process.env["SPOTIFY_CLIENT_SECRET"];
    if (!clientId || !clientSecret) {
      return { songs: [], error: "Spotify is not connected yet. Add the Spotify credentials in settings." };
    }
    const ref = parseSpotifyUrl(data.url);
    if (!ref) {
      return {
        songs: [],
        error: "That doesn't look like a Spotify playlist or album link.",
      };
    }
    const token = await getToken(clientId, clientSecret);
    if (!token) return { songs: [], error: "Spotify rejected the saved credentials. Check the Client ID and Secret." };

    const auth = { Authorization: `Bearer ${token}` };
    let name: string | undefined;
    try {
      const metaRes = await fetch(
        `https://api.spotify.com/v1/${ref.kind}s/${ref.id}?fields=${ref.kind === "playlist" ? "name" : ""}`,
        { headers: auth },
      );
      if (metaRes.status === 404) {
        return { songs: [], error: "That playlist is private or no longer exists. Make it public and try again." };
      }
      if (metaRes.ok) {
        const meta = (await metaRes.json()) as { name?: string };
        name = meta.name;
      }
    } catch {
      /* name is optional */
    }

    const songs: { artist: string; song: string }[] = [];
    let truncated = false;
    let url: string | undefined =
      ref.kind === "playlist"
        ? `https://api.spotify.com/v1/playlists/${ref.id}/tracks?limit=100&fields=next,items(track(name,artists(name)))`
        : `https://api.spotify.com/v1/albums/${ref.id}/tracks?limit=50`;

    try {
      while (url) {
        const res: Response = await fetch(url, { headers: auth });
        if (!res.ok) {
          if (songs.length) break;
          return {
            songs: [],
            error:
              res.status === 404 || res.status === 403
                ? "That playlist isn't publicly readable. Make it public and try again."
                : "Spotify couldn't be reached right now. Try again in a moment.",
          };
        }
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
      if (!songs.length) return { songs: [], error: "Spotify couldn't be reached right now. Try again in a moment." };
    }

    if (!songs.length) return { songs: [], error: "No songs found in that Spotify link." };
    return { songs, name, truncated };
  });
