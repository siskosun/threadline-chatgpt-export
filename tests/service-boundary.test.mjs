import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const core=fs.readFileSync(new URL('../src/tl-core.js',import.meta.url),'utf8');
const service=fs.readFileSync(new URL('../src/tl-service.js',import.meta.url),'utf8');
async function harness({navigationFails=false}={}){
 const records=new Map([['handoff',{id:'handoff',captureId:'capture',state:'prepared',prompt:'Test',files:[{name:'history.md',size:1,sha256:'a'.repeat(64)}],batches:[[0]],missing:[]}]]),events=[],tabs=new Map();
 const store={get:async(name,key)=>structuredClone(records.get(key)),all:async name=>name==='handoffs'?[...records.values()].map(x=>structuredClone(x)):[],set:async(name,value)=>{records.set(value.id,structuredClone(value));events.push('persist:'+value.state);},recover:async()=>{}};
 const event=()=>({addListener(){}});
 const api={runtime:{id:'extension',getURL:p=>'chrome-extension://extension/'+p,onMessage:event()},storage:{session:{get:async()=>({}),set:async()=>{}}},action:{onClicked:event()},scripting:{executeScript:async()=>{}},permissions:{contains:async()=>true},
  windows:{create:async options=>{assert.equal(options.url,'about:blank');events.push('create-blank');tabs.set(17,{id:17,url:'about:blank',status:'complete'});return{id:9,tabs:[tabs.get(17)]};},update:async()=>{}},
  tabs:{onUpdated:event(),onRemoved:event(),get:async id=>tabs.get(id),query:async()=>[],sendMessage:async()=>{events.push('announce');},update:async(id,options)=>{const h=records.get('handoff');assert.equal(h.targetTabId,id);assert.equal(h.state,'target_opened');events.push('navigate');if(navigationFails)throw Error('network failure');tabs.set(id,{id,url:options.url,status:'loading'});return tabs.get(id);}}
 };
 const context=vm.createContext({console,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,Uint32Array,DataView,ArrayBuffer,Blob,AbortController,setTimeout,clearTimeout,crypto:webcrypto,atob,btoa,chrome:api,TLStore:store,importScripts(){},structuredClone});
 vm.runInContext(core,context);
 vm.runInContext(service+'\n globalThis.TEST_BOUNDARY={openHandoff,claim,targetHandoff,handle,boot};',context);
 await context.TEST_BOUNDARY.boot;
 return{...context.TEST_BOUNDARY,events,records,tabs,api};
}
test('new window is blank until handoff ownership is persisted',async()=>{
 const h=await harness(),result=await h.openHandoff('handoff');
 assert.equal(result.targetTabId,17);
 assert.deepEqual(h.events,['create-blank','persist:target_opened','navigate']);
 assert.equal(h.tabs.get(17).url,'https://chatgpt.com/');
});
test('concurrent double-click opens exactly one target window',async()=>{
 const h=await harness(),results=await Promise.allSettled([h.openHandoff('handoff'),h.openHandoff('handoff')]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.match(results.find(x=>x.status==='rejected').reason.message,/HANDOFF_ALREADY_OPENED/);
 assert.equal(h.events.filter(x=>x==='create-blank').length,1);
});
test('navigation uncertainty is persisted and never automatically retried',async()=>{
 const h=await harness({navigationFails:true});
 await assert.rejects(h.openHandoff('handoff'),/TARGET_NAVIGATION_UNCONFIRMED/);
 assert.equal(h.records.get('handoff').state,'injection_blocked');
 await assert.rejects(h.openHandoff('handoff'),/HANDOFF_ALREADY_OPENED/);
 assert.equal(h.events.filter(x=>x==='navigate').length,1);
});
test('only the first claim for the exact new tab and document succeeds',async()=>{
 const h=await harness();await h.openHandoff('handoff');
 const sender={id:'extension',tab:{id:17,url:'https://chatgpt.com/'},url:'https://chatgpt.com/',documentId:'doc-one'};
 const results=await Promise.all([h.claim(sender),h.claim(sender)]);
 assert.equal(results.filter(Boolean).length,1);assert.equal(h.records.get('handoff').targetDocumentId,'doc-one');
 assert.equal(await h.claim({...sender,documentId:'doc-reloaded'}),null);
});
test('handoff file reads reject a different tab, document and existing conversation',async()=>{
 const h=await harness();await h.openHandoff('handoff');
 const sender={id:'extension',tab:{id:17,url:'https://chatgpt.com/'},url:'https://chatgpt.com/',documentId:'doc-one'};await h.claim(sender);
 await assert.rejects(h.targetHandoff({id:'handoff'},{...sender,documentId:'different'}),/HANDOFF_TARGET_MISMATCH/);
 await assert.rejects(h.targetHandoff({id:'handoff'},{...sender,tab:{id:19}}),/HANDOFF_TARGET_MISMATCH/);
 await assert.rejects(h.targetHandoff({id:'handoff'},{...sender,url:'https://chatgpt.com/c/existing_chat_123'}),/NOT_NEW_NORMAL_CHAT/);
});
test('source-page callers cannot start captures or prepare handoffs through workspace commands',async()=>{
 const h=await harness(),sender={id:'extension',tab:{id:17},url:'https://chatgpt.com/'};
 for(const type of ['tl:start','tl:prepareHandoff','tl:openHandoff'])await assert.rejects(h.handle({type,id:'handoff'},sender),/WORKSPACE_ONLY/);
 await assert.rejects(h.handle({type:'tl:sources'},{id:'other-extension',url:'chrome-extension://extension/workspace/index.html'}),/FOREIGN_EXTENSION/);
});
