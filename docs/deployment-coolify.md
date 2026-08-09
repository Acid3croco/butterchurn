# Deploying the demo with Coolify

The repository Dockerfile builds Butterchurn and serves the demo with nginx on
port 80. TLS must terminate at Coolify's reverse proxy; the container itself
does not need to expose port 443.

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

The browser grants capture permission per session. No audio is uploaded or
stored by the application.
