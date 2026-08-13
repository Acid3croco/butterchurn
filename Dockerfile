FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# The PO token provider lets yt-dlp fetch public videos from this datacenter
# IP without account cookies (which YouTube rotates within the hour when they
# come from a live browser session). Its version must match the pip plugin
# installed below.
FROM node:22-alpine AS potprovider

# canvas (a provider dependency jsdom uses to answer BotGuard's canvas
# fingerprinting) has no musl prebuilds, so it compiles from source here.
RUN apk add --no-cache python3 make g++ pkgconfig \
  cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev pixman-dev

WORKDIR /pot
ADD https://github.com/Brainicism/bgutil-ytdlp-pot-provider/archive/refs/tags/1.3.1.tar.gz pot.tar.gz
RUN tar -xzf pot.tar.gz --strip-components=1 \
  && cd server \
  && npm ci --no-audit --no-fund \
  && npx tsc \
  && npm prune --omit=dev

FROM nginx:1.27-alpine

# node runs the YouTube audio proxy; yt-dlp comes from PyPI so each image
# rebuild picks up the latest extractor fixes (YouTube breaks old versions).
# The [default] extra pulls in yt-dlp-ejs, the JS challenge solver that yt-dlp
# runs on Node (see --js-runtimes in server/youtube-audio.mjs); without it
# extraction falls back to fringe clients that YouTube bot-flags quickly.
# The bgutil plugin makes yt-dlp use the PO token provider the entrypoint
# starts on 127.0.0.1:4416 (the plugin's default; no yt-dlp args needed).
RUN apk add --no-cache --upgrade expat nodejs ffmpeg python3 py3-pip \
    cairo pango libjpeg-turbo giflib librsvg pixman \
  && pip install --no-cache-dir --break-system-packages \
    "yt-dlp[default]" "bgutil-ytdlp-pot-provider==1.3.1"

COPY --from=potprovider /pot/server /app/pot-provider

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY server /app/server
COPY scripts/docker-entrypoint.sh /docker-entrypoint-butterchurn.sh
RUN chmod +x /docker-entrypoint-butterchurn.sh
COPY --from=build /app/dist /usr/share/nginx/html/dist
COPY --from=build /app/examples /usr/share/nginx/html/examples
COPY --from=build /app/node_modules/butterchurn-presets/dist/all.js /usr/share/nginx/html/vendor/butterchurn-presets/all.js
COPY --from=build /app/node_modules/butterchurn-presets/dist/imageData.min.js /usr/share/nginx/html/vendor/butterchurn-presets/imageData.min.js

EXPOSE 80

CMD ["/docker-entrypoint-butterchurn.sh"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ \
    && wget -q --spider http://127.0.0.1/api/youtube/health || exit 1
