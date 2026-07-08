## Goal

1. Require sign-in to use the Dance Floor Builder.
2. Remove Step 5 (Music Library Matching + VirtualDJ export folder) from the builder flow. Move that setup into a **Profile / Settings** page. On the builder, saved folders auto-restore silently from the browser; if a device is missing them, a small inline banner links to Profile.

## Important constraint (already discussed)

Folder access uses the browser's File System Access API. Those permissions live in IndexedDB per browser/device and **cannot** be transferred to another device via the server profile. What we CAN store server-side: a flag that says "this user has configured folders before" plus display-name metadata (so we can distinguish "new device, reconnect" from "brand new user, do first-time setup"). Actual re-granting of folder access on a new device still requires one click by the user in the Profile page — but never again in the builder flow.

## Changes

### 1. Auth gate on the builder

- Create `src/routes/_authenticated/route.tsx` — the integration-standard pathless layout: `ssr: false`, `beforeLoad` calls `supabase.auth.getUser()` and `throw redirect({ to: "/auth" })` when unauthenticated; component returns `<Outlet />`.
- Move `src/routes/index.tsx` → `src/routes/_authenticated/index.tsx` and update the route call to `createFileRoute("/_authenticated/")`. URL stays `/`.
- On `/auth`, after successful sign-in, keep the existing redirect to `/`.

### 2. New Profile / Settings page

- Create `src/routes/_authenticated/profile.tsx` (URL `/profile`).
- Move the entire Step 5 UI into this page:
  - Add music folder / Add VirtualDJ `database.xml` / Scan VirtualDJ folder / Clear libraries
  - VirtualDJ export folder picker (Choose / Change / Forget)
  - Indexed-tracks summary + per-source list with remove
- Add a "Music folders" status row to the builder page's header/nav that links to `/profile` when anything is missing on this device.
- Add a top-level user menu (link to Profile, Sign out) to `__root.tsx` or the builder header.

### 3. Persist a "configured before" flag per user

- Migration: add `music_setup_completed boolean default false` to the existing `profiles` table (no folder paths — those can't be reused across devices; this is only a UX hint).
- When the Profile page has at least one library indexed AND an export folder set, upsert `music_setup_completed = true` for `auth.uid()`.
- Existing RLS on `profiles` already scopes updates to the owner — reuse it.

### 4. Builder page (index) behavior after Step 5 removal

- Delete the Step 5 `<Card>` block from the builder. Renumber the "Generate" button placement.
- Keep the existing on-mount effect that reads handles from IndexedDB (`loadDirHandle(VDJ_DIR_KEY)`, `librariesStore`) — this is what "auto-restore silently" relies on.
- If `music_setup_completed` is true but this browser has no handles (new device / cleared storage), render a compact inline notice above "Generate":
  > "Music folders aren't connected on this device. [Reconnect in Profile]"
- If `music_setup_completed` is false (brand-new user), the same banner reads "First time here? [Set up your music folders]".
- Export buttons remain; when no export folder is present on this device they simply fall back to file downloads (already the current behavior).

### 5. Root shell / navigation

- In `__root.tsx`, add a lightweight header with app name, "Profile" link (visible when signed in), and "Sign out" (calls `supabase.auth.signOut()` + navigates to `/auth`, following the sign-out hygiene rules — `queryClient.cancelQueries()`, `clear()`, `signOut()`, `navigate({ to: "/auth", replace: true })`).
- Keep `/auth` public. Keep the sitemap route public.

## Files touched

- New: `src/routes/_authenticated/route.tsx`, `src/routes/_authenticated/profile.tsx`
- Move: `src/routes/index.tsx` → `src/routes/_authenticated/index.tsx` (Step 5 removed, banner added)
- Edit: `src/routes/__root.tsx` (user menu / profile link / sign out)
- Migration: add `music_setup_completed` column to `public.profiles`
- Auto-regenerated: `src/routeTree.gen.ts`

## Out of scope

- Storing folder paths server-side (technically impossible with the File System Access API).
- Cross-device sync of the audio index — each device indexes its own local files.

## What the user will experience

- Signed out → any URL other than `/auth` bounces to `/auth`.
- Signed in on a device they've used before → land on `/`, folders auto-restore, generate right away. Step 5 is gone.
- Signed in on a new device → land on `/`, see a one-line banner linking to `/profile` to reconnect. Once done, the banner disappears and never returns on that device.
