import { google } from 'googleapis';
import { uploadVideo } from './upload.mjs';
import { getAuthenticatedClient } from './auth.mjs';

/**
 * High-level YouTube publisher function.
 *
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function publishToYouTube(options) {
  return await uploadVideo(options);
}

/**
 * Fetches authenticated channel profile details.
 */
export async function getChannelInfo(options = {}) {
  const auth = await getAuthenticatedClient(options);
  const youtube = google.youtube({ version: 'v3', auth });

  const res = await youtube.channels.list({
    part: ['snippet', 'statistics'],
    mine: true,
  });

  if (!res.data.items || res.data.items.length === 0) {
    throw new Error('No YouTube channel found for the authenticated account.');
  }

  const channel = res.data.items[0];
  return {
    id: channel.id,
    title: channel.snippet.title,
    description: channel.snippet.description,
    customUrl: channel.snippet.customUrl || null,
    publishedAt: channel.snippet.publishedAt,
    subscriberCount: channel.statistics.subscriberCount,
    videoCount: channel.statistics.videoCount,
    viewCount: channel.statistics.viewCount,
  };
}

/**
 * Verifies if valid credentials and authentication tokens are active.
 */
export async function verifyYouTubeAuth(options = {}) {
  try {
    const info = await getChannelInfo(options);
    return { ok: true, channel: info };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export { uploadVideo, getAuthenticatedClient };

