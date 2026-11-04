import { cleanReason, omissionText } from "./preparationPolicy";
import { trackIdentity } from "./fileIdentity";
import { exportApproved, resolveExportPath, type ExportSongRef, type VdjLibrary } from "./virtualDj";
export type Availability = "available" | "unavailable" | "unknown";
/** One terminal reason per selected recording (or unresolved row), including extras. */
export function exportReadiness(refs: ExportSongRef[], library: VdjLibrary, availability: Record<string, Availability> = {}, roots?: Record<string, string>) {
  const problems: { index: number; identity?: ExportSongRef["identity"]; title: string; reason: string }[] = [];
  let approved = 0, omitted = 0, excluded = 0, unapproved = 0, missing = 0, cleanBlocked = 0, unknown = 0;
  let duplicateCount = 0, knownSec = 0, unknownLength = 0;
  const seen = new Map<string, { index: number; identity?: ExportSongRef["identity"]; title: string }>();
  const duplicates: { path: string; first: { index: number; identity?: ExportSongRef["identity"]; title: string }; repeat: { index: number; identity?: ExportSongRef["identity"]; title: string } }[] = [];
  for (const [index, ref] of refs.entries()) {
    const issue = (reason: string) => problems.push({ index, identity: ref.identity, title: `${ref.song.artist} — ${ref.song.song}`, reason });
    const ids = ref.match?.trackIndex != null ? [...new Set([ref.match.trackIndex, ...(ref.match.extraTrackIndices ?? [])])] : [];
    const lost = ref.match?.unresolvedPaths ?? [];
    const count = Math.max(1, ids.length + lost.length);
    if (ref.match?.excludedFromVdj) { excluded += count; omitted++; issue("Excluded from DJ export"); continue; }
    // Saved files not in the library are reported, never substituted; a missing primary exports nothing.
    if (!ids.length && lost.length) { missing += lost.length; omitted++; issue(lost.length > 1 ? "Saved primary file is not in the library (its extras are not exported)" : "Saved file is not in the library"); continue; }
    if (!exportApproved(ref.match) || !ids.length) { unapproved += count; omitted++; issue("No confirmed track"); continue; }
    let wrote = 0;
    for (let n = 0; n < lost.length; n++) { missing++; issue("Saved extra file is not in the library"); }
    for (const id of ids) {
      const track = library.tracks[id];
      if (!track) { missing++; issue("Chosen file is not in the library"); continue; }
      const clean = cleanReason(track, !!ref.requireClean);
      if (clean) { cleanBlocked++; issue(clean); continue; }
      const path = resolveExportPath(track.filePath, roots) ?? track.filePath;
      if (availability[path] === "unavailable") { missing++; issue("File unavailable"); continue; }
      if (availability[path] !== "available") { unknown++; issue("File availability unknown"); }
      const fileId = trackIdentity(track.filePath, roots ?? {});
      const occurrence = { index, identity: ref.identity, title: `${ref.song.artist} — ${ref.song.song}` };
      const first = seen.get(fileId);
      if (first) { duplicateCount++; duplicates.push({ path: fileId, first, repeat: occurrence }); issue("Repeated selected file — resolve occurrences before combined DJ export"); }
      else {
        seen.set(fileId, occurrence);
        const seconds = Number(track.songLength);
        if (Number.isFinite(seconds) && seconds > 0) knownSec += seconds;
        else unknownLength++;
      }
      approved++; wrote++;
    }
    if (!wrote) omitted++;
  }
  return { requested: refs.length, approved, uniqueTracks: seen.size, duplicateCount, duplicates, knownSec, unknownLength, omitted, excluded, unapproved, missing, cleanBlocked, unavailable: missing, unknown, problems };
}
export function summaryText(report: ReturnType<typeof exportReadiness>) {
  return `${report.approved} track${report.approved === 1 ? "" : "s"}${report.duplicateCount ? ` · ${report.uniqueTracks} unique files · ${report.duplicateCount} repeat${report.duplicateCount === 1 ? "" : "s"}` : ""}${omissionText(report) ? ` · left out: ${omissionText(report)}` : ""}${report.unknown ? ` · ${report.unknown} file availability unknown` : ""}`;
}
/** Display-only row units, derived from the same selected-file rules as export.
 * Mixed rows retain eligible tracks but still need review; exclusions never need approval.
 * Disk availability is intentionally not inferred by match displays.
 */
export function classifySelectedRow(ref: ExportSongRef, library: VdjLibrary) {
  const report = exportReadiness([ref], library);
  const excluded = !!ref.match?.excludedFromVdj;
  const unlinked = !excluded && ref.match?.trackIndex == null;
  const attention = !excluded && (report.unapproved > 0 || report.missing > 0 || report.cleanBlocked > 0);
  return { report, excluded, unlinked, attention, review: attention && !unlinked,
    matched: !excluded && !attention && report.approved > 0, eligibleTracks: report.approved };
}
export function readinessText(report: ReturnType<typeof exportReadiness>) {
  return ["SetArchitect — Export readiness", `Requested tracks: ${report.requested}`, `Approved tracks (including extras, in playlist order): ${report.approved}`, `Unique eligible files: ${report.uniqueTracks}`, `Repeated selected files: ${report.duplicateCount}`, `Known unique length (seconds): ${report.knownSec}`, `Unique eligible files with unknown length: ${report.unknownLength}`, `Omitted event rows: ${report.omitted}`, `Explicitly excluded: ${report.excluded}`, `Unapproved/unresolved: ${report.unapproved}`, `Missing/unavailable files: ${report.missing}`, `Clean-policy blocks: ${report.cleanBlocked}`, `Availability unknown: ${report.unknown}`, "Reference files retain intended requests. Clean labels are metadata/filename evidence, not verified lyrics.", ...report.problems.map(p => `${p.index + 1}. ${p.title} — ${p.reason}`)].join("\n");
}