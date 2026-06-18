## Goals

1. Let the user connect **multiple music sources** for matching/preview — any number of local folders, plus tracks already loaded from VirtualDJ `database.xml` libraries (when those file paths are reachable as local files).
2. Make the **VirtualDJ "My Lists" export folder** explicitly changeable: show the linked folder, a "Change folder" button, and a "Clear" button.

## 1. Multiple music sources

### Data model (src/routes/index.tsx)

Replace single-folder state with a list:

```ts
type AudioSource =
  | { id: string; kind: "folder"; name: string; files: File[] }
  | { id: string; kind: "vdj"; name: string; libraryIndex: number };

const [audioSources, setAudioSources] = useState<AudioSource[]>([]);
```

`audioIndex` becomes derived: rebuild from the union of all `folder` source files plus any `vdj` source whose tracks have a matching `File` (vdj source is opportunistic — included only when the VirtualDJ library entries can be resolved to actual `File` objects from a connected folder; otherwise it stays as metadata-only and contributes nothing to playback). Memoize the rebuild on `audioSources` changes.

### `src/lib/audioMatch.ts`

- Add optional `extraEntries?: { path: string; basename: string; file: File }[]` parameter to `buildAudioIndex` so VirtualDJ-derived entries (when a `File` is available) can be folded into the same indexes (`byBasename`, `byNormBasename`, `byArtistTitle`, `byTitleOnly`).
- No change to `resolveAudioFile` lookup semantics.

### UI changes

Replace the single "Connected …" row with a **Music sources** card:

- Header: "Music sources" + buttons `Add folder`, `Add from VirtualDJ library` (only enabled when a parsed VirtualDJ library exists and is resolvable), `Rebuild index`.
- List of connected sources, each row showing: name, file count, `Remove` button.
- Footer: combined stats — `N files · M indexed variants across K sources`.

Behavior:
- `Add folder` → existing `pickDirectoryFiles()`, append new `folder` source (dedupe by folder name + size signature).
- `Remove` → drop source, rebuild index, clear stale `resolveCache` entry.
- `Rebuild index` → keep the button; rebuilds the combined index from all current sources.

`resolveLocalFile` continues to consume the combined `audioIndex`; the `PreviewPlayer` requires no changes.

## 2. Changeable VirtualDJ export folder

In the existing "Save to VirtualDJ My Lists" row (around line 1200):

- When unlinked: button `Choose VirtualDJ My Lists folder`.
- When linked: show the folder name (from the `DirectoryHandle.name` — store it alongside the handle in a new `vdjDirName` state) plus two ghost buttons: `Change folder` (re-runs `pickDirectoryHandle`) and `Clear` (resets handle + name).
- Disabled state + helper text preserved when `!canDirWrite`.

Small helper update in `src/lib/virtualDj.ts`: `pickDirectoryHandle()` already returns the handle; the route code reads `handle.name` directly (the `DirHandleLike` type in `index.tsx` gains an optional `name?: string`).

## Files touched

- `src/routes/index.tsx` — new `audioSources` state, derived `audioIndex`, sources UI, export-folder UI with Change/Clear.
- `src/lib/audioMatch.ts` — accept extra pre-resolved entries in `buildAudioIndex`.
- `src/lib/virtualDj.ts` — minor: ensure `pickDirectoryHandle` return type exposes `name` (no behavior change).

## Out of scope

- Persisting sources across reloads (browser security forbids re-using `File`/`FileSystemDirectoryHandle` without re-pick).
- Per-section export folders, remembered named export profiles, or switching between sources instead of combining them — explicitly deferred based on the answers.
