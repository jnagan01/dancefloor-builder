import { describe, it, expect } from 'vitest';
import { freshEvent, validateEventChoices } from '../src/lib/freshEvent';
import { requiresClean } from '../src/lib/preparationPolicy';

describe('explicit fresh event choices', () => {
  it('starts with no content, type, buffer or preferences', () => {
    const event = freshEvent();
    for (const key of ['eventName','hours','minutes','listType','artistsInput','genresInput','vibe','eventType','homeKey','notes','doNotPlayInput','spotifyLink'] as const) expect(event[key]).toBe('');
    expect(event.decades).toEqual([]); expect(event.songs).toEqual([]); expect(event.buffer).toBe(0);
    expect(event.split).toEqual({warmUp:0,transition:0,peak:0});
  });
  it('every event switch starts off, including clean and owned expansion', () => {
    const e = freshEvent();
    expect([e.expand,e.splitOn,e.bpmOn,e.danceOn,e.includeCombined,...Object.values(e.policies)]).toEqual(Array(8).fill(false));
    expect(requiresClean(e.policies)).toBe(false);
  });
  it('creates independent arrays and policy objects on reset', () => {
    const e = freshEvent(); e.decades.push('1980s'); e.policies.requireCleanVersions=true;
    expect(freshEvent().decades).toEqual([]); expect(freshEvent().policies.requireCleanVersions).toBe(false);
  });
  it('requires type before advance', () => { expect(()=>validateEventChoices('', '', '', 0, false)).toThrow('Choose a list type'); });
  it('rejects blank/invalid/zero duration without substitution', () => {
    for(const value of ['', ' ', 'NaN', '0', '-1', 'Infinity','25']) expect(()=>validateEventChoices('dance',value,'',2)).toThrow();
    expect(()=>validateEventChoices('dinner','','',0)).toThrow('positive list length');
  });
  it('requires explicit dance buffer at generation but allows duration-only advance', () => {
    expect(()=>validateEventChoices('dance','1','',0,false)).not.toThrow();
    for(const buffer of [0,NaN,1,5]) expect(()=>validateEventChoices('dance','1','',buffer)).toThrow('Choose a preparation buffer');
    for(const buffer of [2,3,4]) expect(()=>validateEventChoices('dance','1','',buffer)).not.toThrow();
  });
  it('background needs explicit minutes, not hidden hours/buffer choices', () => { expect(()=>validateEventChoices('cocktail','','60',0)).not.toThrow(); });
  it('school requirements remain intentional, legacy missing policy remains unchanged', () => {
    expect(requiresClean({...freshEvent().policies,eventType:'school_dance'})).toBe(true);
    expect(requiresClean({})).toBe(false);
  });
});