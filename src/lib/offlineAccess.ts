// Native offline access bridge (Mac app only). The web page can only hand the
// Mac app a validated backup for the signed-in account, ask its status, or revoke it.
import type { Backup } from "./backups";

export interface OfflineStatus { ok?: boolean; prepared: boolean; preparedAt?: string; events?: number; tracks?: number; error?: string }
type Bridge = {
  prepare(raw: string, account: string): Promise<{ ok: boolean; preparedAt?: string; events?: number; tracks?: number; error?: string }>;
  status(account: string): Promise<OfflineStatus>;
  accountSeen(account: string): Promise<{ ok: boolean }>;
  signedOut(): Promise<{ ok: boolean }>;
};
export function offlineBridge(): Bridge | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as { electronOffline?: Bridge }).electronOffline;
}

/** Collect with the caller's captured owner; any account/session change after an await stops before or after commit. */
export async function prepareOfflineAccess(owner: { account: string; check: () => void }, collect: () => Promise<Backup>, bridge = offlineBridge()): Promise<OfflineStatus> {
  if (!bridge) throw Error("Offline access is available in the Mac app only.");
  const backup = await collect();
  owner.check();
  if (backup.account !== owner.account) throw Error("Account changed; offline access was not prepared.");
  // The Mac app only accepts a prepare for the account it was most recently told is signed in.
  const seen = await bridge.accountSeen(owner.account);
  owner.check();
  if (!seen.ok) throw Error("Offline access could not confirm the signed-in account. Nothing was changed.");
  const result = await bridge.prepare(JSON.stringify(backup), owner.account);
  try { owner.check(); } catch (e) { await bridge.signedOut().catch(() => {}); throw e; }
  if (!result.ok) throw Error(result.error ?? "Offline access could not be saved. The previous offline copy is unchanged.");
  return { prepared: true, preparedAt: result.preparedAt, events: result.events, tracks: result.tracks };
}

/** Called for every auth change: sign-out revokes; another account revokes a different cached account. */
export function reportOfflineSession(event: string, account: string | null | undefined, bridge = offlineBridge()) {
  if (!bridge) return;
  if (event === "SIGNED_OUT") void bridge.signedOut().catch(() => {});
  else if (account) void bridge.accountSeen(account).catch(() => {});
}
