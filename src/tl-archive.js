/* ThreadLine archive I/O. MIT.
 * ZIP headers/ZIP64 layout adapted from thekester/chatgpt-export src/zip.js,
 * pinned 13568bf75688de74a5af563b20d5ccd28f4ad532. Original LICENSE is retained.
 * Blob payloads are streamed for CRC/SHA; never serialized into persistent Base64.
 */
(() => {
 'use strict';
 const C=globalThis.TLCore,S=globalThis.TLStore,enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
 const U32=0xffffffffn,U16=65535;
 const TABLE=new Uint32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
 function crcUpdate(state,bytes){let c=state;for(const b of bytes)c=TABLE[(c^b)&255]^(c>>>8);return c>>>0;}
 async function crc(blob){let c=0xffffffff;const reader=blob.stream().getReader();try{while(true){const x=await reader.read();if(x.done)break;c=crcUpdate(c,x.value);}}finally{reader.releaseLock();}return(c^0xffffffff)>>>0;}
 function safePath(name){C.check(typeof name==='string'&&name.length>0&&name.length<4096&&!name.startsWith('/')&&!/[\\\u0000-\u001f:]/.test(name),'UNSAFE_ZIP_PATH');C.check(name.split('/').every(p=>p!=='.'&&p!=='..'),'UNSAFE_ZIP_PATH');return name;}
 function extra64(values){if(!values.length)return new Uint8Array();const out=new Uint8Array(4+8*values.length),v=new DataView(out.buffer);v.setUint16(0,1,true);v.setUint16(2,8*values.length,true);values.forEach((x,i)=>v.setBigUint64(4+i*8,BigInt(x),true));return out;}
 async function buildZip(entries){
  const local=[],central=[],names=new Set();let offset=0n,any64=false;
  for(const entry of entries){
   const path=safePath(entry.name);C.check(!names.has(path.normalize('NFC')),'DUPLICATE_ZIP_PATH');names.add(path.normalize('NFC'));
   const name=enc.encode(path),blob=entry.blob instanceof Blob?entry.blob:new Blob([entry.content||'']);C.check(name.length<=U16,'ZIP_NAME_TOO_LONG');
   const size=BigInt(blob.size),large=size>U32,largeOffset=offset>U32,need64=large||largeOffset,checksum=await crc(blob);any64 ||= need64;
   const ex=large?extra64([size,size]):new Uint8Array(),h=new DataView(new ArrayBuffer(30));
   h.setUint32(0,0x04034b50,true);h.setUint16(4,need64?45:20,true);h.setUint16(6,0x800,true);h.setUint16(8,0,true);h.setUint16(12,33,true);
   h.setUint32(14,checksum,true);h.setUint32(18,large?0xffffffff:Number(size),true);h.setUint32(22,large?0xffffffff:Number(size),true);h.setUint16(26,name.length,true);h.setUint16(28,ex.length,true);
   local.push(h.buffer,name,ex,blob);
   const vals=[];if(large)vals.push(size,size);if(largeOffset)vals.push(offset);const ce=extra64(vals),ch=new DataView(new ArrayBuffer(46));
   ch.setUint32(0,0x02014b50,true);ch.setUint16(4,need64?45:20,true);ch.setUint16(6,need64?45:20,true);ch.setUint16(8,0x800,true);ch.setUint16(14,33,true);ch.setUint32(16,checksum,true);ch.setUint32(20,large?0xffffffff:Number(size),true);ch.setUint32(24,large?0xffffffff:Number(size),true);ch.setUint16(28,name.length,true);ch.setUint16(30,ce.length,true);ch.setUint32(42,largeOffset?0xffffffff:Number(offset),true);
   central.push(ch.buffer,name,ce);offset+=30n+BigInt(name.length+ex.length)+size;
  }
  let cdSize=0n;central.forEach(c=>cdSize+=BigInt(c.byteLength));const count=BigInt(entries.length),tail=[];
  if(any64||count>BigInt(U16)||offset>U32||cdSize>U32){
   const z=new DataView(new ArrayBuffer(56));z.setUint32(0,0x06064b50,true);z.setBigUint64(4,44n,true);z.setUint16(12,45,true);z.setUint16(14,45,true);z.setBigUint64(24,count,true);z.setBigUint64(32,count,true);z.setBigUint64(40,cdSize,true);z.setBigUint64(48,offset,true);
   const l=new DataView(new ArrayBuffer(20));l.setUint32(0,0x07064b50,true);l.setBigUint64(8,offset+cdSize,true);l.setUint32(16,1,true);tail.push(z.buffer,l.buffer);
  }
  const end=new DataView(new ArrayBuffer(22));end.setUint32(0,0x06054b50,true);end.setUint16(8,count>BigInt(U16)?U16:Number(count),true);end.setUint16(10,count>BigInt(U16)?U16:Number(count),true);end.setUint32(12,cdSize>U32?0xffffffff:Number(cdSize),true);end.setUint32(16,offset>U32?0xffffffff:Number(offset),true);tail.push(end.buffer);
  return new Blob([...local,...central,...tail],{type:'application/zip'});
 }
 const exactNumber=x=>{C.check(x<=BigInt(Number.MAX_SAFE_INTEGER),'ZIP64_OFFSET_TOO_LARGE');return Number(x);};
 async function readZip(blob,{maxEntries=50000,maxExpanded=4*1024**3,maxCentral=32*1024**2}={}){
  C.check(blob instanceof Blob&&blob.size>=22,'INVALID_ZIP');
  const tailStart=Math.max(0,blob.size-65557),tail=new Uint8Array(await blob.slice(tailStart).arrayBuffer()),v=new DataView(tail.buffer);let e=-1;
  for(let i=tail.length-22;i>=0;i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===tail.length){e=i;break;}
  C.check(e>=0,'ZIP_END_NOT_FOUND');C.check(v.getUint16(e+4,true)===0&&v.getUint16(e+6,true)===0,'MULTI_VOLUME_ZIP_UNSUPPORTED');
  let count=v.getUint16(e+10,true),cdSize=v.getUint32(e+12,true),cdOffset=v.getUint32(e+16,true);
  if(count===U16||cdSize===0xffffffff||cdOffset===0xffffffff){
   const loc=new DataView(await blob.slice(tailStart+e-20,tailStart+e).arrayBuffer());C.check(loc.byteLength===20&&loc.getUint32(0,true)===0x07064b50,'INVALID_ZIP64_LOCATOR');C.check(loc.getUint32(16,true)===1,'MULTI_VOLUME_ZIP_UNSUPPORTED');
   const pos=exactNumber(loc.getBigUint64(8,true)),z=new DataView(await blob.slice(pos,pos+56).arrayBuffer());C.check(z.byteLength===56&&z.getUint32(0,true)===0x06064b50,'INVALID_ZIP64_END');count=exactNumber(z.getBigUint64(32,true));cdSize=exactNumber(z.getBigUint64(40,true));cdOffset=exactNumber(z.getBigUint64(48,true));
  }
  C.check(count<=maxEntries&&cdSize<=maxCentral&&cdOffset+cdSize<=blob.size,'ZIP_RESOURCE_LIMIT');
  const data=new Uint8Array(await blob.slice(cdOffset,cdOffset+cdSize).arrayBuffer()),dv=new DataView(data.buffer),entries=new Map();let p=0,expanded=0;
  for(let n=0;n<count;n++){
   C.check(p+46<=data.length&&dv.getUint32(p,true)===0x02014b50,'INVALID_ZIP_DIRECTORY');
   const flags=dv.getUint16(p+8,true),method=dv.getUint16(p+10,true),checksum=dv.getUint32(p+16,true),nl=dv.getUint16(p+28,true),el=dv.getUint16(p+30,true),cl=dv.getUint16(p+32,true);
   C.check(!(flags&1)&&[0,8].includes(method),'UNSUPPORTED_ZIP_ENCRYPTION_OR_METHOD');C.check(p+46+nl+el+cl<=data.length,'TRUNCATED_ZIP_DIRECTORY');
   let compressed=dv.getUint32(p+20,true),size=dv.getUint32(p+24,true),offset=dv.getUint32(p+42,true);
   const name=dec.decode(data.subarray(p+46,p+46+nl));safePath(name);C.check(!entries.has(name.normalize('NFC')),'DUPLICATE_ZIP_PATH');
   if(compressed===0xffffffff||size===0xffffffff||offset===0xffffffff){let q=p+46+nl,found=false;while(q+4<=p+46+nl+el){const type=dv.getUint16(q,true),len=dv.getUint16(q+2,true);q+=4;C.check(q+len<=p+46+nl+el,'TRUNCATED_ZIP_EXTRA');if(type===1){let r=q;if(size===0xffffffff){C.check(r+8<=q+len,'BAD_ZIP64_EXTRA');size=exactNumber(dv.getBigUint64(r,true));r+=8;}if(compressed===0xffffffff){C.check(r+8<=q+len,'BAD_ZIP64_EXTRA');compressed=exactNumber(dv.getBigUint64(r,true));r+=8;}if(offset===0xffffffff){C.check(r+8<=q+len,'BAD_ZIP64_EXTRA');offset=exactNumber(dv.getBigUint64(r,true));}found=true;break;}q+=len;}C.check(found,'MISSING_ZIP64_EXTRA');}
   expanded+=size;C.check(expanded<=maxExpanded&&offset+compressed<=cdOffset,'ZIP_RESOURCE_LIMIT');
   const entry={name,method,size,compressed,checksum,offset};
   entry.blob=async()=>{
    const h=new DataView(await blob.slice(offset,offset+30).arrayBuffer());C.check(h.byteLength===30&&h.getUint32(0,true)===0x04034b50,'INVALID_ZIP_LOCAL_HEADER');C.check(h.getUint16(8,true)===method&&!(h.getUint16(6,true)&1),'ZIP_HEADER_MISMATCH');
    const localNameLen=h.getUint16(26,true),extraLen=h.getUint16(28,true),start=offset+30+localNameLen+extraLen;
    C.check(start+compressed<=cdOffset,'ZIP_ENTRY_OUT_OF_BOUNDS');C.check(dec.decode(new Uint8Array(await blob.slice(offset+30,offset+30+localNameLen).arrayBuffer()))===name,'ZIP_NAME_MISMATCH');
    let out=blob.slice(start,start+compressed);
    if(method===8){const reader=out.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks=[];let bytes=0;try{while(true){const x=await reader.read();if(x.done)break;bytes+=x.value.length;C.check(bytes<=size&&bytes<=maxExpanded,'ZIP_EXPANSION_LIMIT');chunks.push(x.value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}out=new Blob(chunks);}
    C.check(out.size===size,'ZIP_SIZE_MISMATCH');C.check(await crc(out)===checksum,'ZIP_CRC_MISMATCH');return out;
   };
   entries.set(name.normalize('NFC'),entry);p+=46+nl+el+cl;
  }
  C.check(p===data.length,'ZIP_DIRECTORY_TRAILING_DATA');return entries;
 }
 async function exportCapture(captureId){
  const capture=await S.get('captures',captureId);C.check(capture,'CAPTURE_NOT_FOUND');
  const rows=await S.assets(captureId),entries=[],paths=new Set(),files=[];
  for(const a of rows){
   const item={key:a.key,messageId:a.messageId,nodeId:a.nodeId,name:a.name,mime:a.mime,kind:a.kind,origin:a.origin||'unknown',authorRole:a.authorRole||'unknown',ref:a.ref,expectedSize:a.expectedSize,state:a.state,reason:a.reason||null,size:a.size||0,sha256:a.sha256||null,inLatestSnapshot:a.inLatestSnapshot!==false};
   if(a.state==='saved'){
    try{const blob=await S.verifiedBlob(a.sha256);const path='assets/'+a.sha256+'.bin';if(!paths.has(path)){entries.push({name:path,blob});paths.add(path);}files.push({...item,path,size:blob.size});}
    catch{files.push({...item,state:'corrupt',reason:'LOCAL_FILE_INTEGRITY_FAILED',path:null});}
   }else files.push({...item,path:null});
  }
  const snapshot=C.persistedSnapshot(capture.snapshot),snapshotBlob=new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}),snapshotHash=await C.hashBlob(snapshotBlob);
  const manifest={schema:'threadline.archive/1',archiveId:capture.id,createdAt:capture.createdAt,exportedAt:new Date().toISOString(),snapshotPath:'conversation.json',snapshotSha256:snapshotHash,saveScope:capture.saveScope||'all',
   state:capture.state==='ready'&&files.every(a=>a.state==='saved'||a.state==='excluded')&&snapshot.integrity.state==='valid'?'ready':'partial',files};
  entries.push({name:'conversation.json',blob:snapshotBlob},{name:'conversation.md',content:C.history(snapshot,{allBranches:true})},{name:'manifest.json',content:JSON.stringify(manifest,null,2)},{name:'diagnostics.json',content:JSON.stringify({schema:1,integrity:snapshot.integrity,files:files.map(a=>({state:a.state,reason:a.reason})),note:'No authentication or signed download URLs are retained.'},null,2)});
  return{blob:await buildZip(entries),manifest};
 }
 async function jsonEntry(entries,name,max=32*1024**2){const e=entries.get(name);C.check(e&&e.size<=max,'MISSING_OR_LARGE_JSON');return JSON.parse(await(await e.blob()).text());}
 function validatedSnapshot(raw){
  C.check(raw?.schema==='threadline.snapshot/1'&&C.record(raw.nodes)&&Array.isArray(raw.messages)&&Array.isArray(raw.assets),'UNRECOGNIZED_SNAPSHOT');
  C.chatUrl(raw.source?.url);const mapping=Object.create(null);
  for(const [key,node] of Object.entries(raw.nodes)){C.check(C.record(node),'INVALID_NODE');mapping[key]={parent:node.parent,children:node.children,message:null};}
  const seen=new Set();for(const m of raw.messages){C.check(C.record(m)&&mapping[m.nodeId]&&typeof m.id==='string'&&typeof m.text==='string'&&!seen.has(m.nodeId),'INVALID_MESSAGE');seen.add(m.nodeId);mapping[m.nodeId].message={id:m.id,author:{role:m.role},content:{parts:[m.text]},metadata:{is_user_visible:true},create_time:m.timestamp};}
  const out=C.normalizeConversation({conversation_id:raw.source.conversationId,title:raw.title,current_node:raw.currentNode,mapping},raw.source.url),messageByNode=new Map(out.messages.map(m=>[m.nodeId,m])),assetKeys=new Set();
  out.assets=raw.assets.map(a=>{
   C.check(C.record(a)&&typeof a.key==='string'&&a.key.length>0&&typeof a.messageId==='string'&&typeof a.nodeId==='string'&&!assetKeys.has(a.key),'INVALID_ASSET_METADATA');
   assetKeys.add(a.key);
   const ref=C.record(a.ref)?a.ref:{scheme:'unsupported'};
   const safeRef=['file-service','sediment'].includes(ref.scheme)&&/^file[-_][A-Za-z0-9_-]+$/.test(ref.fileId||'')?{scheme:ref.scheme,fileId:ref.fileId}:ref.scheme==='sandbox'?C.pointer('sandbox:'+ref.path):{scheme:'unsupported'};
   const message=messageByNode.get(a.nodeId);if(message)C.check(message.id===a.messageId,'ASSET_MESSAGE_NODE_MISMATCH');
   const authorRole=message?.role||(['assistant','user','tool'].includes(a.authorRole)?a.authorRole:'unknown'),origin=authorRole==='assistant'||(authorRole==='tool'&&safeRef.scheme==='sandbox')?'assistant_generated':authorRole==='user'?'user_uploaded':'unknown';
   const kind=safeRef.scheme==='sandbox'?'generated':['upload','image','media'].includes(a.kind)?a.kind:'upload';
   return{key:a.key,messageId:a.messageId,nodeId:a.nodeId,name:C.safeName(a.name),mime:typeof a.mime==='string'?a.mime:'application/octet-stream',kind,origin,authorRole,ref:safeRef,expectedSize:Number.isSafeInteger(a.expectedSize)&&a.expectedSize>=0?a.expectedSize:null,state:'unavailable',reason:'IMPORTED_METADATA_ONLY'};
  });
  for(const m of out.messages){m.assetKeys=out.assets.filter(a=>a.nodeId===m.nodeId).map(a=>a.key);}
  return out;
 }
 async function restore(blob){
  const entries=await readZip(blob),manifest=await jsonEntry(entries,'manifest.json');
  C.check(manifest.schema==='threadline.archive/1'&&manifest.snapshotPath==='conversation.json'&&Array.isArray(manifest.files),'UNRECOGNIZED_ARCHIVE');
  const rawBlob=await entries.get('conversation.json')?.blob();C.check(rawBlob,'SNAPSHOT_MISSING');C.check(await C.hashBlob(rawBlob)===manifest.snapshotSha256,'SNAPSHOT_HASH_MISMATCH');
  const snapshot=validatedSnapshot(JSON.parse(await rawBlob.text())),byKey=new Map(snapshot.assets.map(a=>[a.key,a])),files=[],blobs=new Map(),keys=new Set();
  for(const m of manifest.files){
   C.check(C.record(m)&&typeof m.key==='string'&&!keys.has(m.key),'INVALID_MANIFEST_ASSET');keys.add(m.key);
   const meta=byKey.get(m.key);C.check(meta,'UNKNOWN_MANIFEST_ASSET');
   if(m.state==='saved'){
    C.check(/^[a-f0-9]{64}$/.test(m.sha256||'')&&m.path==='assets/'+m.sha256+'.bin'&&m.size>0,'INVALID_SAVED_FILE');
    const e=entries.get(m.path);C.check(e&&e.size===m.size,'ARCHIVE_FILE_MISSING');const b=await e.blob();C.check(await C.hashBlob(b)===m.sha256,'ARCHIVE_FILE_HASH_MISMATCH');
    blobs.set(m.sha256,new Blob([b],{type:meta.mime}));files.push({...meta,state:'saved',size:b.size,sha256:m.sha256,reason:null,inLatestSnapshot:m.inLatestSnapshot!==false});
   }else if(m.state==='excluded')files.push({...meta,state:'excluded',size:0,sha256:null,reason:'OUT_OF_SAVE_SCOPE'});
   else files.push({...meta,state:'unavailable',size:0,sha256:null,reason:typeof m.reason==='string'&&/^[A-Z0-9_]+$/.test(m.reason)?m.reason:'IMPORTED_FILE_UNAVAILABLE'});
  }
  for(const a of snapshot.assets)C.check(keys.has(a.key),'MANIFEST_ASSET_OMITTED');
  C.check(manifest.saveScope==null||['all','last_generated'].includes(manifest.saveScope),'INVALID_ARCHIVE_SAVE_SCOPE');
  if((manifest.saveScope||'all')==='all')C.check(files.every(a=>a.state!=='excluded'),'INVALID_ALL_SCOPE_EXCLUSIONS');
  if(manifest.saveScope==='last_generated'){
   const selected=new Set(C.selectAssetKeys(snapshot,'last_generated')),active=new Set(snapshot.active||[]),ambiguous=C.lastGeneratedScopeAmbiguous(snapshot),fileByKey=new Map(files.map(a=>[a.key,a]));
   const savedFiles=files.filter(a=>a.state==='saved');
   C.check(savedFiles.length<=1,'INVALID_LAST_GENERATED_SCOPE');
   if(savedFiles.length)C.check(selected.size===1&&savedFiles[0].key===selected.values().next().value,'INVALID_LAST_GENERATED_FILE_SELECTION');
   for(const asset of snapshot.assets){
    const row=fileByKey.get(asset.key);C.check(row,'MANIFEST_ASSET_OMITTED');
    const known=Object.hasOwn(snapshot.nodes,asset.nodeId),isActive=active.has(asset.nodeId),generated=asset.origin==='assistant_generated'||(!asset.origin&&asset.kind==='generated');
    const unresolved=!known?(asset.origin==='unknown'||generated):(isActive&&(asset.origin==='unknown'||(ambiguous&&generated)));
    if(selected.has(asset.key))C.check(row.state!=='excluded','INVALID_LAST_GENERATED_SCOPE_STATE');
    else if(unresolved)C.check(row.state==='unavailable'&&row.reason==='SAVE_SCOPE_SOURCE_UNRESOLVED','INVALID_LAST_GENERATED_UNRESOLVED_STATE');
    else C.check(row.state==='excluded'&&row.reason==='OUT_OF_SAVE_SCOPE','INVALID_LAST_GENERATED_EXCLUDED_STATE');
   }
  }
  const state=manifest.state==='ready'&&snapshot.integrity.state==='valid'&&files.every(a=>a.state==='saved'||a.state==='excluded')?'ready':'partial';
  return S.importCapture(snapshot,files,blobs,state,manifest.saveScope||'all');
 }
 function fileIdentity(value){return String(value||'').replace(/^file[-_]/,'');}
 async function compareOfficial(captureId,zipBlob){
  const rows=await S.assets(captureId),candidates=[];let total=0;
  async function collect(blob,prefix='',depth=0){const entries=await readZip(blob,{maxExpanded:4*1024**3});for(const e of entries.values()){
   if(e.name.endsWith('/'))continue;total+=e.size;C.check(total<=4*1024**3,'OFFICIAL_EXPORT_RESOURCE_LIMIT');
   if(e.name.endsWith('.zip')&&depth<2){await collect(await e.blob(),prefix+e.name+'/',depth+1);continue;}
   const base=e.name.split('/').pop(),stem=base.replace(/\.[^.]+$/,'');candidates.push({path:prefix+e.name,name:base,fileId:/^file[-_]/.test(stem)?fileIdentity(stem):null,entry:e});
  }}
  await collect(zipBlob);const records=[],cache=new Map();
  for(const a of rows){
   if(a.state==='excluded'){records.push({name:a.name,result:'excluded_by_save_scope'});continue;}
   if(a.state!=='saved'){records.push({name:a.name,result:'not_saved_locally'});continue;}
   let matches=a.ref?.fileId?candidates.filter(x=>x.fileId===fileIdentity(a.ref.fileId)):[],basis='file_id';
   if(!matches.length){matches=candidates.filter(x=>x.name===a.name);basis='unique_filename_only';}
   if(matches.length!==1){records.push({name:a.name,result:matches.length?'ambiguous':'not_found_in_recognized_entries',basis});continue;}
   const m=matches[0];let hash=cache.get(m.path);if(!hash){hash=await C.hashBlob(await m.entry.blob());cache.set(m.path,hash);}
   records.push({name:a.name,result:hash===a.sha256?'bytes_match':'bytes_mismatch',basis,entry:m.path,localSha256:a.sha256,officialSha256:hash});
  }
  return{schema:1,checkedAt:new Date().toISOString(),records,note:'Only exact file IDs and unambiguous original filenames are recognized. Unmatched files do not prove absence from the official export. Unknown mapping formats and historical-file availability require a real account sample.'};
 }
 globalThis.TLArchive=Object.freeze({crc,safePath,buildZip,readZip,exportCapture,restore,validatedSnapshot,compareOfficial});
})();
