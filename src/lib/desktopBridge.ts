// Bridge to the macOS desktop shell. Everything here is feature-detected so
// the same code keeps working in the browser (where these features are off).

export interface VdjReadResult {
  ok: boolean;
  path: string;
  xml?: string;
  error?: string;
  canceled?: boolean;
}

interface ElectronVirtualDJ {
  isAvailable: true;
  getDefaultPath(): Promise<string>;
  readDatabase(customPath?: string | null): Promise<VdjReadResult>;
  chooseDatabase(): Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
  getDefaultRoot?(): Promise<string>;
  chooseRoot?(): Promise<{ ok: boolean; path?: string; hasDatabase?: boolean; canceled?: boolean }>;
}

function bridge(): ElectronVirtualDJ | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { electronVirtualDJ?: ElectronVirtualDJ }).electronVirtualDJ;
  return api?.isAvailable ? api : null;
}

export const isDesktopApp = () => bridge() !== null;

export async function getDefaultVdjPath(): Promise<string | null> {
  const api = bridge();
  if (!api) return null;
  try {
    return await api.getDefaultPath();
  } catch {
    return null;
  }
}

export async function readVdjDatabase(customPath?: string | null): Promise<VdjReadResult> {
  const api = bridge();
  if (!api) return { ok: false, path: "", error: "Open the desktop app to link your VirtualDJ database." };
  return api.readDatabase(customPath ?? null);
}

export async function chooseVdjDatabase(): Promise<string | null> {
  const api = bridge();
  if (!api) return null;
  const result = await api.chooseDatabase();
  return result.ok && result.path ? result.path : null;
}

// --- Native folder picking / writing (desktop app only) ---

export interface ScannedNativeFile {
  name: string;
  path: string;
  relativePath: string;
  size?: number;
  tags?: import("./virtualDj").AudioFileTags | null;
}

export interface NativeScanResult {
  ok: boolean;
  root?: string;
  label?: string;
  files?: ScannedNativeFile[];
  error?: string;
}

interface ElectronFiles {
  isAvailable: true;
  chooseFolder(): Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
  chooseMusicFolder?(): Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
  scanFolder?(dirPath: string): Promise<NativeScanResult>;
  writeTags?(filePath: string, tags: Record<string, string>): Promise<{ ok: boolean; error?: string; tags?: import("./virtualDj").AudioFileTags | null }>;
  readAudio?(filePath: string): Promise<{ ok: boolean; data?: ArrayBuffer; error?: string }>;
  writeFile(dirPath: string, name: string, contents: string): Promise<{ ok: boolean; error?: string }>;
  getPathForFile?(file: File): string;
}

function filesBridge(): ElectronFiles | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { electronFiles?: ElectronFiles }).electronFiles;
  return api?.isAvailable ? api : null;
}

export const supportsNativeFolders = () => filesBridge() !== null;

/** True when the shell can re-read remembered folders straight from disk. */
export const supportsNativeScan = () => Boolean(filesBridge()?.scanFolder);

/** Opens the native picker for a music folder. Null when cancelled. */
export async function chooseNativeMusicFolder(): Promise<string | null> {
  const api = filesBridge();
  if (!api) return null;
  const result = api.chooseMusicFolder ? await api.chooseMusicFolder() : await api.chooseFolder();
  return result.ok && result.path ? result.path : null;
}

