# Deploying the demo with Coolify

The repository Dockerfile builds Butterchurn and serves the demo with nginx on
port 80. TLS must terminate at Coolify's reverse proxy; the container itself
does not need to expose port 443.

## Application settings

Create a Coolify application from the Git repository with these values:

- Repository: `https://github.com/Acid3croco/butterchurn`
- Branch: `master`
- Build pack: **Dockerfile**
- Dockerfile location: `/Dockerfile`
- Base directory: `/`
- Exposed port: `80`
- Health check path: `/`

Assign a public hostname in the application's Domains field using an `https://`
URL. Coolify will request and renew the certificate after the hostname points
to the server. Do not publish an HTTP-only domain: `getDisplayMedia()` is only
available in a secure context (HTTPS or localhost).

## Deploy on merge

The application uses Coolify's "Public GitHub" source, which has no built-in
push-to-deploy hook, so the repository carries a plain GitHub webhook instead:

- Payload URL: `https://coolify.veyxzer.com/webhooks/source/github/events/manual`
- Content type: `application/json`
- Secret: the application's *Manual Webhook Secret (GitHub)* from the Coolify
  application settings (set it there first, then paste the same value here)
- Events: push only

With *Auto Deploy* enabled on the application, every push to `master` (a
merged pull request included) starts a deployment. Pushes to other branches
are ignored. GitHub's "Recent Deliveries" tab on the webhook shows Coolify's
response body, which explains why a push was or was not deployed.

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
