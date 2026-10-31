// Bundled solely by the native test runner. Every service is replaced by isolated stubs.
import React from 'react';import {createRoot} from 'react-dom/client';
import {Route} from '../../../src/routes/_authenticated/events.new';
const windowValue=window as any;
windowValue.__testState={account:'synthetic-owner',eventId:'A',version:0};
const Root=()=>{const [version,setVersion]=React.useState(0);windowValue.__rerender=()=>setVersion(v=>v+1);return <React.Fragment key={version}><Route.component/></React.Fragment>;};
createRoot(document.getElementById('root') as HTMLElement).render(<Root/>);
