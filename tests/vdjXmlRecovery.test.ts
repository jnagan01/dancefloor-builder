import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseVdjDatabaseXmlDetailed, type VdjTrack } from "../src/lib/virtualDj";
import { decodeXmlAttribute, recoverVdjBlocks } from "../src/lib/vdjXmlRecovery";
import { mergeTrackMetadata, metadataResolver, vdjSyncSummary } from "../src/lib/trackMetadataIdentity";
// @ts-expect-error plain JS fixture shared with the Electron suites
import { malformedVdjFixture } from "./native/fixtures/malformed-vdj.mjs";

const require = createRequire(import.meta.url);
const DIR = "/Users/synthetic/Music";
const parse = (xml: string) => parseVdjDatabaseXmlDetailed(xml, { strictBlocks: false });
const byPath = (tracks: VdjTrack[]) => new Map(tracks.map(t => [t.filePath, t]));

describe("malformed VirtualDJ database recovery", () => {
  const fx = malformedVdjFixture(DIR);
  const report = parse(fx.xml);
  const tracks = byPath(report.tracks);

  it("keeps full metadata for intact tracks before and after the damaged entries", () => {
    expect(report.mode).toBe("recovered");
    const lengths = Object.fromEntries(report.tracks.map(t => [t.filePath, t.songLength ?? null]));
    expect(lengths).toEqual({ ...fx.expectedLength, [fx.files.zero]: null, [fx.files.bad]: null });
    const bill = tracks.get(fx.files.bill)!;
    expect(bill).toMatchObject({ artist: "Bill Withers", title: "Ain't No Sunshine", genre: "Soul", year: "1971", playCount: 7, key: "Am", songLength: "290", fileSize: "4646464" });
    expect(tracks.get(fx.files.simon)).toMatchObject({ artist: "Simon & Garfunkel", playCount: 0, songLength: "175" });
    expect(tracks.get(fx.files.after)).toMatchObject({ artist: "Zed", title: "After", songLength: "306" });
  });

  it("decodes &apos; &amp; numeric entities and genuine apostrophes into exact, distinct paths", () => {
    expect(tracks.has(`${DIR}/Bill Withers - Ain't No Sunshine.mp3`)).toBe(true);
    expect(tracks.has(`${DIR}/other/Bill Withers - Ain't No Sunshine.mp3`)).toBe(true);
    expect(tracks.has(`${DIR}/Simon & Garfunkel - Cecilia.mp3`)).toBe(true);
    expect(tracks.has(`${DIR}/Beyoncé - Halo ❤.mp3`)).toBe(true);
    expect(tracks.get(`${DIR}/Beyoncé - Halo ❤.mp3`)!.artist).toBe("Beyoncé");
    expect(tracks.get(`${DIR}/Don't Raw - Quote.mp3`)!.title).toBe('Say "Hi"');
    expect([...tracks.keys()].some(k => k.includes("&apos;") || k.includes("&amp;") || k.includes("&#"))).toBe(false);
  });

  it("recovers known malformed entries without inventing or expanding entities", () => {
    expect(tracks.get(fx.files.broken)).toMatchObject({ artist: "Broken", genre: "Pop", songLength: "200" });
    expect(tracks.get(fx.files.bare)).toMatchObject({ artist: "Tom & Jerry", songLength: "150" });
    const entity = tracks.get(fx.files.entity)!;
    expect(entity.title).toBe("&boom; &xxe;");
    expect(JSON.stringify(report.tracks)).not.toContain("EXPANDED");
    expect(JSON.stringify(report.tracks)).not.toContain("passwd");
  });

  it("skips and reports unrecoverable entries with their line numbers", () => {
    expect(report.skippedCount).toBe(fx.skippedCount);
    const lines = fx.xml.split("\n");
    const lineOf = (needle: string) => lines.findIndex((l: string) => l.includes(needle)) + 1;
    expect(report.skipped).toEqual([
      { line: lineOf("Unclosed - Quote.mp3"), reason: "unsafe file path" },
      { line: lineOf("Bad &#0; Ref"), reason: "invalid character reference in FilePath" },
    ]);
    expect([...tracks.keys()].some(k => k.includes("Unclosed") || k.includes("Bad "))).toBe(false);
  });

  it("merge keeps old valid lengths for invalid/zero/skipped entries and never crosses copies", () => {
    const library: VdjTrack[] = [
      { filePath: fx.files.bill, artist: "Bill Withers", title: "Ain't No Sunshine" },
      { filePath: fx.files.billOther, artist: "Bill Withers", title: "Ain't No Sunshine" },
      { filePath: fx.files.zero, artist: "Zed", title: "Zero", songLength: "111" },
      { filePath: fx.files.bad, artist: "Zed", title: "Bad", songLength: "222" },
      { filePath: fx.files.unclosed, artist: "Unclosed", title: "Quote", songLength: "333", genre: "Kept" },
    ];
    const resolver = metadataResolver(report.tracks, library, {});
    const merged = library.map(t => mergeTrackMetadata(t, resolver.resolve(t.filePath), true));
    expect(merged.map(t => [t.filePath, t.songLength])).toEqual([
      [fx.files.bill, "290"], [fx.files.billOther, "120"], [fx.files.zero, "111"], [fx.files.bad, "222"], [fx.files.unclosed, "333"],
    ]);
    expect(merged[4]).toEqual(library[4]);
    expect(merged.map(t => t.filePath)).toEqual(library.map(t => t.filePath));
    expect(vdjSyncSummary(report.tracks, [{ tracks: library }], {})).toEqual({ matched: 4, withLength: 5 });
  });

  it("valid documents parse identically through the tolerant reader", () => {
    const valid = `<VirtualDJ_Database>\n <Song FilePath="${DIR}/A &amp; B&apos;s.mp3"><Tags Author="A" Title="Tab\there" /><Infos SongLength="215.6" /></Song>\n <Song FilePath='${DIR}/C "q".mp3'><Tags Title="C&#10;D" /></Song>\n</VirtualDJ_Database>`;
    const r = parse(valid);
    expect(r.skippedCount).toBe(0);
    expect(r.tracks.map(t => [t.filePath, t.title, t.songLength ?? null])).toEqual([
      [`${DIR}/A & B's.mp3`, "Tab here", "216"], [`${DIR}/C "q".mp3`, "C\nD", null],
    ]);
  });

  it("decodes only predefined and valid numeric references", () => {
    expect(decodeXmlAttribute("a&amp;b&apos;c&lt;&gt;&quot;")).toBe("a&b'c<>\"");
    expect(decodeXmlAttribute("&#233;&#xE9;&#x1F3B5;")).toBe("ééé".slice(0, 2) + "🎵");
    expect(decodeXmlAttribute("bare & and &custom; stay")).toBe("bare & and &custom; stay");
    expect(decodeXmlAttribute("&#0;")).toBeNull();
    expect(decodeXmlAttribute("&#xD800;")).toBeNull();
    expect(decodeXmlAttribute("line\r\nbreak")).toBe("line break");
  });

  it("bounds the skipped report and stays linear on a 31,250-entry damaged library", () => {
    const rows: string[] = [];
    for (let i = 0; i < 31250; i++) rows.push(i % 500 === 7
      ? ` <Song FilePath="${DIR}/bad-${i}.mp3><Tags Title="x" /></Song>`
      : ` <Song FilePath="${DIR}/t-${i} &amp; co.mp3"><Tags Author="A${i}" Title="T${i}" /><Infos SongLength="${200 + (i % 90)}.4" /></Song>`);
    const t0 = performance.now();
    const r = recoverVdjBlocks(`<VirtualDJ_Database>\n${rows.join("\n")}\n</VirtualDJ_Database>`, null);
    const ms = performance.now() - t0;
    expect(r.blocks.length).toBe(31250 - 63);
    expect(r.skippedCount).toBe(63);
    expect(r.skipped.length).toBe(50);
    expect(ms).toBeLessThan(5000);
  });

  it("the real desktop reader returns the malformed file byte-for-byte and never writes it", async () => {
    const { readVdjDatabaseFile } = require("../desktop/vdj-database.cjs");
    const fs = require("node:fs");
    const dir = mkdtempSync(path.join(os.tmpdir(), "setarchitect-vdj-"));
    const file = path.join(dir, "database.xml");
    writeFileSync(file, fx.xml, "utf8");
    const before = fs.statSync(file).mtimeMs;
    const result = await readVdjDatabaseFile(fs, file);
    expect(result).toEqual({ ok: true, path: file, xml: fx.xml });
    expect(readFileSync(file, "utf8")).toBe(fx.xml);
    expect(fs.statSync(file).mtimeMs).toBe(before);
    expect(parse(result.xml).tracks.length).toBe(report.tracks.length);
    expect((await readVdjDatabaseFile(fs, path.join(dir, "missing.xml"))).ok).toBe(false);
  });
});
