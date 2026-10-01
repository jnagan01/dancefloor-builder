/**
 * Spotify account connection + playlist export.
 *
 * Authorization Code flow against the DJ's own Spotify account so playlists
 * are created in their library. The refresh token is stored server-side in
 * public.spotify_connections (service-role only).
 *
 * Secrets: SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (read inside handlers).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const SPOTIFY_SCOPES = "playlist-modify-public playlist-modify-private user-read-private";

/** Allowed redirect origins — the published app and any Lovable preview host. */
export function isAllowedOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" && u.hostname !== "localhost") return false;
    return u.hostname === "localhost" || u.hostname.endsWith(".lovable.app");
  } catch {
    return false;
  }
}

export function redirectUriFor(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/public/spotify/callback`;
}

/** Signed, short-lived state carrying the user id + origin. */
export async function signState(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${btoa(payload).replace(/=+$/, "")}.${hex}`;
}

export async function verifyState(
  state: string,
  secret: string,
): Promise<{ userId: string; origin: string } | undefined> {
  const [b64, sig] = state.split(".");
  if (!b64 || !sig) return undefined;
  let payload: string;
  try {
    payload = atob(b64);
  } catch {
    return undefined;
  }
  const expected = await signState(payload, secret);
  if (expected !== state) return undefined;
  const [userId, origin, issuedAt] = payload.split("|");
  if (!userId || !origin || !issuedAt) return undefined;
  if (Date.now() - Number(issuedAt) > 15 * 60 * 1000) return undefined;
  return { userId, origin };
}

async function accessTokenFromRefresh(refreshToken: string): Promise<string | undefined> {
  const id = process.env["SPOTIFY_CLIENT_ID"];
  const secret = process.env["SPOTIFY_CLIENT_SECRET"];
  if (!id || !secret) return undefined;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as { access_token?: string };
  return json.access_token;
}

async function tokenForUser(userId: string): Promise<{ token?: string; error?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("spotify_connections")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.refresh_token) return { error: "Spotify isn't connected yet. Connect your account in Settings." };
  const token = await accessTokenFromRefresh(data.refresh_token);
  if (!token) return { error: "Your Spotify connection expired. Reconnect your account in Settings." };
  return { token };
}

/* ------------------------------ connection ------------------------------ */

export const getSpotifyConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ connected: boolean; displayName?: string; configured: boolean }> => {
    const configured = !!process.env["SPOTIFY_CLIENT_ID"] && !!process.env["SPOTIFY_CLIENT_SECRET"];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("spotify_connections")
      .select("spotify_display_name")
      .eq("user_id", context.userId)
      .maybeSingle();
    return { connected: !!data, displayName: data?.spotify_display_name ?? undefined, configured };
  });

export const startSpotifyAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ origin: z.string().max(300) }).parse(d))
  .handler(async ({ data, context }): Promise<{ url?: string; error?: string }> => {
    const clientId = process.env["SPOTIFY_CLIENT_ID"];
    const clientSecret = process.env["SPOTIFY_CLIENT_SECRET"];
    if (!clientId || !clientSecret) return { error: "Spotify isn't configured for this app yet." };
    if (!isAllowedOrigin(data.origin)) return { error: "This app address can't be used for the Spotify sign-in." };
    const state = await signState(`${context.userId}|${data.origin}|${Date.now()}`, clientSecret);
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUriFor(data.origin),
      scope: SPOTIFY_SCOPES,
      state,
      show_dialog: "true",
    });
    return { url: `https://accounts.spotify.com/authorize?${params.toString()}` };
  });

export const disconnectSpotify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("spotify_connections").delete().eq("user_id", context.userId);
    return { ok: true };
  });

/* -------------------------------- export -------------------------------- */

export const createSpotifyPlaylist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ name: z.string().min(1).max(100), description: z.string().max(300).optional() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ playlistId?: string; url?: string; error?: string }> => {
    const { token, error } = await tokenForUser(context.userId);
    if (!token) return { error };
    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    // Spotify no longer accepts POST /v1/users/{id}/playlists for app tokens — use /v1/me/playlists.
    const res = await fetch("https://api.spotify.com/v1/me/playlists", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: data.name,
        public: true,
        description: data.description ?? "Created with Dancefloor Builder",
      }),
    });
    if (!res.ok) return { error: "Spotify could not create the playlist." };
    const pl = (await res.json()) as { id?: string; external_urls?: { spotify?: string } };
    if (!pl.id) return { error: "Spotify did not return a playlist." };
    return { playlistId: pl.id, url: pl.external_urls?.spotify ?? `https://open.spotify.com/playlist/${pl.id}` };
  });

function cleanTerm(s: string): string {
  return s
    .replace(/["']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function findTrackUri(token: string, artist: string, song: string): Promise<string | undefined> {
  const headers = { Authorization: `Bearer ${token}` };
  const queries = [
    `track:${cleanTerm(song)} artist:${cleanTerm(artist)}`,
    `${cleanTerm(song)} ${cleanTerm(artist)}`,
  ];
  for (const q of queries) {
    try {
      const res = await fetch(
        `https://api.spotify.com/v1/search?type=track&limit=1&q=${encodeURIComponent(q)}`,
        { headers },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as { tracks?: { items?: Array<{ uri?: string }> } };
      const uri = json.tracks?.items?.[0]?.uri;
      if (uri) return uri;
    } catch {
      /* try the next query shape */
    }
  }
  return undefined;
}

const BatchSchema = z.object({
  playlistId: z.string().min(1).max(60),
  songs: z.array(z.object({ artist: z.string().max(200), song: z.string().max(200) })).max(25),
});

export interface SpotifyBatchResult {
  added: number;
  missed: { artist: string; song: string; reason: string }[];
  error?: string;
}

export const addSpotifyTracks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => BatchSchema.parse(d))
  .handler(async ({ data, context }): Promise<SpotifyBatchResult> => {
    const { token, error } = await tokenForUser(context.userId);
    if (!token) return { added: 0, missed: [], error };
    const uris: string[] = [];
    const missed: { artist: string; song: string; reason: string }[] = [];
    for (const s of data.songs) {
      // Match on the UPLOADED artist/title only — never local file names or tags.
      const uri = await findTrackUri(token, s.artist, s.song);
      if (uri) uris.push(uri);
      else missed.push({ artist: s.artist, song: s.song, reason: "Not found in Spotify's catalog" });
    }
    if (uris.length) {
      const res = await fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(data.playlistId)}/tracks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uris }),
      });
      if (!res.ok) return { added: 0, missed, error: "Spotify refused to add this batch of songs." };
    }
    return { added: uris.length, missed };
  });
