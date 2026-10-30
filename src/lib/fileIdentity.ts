/** File identity is case-sensitive: macOS volumes may contain case-only siblings. */
export function normalizeFilePath(path: string): string {
  const slash = path.replace(/\\/g, "/");
  const prefix = slash.startsWith("//") ? "//" : slash.startsWith("/") ? "/" : "";
  const parts: string[] = [];
  for (const part of slash.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (parts.length && parts.at(-1) !== "..") parts.pop(); else if (!prefix) parts.push(part); }
    else parts.push(part);
  }
  return prefix + parts.join("/");
}

export const absoluteFilePath = (path: string) => /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path);
export const qualifiedFilePath = (path: string) => /[\\/]/.test(path);
export const fileBasename = (path: string) => normalizeFilePath(path).split("/").pop() ?? "";

export function fullFilePath(path: string, roots: Record<string, string>): string | null {
  if (!path) return null;
  if (absoluteFilePath(path)) return path;
  const [label, ...rest] = path.split(/[\\/]/);
  const root = roots[label];
  if (!root || !rest.length || rest.some(p => p === "..")) return null;
  const separator = /^[A-Za-z]:\\/.test(root) ? "\\" : "/";
  return [root.replace(/[\\/]+$/, ""), ...rest].join(separator);
}

export const trackIdentity = (path: string, roots: Record<string, string>) =>
  normalizeFilePath(fullFilePath(path, roots) ?? path);

/** Existing labels (including retired roots) are reserved so old selections never rebind. */
export function allocateSourceLabel(name: string, root: string | null, labels: string[], roots: Record<string, string>): string {
  if (root) {
    const existing = Object.entries(roots).find(([, saved]) => normalizeFilePath(saved) === normalizeFilePath(root));
    if (existing) return existing[0];
  }
  const taken = new Set([...labels, ...Object.keys(roots)]);
  let label = name;
  for (let i = 2; taken.has(label); i++) label = `${name} (${i})`;
  return label;
}

export function relabelScan<T extends { relativePath: string }>(files: readonly T[], label: string): T[] {
  return files.map(file => ({ ...file, relativePath: `${label}/${file.relativePath.split(/[\\/]/).slice(1).join("/")}` }));
}

/** An index never chooses a first duplicate. Exact identities are considered before legacy names. */
export function createIdentityIndex<T>(items: readonly T[], pathOf: (item: T) => string, roots: Record<string, string>, knownPaths: readonly string[] = []) {
  const exact = new Map<string, T[]>();
  const names = new Map<string, Set<string>>();
  for (const path of [...knownPaths, ...items.map(pathOf)]) {
    const name = fileBasename(path);
    const ids = names.get(name) ?? new Set<string>();
    ids.add(trackIdentity(path, roots));
    names.set(name, ids);
  }
  for (const item of items) {
    const key = trackIdentity(pathOf(item), roots);
    exact.set(key, [...(exact.get(key) ?? []), item]);
  }
  return {
    resolve(path: string): T | undefined {
      const hits = exact.get(trackIdentity(path, roots));
      // A bare name is legacy identity, even if a cached bare-name File exists.
      if (!qualifiedFilePath(path) && (names.get(fileBasename(path))?.size ?? 0) > 1) return undefined;
      if (hits?.length === 1) return hits[0];
      if (qualifiedFilePath(path) || hits?.length) return undefined;
      const ids = names.get(fileBasename(path));
      if (ids?.size !== 1) return undefined;
      const [id] = ids;
      const legacy = exact.get(id);
      return legacy?.length === 1 ? legacy[0] : undefined;
    },
  };
}