FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html/dist
COPY --from=build /app/examples /usr/share/nginx/html/examples
COPY --from=build /app/node_modules/butterchurn-presets/dist/all.js /usr/share/nginx/html/vendor/butterchurn-presets/all.js
COPY --from=build /app/node_modules/butterchurn-presets/dist/imageData.min.js /usr/share/nginx/html/vendor/butterchurn-presets/imageData.min.js

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
