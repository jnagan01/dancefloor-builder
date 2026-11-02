import React from 'react';
export {useWorkspace} from '../../../src/components/workspace/WorkspaceContext';
import {buildLibrary} from '../../../src/lib/virtualDj';
const w=window as any;
export function createFileRoute(){return(options:any)=>({...options,useSearch:()=>({eventId:w.__testState.eventId})});}
export function useNavigate(){return async(options:any)=>{w.__testState.page='event';w.__testState.eventId=options.search?.eventId;w.__rerender();};}
export function useBlocker(){return {};}
export function useAuth(){return {user:{id:w.__testState.account}};}
export function useServerFn(fn:any){return fn;}
export async function getWorkflow(request:any){return w.testBackend.read(request.data.id);}
export async function saveWorkflowSafely(request:any){return w.testBackend.write(request.data);}
const listeners=new Set<any>();
export const supabase={auth:{getUser:async()=>({data:{user:{id:w.__testState.account}}}),onAuthStateChange:(f:any)=>{listeners.add(f);return {data:{subscription:{unsubscribe:()=>listeners.delete(f)}}};}},from:(table:string)=>({
 select:()=>({eq:(_key:string,account:string)=>({limit:async()=>w.testBackend.list(account),maybeSingle:async()=>({data:null})})}),
 update:()=>({eq:async()=>({error:null})})
})};
export const loadMusicLibrary=async()=>({sources:w.__fixture.sources??[{label:'Synthetic',tracks:w.__fixture.tracks}],version:1,savedAt:Date.now()});
export const saveMusicLibrary=async(sources:any,account:string)=>{await w.testBackend.library(sources,account);return Date.now();};
export const validSavedLibrary=(v:any)=>v?.version===1&&Array.isArray(v.sources)&&v.sources.every((s:any)=>typeof s.label==='string'&&Array.isArray(s.tracks)&&s.tracks.every((t:any)=>typeof t.filePath==='string'&&typeof t.artist==='string'&&typeof t.title==='string'));

export const toast={error:(text:any)=>w.__errors.push(String(text)),warning:(text:any)=>w.__warnings.push(String(text)),success:(text:any)=>w.__success.push(String(text)),info:()=>{}};
export const recommendSongsForSection=async()=>({suggestions:w.__fixture.aiSuggestions??[]}),getArtistNeighbors=async()=>({clusters:[]}),getArtistCrowdData=async()=>({artists:[]}),enrichSongs=async()=>({results:[]}),importSpotifyPlaylist=async()=>({songs:[]});
export const lookupMusicBrainz=async()=>({ok:false,error:'Lookups are disabled in the isolated fixture.',retryable:false}),lookupLastfmTrack=async()=>({ok:true,cached:false,items:{available:false,tags:[],similar:[],url:null}});
export function useDebounce(v:any){return v;}
export function useProfileSettings(){return {settings:null};}
export function DjAccountBar(){return null;}export function SpotifyExportDialog(){return null;}export function ProfileSettingsDialog(){return null;}
export const APP_VERSION='isolated-test',formatBuildDate=()=>'';
export function Toaster(){return null;}
export function WaveformPlayer(){return null;}
export const MATCH_LIMIT_KEY='test:limit',MATCH_AUTO_KEY='test:auto',DJ_SOFTWARE_KEY='test:software';
export function pageHead(){return {};}
export async function loadDirHandle(){return {name:'isolated-exports',getFileHandle:async(name:string)=>({createWritable:async()=>({write:async(data:string)=>{const r=await w.testBackend.export(name,data);if(!r.ok)throw Error(r.error);},close:async()=>{}})})};}
export const loadDirHandleMeta=async()=>null,saveDirHandle=async()=>{},clearDirHandle=async()=>{},verifyReadWrite=async()=>true,saveDirHandleMeta=async()=>{},clearDirHandleMeta=async()=>{};
