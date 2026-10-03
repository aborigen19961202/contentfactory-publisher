# ContentFactory Publisher

> **Autonomous multi-platform video publishing engine for ContentFactory.**  
> High-performance, zero-RAM-leak streaming uploader for YouTube Data API v3, custom thumbnails, PostgreSQL state automation, and instant Telegram notifications.

---

## 🌟 Key Features

* **Zero-RAM Streaming:** Streams 1080p/4K MP4 videos via `fs.createReadStream` directly to YouTube Resumable Upload API. Memory consumption is limited to ~20–40 MB during uploads and 0 MB at idle.
* **Full Stage 5 Automation:** Attaches custom thumbnails (`thumbnails.set`), sets SEO metadata, chapters, tags, and scheduled release times (`publishAt`).
* **PostgreSQL State Machine Integration:** Monitors the `yeap_stats` database, automatically picking up topics with `status = 'render_complete'`, uploading, and updating status to `published` (or `publish_failed`).
* **Instant Telegram Alerts:** Real-time notifications on successful upload (with direct video link) or failure alerts for administrator attention.
* **Modular Provider Architecture:** Self-contained modules inside `modules/` allowing seamless addition of future platforms (TikTok, Instagram Reels, X, etc.).

---

## 📁 Repository Structure

```
contentfactory-publisher/
├── modules/
│   ├── youtube/            # YouTube Data API v3 (OAuth2, streaming upload, thumbnail)
│   │   ├── auth.mjs
│   │   ├── upload.mjs
│   │   └── index.mjs
│   └── notifications/      # Notification dispatchers (Telegram bot alerts)
│       ├── telegram.mjs
│       └── index.mjs
├── worker.mjs              # Main CLI / PostgreSQL state-machine runner
├── docs/
│   └── GOOGLE_CLOUD_SETUP.md # Step-by-step Google Cloud OAuth2 setup
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## 🚀 Quick Start

### 1. Installation
```bash
cd contentfactory-publisher
npm install
cp .env.example .env
```

### 2. Configure Credentials & Authenticate
Fill in your Google OAuth2 credentials in `.env` (see [Google Cloud Setup Guide](docs/GOOGLE_CLOUD_SETUP.md)), then run:
```bash
npm run auth:youtube
```

### 3. Usage Examples

#### A. Publish Topic from Database
```bash
node worker.mjs --topic 12
```

#### B. Direct File Upload (CLI Mode)
```bash
node worker.mjs \
  --video "out/video.mp4" \
  --thumbnail "out/thumb.png" \
  --title "Tallest Statues in the World (3D Scale Comparison)" \
  --description "High-precision 3D comparison..." \
  --tags "3d,scale,statues" \
  --privacy unlisted
```

#### C. Watch Daemon Mode (VPS Production)
```bash
npm run watch
# or: node worker.mjs --watch
```

#### D. Dry Run
```bash
node worker.mjs --topic 12 --dry-run
```

---

## 📄 License
MIT

## Google Drive masters (local implementation, 2026-10-02)

New topic masters with a verified `render_outputs` row stream directly from Drive into the existing YouTube adapter. No video is downloaded to VPS storage. Requires updated 3DCHARTS helpers at `RENDERER_DIR`, existing Drive OAuth config, and the ContentFactoryFlow storage migration. Legacy jobs and direct `--video` uploads keep their local-file source. The initial Drive delivery was deployed on VPS 2026-10-03 and verified with topic #14. The direct local-master delivery described below supersedes it for new outputs; historical Drive sources remain supported.

YouTube acknowledgements are persisted in private `~/.local/state/contentfactory-publisher/<output-id>.json` receipts before DB/topic updates. A lost DB response reuses the returned YouTube ID. An upload with an unknown outcome reports `YOUTUBE_UPLOAD_NEEDS_RECONCILIATION` and requires checking YouTube before retrying; never delete that marker blindly.

Run `npm run test:storage`. See ContentFactoryFlow `docs/RENDER_STORAGE.md` for integration and deployment order.

## Registered local master / automatic executor (2026-10-03)

`node worker.mjs --output-id <uuid> --privacy private --json` selects the exact completed output instead of a topic's latest job. New `delivery_target=youtube` records stream their local master after size/hash/path verification. Existing Drive records keep their streaming source. The same durable receipt prevents a duplicate after a lost DB acknowledgement; an uncertain upload is blocked for reconciliation. `--verify-output <uuid> --json` checks the saved YouTube ID without uploading. A retry after cleanup can recover the saved ID without opening the deleted file.

The task-engine's existing storage unit invokes this executor after postproduction and removes local files only after the stored acknowledgement and remote ID verification. No new watch daemon is enabled. Title/tags come from the topic; description remains empty and automatic visibility is private. The old Drive backup is not deleted.

Tests: `npm run test:storage` and `npm run test:youtube-stream`.
