import { cleanReason, omissionText } from "./preparationPolicy";
import { exportApproved, resolveExportPath, type ExportSongRef, type VdjLibrary } from "./virtualDj";
export type Availability = "available" | "unavailable" | "unknown";
/** One terminal reason per selected recording (or unresolved row), including extras. */
export function exportReadiness(refs: ExportSongRef[], library: VdjLibrary, availability: Record<string, Availability> = {}, roots?: Record<string, string>) {
  const problems: { index: number; identity?: ExportSongRef["identity"]; title: string; reason: string }[] = [];
  let approved = 0, omitted = 0, excluded = 0, unapproved = 0, missing = 0, cleanBlocked = 0, unknown = 0;
  for (const [index, ref] of refs.entries()) {
    const issue = (reason: string) => problems.push({ index, identity: ref.identity, title: `${ref.song.artist} — ${ref.song.song}`, reason });
    const ids = ref.match?.trackIndex != null ? [...new Set([ref.match.trackIndex, ...(ref.match.extraTrackIndices ?? [])])] : [];
    const count = Math.max(1, ids.length);
    if (ref.match?.excludedFromVdj) { excluded += count; omitted++; issue("Excluded from DJ export"); continue; }
    if (!exportApproved(ref.match) || !ids.length) { unapproved += count; omitted++; issue("No confirmed track"); continue; }
    let wrote = 0;
    for (const id of ids) {
      const track = library.tracks[id];
      if (!track) { missing++; issue("Chosen file is not in the library"); continue; }
      const clean = cleanReason(track, !!ref.requireClean);
      if (clean) { cleanBlocked++; issue(clean); continue; }
      const path = resolveExportPath(track.filePath, roots) ?? track.filePath;
      if (availability[path] === "unavailable") { missing++; issue("File unavailable"); continue; }
      if (availability[path] !== "available") { unknown++; issue("File availability unknown"); }
      approved++; wrote++;
    }
    if (!wrote) omitted++;
  }
  return { requested: refs.length, approved, omitted, excluded, unapproved, missing, cleanBlocked, unavailable: missing, unknown, problems };
}
export function summaryText(report: ReturnType<typeof exportReadiness>) {
  return `${report.approved} track${report.approved === 1 ? "" : "s"}${omissionText(report) ? ` · left out: ${omissionText(report)}` : ""}${report.unknown ? ` · ${report.unknown} file availability unknown` : ""}`;
}
export function readinessText(report: ReturnType<typeof exportReadiness>) {
  return ["SetArchitect — Export readiness", `Requested tracks: ${report.requested}`, `Approved tracks (including extras, in playlist order): ${report.approved}`, `Omitted event rows: ${report.omitted}`, `Explicitly excluded: ${report.excluded}`, `Unapproved/unresolved: ${report.unapproved}`, `Missing/unavailable files: ${report.missing}`, `Clean-policy blocks: ${report.cleanBlocked}`, `Availability unknown: ${report.unknown}`, "Reference files retain intended requests. Clean labels are metadata/filename evidence, not verified lyrics.", ...report.problems.map(p => `${p.index + 1}. ${p.title} — ${p.reason}`)].join("\n");
}