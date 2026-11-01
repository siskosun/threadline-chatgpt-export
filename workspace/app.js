/* ThreadLine workspace: all user content is rendered with textContent, never HTML. */
(() => {
 'use strict';
 const C=TLCore,S=TLStore,A=TLArchive,$=id=>document.getElementById(id);
 let selectedId=null,selectedKeys=new Set(),handoffId=null,planFingerprint=null,staged=new Map(),view='capture',refreshing=false,messageLimit=100;
 const labels={ready:'可访问快照已保存',partial:'部分保存',capturing:'保存中',interrupted:'已中断',error:'保存失败',cancelled:'已取消',saved:'文件已保存',excluded:'按保存范围跳过',unavailable:'未取得文件字节',discovered:'待下载',downloading:'下载中',corrupt:'本地校验失败',prepared:'接续包已生成',target_opened:'目标窗口已打开',claimed:'准备草稿与文件中',draft_prepared:'草稿已预填',upload_confirmed:'网页确认首批上传',upload_unknown:'首批上传结果未知',injection_blocked:'自动注入已停止',partial_injection:'注入未完整确认',user_verified_upload:'用户已核对首批上传'};
 const errors={CHATGPT_PAGE_NOT_READY:'ChatGPT 页面尚未准备好，请打开原对话后重试。',CHATGPT_LOGIN_REQUIRED:'请先在所选 ChatGPT 标签页登录。',NO_CONVERSATION_ID:'请选择已有的 ChatGPT 对话，而不是空白首页。',SOURCE_ALREADY_RUNNING:'这个对话已有采集在运行，请先停止。',LOCAL_STORAGE_FULL:'本地存储空间不足。已保存的文件保留，请先导出 ZIP 或清理本地档案。',MEDIA_PERMISSION_REQUIRED:'未授予 OpenAI 文件域名权限，正文可保存，但有关文件尚未取得字节。',OUT_OF_SAVE_SCOPE:'该文件未尝试下载，因为它不在本次保存范围内。',SAVE_SCOPE_SOURCE_UNRESOLVED:'文件来源或消息位置无法确认，不能判断它是否为当前分支最后生成文件；未自动下载。',LIVE_CACHE_REQUIRES_ALL_SCOPE:'仅保存最后生成文件不能同时开启实时缓存，请选择全部文件或关闭实时缓存。',USER_DRAFT_PRESENT:'目标窗口已有草稿，自动预填已停止，不会覆盖。',SELECTED_FILE_NOT_SAVED:'所选文件尚未取得实际字节，不能加入接续。',CAPTURE_NOT_READY:'该档案仍在采集，或没有可用快照。',SNAPSHOT_HASH_MISMATCH:'档案快照哈希不匹配，恢复已中止。',ARCHIVE_FILE_HASH_MISMATCH:'归档文件哈希不匹配，恢复已中止。',LOCAL_FILE_HASH_MISMATCH:'本地文件校验失败，不会上传。',UNRECOGNIZED_ARCHIVE:'这不是可识别的研线档案 ZIP。官方导出请使用“对照官方 ZIP”。'};
 function explain(e){const key=e?.message||String(e);return errors[key]||(/^HTTP_\d+$/.test(key)?'远端文件当前不可取得（'+key+'）；不能据此认定文件已永久删除。':key);}
 function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
 function node(tag,text,cls){const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;}
 function button(text,fn,cls){const b=node('button',text,cls);b.type='button';b.addEventListener('click',()=>guard(fn));return b;}
 async function guard(fn){try{return await fn();}catch(e){status(explain(e),true);}}
 async function call(type,data={}){const r=await chrome.runtime.sendMessage({type,...data});if(!r?.ok)throw new Error(r?.code||'EXTENSION_UNAVAILABLE');return r.data;}
 function bytes(n){return n>=1024**3?(n/1024**3).toFixed(2)+' GB':n>=1024**2?(n/1024**2).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':n+' B';}
 function switchView(v){view=v;for(const e of document.querySelectorAll('.view'))e.hidden=e.id!==v+'-view';for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-current',b.dataset.view===v?'page':'false');if(v==='archive')guard(refreshArchives);if(v==='handoff')guard(updateSelection);}
 function fingerprint(){return JSON.stringify([selectedId,[...selectedKeys].sort(),$('instructions').value,$('batch-limit').value]);}
 function invalidate(){if(handoffId&&planFingerprint!==fingerprint()){$('open-target').disabled=true;$('prepare').hidden=false;$('prepare').textContent='重新生成接续包';status('内容已更改，请重新准备。');}}
 async function quota(){const q=await navigator.storage.estimate();$('quota').textContent='本地已用 '+bytes(q.usage||0)+(q.quota?' / 可用配额 '+bytes(q.quota):'');}
 async function sources(){const rows=await call('tl:sources'),old=$('source').value||new URL(location.href).searchParams.get('source');$('source').replaceChildren();if(!rows.length){$('source').append(new Option('未找到已打开的 ChatGPT 对话',''));return;}for(const r of rows)$('source').append(new Option(r.title||r.url,String(r.id)));if(rows.some(r=>String(r.id)===old))$('source').value=old;}
 function updateScopeUI(){const last=$('asset-scope').value==='last_generated',live=$('live');if(last&&live.checked){live.checked=false;status('已关闭实时缓存：仅保存最后生成文件与实时缓存不能同时使用。');}live.disabled=last;$('scope-hint').textContent=last?'对话正文和可访问分支仍完整保存；只下载当前分支中最近一条助手消息生成的一份文件。用户上传文件和其他分支文件会标记为“按保存范围跳过”；来源或位置不明的文件单独标记为未判定。':'对话正文和可访问分支均保存；尝试下载可识别的用户上传文件和助手生成文件。';$('live-hint').textContent=last?'仅保存最后生成文件与实时缓存不兼容。选择“全部文件”后可开启。':'只对选中的对话生效。关闭浏览器或停止后不会自动恢复。';}
 async function start(){
  const tabId=Number($('source').value);C.check(tabId>0,'NO_CONVERSATION_ID');
  $('capture').disabled=true;
  try{
   let allowed=true;if($('allow-media').checked)allowed=await chrome.permissions.request({origins:chrome.runtime.getManifest().optional_host_permissions});
   const scope=$('asset-scope').value,r=await call('tl:start',{tabId,live:$('live').checked,scope});selectedId=r.captureId;selectedKeys.clear();messageLimit=100;
   status(allowed?'已开始保存所选对话。可以保持此页或原对话打开，查看文件状态。':'未授予媒体域名权限：开始保存正文，有关附件可能显示为缺失。');await renderRunning();
  }finally{$('capture').disabled=false;}
 }
 async function renderRunning(){
  const active=await call('tl:sessions'),box=$('running');box.replaceChildren();box.className=active.length?'list':'empty';
  if(!active.length){
   const c=selectedId&&await S.get('captures',selectedId);
   if(c?.snapshot){const first=$('continue').hidden;$('capture').hidden=true;$('continue').hidden=false;$('asset-scope').disabled=false;const rows=await S.assets(selectedId),saved=rows.filter(a=>a.state==='saved').length,excluded=rows.filter(a=>a.state==='excluded').length,missing=rows.filter(a=>a.state!=='saved'&&a.state!=='excluded').length,scope=c.saveScope==='last_generated'?'当前分支最后生成文件':'全部文件';box.textContent='已保存到本地 · '+c.snapshot.messages.length+' 条消息 · 范围：'+scope+' · '+saved+' 个文件已保存，'+excluded+' 个按范围跳过，'+missing+' 个未取得。';if(first)status('对话已保存，可以继续到新聊天。');return;}
   $('capture').hidden=false;$('continue').hidden=true;$('asset-scope').disabled=false;box.textContent='选择一段对话开始保存。';return;
  }
  $('capture').hidden=true;$('continue').hidden=true;$('asset-scope').disabled=true;
  for(const r of active){const c=await S.get('captures',r.captureId),el=node('div',null,'panel');el.append(node('strong',c?.snapshot?.title||c?.title||'正在读取对话'),node('p',r.live?'实时缓存已开启':'正在保存','hint'));
   const rows=await S.assets(r.captureId),saved=rows.filter(a=>a.state==='saved').length,excluded=rows.filter(a=>a.state==='excluded').length,missing=rows.filter(a=>a.state!=='saved'&&a.state!=='excluded').length;el.append(node('p','文件：'+saved+' 个已保存 · '+excluded+' 个按范围跳过 · '+missing+' 个未取得'));
   const actions=node('div',null,'actions');actions.append(button('停止',async()=>{await call('tl:stop',{captureId:r.captureId});await renderRunning();status('已停止。已保存的内容保留。');}));el.append(actions);box.append(el);}
 }
 async function refreshArchives(){
  const list=$('archives'),q=$('search').value.trim().toLowerCase(),rows=(await S.all('captures')).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  list.replaceChildren();for(const c of rows){const title=c.snapshot?.title||c.title||'未完成采集';if(q&&!title.toLowerCase().includes(q))continue;
   const b=button('',()=>choose(c.id),'archive-button');b.setAttribute('aria-pressed',String(selectedId===c.id));b.append(node('strong',title),node('small',(labels[c.state]||c.state)+' · '+String(c.updatedAt||c.createdAt).slice(0,16).replace('T',' ')));list.append(b);}
  if(!list.children.length)list.append(node('p','没有匹配的本地档案。','empty'));
 }
 async function choose(id){if(selectedId!==id){selectedKeys.clear();messageLimit=100;handoffId=null;$('handoff-result').hidden=true;}selectedId=id;await renderDetail();await refreshArchives();await updateSelection();}
 function fileInput(text,onFile){const label=node('label',text,'file-button'),input=document.createElement('input');input.type='file';input.accept='.zip,application/zip';input.addEventListener('change',()=>guard(async()=>{const file=input.files?.[0];if(file)await onFile(file);input.value='';}));label.append(input);return label;}
 async function download(blob,name){
  const url=URL.createObjectURL(blob),notice=node('p','正在请求保存：'+name,'hint');document.querySelector('footer').append(notice);
  try{
   const id=await chrome.downloads.download({url,filename:C.safeName(name),saveAs:true});
   const listen=change=>{if(change.id!==id)return;if(change.state?.current==='complete'){notice.textContent='下载已完成：'+name;cleanup();}else if(change.error||change.state?.current==='interrupted'){notice.textContent='下载未完成：'+name;cleanup();}};
   const cleanup=()=>{chrome.downloads.onChanged.removeListener(listen);URL.revokeObjectURL(url);};
   chrome.downloads.onChanged.addListener(listen);notice.textContent='等待浏览器完成下载：'+name;
   const current=(await chrome.downloads.search({id}))[0];if(current?.state==='complete')listen({id,state:{current:'complete'}});
   setTimeout(cleanup,15*60*1000);return id;
  }catch(e){URL.revokeObjectURL(url);notice.textContent='下载未确认：'+name;throw e;}
 }
 async function renderDetail(){
  const el=$('detail'),c=selectedId&&await S.get('captures',selectedId);el.replaceChildren();if(!c){el.append(node('p','请选择一个本地档案。','empty'));return;}
  const title=c.snapshot?.title||c.title||'读取中';el.append(node('h2',title),node('p',(labels[c.state]||c.state)+(c.live?' · 实时缓存开启':''),'state '+(c.state==='ready'?'good':'warn')));
  if(c.lastError)el.append(node('p',explain(c.lastError),'note'));
  if(!c.snapshot){el.append(node('p','尚未取得对话快照，请查看采集状态。','empty'));return;}
  const snapshot=c.snapshot,rows=await S.assets(c.id),source=node('a','打开源对话');source.href=C.chatUrl(snapshot.source.url).url;source.target='_blank';source.rel='noopener noreferrer';el.append(source);
  const savedCount=rows.filter(a=>a.state==='saved').length,excludedCount=rows.filter(a=>a.state==='excluded').length,missingCount=rows.filter(a=>a.state!=='saved'&&a.state!=='excluded').length,scopeLabel=c.saveScope==='last_generated'?'当前分支最后生成文件':'全部文件';el.append(node('p','保存范围：'+scopeLabel,'hint'),node('p','可见消息 '+snapshot.messages.length+' 条 · 可访问分支叶节点 '+snapshot.integrity.branchCount+' 个 · 文件 '+savedCount+' 个已保存 · '+excludedCount+' 个按范围跳过 · '+missingCount+' 个未取得','hint'));
  const actions=node('div',null,'actions');actions.append(button('下载归档 ZIP',async()=>{status('正在逐一校验文件并生成 ZIP。');const out=await A.exportCapture(c.id);await download(out.blob,C.safeName(title)+'.threadline.zip');status('归档已生成，完整性：'+out.manifest.state+'。下载完成状态见页底。');}),button('继续这段对话',()=>{switchView('handoff');},'primary'),fileInput('对照官方 ZIP',async file=>{status('正在本地读取官方导出，未识别格式不会被当作文件不存在。');const report=await A.compareOfficial(c.id,file);await download(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),'official-comparison.json');status('对照已完成：字节一致 '+report.records.filter(x=>x.result==='bytes_match').length+' / '+report.records.length+'。请查看报告中的未匹配和歧义项。');}));
  if(c.live)actions.append(button('停止实时缓存',async()=>{await call('tl:stop',{captureId:c.id});await renderDetail();}));
  el.append(actions);
  if(snapshot.integrity.issues.length){const d=node('details');d.append(node('summary','分支与内容完整性问题：'+snapshot.integrity.issues.length+' 项'),node('pre',JSON.stringify(snapshot.integrity.issues,null,2)));el.append(d);}
  el.append(node('h3','选择本次接续需要的原始文件'));
  const fileDetails=node('details');fileDetails.append(node('summary','选择要带到新聊天的原始附件'));
  const fileList=node('div',null,'list');
  if(!rows.length)fileList.append(node('p','这份可访问快照中没有识别到文件引用。','hint'));
  for(const a of rows){
   const row=node('div',null,'file-row'),check=document.createElement('input');check.type='checkbox';check.disabled=a.state!=='saved';check.checked=selectedKeys.has(a.key);check.setAttribute('aria-label','选择 '+a.name);check.dataset.assetKey=a.key;
   check.addEventListener('change',()=>{check.checked?selectedKeys.add(a.key):selectedKeys.delete(a.key);guard(updateSelection);invalidate();});
   const origin=a.origin==='assistant_generated'||(!a.origin&&a.kind==='generated')?'助手生成':a.origin==='user_uploaded'?'用户上传':'来源未确认';const info=node('div');info.append(node('strong',a.name),node('span',labels[a.state]||a.state,'state '+(a.state==='saved'?'good':'warn')),node('small',origin+' · '+a.mime+' · '+bytes(a.size||0)+' · 消息 '+a.messageId));
   if(a.reason)info.append(node('p',explain(a.reason),'hint'));
   if(a.state==='saved'){const buttons=node('div',null,'actions');buttons.append(button('下载原件',async()=>download(await S.verifiedBlob(a.sha256),a.name)));info.append(buttons);const d=node('details');d.append(node('summary','查看 SHA-256'),node('pre',a.sha256));info.append(d);}
   row.append(check,info);fileList.append(row);
  }
  fileDetails.append(fileList);el.append(fileDetails);
  const d=node('details');d.append(node('summary','阅读当前分支历史（'+snapshot.active.length+' 个节点）'));
  const byNode=new Map(snapshot.messages.map(m=>[m.nodeId,m])),messages=snapshot.active.map(n=>byNode.get(n)).filter(Boolean);
  for(const m of messages.slice(0,messageLimit)){const block=node('div',null,'message');block.append(node('strong',m.role+' · '+m.id),node('pre',m.text||'（仅附件）'));d.append(block);}
  if(messages.length>messageLimit)d.append(button('再显示 100 条',async()=>{messageLimit+=100;await renderDetail();}));el.append(d);
  el.append(button('删除此本地档案',async()=>{if(!confirm('仅删除扩展中的这份本地档案，不会删除 ChatGPT 对话。尚未导出 ZIP 的文件可能失去本地副本。确认删除？'))return;await call('tl:stop',{captureId:c.id});await S.removeCapture(c.id);selectedId=null;selectedKeys.clear();el.replaceChildren(node('p','本地档案已删除。'));await refreshArchives();await quota();},'danger'));
 }
 async function updateSelection(){const c=selectedId&&await S.get('captures',selectedId),rows=c?.snapshot?await S.assets(c.id):[],excluded=rows.filter(a=>a.state==='excluded').length,missing=rows.filter(a=>a.state!=='saved'&&a.state!=='excluded').length;$('handoff-source').textContent=c?.snapshot?'来源：'+c.snapshot.title:'先在本地档案中选择来源。';$('selection-summary').textContent='已选择 '+selectedKeys.size+' 个原始文件。完整当前分支历史将另行生成附件；未选择或不可用的原始文件不会自动上传。'+(excluded?'本档案按保存范围跳过 '+excluded+' 个文件。':'')+(missing?'另有 '+missing+' 个文件未取得实际字节。':'');$('prepare').disabled=!c?.snapshot||c.state==='capturing';}
 async function prepare(){
  C.check(selectedId,'CAPTURE_NOT_READY');status('正在校验接续文件。');
  const h=await call('tl:prepareHandoff',{captureId:selectedId,keys:[...selectedKeys],instructions:$('instructions').value,batchLimit:Number($('batch-limit').value)});
  handoffId=h.id;planFingerprint=fingerprint();await renderHandoff(h);status('接续包已准备。将只在新的普通聊天中操作，发送由你完成。');
 }
 async function renderHandoff(h){
  $('handoff-result').hidden=false;$('prepare').hidden=true;$('prompt').textContent=h.prompt;$('confirmed').checked=false;$('open-target').disabled=h.state!=='prepared';$('focus-target').disabled=!h.targetTabId;
  const box=$('staging');box.replaceChildren();staged=new Map();
  for(let batch=0;batch<h.batches.length;batch++){
   box.append(node('h3','第 '+(batch+1)+' 批（'+h.batches[batch].length+' 个文件）'));
   for(const i of h.batches[batch]){const f=h.files[i],blob=await S.verifiedBlob(f.sha256),file=new File([blob],f.uploadName||f.name,{type:f.mime});staged.set(i,file);
    const row=node('div',null,'staged');row.draggable=true;row.append(node('strong',file.name),node('small',bytes(file.size)+' · '+(f.kind==='history'?'历史记录':'原始附件')));
    row.addEventListener('dragstart',e=>{try{e.dataTransfer.items.add(file);e.dataTransfer.effectAllowed='copy';}catch{status('此浏览器未允许跨页文件拖拽，请使用下载后手动上传。',true);}});
    row.append(button('下载文件',()=>download(file,file.name)));box.append(row);
   }
   const indices=h.batches[batch];box.append(button('下载第 '+(batch+1)+' 批',async()=>download(await A.buildZip(indices.map(i=>({name:staged.get(i).name,blob:staged.get(i)}))),'handoff-batch-'+(batch+1)+'.zip')));
  }
  if(h.missing.length)box.append(node('p','原档案仍有 '+h.missing.length+' 个文件不可用，未作为空附件注入。','note'));if(h.excluded?.length)box.append(node('p','原档案按保存范围跳过 '+h.excluded.length+' 个文件；如需这些文件，请重新保存全部文件。','note'));
  await renderHandoffState();
 }
 async function renderHandoffState(){
  if(!handoffId)return;const h=await S.get('handoffs',handoffId);if(!h)return;
  $('handoff-state').textContent=(labels[h.state]||h.state)+(h.lastError?' · '+explain(h.lastError):'')+(h.batches.length>1?'；另有 '+(h.batches.length-1)+' 批必须手动补充。':'');
  $('open-target').disabled=h.state!=='prepared'||planFingerprint!==fingerprint();$('focus-target').disabled=!h.targetTabId;
  $('confirm-upload').disabled=!['upload_unknown','upload_confirmed','draft_prepared'].includes(h.state);
 }
 async function downloadHandoff(){
  C.check(handoffId,'HANDOFF_NOT_PREPARED');const h=await S.get('handoffs',handoffId),entries=[];
  for(let b=0;b<h.batches.length;b++)for(const i of h.batches[b]){const f=h.files[i];entries.push({name:'batch-'+String(b+1).padStart(3,'0')+'/'+C.safeName(f.uploadName||f.name),blob:await S.verifiedBlob(f.sha256)});}
  entries.push({name:'handoff_prompt.md',content:h.prompt},{name:'handoff_manifest.json',content:JSON.stringify({schema:1,files:h.files,batches:h.batches,missing:h.missing,excluded:h.excluded||[],note:'A prepared pack is not proof of webpage upload or model reading.'},null,2)});
  await download(await A.buildZip(entries),'threadline-handoff.zip');status('接续包已生成。请解压后上传实际文件，不要假设 ChatGPT 一定能读取 ZIP 内的全部内容。');
 }
 for(const b of document.querySelectorAll('[data-view]'))b.onclick=e=>{e.preventDefault();switchView(b.dataset.view);};
 $('refresh-source').onclick=()=>guard(sources);$('capture').onclick=()=>guard(start);$('source').onchange=()=>{selectedId=null;$('capture').hidden=false;$('continue').hidden=true;guard(renderRunning);};$('asset-scope').onchange=updateScopeUI;$('continue').onclick=()=>guard(async()=>{await choose(selectedId);switchView('handoff');});$('refresh').onclick=()=>guard(async()=>{await refreshArchives();if(selectedId)await renderDetail();});
 $('search').oninput=()=>guard(refreshArchives);$('prepare').onclick=()=>guard(prepare);$('instructions').oninput=invalidate;$('batch-limit').onchange=invalidate;
 $('restore').onchange=()=>guard(async()=>{const f=$('restore').files?.[0];if(!f)return;status('校验档案结构、CRC 和文件哈希。校验全部通过后才写入档案。');const id=await A.restore(f);$('restore').value='';await choose(id);switchView('archive');status('档案已恢复。保留原有缺失状态，不会因恢复而变成完整。');await quota();});
 $('open-target').onclick=()=>guard(async()=>{C.check(planFingerprint===fingerprint(),'REGENERATE_HANDOFF_AFTER_CHANGES');const h=await call('tl:openHandoff',{id:handoffId});await renderHandoffState();status('新聊天已打开。请核对文件，再由你手动发送。');});
 $('focus-target').onclick=()=>guard(()=>call('tl:focusTarget',{id:handoffId}));$('download-handoff').onclick=()=>guard(downloadHandoff);
 $('confirm-upload').onclick=()=>guard(async()=>{C.check($('confirmed').checked,'USER_CONFIRMATION_REQUIRED');await call('tl:confirmUpload',{id:handoffId,confirmed:true});await renderHandoffState();status('已记录首批上传的人工核对。未代你发送消息，也未认证模型已完整读取。');});
 $('persist').onclick=()=>guard(async()=>{const yes=await navigator.storage.persist();status(yes?'浏览器已允许保留本地存储。仍建议下载独立 ZIP。':'浏览器未授予持久化存储。请保留独立 ZIP 备份。');await quota();});
 setInterval(()=>{if(refreshing)return;refreshing=true;Promise.resolve().then(async()=>{if(view==='capture')await renderRunning();if(handoffId)await renderHandoffState();}).catch(()=>{}).finally(()=>refreshing=false);},1500);
 guard(async()=>{await S.open();updateScopeUI();await sources();await refreshArchives();await quota();await updateSelection();status('就绪。选择一个 ChatGPT 对话开始保存。');});
})();
