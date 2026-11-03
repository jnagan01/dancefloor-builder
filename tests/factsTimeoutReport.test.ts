import { describe, it, expect } from "vitest";
import fs from "fs"; import path from "path";
import { timeoutData, timeoutMarkdown } from "./fit/timeoutComparison";

const dir = path.join(__dirname, "fit");
describe("persisted metadata-timeout comparison (fixture, not exact replay)", () => {
  it("committed JSON/MD match a fresh deterministic run (set UPDATE_FIT_REPORT=1 to regenerate)", async () => {
    const json = JSON.stringify(await timeoutData(), null, 1) + "\n", md = (await timeoutMarkdown()) + "\n";
    if (process.env.UPDATE_FIT_REPORT) { fs.writeFileSync(path.join(dir, "timeout.json"), json); fs.writeFileSync(path.join(dir, "timeout.md"), md); }
    expect(fs.readFileSync(path.join(dir, "timeout.json"), "utf8")).toBe(json);
    expect(fs.readFileSync(path.join(dir, "timeout.md"), "utf8")).toBe(md);
  });
  it("BEFORE loses every completed cache fact to the client cutoff; AFTER keeps all of them and nothing for hung rows", async () => {
    const d = await timeoutData();
    expect(d.gather.before.timedOutSongs).toBe(31);
    expect(d.coverage.before.energyAndDanceability).toBe(0);
    expect(d.gather.after.timedOutSongs).toBe(0);
    expect(d.coverage.after.energyAndDanceability).toBe(d.coverage.after.completedCacheFactsAvailable);
    expect(d.gather.after.incompleteSongs).toBe(10);
  });
});
