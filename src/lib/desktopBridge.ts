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
