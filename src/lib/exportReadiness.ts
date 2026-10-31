import { exportApproved, resolveExportPath, type ExportSongRef, type VdjLibrary } from "./virtualDj";
export type Availability = "available" | "unavailable" | "unknown";
export function exportReadiness(refs: ExportSongRef[], library: VdjLibrary, availability: Record<string, Availability> = {}, roots?: Record<string, string>) {
  const recordings = new Set<string>();
  const problems: { index: number; identity?: ExportSongRef["identity"]; title: string; reason: string }[] = [];
  let omitted = 0;
  for (const [index, ref] of refs.entries()) {
    const ids = exportApproved(ref.match) && ref.match?.trackIndex != null
      ? [...new Set([ref.match.trackIndex, ...(ref.match.extraTrackIndices ?? [])])] : [];
    const tracks = ids.map(i => library.tracks[i]).filter(Boolean);
    if (!tracks.length) {
      omitted++;
      problems.push({ index, identity: ref.identity, title: `${ref.song.artist} — ${ref.song.song}`, reason: ref.match?.excludedFromVdj ? "Excluded from DJ export" : "No confirmed recording" });
    }
    for (const track of tracks) {
      const path = resolveExportPath(track.filePath, roots) ?? track.filePath;
      recordings.add(path);
      if (availability[path] !== "available") problems.push({ index, identity: ref.identity, title: `${ref.song.artist} — ${ref.song.song}`, reason: availability[path] === "unavailable" ? "File unavailable" : "File availability unknown" });
    }
  }
  const unavailable = [...recordings].filter(p => availability[p] === "unavailable").length;
  const unknown = [...recordings].filter(p => !availability[p] || availability[p] === "unknown").length;
  return { requested: refs.length, approved: recordings.size, omitted, unavailable, unknown, problems };
}
export function readinessText(report: ReturnType<typeof exportReadiness>) {
  return ["SetArchitect — Export readiness", `Requested songs: ${report.requested}`, `Approved recordings (distinct, including extras): ${report.approved}`, `Omitted songs: ${report.omitted}`, `Unavailable files: ${report.unavailable}`, `Availability unknown: ${report.unknown}`, "Unconfirmed/excluded songs remain in reference files only.", ...report.problems.map(p => `${p.index + 1}. ${p.title} — ${p.reason}`)].join("\n");
}