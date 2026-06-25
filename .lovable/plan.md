# Prevent workflow data from leaking into AI recommendations

## What I checked

- AI call (`src/lib/recommend.functions.ts`): the server function is **stateless**. It only reads the `prefs` and `existing` arrays sent in the request payload — there is no server-side memory of prior calls, and no other data is added to the prompt.
- AI call site (`src/routes/index.tsx`, the Generate handler): `prefs` is rebuilt from the current form inputs and `existing` is built from a freshly computed `r.warmUp/transition/peak` (which itself is derived only from the currently uploaded `songs`). So the prompt itself is already clean.
- The real leak risk is **client-side workflow state** that survives across "New workflow" / "Load workflow" actions. Some of it (matches, generated results, search/preview panels) belongs to one workflow and should not silently carry over.

## Gaps to fix

`resetWorkflow` (new workflow) does not clear:
- `previewTarget` (preview player can keep playing a track from the previous workflow)
- `isGenerating` (stuck spinner if reset during a run)

`applySnapshot` (load workflow from history) does not clear:
- `matches` — manual/auto matches from the previous workflow stay attached to song keys
- `searchOpen`, `searchQuery` — an inline search panel from the previous workflow stays open
- `previewTarget`, `includeCombined`, `isGenerating`

The VirtualDJ export folder handle (`vdjDirHandle/Name/SavedAt`) and the selected music folder (`audioSources`, `libraries`, `librarySources`) are deliberately persisted device-level via IndexedDB — they represent the DJ's machine setup, not workflow content, so they stay.

## Changes (frontend only, `src/routes/index.tsx`)

1. **Extract a single `clearWorkflowState()` helper** that resets every workflow-scoped piece of state: `songs`, `hours`, `artistsInput`, `genresInput`, `decades`, `notes`, `doNotPlayInput`, `expand`, `includeCombined`, `eventName`, `result`, `matches`, `searchOpen`, `searchQuery`, `previewTarget`, `isGenerating`. Call it from `resetWorkflow` so the existing reset path picks up the new fields.

2. **Make `applySnapshot` start from a clean slate**: call `clearWorkflowState()` first, then apply the snapshot's inputs and lists. This guarantees `matches`, `searchOpen`, `previewTarget`, etc. from the previous workflow cannot bleed into the loaded one.

3. **Harden the AI call site** with a short comment + a defensive local rebuild so it is obvious the payload is workflow-scoped:
   - Build `prefs` and `existing` inside the Generate handler from current state only (already the case — add a comment that documents this is intentional and must not reference any outer/stale variables).
   - Keep `existing` derived strictly from `r.warmUp/transition/peak` (already the case).

4. **Re-key the preview player and inline search panel by workflow** so any internal state inside those components is dropped on reset/load. Introduce a `workflowInstanceId` (incrementing number in state) bumped inside `clearWorkflowState()` and inside `applySnapshot`, and pass it as `key` on `<PreviewPlayer>` and on the inline `InlineMatchSearch` wrapper.

## Out of scope

- No change to the server function, prompt, schema, or model.
- No change to persisted device-level state (VDJ export folder, music folder, audio sources).
- No change to history storage or saved snapshot shape.

## Verification

- Manual: generate lists in workflow A (with distinct artists/genres/Do-Not-Play), click "New workflow", confirm form is empty, no matches, no preview, no open search panel. Repeat by loading a saved workflow B — confirm only B's data is visible and a fresh Generate call only contains B's `prefs`/`existing` (visible in network payload).
- Existing tests still pass (`tests/*`).
