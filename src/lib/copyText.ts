/**
 * User-initiated plain-text copy. The installed desktop shell denies the async
 * Clipboard API permission, so the synchronous selection copy runs first while
 * the click gesture is active. The temporary field lives inside `host` (e.g. a
 * modal dialog, so focus traps keep it) and is always removed; focus and the
 * previous selection are restored. Returns false honestly when nothing copied.
 */
export async function copyPlainText(text: string, host: HTMLElement | null = typeof document === 'undefined' ? null : document.body): Promise<boolean> {
  if (host && selectionCopy(text, host)) return true;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to honest failure */ }
  return false;
}

function selectionCopy(text: string, host: HTMLElement): boolean {
  const doc = host.ownerDocument;
  if (typeof doc.execCommand !== 'function') return false;
  const active = doc.activeElement as HTMLElement | null;
  const selection = doc.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)) : [];
  const field = doc.createElement('textarea');
  field.value = text; field.readOnly = true; field.setAttribute('aria-hidden', 'true'); field.tabIndex = -1;
  Object.assign(field.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
  host.appendChild(field);
  let ok = false;
  try {
    field.focus({ preventScroll: true }); field.select(); field.setSelectionRange(0, text.length);
    ok = doc.execCommand('copy');
  } catch { ok = false; }
  finally {
    field.remove();
    try { active?.focus?.({ preventScroll: true }); } catch { /* ignore */ }
    if (selection) { selection.removeAllRanges(); for (const r of ranges) selection.addRange(r); }
  }
  return ok;
}
