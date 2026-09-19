import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import pg from 'pg';
import dotenv from 'dotenv';
import { publishToYouTube } from './modules/youtube/index.mjs';
import { notifyPublishResult } from './modules/notifications/index.mjs';

dotenv.config();

const { Pool } = pg;

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') params.help = true;
    else if (arg === '--verify' || arg === '-v') params.verify = true;
    else if (arg === '--watch' || arg === '-w') params.watch = true;
    else if (arg === '--dry-run') params.dryRun = true;
    else if (arg === '--json') params.json = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        params[key] = next;
        i++;
      } else {
        params[key] = true;
      }
    }
  }

  return params;
}

function printHelp() {
  console.log(`
ContentFactory Auto-Publisher (Stage 5)
=======================================

Usage:
  node worker.mjs [options]

Modes:
  1. Single Topic Publish (from PostgreSQL):
     node worker.mjs --topic <topic_id> [--privacy unlisted] [--channel <name>] [--dry-run]

  2. Direct File Upload (CLI mode):
     node worker.mjs --video "out/video.mp4" --title "My Title" [--privacy unlisted]

  3. Verify Channel Authorization:
     node worker.mjs --verify [--channel <name>]

Options:
  --topic <id>            Topic ID to publish from database
  --video <path>          Path to video file
  --thumbnail <path>      Path to thumbnail image
  --title <text>          Video title
  --description <text>    Video description
  --tags <list>           Comma-separated tags (e.g. "3d,scale,ranking")
  --privacy <level>       Privacy status: 'private', 'unlisted', 'public' (default: unlisted)
  --publish-at <iso_date> Scheduled publication time (e.g. 2026-09-01T18:00:00Z)
  --channel <name>        Channel profile name in ~/.config/contentfactory/channels/<name>
  --proxy <url>           HTTP/HTTPS/SOCKS5 proxy (e.g. http://user:pass@host:port)
  --dry-run               Simulate execution without actual upload
  --json                  Output clean JSON result to stdout
  --help, -h              Show this help message
`);
}

