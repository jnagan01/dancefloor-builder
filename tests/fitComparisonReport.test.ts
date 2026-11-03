import { describe, it, expect } from "vitest";
import fs from "fs"; import path from "path";
import { comparisonData, comparisonMarkdown } from "./fit/fitComparison";

const dir = path.join(__dirname, "fit");
describe("persisted event-fit comparison report", () => {
  it("committed JSON/MD match a fresh deterministic run (set UPDATE_FIT_REPORT=1 to regenerate)", () => {
    const json = JSON.stringify(comparisonData(), null, 1) + "\n", md = comparisonMarkdown() + "\n";
    if (process.env.UPDATE_FIT_REPORT) { fs.writeFileSync(path.join(dir, "comparison.json"), json); fs.writeFileSync(path.join(dir, "comparison.md"), md); }
    expect(fs.readFileSync(path.join(dir, "comparison.json"), "utf8")).toBe(json);
    expect(fs.readFileSync(path.join(dir, "comparison.md"), "utf8")).toBe(md);
  });
  it("no cache-derived popularity is presented as verified familiarity", () => {
    const d = comparisonData();
    for (const v of [d.cache, d.saved]) for (const r of v.after) expect(r.reasons).not.toMatch(/supports guest familiarity|moderate familiarity evidence/);
  });
});
