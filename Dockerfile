FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM nginx:1.27-alpine

# node runs the YouTube audio proxy; yt-dlp comes from PyPI so each image
# rebuild picks up the latest extractor fixes (YouTube breaks old versions).
RUN apk add --no-cache --upgrade expat nodejs ffmpeg python3 py3-pip \
  && pip install --no-cache-dir --break-system-packages yt-dlp

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