async function getDbPool() {
  let connectionString = process.env.DATABASE_URL || process.env.CONTENTFACTORY_DATABASE_URL;
  if (!connectionString || connectionString.includes('contentfactory_publisher')) {
    try {
      const dbEnv = fs.readFileSync(path.join(homedir(), '.config', 'contentfactory', 'database.env'), 'utf8');
      const match = dbEnv.match(/CONTENTFACTORY_DATABASE_URL=['"]?([^'"\n]+)/);
      if (match) connectionString = match[1];
    } catch (_) {}
  }
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set in environment.');
  }
  return new Pool({ connectionString });
}

/**
 * Publishes a specific topic from the PostgreSQL database.
 */
async function publishTopicFromDb(topicId, options = {}) {
  const pool = await getDbPool();
  const startTime = Date.now();

  try {
    const res = await pool.query(
      `SELECT t.id, t.title, t.youtube_tags, t.topic_context,
              rj.output_path AS render_output_path
       FROM topics t
       LEFT JOIN LATERAL (
         SELECT output_path FROM render_jobs
         WHERE topic_id = t.id AND status = 'completed'
         ORDER BY id DESC LIMIT 1
       ) rj ON true
       WHERE t.id = $1`,
      [topicId]
    );
    if (res.rows.length === 0) {
      throw new Error(`Topic #${topicId} not found in database.`);
    }

    const topic = res.rows[0];
    const videoPath = options.video || topic.render_output_path || `out/topic_${topicId}.mp4`;
    const resolvedVideoPath = path.resolve(videoPath);

    if (!fs.existsSync(resolvedVideoPath)) {
      throw new Error(`Video file not found at: ${resolvedVideoPath}`);
    }

    const fileStats = fs.statSync(resolvedVideoPath);
    const fileSizeMb = (fileStats.size / (1024 * 1024)).toFixed(2);

    const title = options.title || topic.title;
    const description = options.description || topic.topic_context || `3D comparison visualization for ${topic.title}`;
    const tags = options.tags
      ? (typeof options.tags === 'string' ? options.tags.split(',').map((t) => t.trim()).filter(Boolean) : options.tags)
      : (topic.youtube_tags || ['contentfactory', '3d-comparison', 'ranking']);
    const privacy = options.privacy || process.env.YOUTUBE_DEFAULT_PRIVACY || 'unlisted';
    const publishAt = options.publishAt || null;
    const channel = options.channel || null;
    const proxy = options.proxy || null;
    const thumbnailPath = options.thumbnail ? path.resolve(options.thumbnail) : null;

    if (!options.json) {
      console.log(`[Worker] Preparing publication for Topic #${topicId}: "${title}"`);
      console.log(`[Worker] Video path: ${resolvedVideoPath} (${fileSizeMb} MB)`);
      if (thumbnailPath) console.log(`[Worker] Thumbnail path: ${thumbnailPath}`);
      if (channel) console.log(`[Worker] Channel profile: ${channel}`);
      if (proxy) console.log(`[Worker] Network proxy: ${proxy}`);
      console.log(`[Worker] Privacy: ${privacy}${publishAt ? ` (Scheduled: ${publishAt})` : ''}`);
    }

    if (options.dryRun) {
      const dryOutput = {
        success: true,
        dryRun: true,
        topicId,
        title,
        channel,
        privacy,
        publishAt,
        videoPath: resolvedVideoPath,
        fileSizeMb: parseFloat(fileSizeMb),
        tagsCount: tags.length,
        tags,
        thumbnailAttached: Boolean(thumbnailPath && fs.existsSync(thumbnailPath)),
      };
      if (!options.json) {
        console.log('\n======================================================');
        console.log('       [Dry-Run] Video Upload Verification');
        console.log('======================================================');
        console.log(`📌 Topic ID     : #${topicId}`);
        console.log(`🎬 Title        : ${title}`);
        console.log(`🔒 Privacy      : ${privacy}${publishAt ? ` (Scheduled: ${publishAt})` : ''}`);
        console.log(`📁 Video Path   : ${resolvedVideoPath} (${fileSizeMb} MB)`);
        console.log(`🏷️ Tags (${tags.length}) : ${tags.join(', ')}`);
        console.log(`🖼️ Thumbnail    : ${thumbnailPath || 'None (auto-generated by YouTube)'}`);
        if (channel) console.log(`👤 Channel      : ${channel}`);
        if (proxy) console.log(`🌐 Proxy        : ${proxy}`);
        console.log('======================================================\n');
        console.log('✅ Dry-run check PASSED! Ready for live upload.');
      } else {
        console.log(JSON.stringify(dryOutput));
      }
      return dryOutput;
    }

    // Step 1: Upload to YouTube
    const publishResult = await publishToYouTube({
      videoPath: resolvedVideoPath,
      thumbnailPath: thumbnailPath && fs.existsSync(thumbnailPath) ? thumbnailPath : null,
      title,
      description,
      tags,
      privacy,
      publishAt,
      channel,
      proxy,
    });

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1);

    // Step 2: Update topic in database to 'published'
    await pool.query(
      "UPDATE topics SET status = 'published' WHERE id = $1",
      [topicId]
    );

    if (!options.json) {
      console.log(`[Worker] ✅ Database updated: Topic #${topicId} -> status='published'`);
    }

    // Step 3: Send Telegram Notification
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        await notifyPublishResult({
          success: true,
          topicId,
          topicTitle: title,
          videoUrl: publishResult.url,
          privacyStatus: publishResult.privacyStatus,
          durationSeconds,
        });
      } catch (telErr) {
        console.warn('[Worker] Telegram notification failed:', telErr.message);
      }
    }

    const output = {
      success: true,
      topicId,
      videoId: publishResult.videoId,
      url: publishResult.url,
      privacyStatus: publishResult.privacyStatus,
      durationSeconds,
    };

    if (options.json) {
      console.log(JSON.stringify(output));
    }

    return output;
  } catch (err) {
    const errorMsg = err.message;
    console.error(`[Worker] ❌ Failed to publish topic #${topicId}:`, errorMsg);

    try {
      if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        await notifyPublishResult({
          success: false,
          topicId,
          topicTitle: `Topic #${topicId}`,
          error: errorMsg,
        });
      }
    } catch (_) {}

    if (options.json) {
      console.log(JSON.stringify({ success: false, topicId, error: errorMsg }));
    }

    throw err;
  } finally {
    await pool.end();
  }
}

/**
 * Direct file publication without database requirement.
 */
