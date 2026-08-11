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

If the server's IP gets flagged by YouTube's bot checks, mount a cookies file
into the container and set the `YTDLP_COOKIES` environment variable to its
path (see the yt-dlp FAQ on cookies).

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
