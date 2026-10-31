import React from 'react';
import {createEventAutosave} from '../../../src/lib/eventAutosave';
import {buildLibrary} from '../../../src/lib/virtualDj';
const w=window as any;
export function createFileRoute(){return(options:any)=>({...options,useSearch:()=>({eventId:w.__testState.eventId})});}
export function useNavigate(){return async(options:any)=>{w.__testState.eventId=options.search?.eventId;w.__rerender();};}
export function useBlocker(){return {};}
export function useAuth(){return {user:{id:'synthetic-owner'}};}
export function useServerFn(fn:any){return fn;}
let workspace:any;export function useWorkspace(){return workspace??=( {sources:[],files:[],loading:false,library:buildLibrary(w.__fixture.tracks),audioIndex:{entries:[],byPath:new Map(),byBase:new Map()},ensureLocalFile:async()=>null});}
export async function getWorkflow(request:any){return w.testBackend.read(request.data.id);}
export async function saveWorkflowSafely(request:any){return w.testBackend.write(request.data);}
export const supabase={auth:{getUser:async()=>({data:{user:null}})}};
export const toast={error:(text:any)=>w.__errors.push(String(text)),warning:(text:any)=>w.__warnings.push(String(text)),success:(text:any)=>w.__success.push(String(text)),info:()=>{}};
export const recommendSongsForSection=async()=>({suggestions:[]}),getArtistNeighbors=async()=>({clusters:[]}),getArtistCrowdData=async()=>({artists:[]}),enrichSongs=async()=>({results:[]}),importSpotifyPlaylist=async()=>({songs:[]});
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
