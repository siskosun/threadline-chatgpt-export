"""Synthetic Chromium MV3 acceptance; no real login, network data, or user files.
Run with xvfb-run -a python tests/browser_e2e.py.
Does not certify the authenticated ChatGPT interface or model reading.
"""
import asyncio
import base64
import hashlib
import io
import json
import tempfile
import traceback
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import zipfile
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
REPORT={'scope':'synthetic_chromium_mv3_not_real_chatgpt','cases':[],'errors':[]}
CID='conversation_fixture_20261101';SOURCE='https://chatgpt.com/c/'+CID

async def wait_async(page, expression, arg=None, timeout=30000):
    """Poll the RESOLVED result. A Promise object itself must not satisfy a wait."""
    loop=asyncio.get_running_loop(); deadline=loop.time()+timeout/1000
    while True:
        result=await page.evaluate(expression,arg)
        if result:
            return result
        if loop.time()>=deadline:
            raise TimeoutError('Resolved asynchronous predicate did not become true: '+expression)
        await asyncio.sleep(0.1)

def xlsx_fixture():
    b=io.BytesIO()
    with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')
        z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>synthetic 42</t></is></c></row></sheetData></worksheet>')
    return b.getvalue()
FILES={
 'file_csv':('data.csv','text/csv',b'id,value\n1,42\n2,77\n'),
 'file_sheet':('research.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xlsx_fixture()),
 'file_image':('diagram.png','image/png',base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1x8AAAAASUVORK5CYII=')),
 'file_second':('data.csv','text/csv',b'id,value\n1,99\n')}
PDF=b'%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
LIVE=b'live-cache-byte-proof-314159'
def conversation(live=False):
    mapping={'root':{'id':'root','parent':None,'children':['n0'],'message':{'id':'system','author':{'role':'system'},'content':{'parts':['NOT_FOR_EXPORT_SECRET']}}}}
    for i in range(120):
        mapping['n'+str(i)]={'id':'n'+str(i),'parent':'root' if i==0 else 'n'+str(i-1),'children':['n'+str(i+1)] if i<119 else [],'message':{'id':'m'+str(i),'author':{'role':'user' if i%2==0 else 'assistant'},'create_time':1700000000+i,'content':{'parts':['known fact at position '+str(i)+': '+str(i*17)]},'metadata':{}}}
    mapping['n0']['message']['metadata']['attachments']=[{'id':k,'name':FILES[k][0],'mime_type':FILES[k][1],'size':len(FILES[k][2])} for k in ['file_csv','file_sheet','file_second']]
    mapping['n2']['message']['content']['parts'].append({'content_type':'image_asset_pointer','asset_pointer':'sediment://file_image'})
    mapping['n2']['message']['metadata']['attachments']=[{'id':'file_image','name':'diagram.png','mime_type':'image/png','size':len(FILES['file_image'][2])}]
    mapping['n3']['message']['content']['parts'].append('[report.pdf](sandbox:/mnt/data/report.pdf)')
    mapping['n5']['message']['content']['parts'].append('[old.pdf](sandbox:/mnt/data/old.pdf)')
    mapping['n6']['message']['metadata']['attachments']=[{'name':'unresolved.pdf'}]
    mapping['n4']['children'].append('alternative')
    mapping['alternative']={'id':'alternative','parent':'n4','children':[],'message':{'id':'m-alt','author':{'role':'assistant'},'content':{'parts':['Alternative conclusion, not the active path.']}}}
    if live:
        mapping['n119']['children']=['live']
        mapping['live']={'id':'live','parent':'n119','children':[],'message':{'id':'m-live','author':{'role':'assistant'},'content':{'parts':['[live.txt](sandbox:/mnt/data/live.txt)']}}}
    return {'conversation_id':CID,'title':'合成研究 · 120 条历史','current_node':'live' if live else 'n119','mapping':mapping}

TARGET_HTML='''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<textarea id="prompt-textarea" rows="8" style="width:500px;max-width:90vw">__DRAFT__</textarea>
<input id="camera" type="file" accept="image/*" capture="environment"><input id="generic" type="file" multiple>
<button id="user-send" onclick="window.sends++">Send (user only)</button><div id="uploads"></div>
<script>
window.sends=0;window.received=[];window.uploadEvents=0;window.mode=__MODE__;
document.getElementById('generic').addEventListener('change',async e=>{
 window.uploadEvents++;
 for(const file of e.target.files){
  const buf=await file.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buf))].map(x=>x.toString(16).padStart(2,'0')).join('');
  window.received.push({name:file.name,size:file.size,sha256:hash,text:file.type.startsWith('text/')?await file.text():null});
  const chip=document.createElement('div');chip.dataset.testid='file-chip';chip.dataset.filename=file.name;chip.textContent=file.name;if(window.mode==='ready')chip.dataset.state='ready';document.getElementById('uploads').append(chip);
 }
});
</script></body></html>'''
SOURCE_HTML='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic source conversation</title></head><body><main><p>Selected synthetic research conversation. No account.</p></main></body></html>'

async def main():
    mode={'live':False,'request_count':0,'write_requests':[],'target_mode':'ready','target_draft':False}
    async def route_handler(route):
        request=route.request;u=urlparse(request.url);p=u.path
        if request.method not in ['GET','HEAD']:
            mode['write_requests'].append({'path':p,'method':request.method})
            return await route.fulfill(status=405,body='READ_ONLY_FIXTURE')
        if p=='/api/auth/session':return await route.fulfill(json={'accessToken':'synthetic-do-not-persist-token','account':{'id':'synthetic-account'}})
        if p=='/backend-api/conversation/'+CID:
            mode['request_count']+=1
            return await route.fulfill(json=conversation(mode['live']))
        if p.startswith('/backend-api/files/download/'):
            fid=p.rsplit('/',1)[1]
            if fid in FILES:return await route.fulfill(json={'download_url':'https://chatgpt.com/backend-api/files/content/'+fid})
        if p.startswith('/backend-api/files/content/'):
            fid=p.rsplit('/',1)[1]
            if fid in FILES:return await route.fulfill(status=200,content_type=FILES[fid][1],body=FILES[fid][2])
        if '/download_from_sandbox' in p or '/interpreter/download' in p:
            path=parse_qs(u.query).get('sandbox_path',[''])[0]
            if path=='/mnt/data/report.pdf':return await route.fulfill(content_type='application/pdf',headers={'Content-Disposition':'attachment; filename=report.pdf'},body=PDF)
            if path=='/mnt/data/live.txt':return await route.fulfill(content_type='text/plain',body=LIVE)
            return await route.fulfill(status=422,content_type='application/json',body='{"error":"fixture unavailable"}')
        if p=='/':return await route.fulfill(content_type='text/html',body=TARGET_HTML.replace('__DRAFT__','USER EXISTING DRAFT' if mode['target_draft'] else '').replace('__MODE__',json.dumps(mode['target_mode'])))
        if p.startswith('/c/'):return await route.fulfill(content_type='text/html',body=SOURCE_HTML)
        return await route.fulfill(status=404,body='UNRECOGNIZED_FIXTURE_ROUTE')
    def passed(name,detail=None):
        REPORT['cases'].append({'name':name,'result':'pass','detail':detail})
        print('PASS',name,flush=True)
    async def launch(pw,profile):
        ctx=await pw.chromium.launch_persistent_context(str(profile),channel='chromium',headless=False,accept_downloads=True,args=['--disable-extensions-except='+str(ROOT/'dist/edge'),'--load-extension='+str(ROOT/'dist/edge'),'--no-sandbox'])
        await ctx.route('https://chatgpt.com/**',route_handler)
        await ctx.route('https://chat.openai.com/**',route_handler)
        worker=ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker')
        return ctx,worker.url.split('/')[2]
    async with async_playwright() as pw:
      with tempfile.TemporaryDirectory(prefix='threadline-cloud-e2e-') as tmp:
        profile=Path(tmp)/'profile';ctx,extension=await launch(pw,profile)
        workspace=None
        try:
            source=await ctx.new_page();await source.goto(SOURCE)
            workspace=await ctx.new_page();await workspace.goto('chrome-extension://'+extension+'/workspace/index.html')
            await workspace.wait_for_function('typeof TLStore!=="undefined"&&typeof TLArchive!=="undefined"')
            await wait_async(workspace,'()=>document.querySelector("#source").value!==""')
            # User-perspective acceptance: one obvious action, plain-language hierarchy, no tab maze.
            assert await workspace.locator('nav').count()==0
            assert await workspace.locator('.view:not([hidden]) .primary:visible').count()==1
            assert not await workspace.locator('#quota').is_visible()
            assert await workspace.locator('details.advanced').first.evaluate('(e)=>!e.open')
            assert await workspace.get_by_role('heading',name='把这段对话，带到新聊天').is_visible()
            assert await workspace.get_by_role('button',name='保存对话').is_visible()
            for width in [320,360,1280]:
                await workspace.set_viewport_size({'width':width,'height':900})
                assert await workspace.evaluate('document.documentElement.scrollWidth<=window.innerWidth+2'),width
                await workspace.screenshot(path=str(OUT/f'ux-home-{width}.png'),full_page=True)
            passed('ux_home_one_primary_action_and_clear_save_task',{'widths':[320,360,1280],'primary_actions':1})
            # Prove the test helper waits for a resolved false-to-true transition.
            await workspace.evaluate('window.fixtureAsyncReady=false;setTimeout(()=>window.fixtureAsyncReady=true,180)')
            await wait_async(workspace,'async()=>window.fixtureAsyncReady')
            assert await workspace.evaluate('window.fixtureAsyncReady') is True
            passed('async_database_waiter_awaits_resolved_predicate')
            await workspace.locator('#capture').scroll_into_view_if_needed()
            await workspace.locator('details.advanced summary').first.click()
            await workspace.locator('#allow-media').uncheck();await workspace.locator('#capture').click()
            await wait_async(workspace,'async()=>{const xs=await TLStore.all("captures");return xs.length>0&&xs[0].snapshot&&["ready","partial"].includes(xs[0].state)}',timeout=90000)
            captures=await workspace.evaluate('TLStore.all("captures")');cap=captures[0];cid=cap['id']
            assert len(cap['snapshot']['messages'])==121 and cap['snapshot']['integrity']['state']=='valid' and cap['state']=='partial',cap
            assets=await workspace.evaluate('id=>TLStore.assets(id)',cid)
            assert len(assets)==7,assets
            saved=[a for a in assets if a['state']=='saved'];missing=[a for a in assets if a['state']!='saved']
            assert len(saved)==5 and len(missing)==2,assets
            assert all(a['sha256'] and a['size']>0 for a in saved)
            expected={hashlib.sha256(v[2]).hexdigest() for v in FILES.values()}|{hashlib.sha256(PDF).hexdigest()}
            assert {a['sha256'] for a in saved}==expected
            assert 'synthetic-do-not-persist-token' not in json.dumps(cap) and 'NOT_FOR_EXPORT_SECRET' not in json.dumps(cap)
            passed('capture_120_messages_all_accessible_branches_real_bytes_and_missing_states',{'saved':5,'unavailable':2})
            await wait_async(workspace,'async()=>{const r=await chrome.runtime.sendMessage({type:"tl:sessions"});return r.ok&&!r.data.length&&!document.querySelector("#continue").hidden}',timeout=30000)
            assert await workspace.locator('#capture').is_hidden()
            assert await workspace.get_by_role('button',name='继续这段对话').is_visible()
            assert await workspace.locator('.view:not([hidden]) .primary:visible').count()==1
            await workspace.get_by_role('button',name='继续这段对话').click()
            assert await workspace.get_by_role('heading',name='继续这段对话').is_visible()
            assert await workspace.locator('.view:not([hidden]) .primary:visible').count()==1
            await workspace.get_by_role('link',name='研线首页').click()
            passed('ux_after_save_replaces_save_action_with_continue_action')
            stored=await workspace.evaluate('''async id=>{
              const out=await TLArchive.exportCapture(id),entries=await TLArchive.readZip(out.blob),files=[];
              for(const m of out.manifest.files)if(m.state==='saved')files.push({name:m.name,sha256:await TLCore.hashBlob(await entries.get(m.path).blob())});
              const before=(await TLStore.all('captures')).length,restored=await TLArchive.restore(out.blob),capture=await TLStore.get('captures',restored),badEntries=[];
              for(const e of entries.values())badEntries.push({name:e.name,blob:await e.blob()});
              badEntries.find(x=>x.name.startsWith('assets/')).blob=new Blob(['TAMPERED']);
              let blocked='';try{await TLArchive.restore(await TLArchive.buildZip(badEntries));}catch(e){blocked=e.message;}
              return{files,before,after:(await TLStore.all('captures')).length,restored,restoredState:capture.state,blocked};
            }''',cid)
            assert stored['after']==stored['before']+1 and stored['restoredState']=='partial',stored
            assert stored['blocked'] in ['ARCHIVE_FILE_MISSING','ARCHIVE_FILE_HASH_MISMATCH'],stored
            assert {x['sha256'] for x in stored['files']}==expected
            passed('zip_roundtrip_restore_and_tamper_rejection_before_capture_commit',stored)
            inner=io.BytesIO()
            with zipfile.ZipFile(inner,'w',zipfile.ZIP_DEFLATED) as z:
                for key,value in FILES.items():z.writestr(key+'.dat',value[2])
                z.writestr('report.pdf',PDF)
            outer=io.BytesIO()
            with zipfile.ZipFile(outer,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('Files-001.zip',inner.getvalue())
            comparison=await workspace.evaluate('async x=>TLArchive.compareOfficial(x.id,new Blob([TLCore.base64ToBytes(x.b64)]))',{'id':cid,'b64':base64.b64encode(outer.getvalue()).decode()})
            assert sum(x['result']=='bytes_match' for x in comparison['records'])==5,comparison
            passed('nested_official_style_zip_fixture_byte_comparison',comparison)
            chunk_result=await workspace.evaluate('''async()=>{
              const model=TLCore.normalizeConversation({conversation_id:'conversation_chunk_001',current_node:'n',mapping:{n:{parent:null,children:[],message:{id:'m',author:{role:'user'},content:{parts:['fixture']},metadata:{attachments:[{id:'file_chunk',name:'chunks.bin'}]}}}}},'https://chatgpt.com/c/conversation_chunk_001');
              const id=TLCore.id();await TLStore.snapshot(id,model);const key=model.assets[0].key;await TLStore.beginAsset(id,key);
              let sequence='';try{await TLStore.chunk(id,key,1,new Uint8Array([1]));}catch(e){sequence=e.message;}
              await TLStore.chunk(id,key,0,new Uint8Array([1,2,3]));await TLStore.recover([]);const a=(await TLStore.assets(id))[0];
              return{sequence,state:a.state,sha256:a.sha256,reason:a.reason};
            }''')
            assert chunk_result['sequence']=='CHUNK_SEQUENCE_MISMATCH' and chunk_result['state']=='unavailable' and chunk_result['sha256'] is None,chunk_result
            passed('indexeddb_sequence_and_interrupted_write_fail_closed',chunk_result)
            start=await workspace.evaluate('''async id=>{
              const r=await chrome.runtime.sendMessage({type:'tl:sources'}),tab=r.data.find(t=>t.url.endsWith('/'+id));
              const s=await chrome.runtime.sendMessage({type:'tl:start',tabId:tab.id,live:true});if(!s.ok)throw Error(s.code);return s.data;
            }''',CID)
            live_id=start['captureId']
            await wait_async(workspace,'async id=>{const c=await TLStore.get("captures",id);return c?.snapshot&&c.live&&["ready","partial"].includes(c.state)}',arg=live_id,timeout=90000)
            mode['live']=True;await source.evaluate('document.querySelector("main").append(document.createTextNode("new generated file available"))')
            await wait_async(workspace,'async id=>(await TLStore.assets(id)).some(a=>a.name==="live.txt"&&a.state==="saved")',arg=live_id,timeout=45000)
            await workspace.evaluate('id=>chrome.runtime.sendMessage({type:"tl:stop",captureId:id})',live_id)
            before_requests=mode['request_count'];await source.evaluate('document.querySelector("main").append(document.createTextNode("after stop"))');await asyncio.sleep(13)
            assert mode['request_count']==before_requests;mode['live']=False
            passed('opt_in_live_generated_file_caching_and_explicit_stop')
            await ctx.close();ctx,extension=await launch(pw,profile)
            source=await ctx.new_page();await source.goto(SOURCE)
            workspace=await ctx.new_page();await workspace.goto('chrome-extension://'+extension+'/workspace/index.html');await workspace.wait_for_function('typeof TLStore!=="undefined"')
            persisted=await workspace.evaluate('async id=>({capture:await TLStore.get("captures",id),assets:await TLStore.assets(id)})',cid)
            assert persisted['capture']['snapshot']['title']==cap['snapshot']['title'] and len([a for a in persisted['assets'] if a['state']=='saved'])==5
            passed('browser_restart_preserves_snapshot_and_binary_blobs')
            async def handoff(target_mode='ready',draft=False):
                mode['target_mode']=target_mode;mode['target_draft']=draft
                h=await workspace.evaluate('''async id=>{
                  const a=(await TLStore.assets(id)).filter(a=>a.state==='saved');
                  const r=await chrome.runtime.sendMessage({type:'tl:prepareHandoff',captureId:id,keys:a.map(a=>a.key),instructions:'Continue with exact file data.',batchLimit:10});if(!r.ok)throw Error(r.code);return r.data;
                }''',cid)
                async with ctx.expect_page() as new_page:
                    response=await workspace.evaluate('id=>chrome.runtime.sendMessage({type:"tl:openHandoff",id})',h['id']);assert response['ok'],response
                target=await new_page.value;await target.wait_for_load_state()
                await wait_async(workspace,'async id=>{const h=await TLStore.get("handoffs",id);return ["upload_confirmed","upload_unknown","injection_blocked","partial_injection"].includes(h.state)}',arg=h['id'],timeout=60000)
                return target,await workspace.evaluate('id=>TLStore.get("handoffs",id)',h['id'])
            target,h=await handoff();assert h['state']=='upload_confirmed',h
            received=await target.evaluate('window.received');assert len(received)==len(h['batches'][0]),received
            assert expected.issubset({x['sha256'] for x in received})
            assert len({x['name'] for x in received})==len(received),'duplicate upload names'
            history=''.join(x['text'] or '' for x in received if x['name'].startswith('conversation_history_'))
            for i in [0,60,119]:assert 'known fact at position '+str(i)+': '+str(i*17) in history
            assert await target.evaluate('window.sends')==0 and await target.locator('#camera').evaluate('(e)=>e.files.length')==0
            assert len(await target.locator('#prompt-textarea').input_value())<4000
            events=await target.evaluate('window.uploadEvents');await target.reload();await asyncio.sleep(2)
            assert await target.evaluate('window.uploadEvents')==0 and events==1
            passed('new_window_receives_verified_bytes_and_early_middle_late_history_without_send')
            passed('handoff_reload_does_not_reinject_camera_untouched_unique_upload_names')
            draft_target,dh=await handoff(draft=True)
            assert dh['state']=='injection_blocked' and dh['lastError']=='USER_DRAFT_PRESENT',dh
            assert await draft_target.locator('#prompt-textarea').input_value()=='USER EXISTING DRAFT'
            assert await draft_target.evaluate('window.uploadEvents')==0
            passed('existing_user_draft_is_not_overwritten')
            unknown_target,uh=await handoff(target_mode='unknown',draft=False)
            assert uh['state']=='upload_unknown',uh
            assert await unknown_target.evaluate('window.sends')==0 and await unknown_target.evaluate('window.uploadEvents')==1
            passed('unrecognized_upload_status_returns_control_without_retry_or_send')
            await workspace.get_by_role('button',name='我的档案').click()
            await workspace.locator('.archive-button').filter(has_text=cap['snapshot']['title']).first.click()
            assert await workspace.locator('.view:not([hidden]) .primary:visible').count()==1
            assert await workspace.get_by_role('button',name='继续这段对话').is_visible()
            for width in [320,360,1280]:
                await workspace.set_viewport_size({'width':width,'height':900})
                await workspace.screenshot(path=str(OUT/f'ux-archive-{width}.png'),full_page=True)
                assert await workspace.evaluate('document.documentElement.scrollWidth<=window.innerWidth+2'),width
            await workspace.get_by_role('button',name='继续这段对话').click()
            assert await workspace.get_by_role('heading',name='继续这段对话').is_visible()
            assert await workspace.locator('.view:not([hidden]) .primary:visible').count()==1
            await workspace.get_by_role('button',name='准备新对话').click()
            await wait_async(workspace,'async()=>!document.querySelector("#handoff-result").hidden&&document.querySelector("#open-target")&&!document.querySelector("#open-target").disabled',timeout=30000)
            assert await workspace.locator('.view:not([hidden]) .primary:visible').count()==1
            assert await workspace.get_by_role('button',name='打开新聊天').is_visible()
            for width in [320,360,1280]:
                await workspace.set_viewport_size({'width':width,'height':900})
                assert await workspace.evaluate('document.documentElement.scrollWidth<=window.innerWidth+2'),width
                await workspace.screenshot(path=str(OUT/f'ux-handoff-{width}.png'),full_page=True)
            passed('ux_archive_and_handoff_each_have_one_clear_next_action',{'widths':[320,360,1280],'primary_actions':1})
            passed('workspace_320_360_1280_reflow_and_screenshots')
            assert not mode['write_requests'],mode['write_requests']
            passed('all_synthetic_source_requests_are_read_only',{'request_count':mode['request_count']})
        except Exception as e:
            REPORT['errors'].append({'message':str(e),'traceback':traceback.format_exc()})
            if workspace:
                try:REPORT['debug']=await workspace.evaluate('async()=>({status:document.querySelector("#status")?.textContent,captures:await TLStore.all("captures"),handoffs:await TLStore.all("handoffs")})')
                except Exception:pass
            for i,page in enumerate(ctx.pages):
                try:await page.screenshot(path=str(OUT/f'failure-{i}.png'),full_page=True)
                except Exception:pass
            raise
        finally:
            REPORT['status']='pass' if not REPORT['errors'] else 'fail'
            (OUT/'browser-report.json').write_text(json.dumps(REPORT,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps({'result':REPORT['status'],'cases':len(REPORT['cases']),'errors':REPORT['errors']},ensure_ascii=False),flush=True)
            await ctx.close()
if __name__=='__main__':asyncio.run(main())
