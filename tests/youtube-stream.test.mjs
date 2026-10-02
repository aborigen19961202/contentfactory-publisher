import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
let sequence=0;
async function adapter(t,youtube) {
 t.mock.module('googleapis',{namedExports:{google:{youtube:()=>youtube}}});
 t.mock.module(new URL('../modules/youtube/auth.mjs',import.meta.url).href,{namedExports:{getAuthenticatedClient:async()=>({})}});
 return (await import(`../modules/youtube/upload.mjs?test=${sequence++}`)).uploadVideo;
}
test('Drive bytes go straight to YouTube; acknowledgement precedes thumbnail follow-up',async t=>{
 const order=[],stream=Readable.from([Buffer.from('video bytes')]);
 const dir=await mkdtemp(path.join(tmpdir(),'youtube-stream-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const thumbnail=path.join(dir,'thumb.jpg');await writeFile(thumbnail,'thumbnail');
 const upload=await adapter(t,{videos:{insert:async request=>{
  order.push('insert');const chunks=[];for await(const b of request.media.body)chunks.push(b);
  assert.equal(Buffer.concat(chunks).toString(),'video bytes');return {data:{id:'video-id'}};
 }},thumbnails:{set:async()=>{order.push('thumbnail');}}});
 const result=await upload({title:'Test',privacy:'private',thumbnailPath:thumbnail,videoSource:{name:'drive-master',sizeBytes:11,open:async()=>stream},
  onBeforeUpload:async()=>{order.push('start');},onUploaded:async id=>{assert.equal(id,'video-id');order.push('ack');}});
 assert.equal(result.videoId,'video-id');assert.deepEqual(order,['start','insert','ack','thumbnail']);assert(stream.destroyed);
});
test('unavailable Drive source never writes an ambiguous YouTube-start marker',async t=>{
 let started=false,called=false;
 const upload=await adapter(t,{videos:{insert:async()=>{called=true;}}});
 await assert.rejects(upload({title:'Test',videoSource:{name:'video',sizeBytes:1,open:async()=>{throw Error('DRIVE_MISSING');}},
  onBeforeUpload:async()=>{started=true;}}),/DRIVE_MISSING/);
 assert.equal(started,false);assert.equal(called,false);
});
test('an API failure destroys the streaming body and sends no successful acknowledgement',async t=>{
 let acknowledged=false;const stream=Readable.from([Buffer.alloc(20)]);
 const upload=await adapter(t,{videos:{insert:async()=>{throw Error('API_FAILED');}}});
 await assert.rejects(upload({title:'Test',videoSource:{name:'video',sizeBytes:20,open:async()=>stream},onUploaded:async()=>{acknowledged=true;}}),/API_FAILED/);
 assert.equal(acknowledged,false);assert(stream.destroyed);
});
