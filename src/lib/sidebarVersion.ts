import { APP_VERSION } from "./appVersion";

type VersionEnvironment = {
  userAgent: string;
  nativeBridge: boolean;
  status?: () => Promise<unknown>;
};

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/;
export const VERSION_LOADING = "Version loading…";
export const NATIVE_VERSION_UNAVAILABLE = "Mac version unavailable";

// Existing releases expose update status, but its `version` is the AVAILABLE
// update, not the installed app. Electron's default UA stamps app.getVersion().
export async function resolveSidebarVersion(environment: VersionEnvironment): Promise<string> {
  const electron = /\bElectron\/\d/.test(environment.userAgent);
  if (!environment.nativeBridge && !electron) return `Web version ${APP_VERSION}`;
  if (!environment.nativeBridge) return NATIVE_VERSION_UNAVAILABLE;
  const installed = /(?:^|\s)(?:SetArchitect|dancefloor-builder-desktop)\/([^\s]+)/.exec(environment.userAgent)?.[1];
  if (electron && installed && semver.test(installed)) return `Mac version ${installed}`;
  // Accept only an explicitly installed-version field if a future bridge adds
  // one. Never trigger discovery or mistake status.version for installed.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!environment.status) return NATIVE_VERSION_UNAVAILABLE;
    const result = await Promise.race([
      environment.status(),
      new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 3000); }),
    ]);
    const current = result && typeof result === "object" && "currentVersion" in result ? result.currentVersion : null;
    return typeof current === "string" && semver.test(current) ? `Mac version ${current}` : NATIVE_VERSION_UNAVAILABLE;
  } catch {
    return NATIVE_VERSION_UNAVAILABLE;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}