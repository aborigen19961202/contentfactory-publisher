import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import url from 'node:url';
import { google } from 'googleapis';
import dotenv from 'dotenv';

import { homedir } from 'node:os';

dotenv.config();

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
];

export function resolveChannelProfileDir(channelName) {
  if (!channelName) return null;
  const candidates = [
    path.join(homedir(), '.config', 'contentfactory', 'channels', channelName),
    path.join(process.cwd(), 'channels', channelName),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

function applyProxy(proxyUrl) {
  if (proxyUrl) {
    process.env.HTTPS_PROXY = proxyUrl;
    process.env.HTTP_PROXY = proxyUrl;
    process.env.https_proxy = proxyUrl;
    process.env.http_proxy = proxyUrl;
  }
}

function getTokenPath(channelName) {
  if (channelName) {
    const profileDir = resolveChannelProfileDir(channelName);
    const channelToken = path.join(profileDir, 'token.json');
    if (fs.existsSync(channelToken)) return channelToken;
  }
  return process.env.YOUTUBE_TOKEN_PATH || path.join(process.cwd(), '.tokens', 'youtube.json');
}

/**
 * Creates and configures the OAuth2 client.
 * Supports channel profiles, .env variables and downloaded Google client_secret*.json files.
 */
export function getOAuth2Client(options = {}) {
  const { channel, proxy } = options;
  applyProxy(proxy);

  let clientId = process.env.YOUTUBE_CLIENT_ID;
  if (clientId && clientId.includes('your_client_id_here')) clientId = null;

  let clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (clientSecret && clientSecret.includes('your_client_secret_here')) clientSecret = null;

  let redirectUri = process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';

  // Check channel profile directory first if specified
  const candidateFiles = [];
  if (channel) {
    const profileDir = resolveChannelProfileDir(channel);
    candidateFiles.push(
      path.join(profileDir, 'client_secret.json'),
      path.join(profileDir, 'client.json'),
      path.join(profileDir, 'credentials.json')
    );
  }

  // Check local root candidate files
  candidateFiles.push(
    path.join(process.cwd(), 'client_secret.json'),
    path.join(process.cwd(), 'client.json'),
    path.join(process.cwd(), 'credentials.json')
  );

  // Also check any file matching client_secret_*.json
  const cwdFiles = fs.readdirSync(process.cwd());
  const matchedSecretFile = cwdFiles.find((f) => f.startsWith('client_secret_') && f.endsWith('.json'));
  if (matchedSecretFile) {
    candidateFiles.unshift(path.join(process.cwd(), matchedSecretFile));
  }

  for (const filePath of candidateFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const creds = raw.installed || raw.web;
        if (creds && creds.client_id && creds.client_secret) {
          clientId = creds.client_id;
          clientSecret = creds.client_secret;
          if (creds.redirect_uris && creds.redirect_uris.length > 0) {
            redirectUri = process.env.YOUTUBE_REDIRECT_URI || creds.redirect_uris[0] || redirectUri;
          }
          break;
        }
      } catch (_) {
        // ignore parse error and fall back
      }
    }
  }

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing YouTube OAuth credentials. Either set YOUTUBE_CLIENT_ID & YOUTUBE_CLIENT_SECRET in .env, or place client_secret.json in channel profile or project root.'
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Loads saved credentials or throws if not authenticated.
 */
export async function getAuthenticatedClient(options = {}) {
  const { channel, proxy } = options;
  applyProxy(proxy);

  const oauth2Client = getOAuth2Client(options);
  const tokenPath = getTokenPath(channel);

  if (!fs.existsSync(tokenPath)) {
    throw new Error(
      `YouTube OAuth2 tokens not found at "${tokenPath}". Please run: npm run auth:youtube`
    );
  }

  const rawTokens = fs.readFileSync(tokenPath, 'utf8');
  const tokens = JSON.parse(rawTokens);
  oauth2Client.setCredentials(tokens);

  // Automatically save refreshed tokens
  oauth2Client.on('tokens', (newTokens) => {
    const updated = { ...tokens, ...newTokens };
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, JSON.stringify(updated, null, 2), 'utf8');
    console.log(`[YouTube Auth] Tokens refreshed and updated successfully at "${tokenPath}".`);
  });

  return oauth2Client;
}

/**
 * Interactive CLI authorization flow.
 */
async function startAuthFlow() {
  const oauth2Client = getOAuth2Client();
  const tokenPath = getTokenPath();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Ensures refresh_token is returned
  });

  console.log('\n======================================================');
  console.log('       ContentFactory YouTube OAuth2 Setup');
  console.log('======================================================\n');
  console.log('1. Open this URL in your browser to authorize access:\n');
  console.log(`   ${authUrl}\n`);
  console.log('2. Waiting for authorization callback on http://localhost:3000/oauth2callback ...');

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = url.parse(req.url, true);
      if (parsedUrl.pathname === '/oauth2callback') {
        const code = parsedUrl.query.code;
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>Error: No authorization code received.</h1>');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Authorization Successful!</h1><p>You can close this tab and return to the terminal.</p>');

        server.close();

        console.log('\n[YouTube Auth] Code received. Exchanging for tokens...');
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
        fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), 'utf8');

        console.log(`[YouTube Auth] ✅ Success! Tokens saved to: ${tokenPath}\n`);
        process.exit(0);
      }
    } catch (err) {
      console.error('[YouTube Auth] Error handling callback:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal Server Error: ${err.message}`);
      process.exit(1);
    }
  });

  server.listen(3000);
}

// Allow direct execution: `node modules/youtube/auth.mjs`
if (process.argv[1] && process.argv[1].endsWith('auth.mjs')) {
  startAuthFlow().catch((err) => {
    console.error('Fatal auth error:', err.message);
    process.exit(1);
  });
}
