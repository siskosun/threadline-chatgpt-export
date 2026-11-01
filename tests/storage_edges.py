"""Cloud-only IndexedDB regression on the actual MV3 extension origin.
No ChatGPT connection, account, user files, or in-memory database substitute.
"""
import asyncio
import json
import tempfile
import traceback
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results'; OUT.mkdir(exist_ok=True)

CASES=r'''async()=>{
 const C=TLCore,S=TLStore,report=[];
 function check(ok,message){if(!ok)throw Error(message);}
 async function rejects(fn,expected){let found='';try{await fn();}catch(e){found=e.message;}check(found===expected,'Expected '+expected+'; received '+found);}
 function model(label,size=null){
  const conversation_id='conversation_storage_'+label;
  return C.normalizeConversation({conversation_id,title:'Synthetic storage '+label,current_node:'n',mapping:{n:{parent:null,children:[],message:{id:'m',author:{role:'user'},content:{parts:['synthetic source']},metadata:{attachments:[{id:'file_shared',name:'data.bin',mime_type:'application/octet-stream',...(size===null?{}:{size})}]}}}}},'https://chatgpt.com/c/'+conversation_id);
 }
 async function save(label,bytes){
  const id=C.id(),snapshot=model(label,bytes.length);await S.snapshot(id,snapshot);
  const key=snapshot.assets[0].key;await S.beginAsset(id,key);await S.chunk(id,key,0,bytes);
  const asset=await S.finishAsset(id,key,'application/octet-stream');await S.finishCapture(id);
  return{id,key,asset};
 }
 const bytes=new TextEncoder().encode('shared-file-byte-proof'),a=await save('a',bytes),b=await save('b',bytes);
 check(a.asset.sha256===b.asset.sha256,'Identical files must be content-addressed');
 const exclusive=await S.putBlob(new Blob(['only-handoff-a']));
 const common={name:'data.bin',mime:'application/octet-stream',sha256:a.asset.sha256,size:bytes.length};
 await S.set('handoffs',{id:'ha',captureId:a.id,state:'prepared',files:[common,{name:'history.md',mime:'text/markdown',...exclusive}],batches:[[0,1]]});
 await S.set('handoffs',{id:'hb',captureId:b.id,state:'prepared',files:[common],batches:[[0]]});
 await S.removeCapture(a.id);
 check(!await S.get('captures',a.id),'Deleted capture remains');
 check(!await S.get('handoffs','ha'),'Deleted capture handoff remains');
 check(!!await S.get('handoffs','hb'),'Other capture handoff was deleted');
 check((await S.verifiedBlob(a.asset.sha256)).size===bytes.length,'Shared file was lost');
 check(!await S.get('files',exclusive.sha256),'Exclusive deleted-handoff file was retained');
 report.push({name:'delete_archive_invalidates_its_handoffs_and_preserves_shared_bytes',result:'pass'});
 await rejects(()=>S.set('handoffs',{id:'ha-late',captureId:a.id,state:'prepared',files:[common]}),'HANDOFF_SOURCE_DELETED');
 await rejects(()=>S.set('handoffs',{id:'missing-file',captureId:b.id,state:'prepared',files:[{name:'missing',sha256:'f'.repeat(64),size:5}]}),'LOCAL_FILE_MISSING');
 check(!await S.get('handoffs','ha-late')&&!await S.get('handoffs','missing-file'),'Failed transaction wrote a dangling handoff');
 report.push({name:'handoff_commit_rejects_missing_source_or_missing_binary',result:'pass'});
 await S.removeCapture(b.id);
 check(!await S.get('handoffs','hb')&&!await S.get('files',b.asset.sha256),'Last reference deletion did not remove file');
 report.push({name:'last_reference_removal_reclaims_file_without_global_stale_gc',result:'pass'});
 const c=await save('race',bytes);
 await Promise.allSettled([S.removeCapture(c.id),S.set('handoffs',{id:'race-handoff',captureId:c.id,state:'prepared',files:[common]})]);
 check(!await S.get('captures',c.id)&&!await S.get('handoffs','race-handoff'),'Concurrent deletion left an active handoff');
 check(!await S.get('files',c.asset.sha256),'Concurrent deletion left a referenced orphan');
 report.push({name:'concurrent_handoff_commit_and_archive_deletion_are_serialized',result:'pass'});
 const id=C.id(),snapshot=model('active');await S.snapshot(id,snapshot);const key=snapshot.assets[0].key;
 await rejects(()=>S.removeCapture(id),'STOP_CAPTURE_BEFORE_DELETE');
 check(!!await S.get('captures',id),'Active capture was removed');
 await S.beginAsset(id,key);await rejects(()=>S.finishAsset(id,key,'application/octet-stream'),'MISSING_ASSET_CHUNKS');
 await rejects(()=>S.chunk(id,key,0,new Uint8Array()),'INVALID_CHUNK');
 await rejects(()=>S.chunk(id,key,0,new Uint8Array(262145)),'INVALID_CHUNK');
 await S.chunk(id,key,0,new Uint8Array([1,2,3]));
 await rejects(()=>S.chunk(id,key,0,new Uint8Array([4])),'CHUNK_SEQUENCE_MISMATCH');
 await S.recover([]);const interrupted=(await S.assets(id))[0];
 check(interrupted.state==='unavailable'&&interrupted.sha256===null,'Interrupted file was falsely marked saved');
 report.push({name:'active_delete_empty_chunks_duplicate_sequence_and_interruption_fail_closed',result:'pass'});
 const mismatchId=C.id(),mismatch=model('mismatch',100);await S.snapshot(mismatchId,mismatch);const mk=mismatch.assets[0].key;
 await S.beginAsset(mismatchId,mk);await S.chunk(mismatchId,mk,0,new Uint8Array([1,2,3]));
 await rejects(()=>S.finishAsset(mismatchId,mk,'application/octet-stream'),'SOURCE_SIZE_MISMATCH');
 await S.failAsset(mismatchId,mk,'SOURCE_SIZE_MISMATCH');
 check((await S.assets(mismatchId))[0].state==='unavailable','Size mismatch became saved');
 report.push({name:'declared_source_size_mismatch_never_creates_saved_asset',result:'pass'});
 const d=await save('corruption',bytes);
 await S.set('files',{sha256:d.asset.sha256,blob:new Blob([new Uint8Array(bytes.length)]),size:bytes.length});
 await rejects(()=>S.verifiedBlob(d.asset.sha256),'LOCAL_FILE_HASH_MISMATCH');
 report.push({name:'same_size_local_corruption_is_rejected_before_upload',result:'pass'});
 return report;
}'''

