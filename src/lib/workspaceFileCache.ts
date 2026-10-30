import { getNativeFilePath } from "./desktopBridge";
import { normalizeFilePath, trackIdentity } from "./fileIdentity";

export function cachedFileIdentity(file: File, roots: Record<string, string>): string {
  return trackIdentity(getNativeFilePath(file) || file.webkitRelativePath || file.name, roots);
}

/** Invalidate both virtual and absolute cached aliases when a source is replaced/removed. */
export function withoutSourceFiles(files: readonly File[], label: string, paths: readonly string[], roots: Record<string, string>): File[] {
  const ids = new Set(paths.map(path => trackIdentity(path, roots)));
  const root = roots[label] ? normalizeFilePath(roots[label]) + "/" : null;
  return files.filter(file => {
    const id = cachedFileIdentity(file, roots);
    const relative = normalizeFilePath(file.webkitRelativePath || file.name);
    return !ids.has(id) && !relative.startsWith(label + "/") && !(root && id.startsWith(root));
  });
}