import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadPublicationSource,loadPublicationContext} from '../modules/publication/source.mjs';

async function fixture(t) {
 const root=await mkdtemp(path.join(tmpdir(),'local-video-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const dir=path.join(root,'output/task-engine/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/job-1-attempt-1');await mkdir(dir,{recursive:true});
 const file=path.join(dir,'master.mp4');await writeFile(file,'video');
 const output={delivery_target:'youtube',local_path:file,size_bytes:5,sha256:createHash('sha256').update('video').digest('hex')};
 const pool={query:async()=>({rows:[output]})};return {root,file,output,pool};
}
test('registered local master is verified and streamed; no Drive request is made',async t=>{
 const f=await fixture(t),source=await loadPublicationSource(f.pool,1,1,{root:f.root});
 const bytes=[];for await(const chunk of await source.open())bytes.push(chunk);
 assert.equal(Buffer.concat(bytes).toString(),'video');
 await writeFile(f.file,'other');await assert.rejects(source.open(),/HASH_MISMATCH/);
});
test('another attempt and a symlink cannot substitute bytes for the registered master',async t=>{
 const f=await fixture(t);
 await assert.rejects((await loadPublicationSource(f.pool,1,2,{root:f.root})).verify(),/UNSAFE/);
 const target=path.join(f.root,'other-directory');await mkdir(target);await writeFile(path.join(target,'master.mp4'),'video');
 await rm(path.dirname(f.file),{recursive:true});await symlink(target,path.dirname(f.file),process.platform==='win32'?'junction':'dir');
 await assert.rejects((await loadPublicationSource(f.pool,1,1,{root:f.root})).verify(),/UNSAFE/);
});
test('executor selects one exact output instead of a newer render for the same topic',async()=>{
 let query,params;const context={id:14,render_job_id:11,render_attempt:1};
 const pool={query:async(sql,args)=>{query=sql;params=args;return {rows:[context]};}};
 const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';assert.equal(await loadPublicationContext(pool,{outputId:id}),context);
 assert.match(query,/WHERE r.id=\$1/);assert.deepEqual(params,[id]);
 await assert.rejects(loadPublicationContext(pool,{outputId:'not-a-uuid'}),/INVALID/);
});
