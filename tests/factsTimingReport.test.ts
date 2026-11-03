import { describe, it, expect } from "vitest";
import fs from "fs"; import path from "path";
import { timingData, timingMarkdown } from "./fit/timingComparison";

const dir = path.join(__dirname, "fit");
describe("persisted metadata-timing comparison (fixture, not exact replay)", () => {
  it("committed JSON/MD match a fresh deterministic run (set UPDATE_FIT_REPORT=1 to regenerate)", () => {
    const json = JSON.stringify(timingData(), null, 1) + "\n", md = timingMarkdown() + "\n";
    if (process.env.UPDATE_FIT_REPORT) { fs.writeFileSync(path.join(dir, "timing.json"), json); fs.writeFileSync(path.join(dir, "timing.md"), md); }
    expect(fs.readFileSync(path.join(dir, "timing.json"), "utf8")).toBe(json);
    expect(fs.readFileSync(path.join(dir, "timing.md"), "utf8")).toBe(md);
  });
  it("estimates penalise but never exclude: every pool row is still ranked under fit", () => {
    const d = timingData();
    expect(d.fit.ranks).toHaveLength(31);
    const old = d.fit.ranks.find(r => r.track === "The Beatles|Let It Be")!;
    expect(old.newReasons).not.toMatch(/no energy or danceability data/);
  });
});
