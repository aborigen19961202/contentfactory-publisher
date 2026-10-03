import test from 'node:test';
import assert from 'node:assert/strict';
let sequence=0;
async function verifier(t,items) {
 t.mock.module('googleapis',{namedExports:{google:{youtube:()=>({videos:{list:async request=>{
  assert.deepEqual(request.id,['video-id']);assert.deepEqual(request.part,['snippet','status']);return {data:{items}};
 }}})}}});
 t.mock.module(new URL('../modules/youtube/auth.mjs',import.meta.url).href,{namedExports:{getAuthenticatedClient:async()=>({})}});
 return (await import(`../modules/youtube/verify.mjs?test=${sequence++}`)).verifyUploadedVideo;
}
test('remote confirmation uses the recorded ID and returns private visibility',async t=>{
 const verify=await verifier(t,[{id:'video-id',snippet:{title:'Topic title'},status:{privacyStatus:'private'}}]);
 assert.deepEqual(await verify({youtube_video_id:'video-id',youtube_uploaded_at:new Date()}),{success:true,videoId:'video-id',title:'Topic title',privacyStatus:'private'});
});
test('missing remote video cannot authorize cleanup',async t=>{
 const verify=await verifier(t,[]);
 await assert.rejects(verify({youtube_video_id:'video-id',youtube_uploaded_at:new Date()}),/UNAVAILABLE/);
 await assert.rejects(verify({youtube_video_id:null}),/NOT_CONFIRMED/);
});
