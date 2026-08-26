import dotenv from 'dotenv';

dotenv.config();

/**
 * Sends a notification message to Telegram.
 *
 * @param {string} text - Formatted HTML/text message
 * @returns {Promise<boolean>}
 */
export async function sendTelegramMessage(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.log('[Notification] Telegram credentials not configured. Skipping alert.');
    return false;
  }

  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      console.warn(`[Notification] Telegram API error: ${data.description}`);
      return false;
    }

    console.log('[Notification] ✅ Telegram alert sent.');
    return true;
  } catch (err) {
    console.warn(`[Notification] Failed to send Telegram alert: ${err.message}`);
    return false;
  }
}

/**
 * Formats and sends a publish success alert.
 */
export async function notifyPublishSuccess({ topicId, topicTitle, videoUrl, privacyStatus, durationSeconds }) {
  const message = [
    `🎬 <b>[ContentFactory] Відео успішно опубліковано!</b>`,
    ``,
    `📌 <b>Тема:</b> #${topicId} — ${escapeHtml(topicTitle)}`,
    `🔗 <b>YouTube:</b> <a href="${videoUrl}">${videoUrl}</a>`,
    `🔒 <b>Статус:</b> <code>${privacyStatus || 'unlisted'}</code>`,
    durationSeconds ? `⏱️ <b>Тривалість завантаження:</b> ${durationSeconds}s` : '',
    ``,
    `🚀 <i>Stage 5 Auto-Publisher</i>`,
  ]
    .filter(Boolean)
    .join('\n');

  return await sendTelegramMessage(message);
}

/**
 * Formats and sends a publish failure alert.
 */
export async function notifyPublishFailure({ topicId, topicTitle, error }) {
  const message = [
    `⚠️ <b>[ContentFactory] Помилка публікації відео!</b>`,
    ``,
    `📌 <b>Тема:</b> #${topicId} — ${escapeHtml(topicTitle || 'Невідома')}`,
    `❌ <b>Помилка:</b> <code>${escapeHtml(error || 'Unknown error')}</code>`,
    ``,
    `🔧 <i>Потрібна увага адміністратора</i>`,
  ].join('\n');

  return await sendTelegramMessage(message);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