async def main():
    result={'scope':'real_chromium_indexeddb_synthetic_data_only','cases':[],'status':'fail'}
    async with async_playwright() as pw:
      with tempfile.TemporaryDirectory(prefix='threadline-storage-') as profile:
        context=await pw.chromium.launch_persistent_context(profile,channel='chromium',headless=False,args=['--disable-extensions-except='+str(ROOT/'dist/edge'),'--load-extension='+str(ROOT/'dist/edge'),'--no-sandbox'])
        try:
            await context.route('http://**',lambda route:route.abort())
            await context.route('https://**',lambda route:route.abort())
            worker=context.service_workers[0] if context.service_workers else await context.wait_for_event('serviceworker')
            extension=worker.url.split('/')[2]
            page=await context.new_page();await page.goto('chrome-extension://'+extension+'/workspace/index.html')
            await page.wait_for_function('typeof TLStore!=="undefined"')
            ready=await page.evaluate('chrome.runtime.sendMessage({type:"tl:sessions"})')
            assert ready['ok'],ready
            result['cases']=await page.evaluate(CASES)
            result['status']='pass'
            for case in result['cases']:print('PASS',case['name'],flush=True)
        except Exception as e:
            result['error']={'message':str(e),'traceback':traceback.format_exc()}
            raise
        finally:
            (OUT/'storage-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps(result,ensure_ascii=False),flush=True)
            await context.close()
if __name__=='__main__':asyncio.run(main())
