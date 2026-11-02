/**
 * App version shown in the footer so a published update can be confirmed
 * at a glance (refresh the desktop app and check the number/date).
 *
 * Bump APP_VERSION when shipping a notable change; the build date updates
 * automatically on every publish.
 */
export const APP_VERSION = "1.1.0";

declare const __APP_BUILD_TIME__: string | undefined;

const buildTimeIso =
  typeof __APP_BUILD_TIME__ === "string" ? __APP_BUILD_TIME__ : new Date().toISOString();

export const APP_BUILD_TIME = buildTimeIso;

declare const __APP_BUILD_ID__: string | undefined;

/**
 * Unique identity of the built artifact (build time + random UUID), injected
 * once per build into both client and server bundles. Null when not injected,
 * so an unstamped build can never be reported as "up to date".
 */
export const APP_BUILD_ID: string | null =
  typeof __APP_BUILD_ID__ === "string" && __APP_BUILD_ID__.length > 0 ? __APP_BUILD_ID__ : null;

// Fixed locale + UTC keeps the string identical on server and browser.
export function formatBuildDate(iso: string = buildTimeIso): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}
