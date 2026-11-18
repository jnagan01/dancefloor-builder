import { describe, expect, it, vi } from 'vitest';
import { copyPlainText } from '@/lib/copyText';

/** Minimal synthetic document: enough DOM to exercise the temporary-field lifecycle without a browser. */
function fakeDom(execResult: boolean | 'throw') {
  const children: any[] = []; const log: string[] = [];
  const ranges = [{ id: 'user-range' }]; let current = [...ranges];
  const selection = { get rangeCount() { return current.length; }, getRangeAt: (i: number) => current[i], removeAllRanges: () => { current = []; }, addRange: (r: any) => { current.push(r); } };
  const button = { focus: vi.fn(() => { doc.activeElement = button; }) };
  const doc: any = {
    activeElement: button, getSelection: () => selection,
    createElement: () => { const el: any = { style: {}, value: '', setAttribute() {}, focus() { doc.activeElement = el; }, select() { current = [{ id: 'field' }]; }, setSelectionRange() {}, remove() { children.splice(children.indexOf(el), 1); log.push('removed'); } }; return el; },
    execCommand: vi.fn((cmd: string) => { log.push(`exec:${cmd}:${doc.activeElement?.value}`); if (execResult === 'throw') throw new Error('raw provider detail'); return execResult; }),
  };
  const host: any = { ownerDocument: doc, appendChild: (el: any) => { children.push(el); log.push('appended'); } };
  return { host, doc, children, log, button, selection: () => current, ranges };
}

describe('user-initiated diagnostics copy', () => {
  it('copies through the selection path inside the given host, then removes the field and restores focus and selection', async () => {
    const d = fakeDom(true); const writeText = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyPlainText('{"safe":1}', d.host)).toBe(true);
    expect(d.log).toEqual(['appended', 'exec:copy:{"safe":1}', 'removed']);
    expect(d.children).toHaveLength(0); expect(d.doc.activeElement).toBe(d.button); expect(d.selection()).toEqual(d.ranges);
    expect(writeText).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('falls back to the async clipboard only when the selection copy is refused', async () => {
    const d = fakeDom(false); const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyPlainText('text', d.host)).toBe(true);
    expect(writeText).toHaveBeenCalledWith('text'); expect(d.children).toHaveLength(0);
    vi.unstubAllGlobals();
  });
  it('reports failure honestly when both paths are denied, still cleaning up', async () => {
    for (const mode of [false, 'throw'] as const) {
      const d = fakeDom(mode);
      vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); }) } });
      expect(await copyPlainText('text', d.host)).toBe(false);
      expect(d.children).toHaveLength(0); expect(d.doc.activeElement).toBe(d.button); expect(d.selection()).toEqual(d.ranges);
      vi.unstubAllGlobals();
    }
  });
  it('without any clipboard support it returns false rather than claiming success', async () => {
    vi.stubGlobal('navigator', {});
    expect(await copyPlainText('text', null)).toBe(false);
    vi.unstubAllGlobals();
  });
});
