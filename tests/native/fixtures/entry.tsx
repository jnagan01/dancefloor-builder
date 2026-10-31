// Bundled solely by the native test runner. Every service is replaced by isolated stubs.
import React from 'react';
import {AppearanceProvider} from '../../../src/components/AppearanceProvider';
import {AppearanceSettings} from '../../../src/components/workspace/AppearanceSettings';import {createRoot} from 'react-dom/client';
import {BackupSettings} from '../../../src/components/workspace/BackupSettings';
import {WorkspaceProvider,useWorkspace} from '../../../src/components/workspace/WorkspaceContext';
import {Route} from '../../../src/routes/_authenticated/events.new';
const windowValue=window as any;
windowValue.__testState={account:'synthetic-owner',eventId:'A',version:0,page:windowValue.__fixture.startBackups?'backups':'event'};
function RescanFixture(){const workspace=useWorkspace();return <button onClick={()=>void workspace.rescan()}>Fixture rescan</button>;}
const Root=()=>{const [version,setVersion]=React.useState(0);windowValue.__rerender=()=>setVersion(v=>v+1);return <AppearanceProvider><WorkspaceProvider><React.Fragment key={version}>{windowValue.__testState.page==='backups'?<><AppearanceSettings/><BackupSettings/>{windowValue.__fixture.startBackups&&<RescanFixture/>}</>:<Route.component/>}</React.Fragment></WorkspaceProvider></AppearanceProvider>;};
createRoot(document.getElementById('root') as HTMLElement).render(<Root/>);
