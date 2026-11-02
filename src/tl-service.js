/* ThreadLine MV3 service worker. No model API, automatic Send, or source mutation. */
importScripts('tl-core.js','tl-store.js');
const C=globalThis.TLCore,S=globalThis.TLStore,api=chrome,runs=new Map();
function errorCode(e){if(e?.name==='QuotaExceededError')return'LOCAL_STORAGE_FULL';if(e?.name==='AbortError')return'CANCELLED_OR_TIMEOUT';return/^[A-Z][A-Z0-9_]{2,100}$/.test(String(e?.message||''))?e.message:'OPERATION_FAILED';}
const trusted=sender=>sender?.id===api.runtime.id;
function workspace(sender){C.check(trusted(sender)&&String(sender.url||'').startsWith(api.runtime.getURL('workspace/')),'WORKSPACE_ONLY');}
async function keepRuns(){await api.storage.session.set({tlRuns:[...runs.values()].map(({controller,...r})=>r)});}
let bootError=null;
const boot=(async()=>{
 const old=(await api.storage.session.get('tlRuns')).tlRuns||[];
 for(const r of old){const c=await S.get('captures',r.captureId);if(c)await S.set('captures',{...c,state:c.state==='capturing'?'interrupted':c.state,live:false,lastError:'WORKER_RESTARTED_RETRY_EXPLICITLY'});}
 await S.recover([]);await api.storage.session.set({tlRuns:[]});
})().catch(e=>{bootError=errorCode(e);});
async function sourceRun(msg,sender){
 C.check(trusted(sender)&&Number.isInteger(sender.tab?.id),'SOURCE_TAB_REQUIRED');const run=runs.get(msg.nonce);C.check(run&&!run.cancelled&&run.tabId===sender.tab.id,'CAPTURE_SESSION_NOT_FOUND');
 const source=C.chatUrl(sender.url||sender.tab.url);C.check(source.conversationId===run.source.conversationId&&source.origin===run.source.origin,'SOURCE_CONVERSATION_CHANGED');
 if(run.documentId)C.check(sender.documentId===run.documentId,'SOURCE_DOCUMENT_CHANGED');else{C.check(sender.documentId,'DOCUMENT_ID_UNAVAILABLE');run.documentId=sender.documentId;await keepRuns();}
 const now=C.chatUrl((await api.tabs.get(run.tabId)).url);C.check(now.conversationId===run.source.conversationId&&now.origin===run.source.origin,'SOURCE_NAVIGATED');return run;
}
async function sendToSource(tabId,message){
 try{return await api.tabs.sendMessage(tabId,message);}catch{await api.scripting.executeScript({target:{tabId},files:['src/tl-core.js','src/tl-capture.js','src/tl-inject.js']});return api.tabs.sendMessage(tabId,message);}
}
async function startCapture(msg){
 C.check(Number.isInteger(msg.tabId),'INVALID_TAB_ID');C.check(![...runs.values()].some(r=>r.tabId===msg.tabId),'SOURCE_ALREADY_RUNNING');
 const scope=msg.scope==null?'all':msg.scope;C.check(['all','last_generated'].includes(scope),'INVALID_SAVE_SCOPE');C.check(!(msg.live&&scope==='last_generated'),'LIVE_CACHE_REQUIRES_ALL_SCOPE');
 const tab=await api.tabs.get(msg.tabId),source=C.chatUrl(tab.url),captureId=msg.captureId||C.id(),previous=await S.get('captures',captureId);
 if(previous){const p=previous.snapshot?.source||previous.source;C.check(p?.conversationId===source.conversationId&&p.origin===source.origin,'CAPTURE_SOURCE_CHANGED');C.check((previous.saveScope||'all')===scope,'CAPTURE_SCOPE_CHANGED');}
 else await S.set('captures',{id:captureId,title:C.scrubText(tab.title||'读取对话中'),source,snapshot:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),state:'capturing',live:!!msg.live,saveScope:scope});
 const nonce=C.id(),run={nonce,tabId:tab.id,source,captureId,live:!!msg.live,scope,phase:'reading',documentId:null,cancelled:false};runs.set(nonce,run);await keepRuns();
 try{const response=await sendToSource(tab.id,{type:'tl:capture',nonce,live:run.live,scope:run.scope});C.check(response?.ok,'CHATGPT_PAGE_NOT_READY');}
 catch(e){runs.delete(nonce);await keepRuns();const c=await S.get('captures',captureId);await S.set('captures',{...c,state:'error',live:false,lastError:errorCode(e)});throw new Error('CHATGPT_PAGE_NOT_READY');}
 return{captureId};
}
async function stopCapture(captureId){
 for(const[nonce,r]of runs)if(r.captureId===captureId){r.cancelled=true;r.controller?.abort();runs.delete(nonce);await api.tabs.sendMessage(r.tabId,{type:'tl:stopCapture',nonce}).catch(()=>{});}
 await keepRuns();const c=await S.get('captures',captureId);if(c){for(const a of await S.assets(captureId))if(a.state==='downloading')await S.failAsset(captureId,a.key,'CANCELLED_BY_USER');await S.set('captures',{...c,state:c.state==='capturing'?'cancelled':c.state,live:false});}
}
async function externalDownload(run,msg){
 const asset=await S.get('assets',[run.captureId,msg.key]);C.check(asset&&asset.state!=='saved'&&asset.state!=='excluded','INVALID_DOWNLOAD_ASSET');const target=C.mediaUrl(msg.url);C.check(await api.permissions.contains({origins:[target.origin+'/*']}),'MEDIA_PERMISSION_REQUIRED');
 const controller=new AbortController();run.controller=controller;const timer=setTimeout(()=>controller.abort(),60000);
 try{
  const r=await fetch(target.href,{method:'GET',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store',signal:controller.signal});C.check(r.ok,'HTTP_'+r.status);C.check(r.body,'NO_DOWNLOAD_BODY');
  const estimate=await navigator.storage.estimate(),declared=Number(r.headers.get('content-length')||0);if(estimate.quota&&declared)C.check(declared<Math.max(0,estimate.quota-(estimate.usage||0)),'LOCAL_STORAGE_FULL');
  await S.beginAsset(run.captureId,msg.key);const reader=r.body.getReader();let seq=0,total=0;
  try{while(true){C.check(!run.cancelled&&runs.has(run.nonce),'CANCELLED_BY_USER');const x=await reader.read();if(x.done)break;for(let i=0;i<x.value.length;i+=262144){const part=x.value.subarray(i,i+262144);await S.chunk(run.captureId,msg.key,seq++,part);total+=part.length;}}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  if(declared&&!r.headers.get('content-encoding'))C.check(total===declared,'DOWNLOAD_SIZE_MISMATCH');return await S.finishAsset(run.captureId,msg.key,r.headers.get('content-type'));
 }catch(e){await S.failAsset(run.captureId,msg.key,errorCode(e));throw e;}finally{clearTimeout(timer);delete run.controller;}
}
async function prepareHandoff(msg){
 const c=await S.get('captures',msg.captureId);C.check(c?.snapshot,'CAPTURE_NOT_READY');C.check(!['capturing','error'].includes(c.state),'CAPTURE_NOT_READY');
 const rows=await S.assets(c.id),plan=C.handoff(c.snapshot,rows,Array.isArray(msg.keys)?msg.keys:[],msg.instructions||'',msg.batchLimit||10),files=[],names=new Set(['handoff_index.md']);
 for(const f of plan.files){
  const base=C.safeName(f.name);let uploadName=base,sequence=2;while(names.has(uploadName.toLowerCase()))uploadName=sequence+++'_'+base;names.add(uploadName.toLowerCase());
  if(f.kind==='asset'){const b=await S.verifiedBlob(f.sha256);files.push({...f,uploadName,size:b.size});}
  else{const blob=new Blob([f.text],{type:f.mime}),info=await S.putBlob(blob);files.push({kind:'history',name:f.name,uploadName,mime:f.mime,...info});}
 }
 const index=['# 接续文件索引','','仅下列文件已准备；网页是否上传成功需另行核对。',...files.map(f=>'- 上传名：'+f.uploadName+'；原名：'+f.name+'；SHA-256：'+f.sha256),...plan.missing.map(f=>'- 未取得文件：'+f.name+'（'+f.reason+'）'),...plan.excluded.map(f=>'- 按保存范围跳过：'+f.name+'（未取得文件字节）')].join('\n');
 const indexInfo=await S.putBlob(new Blob([index],{type:'text/markdown'}));files.unshift({kind:'index',name:'handoff_index.md',uploadName:'handoff_index.md',mime:'text/markdown',...indexInfo});
 const batches=[];for(let i=0;i<files.length;i+=plan.batchLimit)batches.push(files.slice(i,i+plan.batchLimit).map((_,j)=>i+j));
 const prompt=plan.prompt.replace(/准备批次：\d+/,'准备批次：'+batches.length)+'\n\n请先查看 handoff_index.md；同名原文件已分配不同上传名，必须按索引及哈希区分。'+(batches.length>1?' 首批不是全部材料，剩余批次需要用户手动补充。':'');
 const h={id:C.id(),captureId:c.id,createdAt:new Date().toISOString(),state:'prepared',prompt,files,batches,missing:plan.missing,excluded:plan.excluded};await S.set('handoffs',h);return h;
}
async function announce(tabId){const h=(await S.all('handoffs')).find(h=>h.targetTabId===tabId&&h.state==='target_opened');if(h)await api.tabs.sendMessage(tabId,{type:'tl:handoffAvailable'}).catch(()=>{});}
// A fresh window must not load ChatGPT before its tab is durably bound to this handoff.
// Serialize opens as well as claims: repeated UI clicks cannot create duplicate targets.
let openQueue=Promise.resolve();
function openHandoff(id){
 const operation=openQueue.then(async()=>{
  const h=await S.get('handoffs',id);C.check(h?.state==='prepared','HANDOFF_ALREADY_OPENED');
  const win=await api.windows.create({url:'about:blank',focused:true,type:'normal'}),target=win.tabs?.[0];C.check(Number.isInteger(target?.id),'NEW_WINDOW_FAILED');
  const updated={...h,state:'target_opened',targetTabId:target.id,targetWindowId:win.id,targetDocumentId:null};
  try{
   await S.set('handoffs',updated);
   const loaded=await api.tabs.update(target.id,{url:'https://chatgpt.com/'});
   if(loaded.status==='complete')await announce(target.id);
   return updated;
  }catch(e){
   await S.set('handoffs',{...updated,state:'injection_blocked',lastError:'TARGET_NAVIGATION_UNCONFIRMED'}).catch(()=>{});
   throw new Error('TARGET_NAVIGATION_UNCONFIRMED');
  }
 });openQueue=operation.catch(()=>{});return operation;
}
async function targetHandoff(msg,sender){
 C.check(trusted(sender)&&Number.isInteger(sender.tab?.id)&&sender.documentId,'TARGET_TAB_REQUIRED');const h=await S.get('handoffs',msg.id);C.check(h&&h.targetTabId===sender.tab.id&&h.targetDocumentId===sender.documentId,'HANDOFF_TARGET_MISMATCH');C.chatUrl(sender.url||sender.tab.url,{target:true});C.chatUrl((await api.tabs.get(sender.tab.id)).url,{target:true});return h;
}
let claimQueue=Promise.resolve();
async function claim(sender){
 const operation=claimQueue.then(async()=>{
  C.check(trusted(sender)&&Number.isInteger(sender.tab?.id)&&sender.documentId,'TARGET_TAB_REQUIRED');C.chatUrl(sender.url||sender.tab.url,{target:true});
  const h=(await S.all('handoffs')).find(x=>x.targetTabId===sender.tab.id&&x.state==='target_opened');if(!h)return null;
  C.chatUrl((await api.tabs.get(sender.tab.id)).url,{target:true});await S.set('handoffs',{...h,state:'claimed',targetDocumentId:sender.documentId});
  return{id:h.id,prompt:h.prompt,files:h.batches[0].map(i=>({...h.files[i],index:i})),remainingBatches:h.batches.length-1};
 });claimQueue=operation.catch(()=>{});return operation;
}
async function handle(msg,sender){
 await boot;C.check(!bootError,bootError||'STARTUP_FAILED');C.check(trusted(sender),'FOREIGN_EXTENSION');
 if(msg.type==='tl:claimHandoff')return claim(sender);
 if(msg.type==='tl:handoffChunk'){
  const h=await targetHandoff(msg,sender);C.check(h.state==='claimed'&&h.batches[0].includes(msg.index),'HANDOFF_NOT_READABLE');const f=h.files[msg.index],row=await S.get('files',f.sha256);C.check(row?.blob&&row.blob.size===f.size,'LOCAL_FILE_MISSING');C.check(Number.isSafeInteger(msg.offset)&&msg.offset>=0&&msg.offset<row.blob.size,'INVALID_FILE_OFFSET');
  const b=new Uint8Array(await row.blob.slice(msg.offset,msg.offset+262144).arrayBuffer());return{data:C.bytesToBase64(b),total:row.blob.size};
 }
 if(msg.type==='tl:handoffStatus'){
  const h=await targetHandoff(msg,sender);C.check(h.state==='claimed','HANDOFF_ALREADY_FINISHED');C.check(['draft_prepared','upload_confirmed','upload_unknown','injection_blocked','partial_injection'].includes(msg.state),'INVALID_HANDOFF_STATE');
  const code=/^[A-Z0-9_]{1,100}$/.test(msg.code||'')?msg.code:null,updated={...h,state:msg.state,lastError:code,reportedAt:new Date().toISOString()};await S.set('handoffs',updated);return updated;
 }
 if(['tl:sources','tl:start','tl:stop','tl:sessions','tl:prepareHandoff','tl:openHandoff','tl:confirmUpload','tl:focusTarget'].includes(msg.type)){
  workspace(sender);
  if(msg.type==='tl:sources'){const tabs=await api.tabs.query({url:['https://chatgpt.com/*','https://chat.openai.com/*']});return tabs.flatMap(t=>{try{const source=C.chatUrl(t.url);return[{id:t.id,title:C.scrubText(t.title),url:source.url}];}catch{return[];}});}
  if(msg.type==='tl:start')return startCapture(msg);
  if(msg.type==='tl:stop'){await stopCapture(msg.captureId);return{stopped:true};}
  if(msg.type==='tl:sessions')return[...runs.values()].map(r=>({captureId:r.captureId,tabId:r.tabId,live:r.live,phase:r.phase}));
  if(msg.type==='tl:prepareHandoff')return prepareHandoff(msg);
  if(msg.type==='tl:openHandoff')return openHandoff(msg.id);
  if(msg.type==='tl:focusTarget'){const h=await S.get('handoffs',msg.id);C.check(h?.targetTabId,'NO_TARGET');await api.tabs.update(h.targetTabId,{active:true});await api.windows.update(h.targetWindowId,{focused:true});return{focused:true};}
  if(msg.type==='tl:confirmUpload'){const h=await S.get('handoffs',msg.id);C.check(h&&['upload_unknown','upload_confirmed','draft_prepared'].includes(h.state),'HANDOFF_NOT_CONFIRMABLE');C.check(msg.confirmed===true,'USER_CONFIRMATION_REQUIRED');await S.set('handoffs',{...h,state:'user_verified_upload',userVerifiedAt:new Date().toISOString(),note:'User confirmed page attachments; this is not model-read or sent-message evidence.'});return{confirmed:true};}
 }
 const run=await sourceRun(msg,sender);run.phase=msg.type.slice(3);
 if(msg.type==='tl:snapshot'){
  C.check(msg.snapshot?.source?.conversationId===run.source.conversationId&&msg.snapshot?.source?.origin===run.source.origin,'SNAPSHOT_SOURCE_MISMATCH');C.check(JSON.stringify(msg.snapshot).length<=16*1024*1024,'SNAPSHOT_MESSAGE_SIZE_LIMIT');
  await S.snapshot(run.captureId,msg.snapshot);const c=await S.get('captures',run.captureId);await S.set('captures',{...c,live:run.live});const rows=await S.assets(run.captureId);return{savedKeys:rows.filter(a=>a.state==='saved').map(a=>a.key)};
 }
 if(msg.type==='tl:assetBegin'){await S.beginAsset(run.captureId,msg.key);return{ok:true};}
 if(msg.type==='tl:assetChunk'){await S.chunk(run.captureId,msg.key,msg.seq,C.base64ToBytes(msg.data));return{ok:true};}
 if(msg.type==='tl:assetEnd')return S.finishAsset(run.captureId,msg.key,msg.mime);
 if(msg.type==='tl:assetFail'){await S.failAsset(run.captureId,msg.key,/^[A-Z0-9_]{1,100}$/.test(msg.code||'')?msg.code:'DOWNLOAD_FAILED');return{ok:true};}
 if(msg.type==='tl:external')return externalDownload(run,msg);
 if(msg.type==='tl:finish'){const c=await S.finishCapture(run.captureId);if(run.live){run.phase='watching';await S.set('captures',{...c,live:true});}else runs.delete(run.nonce);await keepRuns();return c;}
 if(msg.type==='tl:heartbeat')return{active:true};
 if(msg.type==='tl:captureFailed'){const c=await S.get('captures',run.captureId);if(c)await S.set('captures',{...c,state:c.snapshot?'partial':'error',live:false,lastError:/^[A-Z0-9_]{1,100}$/.test(msg.code||'')?msg.code:'CAPTURE_FAILED'});run.controller?.abort();runs.delete(run.nonce);await keepRuns();return{stopped:true};}
 throw new Error('UNKNOWN_OPERATION');
}
api.runtime.onMessage.addListener((msg,sender,respond)=>{if(!msg||typeof msg.type!=='string'||!msg.type.startsWith('tl:'))return false;handle(msg,sender).then(data=>respond({ok:true,data})).catch(e=>respond({ok:false,code:errorCode(e)}));return true;});
let workspaceOpening=Promise.resolve();
api.action.onClicked.addListener(tab=>{
 workspaceOpening=workspaceOpening.catch(()=>{}).then(async()=>{
  const url=api.runtime.getURL('workspace/index.html'),existing=(await api.tabs.query({url:url+'*'}))[0];
  if(existing){await api.tabs.update(existing.id,{active:true});await api.windows.update(existing.windowId,{focused:true});}else await api.tabs.create({url:url+(tab?.id?'?source='+tab.id:'')});
 });
});
api.tabs.onUpdated.addListener((tabId,change,tab)=>{
 if(change.status==='complete')announce(tabId).catch(()=>{});
 if(change.url)for(const r of runs.values())if(r.tabId===tabId){let same=false;try{const now=C.chatUrl(tab.url);same=now.conversationId===r.source.conversationId&&now.origin===r.source.origin;}catch{}if(!same)stopCapture(r.captureId).catch(()=>{});}
});
api.tabs.onRemoved.addListener(tabId=>{for(const r of runs.values())if(r.tabId===tabId)stopCapture(r.captureId).catch(()=>{});});
