
# Workflow History + New Workflow

Add two DJ-only features to the index page:
1. **History** of previously created lists, saved to the signed-in DJ's account.
2. **Start new workflow** button that resets the current page without a refresh (with a confirm).

## Who can use it

- Only signed-in, approved DJs (matches the planned Spotify export gating).
- Signed-out / pending users still get the public generator but no save/history UI.

## What gets saved per entry

- A **name/label** the DJ types when saving (default suggestion: "Workflow — <date>").
- The three generated lists (Warm Up, Transition, Peak).
- The inputs that produced them: uploaded songs, preferences (artists, genres, decades, notes, do-not-play), hours, and the expand toggle.
- `created_at` timestamp.

## Database (one migration)

New table `public.workflow_history`:

- `id uuid pk`
- `user_id uuid` → `auth.users` (cascade)
- `name text not null`
- `inputs jsonb not null` — uploaded songs + preferences + hours + expand
- `lists jsonb not null` — `{ warmUp, transition, peak }`
- `created_at`, `updated_at`

RLS: owner-only SELECT/INSERT/UPDATE/DELETE scoped to `auth.uid() = user_id`; admins SELECT all. Standard GRANTs to `authenticated` + `service_role`. `updated_at` trigger using existing `update_updated_at_column()`.

## UI changes (index page only)

Header area (when signed in as approved DJ):

- **"Save to history"** button — appears once lists are generated. Opens a small dialog: name field (prefilled), Save / Cancel.
- **"History"** button — opens a side sheet listing past entries (name, date, song counts). Each row has:
  - **Load** — restores inputs + lists into the page state (replaces current).
  - **Rename** / **Delete**.
- **"Start new workflow"** button — always visible. Opens a confirm dialog with:
  - "Save current workflow first?" (only if there's unsaved work) → Save + Reset, Reset without saving, Cancel.

Signed-out users see a small "Sign in to save history" hint instead of the buttons. No redirect; the existing public flow is untouched.

## Server functions (`src/lib/history.functions.ts`)

All use `requireSupabaseAuth` + gate on `is_dj_approved(userId)`:

- `listWorkflows()` → `{ id, name, created_at, counts }[]`
- `getWorkflow(id)` → full entry (inputs + lists)
- `saveWorkflow({ name, inputs, lists })` → new id
- `renameWorkflow({ id, name })`
- `deleteWorkflow(id)`

## State reset ("Start new workflow")

A single `resetWorkflow()` function in `Index` clears: uploaded songs, generated result, preferences, do-not-play, hours, expand toggle, and any transient UI state (dialogs, search). No page reload, no route change. Triggered from the confirm dialog above.

## Out of scope

- No changes to generation logic, Virtual DJ matching, or the planned Spotify export.
- No public/anonymous history (per the choice "Per signed-in DJ (cloud)").

## Technical notes

- `inputs`/`lists` stored as `jsonb` to keep the schema flexible as the generator evolves.
- `saveWorkflow` validates payload with Zod (artist/song string caps, max song counts) to keep row size bounded.
- History sheet uses existing `Sheet` + `Table` shadcn components; no new dependencies.
- Loading an entry routes through the same state setters the generator already uses, so the UI re-renders identically to a fresh generation.