/** Lists audio files inside a remembered folder without any user prompt. */
export async function scanNativeFolder(dirPath: string): Promise<NativeScanResult> {
  const api = filesBridge();
  if (!api?.scanFolder) return { ok: false, error: "Not available outside the desktop app." };
  try {
    return await api.scanFolder(dirPath);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Reads one audio file from disk and wraps it as a File for playback. */
export async function readNativeAudioFile(filePath: string, relativePath?: string): Promise<File | null> {
  const api = filesBridge();
  if (!api?.readAudio) return null;
  try {
    const res = await api.readAudio(filePath);
    if (!res.ok || !res.data) return null;
    const name = filePath.split(/[\\/]/).pop() || "track";
    const file = new File([res.data], name);
    if (relativePath) {
      Object.defineProperty(file, "webkitRelativePath", { value: relativePath, configurable: true });
    }
    return file;
  } catch {
    return null;
  }
}

/**
 * A folder handle backed by the macOS shell. It mimics just enough of the
 * File System Access API (`getFileHandle` → `createWritable`) that the rest
 * of the app can treat native and browser folders identically.
 */
export interface NativeDirHandle {
  __nativePath: string;
  name: string;
  queryPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  getFileHandle(
    fileName: string,
    options?: { create?: boolean },
  ): Promise<{ createWritable(): Promise<{ write(data: string): void; close(): Promise<void> }> }>;
}

export function isNativeDirHandle(handle: unknown): handle is NativeDirHandle {
  return typeof (handle as NativeDirHandle | null)?.__nativePath === "string";
}

export function makeNativeDirHandle(dirPath: string): NativeDirHandle {
  const name = dirPath.split("/").filter(Boolean).pop() || dirPath;
  return {
    __nativePath: dirPath,
    name,
    queryPermission: async () => "granted" as PermissionState,
    requestPermission: async () => "granted" as PermissionState,
    getFileHandle: async (fileName: string) => ({
      createWritable: async () => {
        let buffer = "";
        return {
          write(data: string) {
            buffer += data;
          },
          async close() {
            const api = filesBridge();
            if (!api) throw new Error("The desktop app is no longer available.");
            const res = await api.writeFile(dirPath, fileName, buffer);
            if (!res.ok) throw new Error(res.error || "Couldn't write the file.");
          },
        };
      },
    }),
  };
}

/** Opens the native macOS folder picker. Returns null when cancelled. */
export async function chooseNativeFolder(): Promise<NativeDirHandle | null> {
  const api = filesBridge();
  if (!api) return null;
  const result = await api.chooseFolder();
  if (!result.ok || !result.path) return null;
  return makeNativeDirHandle(result.path);
}

/** Full on-disk path of a picked file (desktop app only), or "" when unknown. */
export function getNativeFilePath(file: File): string {
  try {
    return filesBridge()?.getPathForFile?.(file) ?? "";
  } catch {
    return "";
  }
}

const joinPath = (root: string, name: string) => `${root.replace(/[\\/]+$/, "")}/${name}`;
export const vdjDatabaseIn = (root: string) => joinPath(root, "database.xml");
export const vdjPlaylistsIn = (root: string) => joinPath(root, "Playlists");

/** Default VirtualDJ folder on this Mac (desktop app only). */
export async function getDefaultVdjRoot(): Promise<string | null> {
  const api = bridge();
  if (!api) return null;
  try {
    if (api.getDefaultRoot) return await api.getDefaultRoot();
    const db = await api.getDefaultPath();
    return db.replace(/[\\/]database\.xml$/i, "");
  } catch {
    return null;
  }
}

/** Native picker for the main VirtualDJ folder. Null when cancelled. */
export async function chooseVdjRoot(): Promise<{ path: string; hasDatabase: boolean } | null> {
  const api = bridge();
  if (!api) return null;
  if (api.chooseRoot) {
    const r = await api.chooseRoot();
    return r.ok && r.path ? { path: r.path, hasDatabase: r.hasDatabase !== false } : null;
  }
  // Older installer: fall back to the generic folder picker.
  const files = filesBridge();
  if (!files) return null;
  const r = await files.chooseFolder();
  return r.ok && r.path ? { path: r.path, hasDatabase: true } : null;
}

/** True when the Mac app can save edited tags into music files. */
export const supportsTagWriting = () => Boolean(filesBridge()?.writeTags);

/** Saves edited tags straight into a music file on disk (desktop app only). */
export async function writeNativeTags(filePath: string, tags: Record<string, string>) {
  const api = filesBridge();
  if (!api?.writeTags) return { ok: false as const, error: "Update the Mac app to edit song details." };
  try {
    return await api.writeTags(filePath, tags);
  } catch (error) {
    return { ok: false as const, error: (error as Error).message };
  }
}