async function publishDirectFile(options) {
  const startTime = Date.now();

  if (!options.video) {
    throw new Error('Missing --video argument for direct publication.');
  }
  if (!options.title) {
    throw new Error('Missing --title argument for direct publication.');
  }

  const resolvedVideoPath = path.resolve(options.video);
  if (!fs.existsSync(resolvedVideoPath)) {
    throw new Error(`Video file not found at: ${resolvedVideoPath}`);
  }

  const fileStats = fs.statSync(resolvedVideoPath);
  const fileSizeMb = (fileStats.size / (1024 * 1024)).toFixed(2);
  const privacy = options.privacy || process.env.YOUTUBE_DEFAULT_PRIVACY || 'unlisted';
  const publishAt = options.publishAt || null;
  const channel = options.channel || null;
  const proxy = options.proxy || null;
  const thumbnailPath = options.thumbnail ? path.resolve(options.thumbnail) : null;
  const tags = options.tags
    ? (typeof options.tags === 'string' ? options.tags.split(',').map((t) => t.trim()).filter(Boolean) : options.tags)
    : [];

  if (options.dryRun) {
    const dryOutput = {
      success: true,
      dryRun: true,
      title: options.title,
      channel,
      privacy,
      publishAt,
      videoPath: resolvedVideoPath,
      fileSizeMb: parseFloat(fileSizeMb),
      tagsCount: tags.length,
      tags,
      thumbnailAttached: Boolean(thumbnailPath && fs.existsSync(thumbnailPath)),
    };
    if (!options.json) {
      console.log('\n======================================================');
      console.log('       [Dry-Run] Direct File Upload Verification');
      console.log('======================================================');
      console.log(`🎬 Title        : ${options.title}`);
      console.log(`🔒 Privacy      : ${privacy}${publishAt ? ` (Scheduled: ${publishAt})` : ''}`);
      console.log(`📁 Video Path   : ${resolvedVideoPath} (${fileSizeMb} MB)`);
      console.log(`🏷️ Tags (${tags.length}) : ${tags.join(', ')}`);
      console.log(`🖼️ Thumbnail    : ${thumbnailPath || 'None (auto-generated by YouTube)'}`);
      if (channel) console.log(`👤 Channel      : ${channel}`);
      if (proxy) console.log(`🌐 Proxy        : ${proxy}`);
      console.log('======================================================\n');
      console.log('✅ Dry-run check PASSED! Ready for live upload.');
    } else {
      console.log(JSON.stringify(dryOutput));
    }
    return dryOutput;
  }

  const publishResult = await publishToYouTube({
    videoPath: resolvedVideoPath,
    thumbnailPath: thumbnailPath && fs.existsSync(thumbnailPath) ? thumbnailPath : null,
    title: options.title,
    description: options.description || '',
    tags,
    privacy,
    publishAt,
    channel,
    proxy,
  });

  const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1);

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      await notifyPublishResult({
        success: true,
        topicId: 'CLI-Direct',
        topicTitle: options.title,
        videoUrl: publishResult.url,
        privacyStatus: publishResult.privacyStatus,
        durationSeconds,
      });
    } catch (_) {}
  }

  const output = {
    success: true,
    videoId: publishResult.videoId,
    url: publishResult.url,
    privacyStatus: publishResult.privacyStatus,
    durationSeconds,
  };

  if (options.json) {
    console.log(JSON.stringify(output));
  }

  return output;
}

/**
 * Watch / Daemon Mode: Polls PostgreSQL for topics ready to publish.
 */
async function runWatchDaemon() {
  console.log('[Worker] 🚀 Watch Daemon started. Monitoring PostgreSQL for topics with status="render_complete"...');
  const pool = await getDbPool();

  const pollIntervalMs = 10000; // 10 seconds

  const loop = async () => {
    try {
      // Find candidate topic
      const res = await pool.query(
        "SELECT id FROM topics WHERE status = 'render_complete' ORDER BY id ASC LIMIT 1"
      );

      if (res.rows.length > 0) {
        const topicId = res.rows[0].id;
        console.log(`[Worker] 🔔 Found candidate topic #${topicId} with status='render_complete'. Starting publication...`);
        await publishTopicFromDb(topicId);
      }
    } catch (err) {
      console.error('[Worker Daemon] Error during poll cycle:', err.message);
    } finally {
      setTimeout(loop, pollIntervalMs);
    }
  };

  loop();
}

// Main CLI Entry Point
async function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.verify) {
    const { getChannelInfo } = await import('./modules/youtube/index.mjs');
    console.log('[Verify] 🔍 Connecting to YouTube API to inspect channel credentials...');
    try {
      const channel = await getChannelInfo({ channel: args.channel, proxy: args.proxy });
      console.log('\n======================================================');
      console.log('       Authenticated YouTube Channel Details');
      console.log('======================================================');
      console.log(`📌 Channel Title : ${channel.title}`);
      console.log(`🆔 Channel ID    : ${channel.id}`);
      if (channel.customUrl) console.log(`🔗 Custom URL    : https://youtube.com/${channel.customUrl}`);
      console.log(`👥 Subscribers   : ${channel.subscriberCount}`);
      console.log(`🎬 Total Videos  : ${channel.videoCount}`);
      console.log(`👁️ Total Views   : ${channel.viewCount}`);
      if (args.channel) console.log(`👤 Profile Name  : ${args.channel}`);
      if (args.proxy) console.log(`🌐 Proxy Used    : ${args.proxy}`);
      console.log('======================================================\n');
      console.log('✅ Authentication is 100% active and working!\n');
    } catch (err) {
      console.error('\n❌ YouTube Authentication Verification Failed:', err.message);
      process.exit(1);
    }
    return;
  }

  if (args.watch) {
    await runWatchDaemon();
    return;
  }

  if (args.topic) {
    await publishTopicFromDb(parseInt(args.topic, 10), args);
    return;
  }

  if (args.video) {
    await publishDirectFile(args);
    return;
  }

  printHelp();
}

main().catch((err) => {
  console.error('[Fatal Error]', err.message);
  process.exit(1);
});
