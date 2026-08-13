# Deploying the demo with Coolify

The repository Dockerfile builds Butterchurn and serves the demo with nginx on
port 80. TLS must terminate at Coolify's reverse proxy; the container itself
does not need to expose port 443.

The image also runs a small Node service (`server/youtube-audio.mjs`) on
loopback port 3000. nginx proxies `/api/` to it; it fetches the audio track of
a YouTube video with yt-dlp for the demo's YouTube source. yt-dlp is installed
from PyPI at image build time, so redeploying rebuilds the image and picks up
the latest YouTube extractor fixes — redeploy if YouTube fetches start
failing.

YouTube bot-checks datacenter IPs ("Sign in to confirm you're not a bot").
The image answers that with the bgutil PO token provider: a small Node
service the entrypoint runs on loopback port 4416, which mints the
proof-of-origin tokens YouTube expects from legitimate clients. yt-dlp's
bgutil plugin (pinned in the Dockerfile to the same version as the provider)
picks it up automatically, so public videos fetch without any cookies and
there is nothing that expires.

If fetches still fail with the bot-check message, account cookies from a
logged-in YouTube session are the fallback:

1. In a private/incognito browser window, log in to youtube.com (a throwaway
   Google account is safer than your main one), open a video, and export the
   cookies in Netscape format with an extension such as "Get cookies.txt
   LOCALLY". Close the private window afterwards without logging out — that
   keeps the exported session from being rotated (see the yt-dlp wiki on
   exporting YouTube cookies).
2. Base64-encode the file (`base64 -i cookies.txt | tr -d '\n'`) and set the
   result as the `YTDLP_COOKIES_B64` environment variable in Coolify, then
   restart the application. The entrypoint writes it to disk and points
   yt-dlp at it.

Cookies expire after a while; if fetches start failing with the bot-check
error again, export and set them again. Alternatively mount a cookies file
yourself and set `YTDLP_COOKIES` to its path.

## Application settings

Create a Coolify application from the Git repository with these values:

- Repository: `https://github.com/Acid3croco/butterchurn`
- Branch: `agent/capture-another-tab` while PR #1 is under review, then `master`
- Build pack: **Dockerfile**
- Dockerfile location: `/Dockerfile`
- Base directory: `/`
- Exposed port: `80`
- Health check path: `/`

Assign a public hostname in the application's Domains field using an `https://`
URL. Coolify will request and renew the certificate after the hostname points
to the server. Do not publish an HTTP-only domain: `getDisplayMedia()` is only
available in a secure context (HTTPS or localhost).

## Post-deploy checks

1. Open the final HTTPS URL in Chromium.
2. Confirm that the preset selector contains the complete collection.
3. Open audio in a second browser tab and select **Capture a tab**.
4. Choose that browser tab and keep **Share tab audio** enabled.
5. Confirm that the source indicator turns green and the visualizer reacts.
6. Stop sharing from Chromium, then confirm the interface returns to
   **Waiting for audio** and allows a new capture.
7. Paste a YouTube link into the YouTube field and press **Play**. Confirm the
   download progress reaches 100%, the video title appears as the source, and
   the pause, stop, volume, and seek controls work. `/api/youtube/health`
   must return `{"ok":true}`.
8. Paste a playlist or mix link. Confirm the track counter appears in the
   source name and the previous/next buttons switch tracks.

The browser grants capture permission per session. No audio is uploaded or
stored by the application.
