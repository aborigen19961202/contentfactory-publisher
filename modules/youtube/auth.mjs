import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import url from 'node:url';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
];

function getTokenPath() {
  return process.env.YOUTUBE_TOKEN_PATH || path.join(process.cwd(), '.tokens', 'youtube.json');
}

/**
 * Creates and configures the OAuth2 client.
 */
export function getOAuth2Client() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';

  if (!clientId || !clientSecret) {
    throw new Error('Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET in environment variables.');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Loads saved credentials or throws if not authenticated.
 */
export async function getAuthenticatedClient() {
  const oauth2Client = getOAuth2Client();
  const tokenPath = getTokenPath();

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
    console.log('[YouTube Auth] Tokens refreshed and updated successfully.');
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
