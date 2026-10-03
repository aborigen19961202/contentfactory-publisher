import {google} from 'googleapis';
import {getAuthenticatedClient} from './auth.mjs';

export async function verifyUploadedVideo(output,options={}) {
 if(!output?.youtube_video_id||!output.youtube_uploaded_at)throw Error('YOUTUBE_UPLOAD_NOT_CONFIRMED');
 const auth=await getAuthenticatedClient(options);
 const youtube=google.youtube({version:'v3',auth});
 const response=await youtube.videos.list({id:[output.youtube_video_id],part:['snippet','status']});
 const video=response.data.items?.find(v=>v.id===output.youtube_video_id);
 if(!video)throw Error('YOUTUBE_VIDEO_UNAVAILABLE');
 return {success:true,videoId:video.id,privacyStatus:video.status?.privacyStatus,title:video.snippet?.title};
}
