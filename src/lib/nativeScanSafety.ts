import type { NativeScanResult } from "./desktopBridge";

/** Older installed shells omit complete; retain compatibility but reject explicit partials. */
export function nativeScanProblem(result: NativeScanResult, previousCount: number): string | null {
  if (!result.ok || result.complete === false || result.truncated === true || !Array.isArray(result.files)) {
    return result.error ?? "The folder scan did not finish. Your saved tracks have been kept.";
  }
  if (previousCount > 0 && result.files.length === 0) {
    return "No audio files were returned for a previously indexed folder. Your saved tracks have been kept; check folder access and try again.";
  }
  return null;
}