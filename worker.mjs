import fs from 'node:fs';
import path from 'node:path';
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
  1. Single Topic Publish:
     node worker.mjs --topic <topic_id>

  2. Direct File Upload (CLI mode):
     node worker.mjs --video "out/video.mp4" --thumbnail "out/thumb.png" --title "My Title"

  3. Watch / Daemon Mode (Listens to PostgreSQL):
     node worker.mjs --watch

Options:
  --topic <id>            Topic ID to publish from database
  --video <path>          Path to video file
  --thumbnail <path>      Path to thumbnail image
  --title <text>          Video title
  --description <text>    Video description
  --tags <list>           Comma-separated tags (e.g. "3d,scale,ranking")
  --privacy <level>       Privacy status: 'private', 'unlisted', 'public' (default: unlisted)
  --publish-at <iso_date> Scheduled publication time (e.g. 2026-09-01T18:00:00Z)
  --dry-run               Simulate execution without actual upload
  --json                  Output clean JSON result to stdout
  --help, -h              Show this help message
`);
}

async function getDbPool() {
  const connectionString = process.env.DATABASE_URL;
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
    const res = await pool.query('SELECT * FROM topics WHERE id = $1', [topicId]);
    if (res.rows.length === 0) {
      throw new Error(`Topic #${topicId} not found in database.`);
    }

    const topic = res.rows[0];
    const context = topic.topic_context || {};

    const videoPath = options.video || context.video_path || context.output_path || `out/topic_${topicId}.mp4`;
    const thumbnailPath = options.thumbnail || context.thumbnail_path || `out/topic_${topicId}_thumb.png`;
    const title = options.title || context.seo_title || topic.title;
    const description = options.description || context.seo_description || `3D comparison visualization for ${topic.title}`;
    const tags = options.tags || context.seo_tags || ['contentfactory', '3d-comparison', 'ranking'];
    const privacy = options.privacy || context.privacy || process.env.YOUTUBE_DEFAULT_PRIVACY || 'unlisted';
    const publishAt = options.publishAt || context.publish_at || null;

    if (!options.json) {
      console.log(`[Worker] Preparing publication for Topic #${topicId}: "${title}"`);
      console.log(`[Worker] Video path: ${videoPath}`);
      console.log(`[Worker] Thumbnail path: ${thumbnailPath}`);
    }

    if (options.dryRun) {
      console.log('[Worker] 🔍 Dry-run mode active. Skipping actual upload.');
      return { success: true, dryRun: true, topicId, title, videoPath };
    }

    // Step 1: Upload to YouTube
    const publishResult = await publishToYouTube({
      videoPath,
      thumbnailPath: fs.existsSync(thumbnailPath) ? thumbnailPath : null,
      title,
      description,
      tags,
      privacy,
      publishAt,
    });

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1);

    // Step 2: Update topic in database
    const updatedContext = {
      ...context,
      youtube_video_id: publishResult.videoId,
      youtube_url: publishResult.url,
      published_at: new Date().toISOString(),
      publish_duration_seconds: parseFloat(durationSeconds),
    };

    await pool.query(
      "UPDATE topics SET status = 'published', topic_context = $2 WHERE id = $1",
      [topicId, JSON.stringify(updatedContext)]
    );

    if (!options.json) {
      console.log(`[Worker] ✅ Database updated: Topic #${topicId} -> status='published'`);
    }

    // Step 3: Send Telegram Notification
    await notifyPublishResult({
      success: true,
      topicId,
      topicTitle: title,
      videoUrl: publishResult.url,
      privacyStatus: publishResult.privacyStatus,
      durationSeconds,
    });

    const output = {
      success: true,
      topicId,
      videoId: publishResult.videoId,
      url: publishResult.url,
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
      await pool.query(
        "UPDATE topics SET status = 'publish_failed', topic_context = jsonb_set(COALESCE(topic_context, '{}'::jsonb), '{publish_error}', $2::jsonb) WHERE id = $1",
        [topicId, JSON.stringify(errorMsg)]
      );

      await notifyPublishResult({
        success: false,
        topicId,
        topicTitle: `Topic #${topicId}`,
        error: errorMsg,
      });
    } catch (dbErr) {
      console.error('[Worker] Failed to update error status in DB:', dbErr.message);
    }

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

  if (options.dryRun) {
    console.log('[Worker] 🔍 Dry-run mode active. Skipping actual upload.');
    return { success: true, dryRun: true, options };
  }

  const publishResult = await publishToYouTube({
    videoPath: options.video,
    thumbnailPath: options.thumbnail,
    title: options.title,
    description: options.description || '',
    tags: options.tags || [],
    privacy: options.privacy || 'unlisted',
    publishAt: options.publishAt,
  });

  const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1);

  await notifyPublishResult({
    success: true,
    topicId: 'CLI-Direct',
    topicTitle: options.title,
    videoUrl: publishResult.url,
    privacyStatus: publishResult.privacyStatus,
    durationSeconds,
  });

  const output = {
    success: true,
    videoId: publishResult.videoId,
    url: publishResult.url,
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
        
        // Optimistic lock: set to 'publishing'
        await pool.query("UPDATE topics SET status = 'publishing' WHERE id = $1", [topicId]);
        
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
