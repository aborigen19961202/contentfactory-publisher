import path from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';

export async function loadStoredSource(pool,jobId,attempt,{root=process.env.RENDERER_DIR || '/home/aborigen/projects/3dcharts-remotion'}={}) {
 const output=(await pool.query('SELECT * FROM public.render_outputs WHERE render_job_id=$1 AND render_attempt=$2',[jobId,attempt])).rows[0];
 if(!output)return null; // Existing videos keep their original local-file path.
 if(output.drive_state!=='verified')throw Error('VIDEO_TRANSFER_NOT_READY');
 const {createGoogleDriveClient}=await import(pathToFileURL(path.join(root,'scripts/lib/google-drive.mjs')).href);
 const {openDriveVideo,verifyDriveVideo}=await import(pathToFileURL(path.join(root,'scripts/lib/drive-video.mjs')).href);
 const drive=await createGoogleDriveClient();
 return {output,name:`job-${jobId}-attempt-${attempt}-master.mp4`,sizeBytes:Number(output.size_bytes),
  open:()=>openDriveVideo(drive,output),verify:()=>verifyDriveVideo(drive,output)};
}

async function writeReceipt(file,receipt) {
 await mkdir(path.dirname(file),{recursive:true,mode:0o700});
 await writeFile(`${file}.part`,JSON.stringify(receipt),{mode:0o600});
 await rename(`${file}.part`,file);
}

// Persist the YouTube acknowledgement before topic updates or notifications.
// An ambiguous upload requires inspection rather than creating a duplicate.
export async function publishStoredVideo({pool,source,publish,options,stateDir=path.join(homedir(),'.local/state/contentfactory-publisher')}) {
 const id=source.output.id;
 if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('INVALID_VIDEO_OUTPUT_ID');
 const client=await pool.connect();let locked=false;
 const file=path.join(stateDir,`${id}.json`);
 try {
  locked=(await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,7341)) AS locked",[id])).rows[0].locked;
  if(!locked)throw Error('VIDEO_PUBLICATION_ACTIVE');
  const current=(await client.query('SELECT * FROM public.render_outputs WHERE id=$1',[id])).rows[0];
  let receipt;
  try {receipt=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(receipt&&receipt.outputId!==id)throw Error('YOUTUBE_RECEIPT_IDENTITY_MISMATCH');
  if(receipt&&receipt.channel!==(options.channel || null))throw Error('YOUTUBE_RECEIPT_CHANNEL_MISMATCH');
  const acknowledge=async videoId=>client.query(`UPDATE public.render_outputs SET youtube_video_id=$2,youtube_uploaded_at=now()
    WHERE id=$1 AND youtube_video_id IS NULL`,[id,videoId]);
  const videoId=current.youtube_video_id || receipt?.videoId;
  if(videoId) {
   if(current.youtube_video_id&&receipt?.videoId&&current.youtube_video_id!==receipt.videoId)throw Error('YOUTUBE_RECEIPT_IDENTITY_MISMATCH');
   await acknowledge(videoId);
   return {videoId,url:`https://youtu.be/${videoId}`,privacyStatus:receipt?.privacyStatus || options.privacy,recovered:true};
  }
  if(receipt?.state==='uploading')throw Error('YOUTUBE_UPLOAD_NEEDS_RECONCILIATION');
  return await publish({...options,videoSource:source,
   onBeforeUpload:()=>writeReceipt(file,{outputId:id,state:'uploading',channel:options.channel || null}),
   onUploaded:async videoId=>{
    await writeReceipt(file,{outputId:id,state:'uploaded',videoId,channel:options.channel || null,
      privacyStatus:options.publishAt?'private':options.privacy});
    await acknowledge(videoId);
   }});
 } finally {
  if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,7341))',[id]).catch(()=>{});
  client.release();
 }
}
