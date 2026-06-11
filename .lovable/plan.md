# Export Dance Floor Lists to Spotify (3 Playlists, DJ-Only)

## Goal

Add an "Export to Spotify" feature that takes the three generated lists (Warm Up, Transition, Peak) and creates **three separate playlists** in the signed-in DJ's Spotify account. Available only to a signed-in DJ.

## User Flow

1. DJ visits the app. The main tool (upload, generate lists) stays public — no friction.
2. After generating lists, DJ sees an "Export to Spotify" button.
3. If not signed in → button prompts "Sign in as DJ to export". Clicking opens a sign-in screen (email/password + Google).
4. Once signed in, DJ clicks "Connect Spotify" (first time only) → redirected to Spotify OAuth consent → back to the app with tokens stored server-side.
5. DJ clicks "Export to Spotify" → server matches each song to a Spotify track, creates 3 playlists, adds tracks.
6. Result modal shows: 3 playlist links + per-list match stats (e.g. "Warm Up: 18/20 matched, 2 not found").

## Auth Setup

- **Lovable Cloud auth** with email/password + Google sign-in (defaults). DJ accounts only — no anonymous signups.
- New route `/auth` for sign-in/sign-up.
- DJs only — no separate roles needed for v1 (every signed-in user is a DJ).
- A `profiles` table to store DJ name (optional, useful later).
- A `spotify_connections` table to store each DJ's Spotify refresh token (server-only access, RLS scoped to `auth.uid()`).

## Spotify Setup

- Register a Spotify Developer app (developer.spotify.com) — DJ does this once or we use ours; **I'll ask the user which they prefer below**.
- Required Spotify scopes: `playlist-modify-public`, `playlist-modify-private`.
- Redirect URI: `https://<app-domain>/api/public/spotify/callback`.
- Store `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` as Lovable Cloud secrets.

## Server Functions / Routes

1. `GET /api/public/spotify/callback` — server route handling Spotify OAuth redirect. Verifies state, exchanges code for tokens, saves refresh token to `spotify_connections` for the authenticated DJ.
2. `startSpotifyAuth` (server fn, auth-required) — generates Spotify auth URL with state token tied to DJ's user id, returns URL for browser redirect.
3. `getSpotifyConnectionStatus` (server fn, auth-required) — returns `{ connected: boolean, spotifyDisplayName? }`.
4. `exportToSpotify` (server fn, auth-required) — accepts the three lists (song title + artist arrays). For each list:
   - Refresh access token using stored refresh token.
   - Search Spotify for each track (`q=track:<title> artist:<artist>`), pick top result above a confidence threshold.
   - Create a playlist (name: "Warm Up — <date>", "Transition — <date>", "Peak — <date>"; description includes app attribution).
   - Add matched track URIs in batches of 100.
   - Return per-list `{ playlistUrl, matched, unmatchedSongs[] }`.

All Spotify API calls go through the server (refresh token never touches the browser).

## UI Changes

- Top-right header: "Sign in" / DJ avatar menu (Sign out).
- After generating lists, add an "Export to Spotify" panel:
  - Not signed in → "Sign in to export to Spotify" button → `/auth`.
  - Signed in, no Spotify connection → "Connect Spotify" button.
  - Connected → "Export 3 playlists to Spotify" button, plus "Disconnect Spotify" link.
- Export result modal: 3 playlist cards (name, open-in-Spotify link, matched count, expandable "unmatched" list).

## Database (migration)

```sql
-- profiles (optional DJ display name)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz default now()
);
-- + GRANT, RLS, auto-create trigger on signup

-- spotify connections
create table public.spotify_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  spotify_user_id text not null,
  spotify_display_name text,
  refresh_token text not null,        -- server-only; RLS blocks client reads
  scopes text not null,
  connected_at timestamptz default now()
);
-- + GRANT to authenticated/service_role, RLS: users can SELECT connection
--   existence (display_name only via a view or server fn), never the token
```

The refresh token row is read only by server functions using `supabaseAdmin`; RLS denies all direct client access.

## Caveats

- Spotify search matching is ~85–95% accurate. Unmatched tracks are reported clearly so the DJ can add them manually.
- One export = three new playlists each time (we don't dedupe playlist names; date suffix prevents collisions).
- Spotify free accounts work for playlist creation.

## Technical Notes

- TanStack Start `createServerFn` for app logic; one server route only for the OAuth callback.
- `requireSupabaseAuth` middleware on all DJ-only server fns.
- `attachSupabaseAuth` already registered in `src/start.ts` from the Cloud setup.
- Spotify token refresh logic isolated in `src/lib/spotify.server.ts` (server-only).
- Existing dance floor logic (`src/lib/danceFloor.ts`) is untouched — export reads the already-generated lists from the index page.

## Questions Before I Build

1. **Spotify app credentials**: Use a single Lovable-managed Spotify app (you give me a client ID/secret and I store them as secrets — simpler for DJs), or require each DJ to bring their own (more setup per DJ, no shared rate limits)? Recommended: single shared app.
2. **Sign-up open or invite-only?** Should anyone be able to create a DJ account, or do you want to restrict it (e.g. only emails you whitelist)?
