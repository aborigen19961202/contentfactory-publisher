import path from 'node:path';
import {createReadStream} from 'node:fs';
import {lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadStoredSource} from '../google-drive/source.mjs';

export async function loadPublicationSource(pool,jobId,attempt,{root=process.env.RENDERER_DIR || '/home/aborigen/projects/3dcharts-remotion'}={}) {
 const output=(await pool.query('SELECT * FROM public.render_outputs WHERE render_job_id=$1 AND render_attempt=$2',[jobId,attempt])).rows[0];
 if(!output)return null;
 if(output.delivery_target!=='youtube')return loadStoredSource(pool,jobId,attempt,{root});
 const file=path.resolve(output.local_path);
 const verify=async()=>{
  const base=await realpath(root),relative=path.relative(base,file).split(path.sep);
  if(relative.length!==5||relative[0]!=='output'||relative[1]!=='task-engine'||!/^[0-9a-f-]{36}$/i.test(relative[2])
    ||relative[3]!==`job-${jobId}-attempt-${attempt}`||relative[4]!=='master.mp4'||await realpath(file)!==file)throw Error('UNSAFE_LOCAL_VIDEO_SOURCE');
  const info=await lstat(file);
  if(!info.isFile()||info.size!==Number(output.size_bytes))throw Error('LOCAL_VIDEO_SIZE_MISMATCH');
  const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);
  if(hash.digest('hex')!==output.sha256)throw Error('LOCAL_VIDEO_HASH_MISMATCH');
 };
 return {output,name:path.basename(file),sizeBytes:Number(output.size_bytes),localPath:file,
  verify,open:async()=>{await verify();return createReadStream(file);}};
}

export async function loadPublicationContext(pool,{topicId,outputId}={}) {
 if(outputId) {
  if(!/^[0-9a-f-]{36}$/i.test(outputId))throw Error('INVALID_VIDEO_OUTPUT_ID');
  return (await pool.query(`SELECT t.id,t.title,t.youtube_tags,t.topic_context,
   j.output_path AS render_output_path,j.id AS render_job_id,r.render_attempt
   FROM public.render_outputs r JOIN public.render_jobs j ON j.id=r.render_job_id
   JOIN public.topics t ON t.id=j.topic_id WHERE r.id=$1 AND j.status='completed'`,[outputId])).rows[0];
 }
 return (await pool.query(`SELECT t.id,t.title,t.youtube_tags,t.topic_context,
  j.output_path AS render_output_path,j.id AS render_job_id,j.attempts AS render_attempt
  FROM public.topics t LEFT JOIN LATERAL (SELECT id,attempts,output_path FROM public.render_jobs
   WHERE topic_id=t.id AND status='completed' ORDER BY id DESC LIMIT 1) j ON true WHERE t.id=$1`,[topicId])).rows[0];
}
