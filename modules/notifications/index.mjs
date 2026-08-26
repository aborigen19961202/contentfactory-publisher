import {
  sendTelegramMessage,
  notifyPublishSuccess,
  notifyPublishFailure,
} from './telegram.mjs';

/**
 * Universal notification dispatcher.
 *
 * @param {Object} payload
 * @param {boolean} payload.success
 * @param {number|string} payload.topicId
 * @param {string} payload.topicTitle
 * @param {string} [payload.videoUrl]
 * @param {string} [payload.privacyStatus]
 * @param {number} [payload.durationSeconds]
 * @param {string} [payload.error]
 */
export async function notifyPublishResult(payload) {
  if (payload.success) {
    return await notifyPublishSuccess(payload);
  } else {
    return await notifyPublishFailure(payload);
  }
}

export { sendTelegramMessage, notifyPublishSuccess, notifyPublishFailure };
