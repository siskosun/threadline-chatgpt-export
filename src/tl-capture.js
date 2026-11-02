/* ChatGPT page adapter. MIT. Read-only private endpoints; protocol drift is explicit.
 * Endpoint families derive from the pinned exporter. Tokens stay in this closure.
 */
(() => {
 'use strict';
 if(globalThis.TLCaptureInstalled)return;globalThis.TLCaptureInstalled=true;
 const C=globalThis.TLCore,api=chrome;let active=null;
 const code=e=>e?.name==='AbortError'?'CANCELLED_OR_TIMEOUT':/^[A-Z0-9_]{2,100}$/.test(e?.message||'')?e.message:'CAPTURE_REQUEST_FAILED';
 async function message(type,data={},nonce=active?.nonce){const r=await api.runtime.sendMessage({type,nonce,...data});if(!r?.ok)throw new Error(r?.code||'EXTENSION_UNAVAILABLE');return r.data;}
 function sameSource(run){const s=C.chatUrl(location.href);C.check(s.conversationId===run.source.conversationId&&s.origin===run.source.origin,'SOURCE_CONVERSATION_CHANGED');C.check(active===run&&!run.stopped,'CANCELLED_BY_USER');}
 function status(run,text){
  let host=document.getElementById('threadline-cache-notice');
  if(!host){host=document.createElement('div');host.id='threadline-cache-notice';host.setAttribute('role','status');host.style.cssText='position:fixed;bottom:12px;right:12px;z-index:2147483647;max-width:330px;padding:10px 14px;background:#eef4fb;color:#23384f;border:1px solid #8193a8;border-radius:8px;font:13px/1.6 system-ui;box-shadow:0 2px 10px #0002';(document.body||document.documentElement).append(host);}
  host.replaceChildren(document.createTextNode(text));
  if(run&&!run.stopped){const b=document.createElement('button');b.type='button';b.textContent='停止保存';b.style.cssText='margin-left:8px;padding:4px 8px';b.onclick=()=>{stop(run);message('tl:captureFailed',{code:'CANCELLED_BY_USER'},run.nonce).catch(()=>{});};host.append(b);}
 }
 function stop(run){run.stopped=true;run.controller?.abort();run.observer?.disconnect();clearInterval(run.timer);if(active===run)active=null;status(null,'研线：本对话保存已停止；已写入的本地文件保留。');}
 async function fetchResponse(run,path,token,accountId){
  sameSource(run);const u=new URL(path,run.source.origin),conversationPath='/backend-api/conversation/'+encodeURIComponent(run.source.conversationId);
  C.check(u.origin===run.source.origin,'CROSS_ORIGIN_AUTH_REQUEST_REJECTED');
  C.check(u.pathname==='/api/auth/session'||u.pathname===conversationPath||u.pathname.startsWith(conversationPath+'/')||u.pathname.startsWith('/backend-api/files/'),'UNSUPPORTED_READ_ENDPOINT');
  C.readOnlyRequest('GET');const headers={Accept:'*/*'};if(token)headers.Authorization='Bearer '+token;if(accountId)headers['ChatGPT-Account-ID']=accountId;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);run.controller=controller;
  try{const response=await fetch(u.href,{method:'GET',credentials:'include',headers,redirect:'error',cache:'no-store',signal:controller.signal});C.check(response.ok,'HTTP_'+response.status);return{response,close:()=>{clearTimeout(timer);if(run.controller===controller)delete run.controller;}};}
  catch(e){clearTimeout(timer);throw e;}
 }
 async function json(run,path,token,accountId){const{response,close}=await fetchResponse(run,path,token,accountId);try{return await response.json();}finally{close();}}
 async function sourceBytes(run,asset,response){
  const mime=(response.headers.get('content-type')||asset.mime).split(';')[0];if(mime==='text/html'&&!/\.html?$/i.test(asset.name))throw new Error('HTML_LOGIN_OR_ERROR_DOCUMENT');
  await message('tl:assetBegin',{key:asset.key},run.nonce);C.check(response.body,'EMPTY_DOWNLOAD_BODY');const reader=response.body.getReader();let seq=0,total=0;
  try{while(true){sameSource(run);const r=await reader.read();if(r.done)break;for(let i=0;i<r.value.length;i+=262144){const bytes=r.value.subarray(i,i+262144);await message('tl:assetChunk',{key:asset.key,seq:seq++,data:C.bytesToBase64(bytes)},run.nonce);total+=bytes.length;}}}
  catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  const declared=Number(response.headers.get('content-length')||0);if(declared&&!response.headers.get('content-encoding'))C.check(total===declared,'DOWNLOAD_SIZE_MISMATCH');return message('tl:assetEnd',{key:asset.key,mime},run.nonce);
 }
 async function urlBytes(run,asset,url,token,accountId){
  const u=new URL(url,run.source.origin);if(u.origin!==run.source.origin){C.mediaUrl(u.href);return message('tl:external',{key:asset.key,url:u.href},run.nonce);}
  const{response,close}=await fetchResponse(run,u.href,token,accountId);try{return await sourceBytes(run,asset,response);}finally{close();}
 }
 async function download(run,asset,token,accountId){
  const ref=asset.ref,id=encodeURIComponent(run.source.conversationId);
  if(ref.scheme==='https'){C.check(asset.ephemeralUrl,'SIGNED_URL_UNAVAILABLE');return urlBytes(run,asset,asset.ephemeralUrl,token,accountId);}
  if(['file-service','sediment'].includes(ref.scheme)){
   const file=encodeURIComponent(ref.fileId),qs='?conversation_id='+id,routes=['/backend-api/files/download/'+file+qs+'&inline=false','/backend-api/files/download/'+file+qs,'/backend-api/files/'+file+'/download'+qs];let last;
   for(const route of routes){try{const data=await json(run,route,token,accountId),url=data.download_url||data.signed_url||data.url;C.check(typeof url==='string','DOWNLOAD_URL_MISSING');return await urlBytes(run,asset,url,token,accountId);}catch(e){last=e;if(['HTTP_401','HTTP_403','MEDIA_PERMISSION_REQUIRED','LOCAL_STORAGE_FULL','CANCELLED_BY_USER'].includes(code(e)))break;}}
   throw last||new Error('DOWNLOAD_UNAVAILABLE');
  }
  if(ref.scheme==='sandbox'){
   const query=new URLSearchParams({sandbox_path:ref.path,message_id:asset.messageId}),base='/backend-api/conversation/'+id,routes=[base+'/download_from_sandbox/v2?'+query,base+'/interpreter/download?'+query,base+'/download_from_sandbox?'+query];let last;
   for(const route of routes){let close;try{
    const fetched=await fetchResponse(run,route,token,accountId);close=fetched.close;const r=fetched.response,mime=r.headers.get('content-type')||'';
    if(mime.includes('application/json')&&!r.headers.get('content-disposition')){
     const bytes=await r.arrayBuffer(),data=JSON.parse(new TextDecoder().decode(bytes)),url=data.download_url||data.signed_url;
     if(typeof url==='string'){close();close=null;return await urlBytes(run,asset,url,token,accountId);}
     if(/\.json$/i.test(asset.name))return await sourceBytes(run,asset,new Response(bytes,{headers:{'content-type':'application/json'}}));
     throw new Error('SANDBOX_DOWNLOAD_ENVELOPE_UNRECOGNIZED');
    }
    return await sourceBytes(run,asset,r);
   }catch(e){last=e;if(['HTTP_401','HTTP_403','MEDIA_PERMISSION_REQUIRED','LOCAL_STORAGE_FULL','CANCELLED_BY_USER'].includes(code(e)))break;}finally{close?.();}}
   throw last||new Error('SANDBOX_FILE_UNAVAILABLE');
  }
  throw new Error('UNSUPPORTED_ASSET_REFERENCE');
 }
 function reconcileVisibleAttachments(model){
  const known=new Set(model.assets.map(a=>a.name.toLowerCase()));
  for(const e of document.querySelectorAll('[data-message-author-role] a[download],[data-message-author-role] [data-testid="file-chip"]')){
   if(!e.getClientRects().length)continue;const raw=e.getAttribute('download')||e.getAttribute('data-filename')||e.textContent||'',name=C.safeName(raw.trim());
   if(!/\.[a-z0-9]{1,10}$/i.test(name)||known.has(name.toLowerCase()))continue;
   known.add(name.toLowerCase());model.integrity.state='partial';model.integrity.issues.push({code:'VISIBLE_ATTACHMENT_NOT_IN_API',name});
   const role=e.closest('[data-message-author-role]')?.getAttribute('data-message-author-role')||'unknown',origin=role==='assistant'?'assistant_generated':role==='user'?'user_uploaded':'unknown';
   model.assets.push({key:JSON.stringify(['visible-unmatched',name]),messageId:'visible-unmatched',nodeId:'visible-unmatched',name,mime:'application/octet-stream',kind:'upload',origin,authorRole:role,ref:{scheme:'unsupported'},expectedSize:null,state:'unavailable',reason:'VISIBLE_ATTACHMENT_NOT_IN_API'});
  }
 }
 async function cycle(run){
  if(run.busy||run.stopped)return;run.busy=true;run.dirty=false;
  try{
   sameSource(run);status(run,run.scope==='last_generated'?'研线：正在查找当前分支最后生成的文件。':'研线：正在读取本对话和可识别文件。');
   const session=await json(run,'/api/auth/session');C.check(typeof session.accessToken==='string'&&session.accessToken,'CHATGPT_LOGIN_REQUIRED');const token=session.accessToken,account=session.account?.id||session.activeAccount?.id||session.account_id||null;
   const raw=await json(run,'/backend-api/conversation/'+encodeURIComponent(run.source.conversationId),token,account);sameSource(run);
   const model=C.normalizeConversation(raw,location.href);reconcileVisibleAttachments(model);const selectedKeys=new Set(C.selectAssetKeys(model,run.scope)),scopeAmbiguous=run.scope==='last_generated'&&C.lastGeneratedScopeAmbiguous(model);
   for(const a of model.assets)if(!selectedKeys.has(a.key)){const active=model.active.includes(a.nodeId),known=!!model.nodes[a.nodeId],generated=a.origin==='assistant_generated'||(!a.origin&&a.kind==='generated'),unresolved=!known?(a.origin==='unknown'||generated):(active&&(a.origin==='unknown'||(scopeAmbiguous&&generated)));if(unresolved){a.state='unavailable';a.reason='SAVE_SCOPE_SOURCE_UNRESOLVED';}else{a.state='excluded';a.reason='OUT_OF_SAVE_SCOPE';}}
   const selectedAssets=model.assets.filter(a=>a.state!=='excluded'),skipped=model.assets.length-selectedAssets.length,persisted=C.persistedSnapshot(model);C.check(JSON.stringify(persisted).length<=16*1024*1024,'SNAPSHOT_MESSAGE_SIZE_LIMIT');
   const saved=new Set((await message('tl:snapshot',{snapshot:persisted},run.nonce)).savedKeys);let done=0,missing=0;
   for(const a of model.assets){
    if(a.state==='excluded')continue;sameSource(run);if(saved.has(a.key)){done++;continue;}status(run,'研线：保存文件 '+(done+missing+1)+' / '+selectedAssets.length+'。');
    if(a.reason==='SAVE_SCOPE_SOURCE_UNRESOLVED'){await message('tl:assetFail',{key:a.key,code:'SAVE_SCOPE_SOURCE_UNRESOLVED'},run.nonce);missing++;continue;}
    try{await download(run,a,token,account);done++;}catch(e){const reason=code(e);await message('tl:assetFail',{key:a.key,code:reason},run.nonce);missing++;if(reason==='LOCAL_STORAGE_FULL')throw e;}
   }
   await message('tl:finish',{},run.nonce);const hasActiveGenerated=model.assets.some(a=>model.active.includes(a.nodeId)&&(a.origin==='assistant_generated'||(!a.origin&&a.kind==='generated'))),noGenerated=run.scope==='last_generated'&&!hasActiveGenerated&&!scopeAmbiguous,scopeNotice=scopeAmbiguous?'当前分支存在来源不明或无法映射的文件，不能安全确定最后生成文件；可能的候选文件均标记为未判定。':noGenerated?'当前分支未识别到助手生成文件，只保存了对话正文。':'';status(run.live?run:null,'研线：已保存 '+done+' 个文件；'+missing+' 个未取得；'+skipped+' 个按范围跳过。'+(scopeNotice?' '+scopeNotice:run.live?'实时缓存已开启。':'请在本地档案中核对完整性。'));
   if(!run.live){run.stopped=true;if(active===run)active=null;}
  }catch(e){const reason=code(e);await message('tl:captureFailed',{code:reason},run.nonce).catch(()=>{});stop(run);status(null,'研线：保存中止（'+reason+'）。已保存的字节保留，未确认的结果不自动重试。');}
  finally{run.busy=false;}
 }
 function start(nonce,live,scope='all'){
  C.check(['all','last_generated'].includes(scope),'INVALID_SAVE_SCOPE');C.check(!(live&&scope==='last_generated'),'LIVE_CACHE_REQUIRES_ALL_SCOPE');
  if(active)stop(active);const run={nonce,source:C.chatUrl(location.href),live:!!live,scope,busy:false,stopped:false,dirty:true};active=run;
  if(run.live){
   run.observer=new MutationObserver(records=>{if(records.some(r=>{const e=r.target instanceof Element?r.target:r.target.parentElement;return!e?.closest('#threadline-cache-notice');}))run.dirty=true;});
   run.observer.observe(document.body||document.documentElement,{childList:true,subtree:true});
   run.timer=setInterval(async()=>{
    if(run.busy||run.stopped)return;
    try{sameSource(run);await message('tl:heartbeat',{},run.nonce);if(run.dirty)await cycle(run);}catch(e){stop(run);status(null,'研线：缓存已暂停（'+code(e)+'），请在档案页显式重新开启。');}
   },12000);
  }
  cycle(run);
 }
 api.runtime.onMessage.addListener((msg,sender,respond)=>{
  if(sender.id!==api.runtime.id)return false;
  if(msg?.type==='tl:capture'){try{C.check(typeof msg.nonce==='string'&&msg.nonce.length>20,'INVALID_CAPTURE_NONCE');start(msg.nonce,msg.live,msg.scope||'all');respond({ok:true});}catch(e){respond({ok:false,code:code(e)});}return false;}
  if(msg?.type==='tl:stopCapture'){if(active?.nonce===msg.nonce)stop(active);respond({ok:true});return false;}return false;
 });
})();
