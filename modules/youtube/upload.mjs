import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { getAuthenticatedClient } from './auth.mjs';

/**
 * Uploads a video file and optional thumbnail to YouTube via streaming.
 *
 * @param {Object} options
 * @param {string} [options.videoPath] - Absolute or relative path to the MP4 file
 * @param {Object} [options.videoSource] - Streaming source with name, sizeBytes and open()
 * @param {function} [options.onBeforeUpload] - Persist upload-start marker
 * @param {function} [options.onUploaded] - Persist returned video ID before follow-up work
 * @param {string} [options.thumbnailPath] - Absolute or relative path to the PNG/JPG thumbnail
 * @param {string} options.title - YouTube video title
 * @param {string} [options.description=''] - YouTube video description
 * @param {string[]|string} [options.tags=[]] - Video tags
 * @param {'private'|'unlisted'|'public'} [options.privacy='unlisted'] - Privacy status
 * @param {string} [options.publishAt] - ISO 8601 string for scheduled release (forces private status)
 * @param {number|string} [options.categoryId=27] - YouTube category (default: 27 Education)
 * @param {function} [options.onProgress] - Optional progress callback
 * @returns {Promise<{ videoId: string, url: string, title: string, privacyStatus: string, thumbnailSet: boolean }>}
 */
export async function uploadVideo(options) {
  const {
    videoPath,
    videoSource,
    onUploaded,
    onBeforeUpload,
    thumbnailPath,
    title,
    description = '',
    tags = [],
    privacy = process.env.YOUTUBE_DEFAULT_PRIVACY || 'private',
    publishAt,
    categoryId = process.env.YOUTUBE_DEFAULT_CATEGORY_ID || 27,
    channel,
    proxy,
    onProgress,
  } = options;

  if (!videoPath && !videoSource) {
    throw new Error('[YouTube Upload] Missing required parameter: videoPath');
  }

  const resolvedVideoPath = videoPath ? path.resolve(videoPath) : null;
  if (!videoSource && !fs.existsSync(resolvedVideoPath)) {
    throw new Error(`[YouTube Upload] Video file not found: ${resolvedVideoPath}`);
  }

  if (!title) {
    throw new Error('[YouTube Upload] Missing required parameter: title');
  }

  const oauth2Client = await getAuthenticatedClient({ channel, proxy });
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  const fileStats = videoSource ? { size: videoSource.sizeBytes } : fs.statSync(resolvedVideoPath);
  const fileSizeMb = (fileStats.size / (1024 * 1024)).toFixed(2);
  console.log(`[YouTube Upload] Starting streaming upload: "${videoSource?.name || path.basename(resolvedVideoPath)}" (${fileSizeMb} MB)...`);
  if (channel) console.log(`[YouTube Upload] Target channel profile: "${channel}"`);
  if (proxy) console.log(`[YouTube Upload] Network proxy active: "${proxy}"`);

  const parsedTags = Array.isArray(tags)
    ? tags
    : typeof tags === 'string'
      ? tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

  const requestBody = {
    snippet: {
      title,
      description,
      tags: parsedTags,
      categoryId: String(categoryId),
    },
    status: {
      privacyStatus: publishAt ? 'private' : privacy,
      selfDeclaredMadeForKids: false,
    },
  };

  if (publishAt) {
    requestBody.status.publishAt = new Date(publishAt).toISOString();
    console.log(`[YouTube Upload] Video scheduled for release at: ${requestBody.status.publishAt}`);
  }

  let lastReportedPercent = -1;
  const body = videoSource ? await videoSource.open() : fs.createReadStream(resolvedVideoPath);
  let res;
  try {
    if (onBeforeUpload) await onBeforeUpload();
    res = await youtube.videos.insert(
      {
        part: ['snippet', 'status'],
        requestBody,
        media: {
          body,
        },
      },
      {
        retry: false,
        onUploadProgress: (evt) => {
          const percent = Math.floor((evt.bytesRead / fileStats.size) * 100);
          if (percent !== lastReportedPercent && (percent % 5 === 0 || percent === 100)) {
            lastReportedPercent = percent;
            const readMb = (evt.bytesRead / (1024 * 1024)).toFixed(1);
            console.log(`[YouTube Upload] ⏳ Uploading: ${percent}% (${readMb} / ${fileSizeMb} MB)`);
          }
          if (onProgress) {
            onProgress(percent, evt.bytesRead, fileStats.size);
          }
        },
      }
    );

  } finally { body.destroy(); }

  const videoId = res.data.id;
  if (!videoId) throw Error('YOUTUBE_VIDEO_ID_MISSING');
  if (onUploaded) await onUploaded(videoId);
  const videoUrl = `https://youtu.be/${videoId}`;
  console.log(`[YouTube Upload] ✅ Video uploaded successfully! ID: ${videoId} | URL: ${videoUrl}`);

  let thumbnailSet = false;

  // Set custom thumbnail if provided
  if (thumbnailPath) {
    const resolvedThumbPath = path.resolve(thumbnailPath);
    if (fs.existsSync(resolvedThumbPath)) {
      try {
        console.log(`[YouTube Upload] Setting custom thumbnail: "${path.basename(resolvedThumbPath)}"...`);
        await youtube.thumbnails.set({
          videoId,
          media: {
            body: fs.createReadStream(resolvedThumbPath),
          },
        });
        thumbnailSet = true;
        console.log(`[YouTube Upload] ✅ Thumbnail uploaded and attached.`);
      } catch (thumbErr) {
        console.error(`[YouTube Upload] ⚠️ Warning: Failed to set thumbnail (${thumbErr.message}). Video is still uploaded.`);
      }
    } else {
      console.warn(`[YouTube Upload] ⚠️ Thumbnail path provided but file not found: ${resolvedThumbPath}`);
    }
  }

  return {
    videoId,
    url: videoUrl,
    title,
    privacyStatus: requestBody.status.privacyStatus,
    publishAt: requestBody.status.publishAt || null,
    thumbnailSet,
  };
}
