import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {publishStoredVideo,loadStoredSource} from '../modules/google-drive/source.mjs';
async function fixture(t) {
 const stateDir=await mkdtemp(path.join(tmpdir(),'publish-receipt-test-'));t.after(()=>rm(stateDir,{recursive:true,force:true}));
 const output={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',youtube_video_id:null};let failAck=false;
 const client={release:()=>{},query:async(sql,args)=>{
  if(sql.includes('pg_try_advisory'))return {rows:[{locked:true}]};
  if(sql.startsWith('SELECT *'))return {rows:[output]};
  if(sql.startsWith('UPDATE')){if(failAck)throw Error('DB_ACK_LOST');output.youtube_video_id=args[1];}
  return {rows:[]};
 }};
 return {pool:{connect:async()=>client},source:{output},options:{privacy:'private'},stateDir,failAck:v=>{failAck=v;}};
}
test('a lost DB acknowledgement recovers YouTube ID without a second API upload',async t=>{
 const f=await fixture(t);let calls=0;const publish=async options=>{calls++;await options.onBeforeUpload();await options.onUploaded('video-id');return {videoId:'video-id'};};
 f.failAck(true);await assert.rejects(publishStoredVideo({...f,publish}),/DB_ACK_LOST/);
 f.failAck(false);const recovered=await publishStoredVideo({...f,publish});assert.equal(calls,1);assert.equal(recovered.videoId,'video-id');assert.equal(f.source.output.youtube_video_id,'video-id');
});
test('ambiguous YouTube upload blocks automatic duplicate creation',async t=>{
 const f=await fixture(t);let calls=0;const publish=async options=>{calls++;await options.onBeforeUpload();throw Error('CONNECTION_LOST');};
 await assert.rejects(publishStoredVideo({...f,publish}),/CONNECTION_LOST/);
 await assert.rejects(publishStoredVideo({...f,publish}),/NEEDS_RECONCILIATION/);assert.equal(calls,1);
});
test('an unverified newest output cannot fall back to a legacy local video',async()=>{
 const pool={query:async()=>({rows:[{drive_state:'failed'}]})};
 await assert.rejects(loadStoredSource(pool,1,1),/VIDEO_TRANSFER_NOT_READY/);
 assert.equal(await loadStoredSource({query:async()=>({rows:[]})},1,1),null);
});
