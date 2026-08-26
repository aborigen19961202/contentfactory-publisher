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
 * Verifies if valid credentials and authentication tokens are active.
 */
export async function verifyYouTubeAuth() {
  try {
    const client = await getAuthenticatedClient();
    return { ok: true, message: 'YouTube credentials and tokens are valid.' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export { uploadVideo, getAuthenticatedClient };
