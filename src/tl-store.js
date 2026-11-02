/* ThreadLine IndexedDB, extension origin only. MIT. */
(() => {
 'use strict';
 const C=globalThis.TLCore,NAME='threadline-local-archive-v1';let opening;
 const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('IDB_REQUEST_FAILED'));});
 function open(){
  if(opening)return opening;
  opening=new Promise((resolve,reject)=>{
   const r=indexedDB.open(NAME,1);
   r.onupgradeneeded=()=>{
    const db=r.result;db.createObjectStore('captures',{keyPath:'id'});
    const a=db.createObjectStore('assets',{keyPath:['captureId','key']});a.createIndex('capture','captureId');
    db.createObjectStore('files',{keyPath:'sha256'});
    const ch=db.createObjectStore('chunks',{keyPath:['captureId','key','seq']});ch.createIndex('owner',['captureId','key']);ch.createIndex('capture','captureId');
    db.createObjectStore('handoffs',{keyPath:'id'});
   };
   r.onerror=()=>{opening=null;reject(r.error||new Error('IDB_OPEN_FAILED'));};
   r.onblocked=()=>{opening=null;reject(new Error('IDB_UPGRADE_BLOCKED_CLOSE_OTHER_WINDOWS'));};
   r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();opening=null;};resolve(r.result);};
  });return opening;
 }
 async function transaction(names,mode,body){
  const db=await open();return new Promise((resolve,reject)=>{
   const t=db.transaction(names,mode),stores=Object.fromEntries(names.map(n=>[n,t.objectStore(n)]));let result,problem;
   t.oncomplete=()=>resolve(result);t.onabort=()=>reject(problem||t.error||new Error('IDB_TRANSACTION_ABORTED'));t.onerror=()=>{};
   Promise.resolve().then(()=>body(stores,t)).then(r=>result=r).catch(e=>{problem=e;try{t.abort();}catch{reject(e);}});
  });
 }
 const get=(store,key)=>transaction([store],'readonly',s=>request(s[store].get(key)));
 const all=store=>transaction([store],'readonly',s=>request(s[store].getAll()));
 async function set(store,value){
  if(store!=='handoffs')return transaction([store],'readwrite',s=>request(s[store].put(value)));
  // A prepared handoff must never commit pointers to files/source concurrently deleted.
  return transaction(['handoffs','captures','files'],'readwrite',async s=>{
   C.check(value&&typeof value.captureId==='string'&&Array.isArray(value.files),'INVALID_HANDOFF_RECORD');
   C.check(await request(s.captures.get(value.captureId)),'HANDOFF_SOURCE_DELETED');
   for(const f of value.files){C.check(/^[a-f0-9]{64}$/.test(f.sha256||'')&&f.size>0,'INVALID_HANDOFF_FILE');const row=await request(s.files.get(f.sha256));C.check(row?.blob instanceof Blob&&row.size===f.size&&row.blob.size===f.size,'LOCAL_FILE_MISSING');}
   return request(s.handoffs.put(value));
  });
 }
 const assets=captureId=>transaction(['assets'],'readonly',s=>request(s.assets.index('capture').getAll(captureId)));
 const chunks=(captureId,key)=>transaction(['chunks'],'readonly',s=>request(s.chunks.index('owner').getAll(IDBKeyRange.only([captureId,key]))));
 async function snapshot(captureId,model){
  C.check(model?.schema==='threadline.snapshot/1','INVALID_SNAPSHOT');const clean=C.persistedSnapshot(model),now=new Date().toISOString();
  await transaction(['captures','assets'],'readwrite',async s=>{
   const prev=await request(s.captures.get(captureId)),prevSource=prev?.snapshot?.source||prev?.source;
   if(prevSource)C.check(prevSource.conversationId===clean.source.conversationId&&prevSource.origin===clean.source.origin,'CAPTURE_SOURCE_CHANGED');
   const prior=await request(s.assets.index('capture').getAll(captureId)),old=new Map(prior.map(a=>[a.key,a])),current=new Set(clean.assets.map(a=>a.key));
   for(const a of clean.assets){const p=old.get(a.key);if(p?.state==='saved'&&(a.expectedSize==null||a.expectedSize===p.size))s.assets.put({...p,name:a.name,mime:a.mime==='application/octet-stream'?p.mime:a.mime,inLatestSnapshot:true});else s.assets.put({...a,captureId,inLatestSnapshot:true,sha256:null,size:0,chunks:0,state:['unavailable','excluded'].includes(a.state)?a.state:'discovered',reason:a.reason||null});}
   for(const a of prior)if(!current.has(a.key))s.assets.put({...a,inLatestSnapshot:false});
   s.captures.put({id:captureId,snapshot:clean,createdAt:prev?.createdAt||now,updatedAt:now,state:'capturing',live:!!prev?.live,saveScope:prev?.saveScope||'all'});
  });return get('captures',captureId);
 }
 async function beginAsset(captureId,key){
  await transaction(['captures','assets','chunks'],'readwrite',async s=>{
   C.check(await request(s.captures.get(captureId)),'CAPTURE_NOT_FOUND');
   const a=await request(s.assets.get([captureId,key]));C.check(a,'UNKNOWN_ASSET');if(a.state==='saved')return;C.check(a.state!=='excluded','ASSET_EXCLUDED_BY_SAVE_SCOPE');
   const old=await request(s.chunks.index('owner').getAllKeys(IDBKeyRange.only([captureId,key])));old.forEach(k=>s.chunks.delete(k));
   s.assets.put({...a,state:'downloading',size:0,chunks:0,reason:null});
  });
 }
 async function chunk(captureId,key,seq,bytes){
  C.check(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=262144,'INVALID_CHUNK');
  await transaction(['assets','chunks'],'readwrite',async s=>{
   const a=await request(s.assets.get([captureId,key]));C.check(a?.state==='downloading','ASSET_NOT_DOWNLOADING');C.check(Number.isSafeInteger(seq)&&seq===a.chunks,'CHUNK_SEQUENCE_MISMATCH');
   s.chunks.put({captureId,key,seq,blob:new Blob([bytes])});s.assets.put({...a,chunks:seq+1,size:a.size+bytes.length});
  });
 }
 async function finishAsset(captureId,key,mime){
  const a=await get('assets',[captureId,key]);C.check(a?.state==='downloading','ASSET_NOT_DOWNLOADING');
  const parts=await chunks(captureId,key),hash=new C.SHA256();let size=0;C.check(parts.length===a.chunks&&a.chunks>0,'MISSING_ASSET_CHUNKS');
  for(let i=0;i<parts.length;i++){C.check(parts[i].seq===i,'CHUNK_SEQUENCE_MISMATCH');const bytes=new Uint8Array(await parts[i].blob.arrayBuffer());hash.update(bytes);size+=bytes.length;}
  C.check(size>0&&size===a.size,'EMPTY_OR_TRUNCATED_ASSET');if(a.expectedSize!=null)C.check(a.expectedSize===size,'SOURCE_SIZE_MISMATCH');
  const sha256=hash.hex(),type=typeof mime==='string'&&/^[\w.+-]+\/[\w.+-]+/.test(mime)?mime.split(';')[0]:a.mime,blob=new Blob(parts.map(p=>p.blob),{type});
  await transaction(['files','assets','chunks'],'readwrite',async s=>{
   const current=await request(s.assets.get([captureId,key]));C.check(current?.state==='downloading'&&current.size===size&&current.chunks===a.chunks,'ASSET_CHANGED_DURING_COMMIT');
   const existing=await request(s.files.get(sha256));if(!existing)s.files.put({sha256,blob,size});
   s.assets.put({...current,mime:type,state:'saved',sha256,size,savedAt:new Date().toISOString(),reason:null});parts.forEach(p=>s.chunks.delete([captureId,key,p.seq]));
  });return get('assets',[captureId,key]);
 }
 async function failAsset(captureId,key,reason){
  await transaction(['assets','chunks'],'readwrite',async s=>{
   const a=await request(s.assets.get([captureId,key]));if(!a||a.state==='saved'||a.state==='excluded')return;
   const old=await request(s.chunks.index('owner').getAllKeys(IDBKeyRange.only([captureId,key])));old.forEach(k=>s.chunks.delete(k));
   s.assets.put({...a,state:'unavailable',reason:String(reason||'DOWNLOAD_UNCONFIRMED').slice(0,150),chunks:0,size:0,sha256:null});
  });
 }
 async function finishCapture(captureId,requested='ready'){
  const rows=await assets(captureId),c=await get('captures',captureId);C.check(c?.snapshot,'CAPTURE_NOT_FOUND');
  const excluded=rows.filter(a=>a.state==='excluded').length,missing=rows.filter(a=>a.state!=='saved'&&a.state!=='excluded').length,saved=rows.filter(a=>a.state==='saved').length,state=requested==='ready'?(missing||c.snapshot.integrity.state!=='valid'?'partial':'ready'):requested;
  await set('captures',{...c,state,updatedAt:new Date().toISOString(),savedFiles:saved,missingFiles:missing,excludedFiles:excluded});return get('captures',captureId);
 }
 async function verifiedBlob(sha256){
  C.check(/^[0-9a-f]{64}$/.test(sha256),'INVALID_CONTENT_HASH');const row=await get('files',sha256);
  C.check(row?.blob instanceof Blob,'LOCAL_FILE_MISSING');C.check(row.blob.size===row.size,'LOCAL_FILE_SIZE_MISMATCH');C.check(await C.hashBlob(row.blob)===sha256,'LOCAL_FILE_HASH_MISMATCH');return row.blob;
 }
 async function putBlob(blob){
  C.check(blob instanceof Blob&&blob.size>0,'EMPTY_ASSET');const sha256=await C.hashBlob(blob);
  if(!await get('files',sha256))await set('files',{sha256,blob,size:blob.size});return{sha256,size:blob.size};
 }
 async function recover(activeIds=[]){
  const active=new Set(activeIds);
  for(const c of await all('captures'))if((c.state==='capturing'||c.live)&&!active.has(c.id)){
   const rows=await assets(c.id);for(const a of rows)if(a.state==='downloading')await failAsset(c.id,a.key,'INTERRUPTED_RETRY_EXPLICITLY');
   await set('captures',{...c,state:c.state==='capturing'?'interrupted':c.state,live:false,cacheStoppedReason:'BROWSER_OR_WORKER_RESTART',updatedAt:new Date().toISOString()});
  }
 }
 async function removeCapture(captureId){
  // Delete only this archive and its handoffs. Compute shared-blob references under
  // one transaction, not from a stale snapshot that races another capture commit.
  await transaction(['captures','assets','chunks','files','handoffs'],'readwrite',async s=>{
   const current=await request(s.captures.get(captureId));if(!current)return;
   C.check(!current.live&&current.state!=='capturing','STOP_CAPTURE_BEFORE_DELETE');
   const removed=await request(s.assets.index('capture').getAll(captureId));
   const candidateHashes=new Set(removed.map(a=>a.sha256).filter(Boolean));
   s.captures.delete(captureId);for(const a of removed)s.assets.delete([captureId,a.key]);
   for(const key of await request(s.chunks.index('capture').getAllKeys(captureId)))s.chunks.delete(key);
   const handoffs=await request(s.handoffs.getAll());
   for(const h of handoffs)if(h.captureId===captureId){s.handoffs.delete(h.id);for(const f of h.files||[])candidateHashes.add(f.sha256);}
   const references=new Set((await request(s.assets.getAll())).map(a=>a.sha256).filter(Boolean));
   for(const h of handoffs)if(h.captureId!==captureId)for(const f of h.files||[])references.add(f.sha256);
   for(const sha of candidateHashes)if(sha&&!references.has(sha))s.files.delete(sha);
  });
 }
 async function importCapture(snapshotData,items,blobs,state,saveScope='all'){
  const captureId=C.id();for(const[sha,blob]of blobs){C.check(await C.hashBlob(blob)===sha,'IMPORT_HASH_MISMATCH');await putBlob(blob);}
  const snapshotCopy=C.persistedSnapshot(snapshotData);
  await transaction(['captures','assets'],'readwrite',s=>{
   s.captures.put({id:captureId,snapshot:snapshotCopy,state,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),imported:true,live:false,saveScope});for(const a of items)s.assets.put({...a,captureId});
  });return captureId;
 }
 globalThis.TLStore=Object.freeze({open,get,all,set,assets,snapshot,beginAsset,chunk,finishAsset,failAsset,finishCapture,verifiedBlob,putBlob,recover,removeCapture,importCapture});
})();
