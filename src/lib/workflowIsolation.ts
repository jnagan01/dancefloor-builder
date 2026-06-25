/**
 * Workflow isolation primitives.
 *
 * The app builds AI-recommended song lists per "workflow". A workflow is one
 * user session of: upload songs → set prefs → generate. To guarantee an AI
 * recommendation call only ever sees the active workflow's data (and never
 * leaks songs/matches/prefs from a previous workflow), every workflow-scoped
 * piece of state is centralized here and re-set together.
 *
 * These helpers are pure so they can be exercised by regression tests
 * without rendering the React tree.
 */

export type SectionLists<T extends { artist: string; song: string }> = {
  warmUp: T[];
  transition: T[];
  peak: T[];
};

export type RecommendExistingEntry = { artist: string; song: string };

/**
 * Build the `existing` array that gets sent to the AI recommender. The
 * recommender uses this to avoid re-suggesting songs already in the set.
 *
 * INVARIANT: the returned array contains ONLY entries from the lists passed
 * in. Callers must construct `lists` from the current workflow's songs;
 * never merge in data from another workflow.
 */
export function buildRecommendExisting<T extends { artist: string; song: string }>(
  lists: SectionLists<T>,
): RecommendExistingEntry[] {
  return [...lists.warmUp, ...lists.transition, ...lists.peak].map((s) => ({
    artist: s.artist,
    song: s.song,
  }));
}

/**
 * The shape of state that belongs to a single workflow. Anything in this
 * object MUST be cleared when starting a new workflow or loading a saved
 * one. Device-level state (connected music folders, VirtualDJ export
 * folder) is intentionally NOT part of this — it survives across workflows.
 */
export interface WorkflowScopedState {
  songs: unknown[];
  hours: string;
  artistsInput: string;
  genresInput: string;
  decades: string[];
  notes: string;
  doNotPlayInput: string;
  expand: boolean;
  includeCombined: boolean;
  eventName: string;
  result: unknown | null;
  matches: Record<string, unknown>;
  searchOpen: unknown | null;
  searchQuery: string;
  previewTarget: unknown | null;
  isGenerating: boolean;
}

/** The canonical empty-workflow state. */
export function getInitialWorkflowState(): WorkflowScopedState {
  return {
    songs: [],
    hours: "3",
    artistsInput: "",
    genresInput: "",
    decades: ["2000s", "2010s", "2020s"],
    notes: "",
    doNotPlayInput: "",
    expand: false,
    includeCombined: false,
    eventName: "",
    result: null,
    matches: {},
    searchOpen: null,
    searchQuery: "",
    previewTarget: null,
    isGenerating: false,
  };
}

/**
 * Bumped whenever the workflow boundary changes (reset or load). The UI
 * uses this as a React `key` on workflow-scoped components so any internal
 * component state is dropped at the boundary.
 */
export function nextWorkflowInstanceId(prev: number): number {
  return prev + 1;
}
