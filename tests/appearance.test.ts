import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { APPEARANCE_KEY, appearanceScript, readAppearance, resolveAppearance } from '@/lib/appearance';
describe('local appearance preference',()=>{
  it('defaults to System and tolerates unavailable/corrupt storage',()=>{expect(readAppearance({getItem:()=>null})).toBe('system');expect(readAppearance({getItem:()=> 'invalid'})).toBe('system');expect(readAppearance({getItem:()=>{throw Error('denied');}})).toBe('system');});
  it.each(['light','dark'] as const)('persists and resolves explicit %s regardless of OS',theme=>{expect(readAppearance({getItem:key=>key===APPEARANCE_KEY?theme:null})).toBe(theme);expect(resolveAppearance(theme,true)).toBe(theme);expect(resolveAppearance(theme,false)).toBe(theme);});
  it('only System follows system changes',()=>{expect(resolveAppearance('system',true)).toBe('dark');expect(resolveAppearance('system',false)).toBe('light');});
  it.each([['system',true,'dark'],['system',false,'light'],['light',true,'light'],['dark',false,'dark']])('first-paint script resolves %s/%s before content', (value,dark,expected)=>{const classes:string[]=[];const html={classList:{add:(v:string)=>classes.push(v)},dataset:{} as any,style:{} as any};vm.runInNewContext(appearanceScript,{localStorage:{getItem:()=>value},document:{documentElement:html},matchMedia:()=>({matches:dark})});expect(classes).toEqual([expected]);expect(html.style.colorScheme).toBe(expected);expect(html.dataset.appearance).toBe(value);});
});