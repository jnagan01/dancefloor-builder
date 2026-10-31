import { describe, it, expect } from "vitest";
import {
  buildM3u,
  buildTxtPlaylist,
  countMatchedForExport,
  type ExportSongRef,
  type VdjLibrary,
} from "../src/lib/virtualDj";

const lib = {
  tracks: [
    { filePath: "/Users/dj/Music/a.mp3", artist: "Artist A", title: "Song A" },
    { filePath: "/Users/dj/Music/b.mp3", artist: "Artist B", title: "Song B" },
  ],
  byKey: new Map(),
  byArtist: new Map(),
  subjects: [],
  tokens: {},
} as unknown as VdjLibrary;

const refs: ExportSongRef[] = [
  { song: { artist: "Artist A", song: "Song A" } as never, match: { status: "Matched", trackIndex: 0 } as never },
  { song: { artist: "Nobody", song: "Unmatched Song" } as never },
  { song: { artist: "Artist B", song: "Song B" } as never, match: { status: "Matched", trackIndex: 1 } as never },
];

describe("DJ-software exports include matched songs only", () => {
  it("counts only songs resolved to a library file", () => {
    expect(countMatchedForExport(refs, lib)).toBe(2);
  });

  it("omits unmatched songs from the matched-only set list", () => {
    const txt = buildTxtPlaylist(refs, lib, { matchedOnly: true });
    expect(txt).not.toContain("Unmatched Song");
    expect(txt).toContain("1. Artist A - Song A");
    expect(txt).toContain("2. Artist B - Song B");
  });

  it("omits unmatched songs from the M3U playlist", () => {
    const m3u = buildM3u(refs, lib, {});
    expect(m3u).not.toContain("Unmatched Song");
    expect(m3u).toContain("/Users/dj/Music/a.mp3");
    expect(m3u).toContain("/Users/dj/Music/b.mp3");
  });

  it("produces only the header when nothing matched, so exports must skip writing it", () => {
    expect(countMatchedForExport(refs, lib)).toBe(2);
    const emptyLib = { tracks: [], byKey: new Map(), byArtist: new Map(), subjects: [], tokens: {} } as unknown as VdjLibrary;
    expect(countMatchedForExport(refs, emptyLib)).toBe(0);
    expect(buildM3u(refs, emptyLib)).toBe("#EXTM3U\r\n");
  });
});

describe("reference exports keep every song", () => {
  it("keeps unmatched songs in the plain set list and numbers them in order", () => {
    const txt = buildTxtPlaylist(refs, lib);
    expect(txt).toContain("1. Artist A - Song A");
    expect(txt).toContain("2. Nobody - Unmatched Song (not in library)");
    expect(txt).toContain("3. Artist B - Song B");
  });

  it("lists every song even with no library loaded", () => {
    const txt = buildTxtPlaylist(refs, undefined);
    expect(txt.trim().split("\r\n")).toHaveLength(3);
  });
});

describe("reference TXT warning labels match the real reason", () => {
  const labeledRefs: ExportSongRef[] = [
    // Valid library candidate the user never confirmed.
    { song: { artist: "Artist A", song: "Song A" } as never, match: { status: "Possible Match", trackIndex: 0, confirmed: false } as never },
    // Valid candidate explicitly excluded from DJ-software exports.
    { song: { artist: "Artist B", song: "Song B" } as never, match: { status: "Matched", trackIndex: 1, excludedFromVdj: true } as never },
    // Confirmed, valid, non-excluded match: no warning.
    { song: { artist: "Artist A", song: "Song A Again" } as never, match: { status: "Matched", trackIndex: 0, confirmed: true } as never },
    // Candidate index points at nothing: genuinely unresolvable.
    { song: { artist: "Ghost", song: "Gone" } as never, match: { status: "Possible Match", trackIndex: 99 } as never },
  ];

  it("labels unconfirmed, excluded, and missing songs accurately", () => {
    const txt = buildTxtPlaylist(labeledRefs, lib);
    expect(txt).toContain("1. Artist A - Song A (match not confirmed)");
    expect(txt).toContain("2. Artist B - Song B (excluded from DJ export)");
    expect(txt).toContain("3. Artist A - Song A Again\r\n");
    expect(txt).not.toContain("Song A Again (");
    expect(txt).toContain("4. Ghost - Gone (not in library)");
    expect(txt).not.toContain("(not in library)\r\n1.");
  });

  it("matched-only DJ output still omits unconfirmed and excluded songs", () => {
    const txt = buildTxtPlaylist(labeledRefs, lib, { matchedOnly: true });
    expect(txt).toContain("1. Artist A - Song A");
    expect(txt).not.toContain("Song B");
    expect(txt).not.toContain("Gone");
    expect(txt).not.toContain("match not confirmed");
  });
});
