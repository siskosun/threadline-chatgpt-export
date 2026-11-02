import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const name of ['tl-core.js','tl-archive.js'])vm.runInThisContext(fs.readFileSync(path.join(root,'src',name),'utf8'),{filename:name});
const C=globalThis.TLCore,A=globalThis.TLArchive,source='https://chatgpt.com/c/conversation_fixture_01';
function fixture(count=120){
 assert.ok(count>=1);const mapping=Object.create(null);mapping.root={id:'root',parent:null,children:['n0'],message:{id:'hidden',author:{role:'system'},content:{parts:['HIDDEN_SYSTEM_SECRET']}}};
 for(let i=0;i<count;i++)mapping['n'+i]={id:'n'+i,parent:i?'n'+(i-1):'root',children:i<count-1?['n'+(i+1)]:[],message:{id:'m'+i,author:{role:i%2?'assistant':'user'},create_time:1700000000+i,content:{parts:['message '+i]}}};
 const parent='n'+Math.min(3,count-1);mapping[parent].children.push('alt');mapping.alt={id:'alt',parent,children:[],message:{id:'alternative',author:{role:'assistant'},content:{parts:['ALTERNATE_BRANCH']}}};
 return{conversation_id:'conversation_fixture_01',title:'Synthetic research',current_node:'n'+(count-1),mapping};
}
const snapshot=()=>C.normalizeConversation(fixture(),source);
test('SHA-256 matches node reference for empty, padding boundaries and binary streams',()=>{
 for(const n of [0,1,55,56,63,64,65,127,128,129,1024,1024*1024]){const input=new Uint8Array(randomBytes(n)),expected=createHash('sha256').update(input).digest('hex'),h=new C.SHA256();for(let i=0;i<n;i+=37)h.update(input.subarray(i,i+37));assert.equal(h.hex(),expected,'length='+n);}
 assert.equal(new C.SHA256().update('abc').hex(),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('Blob hash streams a multi-megabyte payload',async()=>{const block=new Uint8Array(262144).fill(19),blob=new Blob(Array(64).fill(block));assert.equal(await C.hashBlob(blob),createHash('sha256').update(new Uint8Array(await blob.arrayBuffer())).digest('hex'));});
test('120-message current branch and alternatives survive without hidden system content',()=>{
 const s=snapshot();assert.equal(s.messages.length,121);assert.equal(s.active.length,121);assert.equal(s.integrity.branchCount,2);assert.equal(s.integrity.state,'valid');assert.equal(JSON.stringify(s).includes('HIDDEN_SYSTEM_SECRET'),false);assert.equal(C.history(s).includes('ALTERNATE_BRANCH'),false);assert.equal(C.history(s,{allBranches:true}).includes('ALTERNATE_BRANCH'),true);
});
test('hidden analysis bodies are not retained even when they appear in the accessible mapping',()=>{
 const f=fixture();f.mapping.n5.message.channel='analysis';f.mapping.n5.message.content.parts=['HIDDEN_INTERNAL_REASONING'];const s=C.normalizeConversation(f,source);assert.equal(JSON.stringify(s).includes('HIDDEN_INTERNAL_REASONING'),false);assert.ok(s.nodes.n5);
});
test('broken parents, cycles, duplicate message IDs and missing current node never imply complete',()=>{
 for(const mutate of [f=>f.mapping.n20.parent='missing',f=>{f.mapping.n0.parent='n1';f.mapping.n1.parent='n0';},f=>f.mapping.n8.message.id=f.mapping.n7.message.id,f=>f.current_node='missing']){const f=fixture();mutate(f);const s=C.normalizeConversation(f,source);assert.equal(s.integrity.state,'partial');assert.ok(s.integrity.issues.length);}
});
test('prototype-like node IDs are retained only as data and cannot mutate the graph object',()=>{
 const f=fixture(2);Object.defineProperty(f.mapping,'__proto__',{enumerable:true,value:{parent:'root',children:[],message:{id:'strange',author:{role:'assistant'},content:{parts:['data']}}}});f.mapping.root.children.push('__proto__');const s=C.normalizeConversation(f,source);assert.ok(Object.hasOwn(s.nodes,'__proto__'));assert.equal(Object.getPrototypeOf(s.nodes),null);
});
test('asset schemes and sandbox traversal are distinguished',()=>{
 assert.deepEqual(C.pointer('sediment://file_test'),{scheme:'sediment',fileId:'file_test'});assert.deepEqual(C.pointer('file-service://file-test'),{scheme:'file-service',fileId:'file-test'});assert.deepEqual(C.pointer('sandbox:/mnt/data/result.csv'),{scheme:'sandbox',path:'/mnt/data/result.csv'});
 for(const x of ['sandbox:/etc/passwd','sandbox:/mnt/data/../secret','sandbox:/mnt/data/%2e%2e/secret'])assert.equal(C.pointer(x).scheme,'unsupported');
});
test('last-generated scope selects the latest assistant file on the active branch only',()=>{
 const f=fixture(8);
 f.mapping.n0.message.metadata={attachments:[{id:'file_user',name:'upload.pdf'}]};
 f.mapping.n1.message.content.parts.push('[first.csv](sandbox:/mnt/data/first.csv)');
 f.mapping.n3.message.metadata={attachments:[{id:'file_middle',name:'middle.xlsx'}]};
 f.mapping.n7.message.content.parts.push('[latest.txt](sandbox:/mnt/data/latest.txt)');
 f.mapping.alt.message.content.parts.push('[inactive.pdf](sandbox:/mnt/data/inactive.pdf)');
 const s=C.normalizeConversation(f,source),byName=new Map(s.assets.map(a=>[a.name,a]));
 assert.equal(byName.get('upload.pdf').origin,'user_uploaded');
 assert.equal(byName.get('middle.xlsx').origin,'assistant_generated');
 assert.deepEqual(C.selectAssetKeys(s,'all'),s.assets.map(a=>a.key));
 assert.deepEqual(C.selectAssetKeys(s,'last_generated'),[byName.get('latest.txt').key]);
 assert.equal(C.selectAssetKeys(s,'last_generated').includes(byName.get('inactive.pdf').key),false);
 assert.throws(()=>C.selectAssetKeys(s,'unknown'),/INVALID_SAVE_SCOPE/);
});
test('last-generated scope does not substitute a user upload when no assistant output exists',()=>{const f=fixture(2);f.mapping.n0.message.metadata={attachments:[{id:'file_user_only',name:'user-only.pdf'}]};const s=C.normalizeConversation(f,source);assert.equal(s.assets[0].origin,'user_uploaded');assert.deepEqual(C.selectAssetKeys(s,'last_generated'),[]);});
test('earlier unknown tool pointers do not displace a later known assistant output',()=>{const f=fixture(8);f.mapping.n4.message.author.role='tool';f.mapping.n4.message.metadata={is_user_visible:true,attachments:[{id:'file_tool_unknown',name:'tool-output.txt'}]};f.mapping.n7.message.content.parts.push('[latest.txt](sandbox:/mnt/data/latest.txt)');const s=C.normalizeConversation(f,source),tool=s.assets.find(a=>a.name==='tool-output.txt'),latest=s.assets.find(a=>a.name==='latest.txt');assert.equal(tool.origin,'unknown');assert.equal(C.lastGeneratedScopeAmbiguous(s),false);assert.deepEqual(C.selectAssetKeys(s,'last_generated'),[latest.key]);});
test('later unresolved active-branch files block guessing an earlier latest-generated file',()=>{const f=fixture(10);f.mapping.n7.message.content.parts.push('[known.txt](sandbox:/mnt/data/known.txt)');f.mapping.n9.message.author.role='tool';f.mapping.n9.message.metadata={is_user_visible:true,attachments:[{id:'file_later_unknown',name:'later-unknown.txt'}]};const s=C.normalizeConversation(f,source),known=s.assets.find(a=>a.name==='known.txt'),unknown=s.assets.find(a=>a.name==='later-unknown.txt');s.assets=[unknown,known];assert.equal(C.lastGeneratedScopeAmbiguous(s),true);assert.deepEqual(C.selectAssetKeys(s,'last_generated'),[]);s.assets.push({key:'unmapped',nodeId:'missing-node',origin:'unknown',kind:'upload'});assert.equal(C.lastGeneratedScopeAmbiguous(s),true);assert.deepEqual(C.selectAssetKeys(s,'last_generated'),[]);});
test('unmapped user uploads do not block a known latest assistant file',()=>{const f=fixture(8);f.mapping.n7.message.content.parts.push('[latest.txt](sandbox:/mnt/data/latest.txt)');const s=C.normalizeConversation(f,source);s.assets.push({key:'orphan-user-upload',nodeId:'missing-node',origin:'user_uploaded',kind:'upload'});assert.equal(C.lastGeneratedScopeAmbiguous(s),false);assert.deepEqual(C.selectAssetKeys(s,'last_generated'),[s.assets.find(a=>a.name==='latest.txt').key]);});
test('assistant files on inactive branches do not count as active generated output',()=>{const f=fixture(8);f.mapping.alt.message.content.parts.push('[inactive-only.txt](sandbox:/mnt/data/inactive-only.txt)');const s=C.normalizeConversation(f,source);assert.equal(C.lastGeneratedScopeAmbiguous(s),false);assert.deepEqual(C.selectAssetKeys(s,'last_generated'),[]);});
test('named attachment without a downloadable pointer is explicitly unavailable',()=>{
 const f=fixture(2);f.mapping.n0.message.metadata={attachments:[{name:'report.pdf'}]};const s=C.normalizeConversation(f,source);assert.equal(s.assets.length,1);assert.equal(s.assets[0].state,'unavailable');assert.throws(()=>C.handoff(s,s.assets,[s.assets[0].key]),/SELECTED_FILE_NOT_SAVED/);
});
test('sediment and metadata references to the same file within one message are deduplicated',()=>{
 const f=fixture(2);f.mapping.n0.message.content.parts.push({content_type:'image_asset_pointer',asset_pointer:'sediment://file_image'});f.mapping.n0.message.metadata={attachments:[{id:'file_image',name:'image.png',mime_type:'image/png'}]};const s=C.normalizeConversation(f,source);assert.equal(s.assets.length,1);assert.equal(s.assets[0].name,'image.png');
});
test('visible structured text is retained, not silently discarded with audio wrappers',()=>{
 const f=fixture(2);f.mapping.n0.message.content.parts=[{content_type:'text_audio',text:'spoken visible words'}];assert.match(C.normalizeConversation(f,source).messages[0].text,/spoken visible words/);
});
test('signed download credentials do not enter persisted snapshots',()=>{
 const f=fixture(2);f.mapping.n0.message.metadata={attachments:[{name:'report.pdf',url:'https://files.oaiusercontent.com/report?sig=SECRET'}]};const s=C.normalizeConversation(f,source);assert.equal(s.assets[0].ephemeralUrl.includes('SECRET'),true);assert.equal(JSON.stringify(C.persistedSnapshot(s)).includes('SECRET'),false);
});
test('auth request policy is read-only and media URLs reject credential and suffix tricks',()=>{
 C.readOnlyRequest('GET');C.readOnlyRequest('HEAD');for(const method of ['POST','PATCH','DELETE','PUT'])assert.throws(()=>C.readOnlyRequest(method),/WRITE_REQUEST_REJECTED/);
 for(const u of ['https://evil.test/a','https://files.oaiusercontent.com.evil.test/a','https://user:pass@files.oaiusercontent.com/a','http://files.oaiusercontent.com/a','https://files.oaiusercontent.com:444/a'])assert.throws(()=>C.mediaUrl(u));assert.equal(C.mediaUrl('https://files.oaiusercontent.com/a').hostname,'files.oaiusercontent.com');
});
test('new-chat policy rejects existing, temporary, project and unknown query destinations',()=>{
 C.chatUrl('https://chatgpt.com/',{target:true});C.chatUrl('https://chatgpt.com/?model=test',{target:true});for(const u of ['https://chatgpt.com/c/conversation_abc','https://chatgpt.com/g/project','https://chatgpt.com/?temporary-chat=true','https://chatgpt.com/?unknown=1'])assert.throws(()=>C.chatUrl(u,{target:true}));
});
test('long histories become numbered files, not composer text, and 21 originals are batched',()=>{
 const s=snapshot(),rows=Array.from({length:21},(_,i)=>({key:'file'+i,name:'document'+i+'.txt',state:'saved',size:4,sha256:'a'.repeat(64),mime:'text/plain'})),p=C.handoff(s,rows,rows.map(x=>x.key),'Continue the synthetic task',10,1200);
 assert.ok(p.files.filter(f=>f.kind==='history').length>1);assert.ok(p.batches.length>=3);assert.ok(p.batches.every(b=>b.length<=10));assert.ok(p.prompt.length<2000);assert.equal(p.prompt.includes('message 50'),false);assert.ok(p.files.filter(f=>f.kind==='history').map(f=>f.text).join('').includes('message 50'));
});
test('missing original files are listed but never represented by empty upload objects',()=>{const s=snapshot(),p=C.handoff(s,[{key:'x',name:'lost.pdf',state:'unavailable',reason:'HTTP_422'}],[]);assert.equal(p.files.some(f=>f.name==='lost.pdf'),false);assert.equal(p.missing.length,1);});
test('intentionally excluded assets are not reported as missing during handoff',()=>{const s=snapshot(),rows=[{key:'saved',name:'kept.pdf',state:'saved',size:1,sha256:'a'.repeat(64),mime:'application/pdf'},{key:'skip',name:'skip.pdf',state:'excluded',reason:'OUT_OF_SAVE_SCOPE'},{key:'lost',name:'lost.pdf',state:'unavailable',reason:'HTTP_422'}],p=C.handoff(s,rows,['saved']);assert.equal(p.missing.length,1);assert.equal(p.missing[0].name,'lost.pdf');assert.equal(p.excluded.length,1);assert.equal(p.excluded[0].name,'skip.pdf');});
test('ZIP roundtrip preserves unicode paths and binary payloads',async()=>{
 const data=new Uint8Array([0,1,127,128,255]),zip=await A.buildZip([{name:'manifest.json',content:'{}'},{name:'assets/资料.bin',blob:new Blob([data])}]),entries=await A.readZip(zip);assert.equal(entries.size,2);assert.deepEqual(new Uint8Array(await(await entries.get('assets/资料.bin').blob()).arrayBuffer()),data);
});
test('CRC validation rejects payload corruption before restore',async()=>{
 const zip=await A.buildZip([{name:'payload.bin',content:'known-content'}]),data=new Uint8Array(await zip.arrayBuffer());data[30+'payload.bin'.length]^=1;const entries=await A.readZip(new Blob([data]));await assert.rejects(()=>entries.get('payload.bin').blob(),/ZIP_CRC_MISMATCH/);
});
test('ZIP reader rejects truncated archives and zip-slip or duplicate names',async()=>{
 await assert.rejects(()=>A.buildZip([{name:'../escape',content:'x'}]),/UNSAFE_ZIP_PATH/);await assert.rejects(()=>A.buildZip([{name:'same',content:'x'},{name:'same',content:'y'}]),/DUPLICATE_ZIP_PATH/);const zip=await A.buildZip([{name:'safe',content:'x'}]);await assert.rejects(()=>A.readZip(zip.slice(0,zip.size-4)),/ZIP_END_NOT_FOUND/);
});
test('ZIP64 end records can describe small test entries without allocating gigabytes',async()=>{
 const original=await A.buildZip([{name:'x',content:'abc'}]),bytes=new Uint8Array(await original.arrayBuffer()),end=new DataView(bytes.buffer,bytes.length-22),offset=end.getUint32(16,true),size=end.getUint32(12,true),z=new DataView(new ArrayBuffer(56));
 z.setUint32(0,0x06064b50,true);z.setBigUint64(4,44n,true);z.setUint16(12,45,true);z.setUint16(14,45,true);z.setBigUint64(24,1n,true);z.setBigUint64(32,1n,true);z.setBigUint64(40,BigInt(size),true);z.setBigUint64(48,BigInt(offset),true);
 const l=new DataView(new ArrayBuffer(20));l.setUint32(0,0x07064b50,true);l.setBigUint64(8,BigInt(bytes.length-22),true);l.setUint32(16,1,true);end.setUint16(8,65535,true);end.setUint16(10,65535,true);end.setUint32(12,0xffffffff,true);end.setUint32(16,0xffffffff,true);
 const zip=new Blob([bytes.subarray(0,bytes.length-22),z.buffer,l.buffer,bytes.subarray(bytes.length-22)]),entries=await A.readZip(zip);assert.equal(await(await entries.get('x').blob()).text(),'abc');
});
test('workspace renders user data as text and never provides an automatic send action',()=>{
 const ui=fs.readFileSync(path.join(root,'workspace/app.js'),'utf8'),inject=fs.readFileSync(path.join(root,'src/tl-inject.js'),'utf8');assert.equal(/\.innerHTML\s*=/.test(ui),false);assert.equal(/(?:send-button|submit).*\.click\s*\(/i.test(inject),false);assert.match(inject,/HANDOFF_FILE_HASH_MISMATCH/);assert.match(inject,/USER_DRAFT_PRESENT/);
});
