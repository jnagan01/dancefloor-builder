import { useEffect, useRef } from 'react';
import { APP_VERSION } from '../appVersion';
import { resolveSidebarVersion } from '../sidebarVersion';
import { safeVersion } from './schema';

type Environment = Parameters<typeof resolveSidebarVersion>[0];
/** Resolve before preparation, never await IPC on the generation path. */
export function createDiagnosticVersion(environment: Environment) {
  const desktop = environment.nativeBridge || /\bElectron\/\d/.test(environment.userAgent);
  const state = { current: desktop ? 'desktop:unavailable' : `web:${safeVersion(APP_VERSION)}` };
  let active = true;
  const ready = resolveSidebarVersion(environment).then(label => {
    if (!active) return;
    const prefix = desktop ? 'Version ' : 'Web version ';
    const version = label.startsWith(prefix) ? safeVersion(label.slice(prefix.length)) : 'unknown';
    state.current = desktop ? `desktop:${version === 'unknown' ? 'unavailable' : version}` : `web:${version}`;
  }).catch(() => {});
  return { state, ready, dispose: () => { active = false; } };
}

export function useDiagnosticVersion() {
  const version = useRef('unknown');
  useEffect(() => {
    let active = true;
    const native = window as Window & { electronUpdates?: { status?: () => Promise<unknown> }; electronFiles?: unknown; electronVirtualDJ?: unknown };
    const resolved = createDiagnosticVersion({
      userAgent: navigator.userAgent,
      nativeBridge: Boolean(native.electronUpdates || native.electronFiles || native.electronVirtualDJ),
      status: native.electronUpdates?.status ? () => native.electronUpdates?.status?.() ?? Promise.resolve(null) : undefined,
    });
    version.current = resolved.state.current;
    void resolved.ready.then(() => { if (active) version.current = resolved.state.current; });
    return () => { active = false; resolved.dispose(); };
  }, []);
  return version;
}

export function diagnosticVersionLabel(version: string) {
  if (version === 'desktop:unavailable') return 'Installed desktop version unavailable';
  if (version.startsWith('desktop:')) return `Installed desktop version ${version.slice(8)}`;
  if (version.startsWith('web:')) return `Web version ${version.slice(4)}`;
  return 'App version unavailable'; // Legacy unlabelled records cannot establish installed identity.
}