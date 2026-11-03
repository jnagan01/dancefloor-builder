import { describe, it, expect } from 'vitest';
import { freshEvent, validateEventChoices, preparationCoverage } from '../src/lib/freshEvent';
import { requiresClean } from '../src/lib/preparationPolicy';
import { generateLists } from '../src/lib/danceFloor';

describe('explicit fresh event choices', () => {
  it('starts with blank content and only the explicit 1× baseline', () => {
    const event = freshEvent();
    for (const key of ['eventName','hours','minutes','listType','artistsInput','genresInput','vibe','eventType','homeKey','notes','doNotPlayInput','spotifyLink'] as const) expect(event[key]).toBe('');
    expect(event.decades).toEqual([]); expect(event.songs).toEqual([]); expect(event.buffer).toBe(1);
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
  it('accepts 1× without requiring 2× and rejects invalid preparation choices', () => {
    expect(()=>validateEventChoices('dance','1','',0,false)).not.toThrow();
    for(const buffer of [0,NaN,1.5,5]) expect(()=>validateEventChoices('dance','1','',buffer)).toThrow('Choose a preparation target');
    for(const buffer of [1,2,3,4]) expect(()=>validateEventChoices('dance','1','',buffer)).not.toThrow();
  });
  it('background needs explicit minutes, not hidden hours/buffer choices', () => { expect(()=>validateEventChoices('cocktail','','60',0)).not.toThrow(); });
  it('school requirements remain intentional, legacy missing policy remains unchanged', () => {
    expect(requiresClean({...freshEvent().policies,eventType:'school_dance'})).toBe(true);
    expect(requiresClean({})).toBe(false);
  });
  it('40 four-minute client tracks cover a one-hour baseline but can request 4× extras', () => {
    const baseline = preparationCoverage(Array(40).fill(240),60,1);
    expect(baseline.baselineShortSeconds).toBe(0); expect(baseline.preparationShortSeconds).toBe(0);
    expect(preparationCoverage(Array(40).fill(240),60,4).preparationShortSeconds).toBe(4800);
  });
  it('40 uploads retain legacy 42-slot allocation without turning the two spare slots into missing baseline time', () => {
    const uploaded=Array.from({length:40},(_,i)=>({artist:`Client ${i}`,song:`Normal track ${i}`}));
    const result=generateLists({uploaded,preserveRequestedRows:true,prefs:{artists:[],genres:[],decades:[],notes:''},hours:1,buffer:1,expand:false});
    expect(result.targetTotal).toBe(42);expect(result.shortfall.total).toBe(2);
    expect([...result.warmUp,...result.transition,...result.peak]).toHaveLength(40);
    expect(preparationCoverage(Array(40).fill(240),60,1).baselineShortSeconds).toBe(0);
  });
  it('five known four-minute tracks leave an honest forty-minute baseline gap', () => {
    expect(preparationCoverage(Array(5).fill(240),60,1)).toMatchObject({knownSeconds:1200,unknown:0,baselineShortSeconds:2400});
  });
  it('unknown and invalid lengths remain explicitly estimated, not known coverage', () => {
    expect(preparationCoverage([300,undefined,0,NaN],60,1)).toMatchObject({knownSeconds:300,unknown:3,estimatedSeconds:1020,baselineShortSeconds:2580});
  });
  it('reset always returns 1× independently of a saved or edited preparation buffer', () => {
    const edited=freshEvent();edited.buffer=4;edited.expand=true;
    expect(freshEvent()).toMatchObject({buffer:1,expand:false});
  });
});