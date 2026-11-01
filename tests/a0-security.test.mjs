import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const manifest=JSON.parse(read('manifest.json'));
const content=read('src/content.js'),picker=read('src/picker.js'),popup=read('popup/popup.js'),html=read('popup/popup.html'),background=read('src/background.js');
const hosts=['https://oaiusercontent.com/*','https://*.oaiusercontent.com/*','https://oaistatic.com/*','https://*.oaistatic.com/*','https://images.openai.com/*'];
function destructive(source){return /\bmethod\s*:\s*['"](?:DELETE|PATCH|PUT)['"]/i.test(source)||/is_visible\s*:\s*false/.test(source)||/action\s*[:=]+\s*['"](?:delete|export-delete)['"]/.test(source);}
test('manifest uses a narrow OpenAI media-host allowlist',()=>{
 assert.deepEqual(manifest.host_permissions,['https://chatgpt.com/*','https://chat.openai.com/*']);
 assert.deepEqual(manifest.optional_host_permissions,hosts);
 assert.equal(JSON.stringify(manifest).includes('<all_urls>'),false);
 assert.equal(manifest.name,'ThreadLine Archive');
});
test('content script has no destructive conversation or project API path',()=>{
 for(const forbidden of ['deleteConversationPermanently','autoDeleteExported','autoDeleteProjectsAfterExport','projectDeletionCandidates','managerDeletedDuringScan','pendingDeletion','autoDeleteAfterExport'])assert.equal(content.includes(forbidden),false,forbidden);
 assert.equal(destructive(content),false);
 assert.match(content,/x\.action==='export'/);
});
test('destructive guard accepts GET project lookup but rejects DELETE and PATCH',()=>{
 assert.equal(destructive("apiGet('/backend-api/gizmos/project-1')"),false);
 for(const sample of ["authFetch('/backend-api/gizmos/project-1',0,null,true,{method:'DELETE'})","fetch('/backend-api/conversation/x',{method: 'PATCH',body: {is_visible:false}})","{action:'export-delete'}"]){assert.equal(destructive(sample),true,sample);}
});
test('picker exposes export and review only, never destructive controls',()=>{
 for(const forbidden of ['Delete conversations','Delete these','runDelete','openConfirm','pendingDeletion','autoDelete','action: "delete"','action: "export-delete"'])assert.equal(picker.includes(forbidden),false,forbidden);
 assert.match(picker,/History export finished/);
 assert.match(picker,/This exported list is for review only/);
});
test('popup has no deletion UI or all-site permission request',()=>{
 for(const forbidden of ['autoDelete','ALL_SITES','<all_urls>','review-delete','auto-delete-after-export'])assert.equal(popup.includes(forbidden),false,forbidden);
 for(const forbidden of ['auto-delete','delete-projects','confirm-auto-delete','review-delete'])assert.equal(html.includes(forbidden),false,forbidden);
 assert.match(popup,/EXTERNAL_MEDIA_HOSTS/);
});
test('all shipped classic JavaScript parses, independent of string guards',()=>{
 for(const dir of ['src','popup'])for(const file of fs.readdirSync(path.join(ROOT,dir))){if(file.endsWith('.js'))new vm.Script(read(dir+'/'+file),{filename:dir+'/'+file});}
});
test('background validates sender and media host before fetch',async()=>{
 const listeners=[],calls=[];
 const api={runtime:{id:'test-extension',onMessage:{addListener:fn=>listeners.push(fn)}}};
 vm.runInNewContext(background,{browser:api,URL,AbortController,setTimeout,clearTimeout,Uint8Array,btoa,String,Error,Promise,fetch:async(url,options)=>{calls.push({url,options});return{ok:true,headers:{get:()=> 'application/octet-stream'},arrayBuffer:async()=>new TextEncoder().encode('asset').buffer};}});
 const handle=listeners[0];let response;
 for(const url of ['https://attacker.example/a','http://files.oaiusercontent.com/a','https://files.oaiusercontent.com.attacker.example/a']){
  assert.equal(handle({type:'cgx-fetch',url},{id:api.runtime.id},x=>response=x),false);
  assert.equal(response.ok,false);assert.equal(calls.length,0);
 }
 assert.equal(handle({type:'cgx-fetch',url:'https://files.oaiusercontent.com/a'},{id:'other'},()=>assert.fail('other sender')),false);
 assert.equal(handle({type:'cgx-fetch',url:'https://files.oaiusercontent.com/a'},{id:api.runtime.id},x=>response=x),true);
 await new Promise(r=>setTimeout(r,0));assert.equal(response.ok,true);
 assert.equal(calls.length,1);assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.referrerPolicy,'no-referrer');
});
test('built Edge package carries restricted manifest and non-destructive scripts',()=>{
 const edge=path.join(ROOT,'dist','edge');assert.equal(fs.existsSync(edge),true);
 const built=JSON.parse(fs.readFileSync(path.join(edge,'manifest.json'),'utf8'));assert.deepEqual(built.optional_host_permissions,hosts);
 const c=fs.readFileSync(path.join(edge,'src','content.js'),'utf8');assert.equal(destructive(c),false);
 assert.equal(fs.readFileSync(path.join(edge,'src','picker.js'),'utf8').includes('runDelete'),false);
});
