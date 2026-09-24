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

export function formatBuildDate(iso: string = buildTimeIso): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
