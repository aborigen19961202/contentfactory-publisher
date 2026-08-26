# Google Cloud Console Setup for YouTube Data API v3

This guide walks you through obtaining **OAuth2 Client ID and Client Secret** for automating YouTube video uploads.

---

## 1. Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click on the project dropdown at the top and select **"New Project"**.
3. Name it **`ContentFactory-YouTube`** (or your channel name) and click **Create**.

---

## 2. Enable YouTube Data API v3

1. In the left navigation menu, go to **APIs & Services** &rarr; **Library**.
2. Search for **`YouTube Data API v3`**.
3. Click on it and click **"Enable"**.

---

## 3. Configure OAuth Consent Screen

1. In the left menu, click **APIs & Services** &rarr; **OAuth consent screen**.
2. Select **User Type: External** and click **Create**.
3. Fill in the required fields:
   * **App name:** `ContentFactory Publisher`
   * **User support email:** (Your Gmail address)
   * **Developer contact email:** (Your Gmail address)
4. Click **Save and Continue**.
5. **Scopes Step:**
   * Click **Add or Remove Scopes**.
   * Add:
     * `.../auth/youtube.upload` (Upload YouTube videos)
     * `.../auth/youtube` (Manage your YouTube account)
   * Click **Update** &rarr; **Save and Continue**.
6. **Test Users Step:**
   * Add the Google account (email) that owns or manages your YouTube channel.
   * Click **Save and Continue**.

---

## 4. Create OAuth2 Credentials (Desktop App)

1. In the left menu, click **APIs & Services** &rarr; **Credentials**.
2. Click **"+ CREATE CREDENTIALS"** &rarr; **"OAuth client ID"**.
3. Select **Application type: Desktop App** (or Web Application if using local redirect `http://localhost:3000/oauth2callback`).
4. Set Name: **`ContentFactory-Node-Client`**.
5. If choosing **Web Application**, add to Authorized redirect URIs:
   * `http://localhost:3000/oauth2callback`
6. Click **Create**.
7. Copy your **Client ID** and **Client Secret**.

---

## 5. Configure `.env` and Authenticate

1. Open `.env` in `contentfactory-publisher`:
   ```env
   YOUTUBE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
   YOUTUBE_CLIENT_SECRET=GOCSPX-your_client_secret_here
   YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth2callback
   ```
2. Run the interactive authorization command:
   ```bash
   npm run auth:youtube
   ```
3. Open the generated URL, authorize with your YouTube channel account, and approve permissions.
4. Tokens will be automatically saved to `.tokens/youtube.json` and refreshed automatically 24/7.
