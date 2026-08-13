#!/bin/sh
set -e

# YouTube bot-checks datacenter IPs; yt-dlp gets past that with cookies from
# a logged-in browser session. Coolify cannot mount files, so the cookies.txt
# content arrives base64-encoded in an env var and is written to disk here.
# YTDLP_COOKIES (a path) still wins if set directly.
if [ -n "$YTDLP_COOKIES_B64" ] && [ -z "$YTDLP_COOKIES" ]; then
  echo "$YTDLP_COOKIES_B64" | base64 -d > /tmp/ytdlp-cookies.txt
  export YTDLP_COOKIES=/tmp/ytdlp-cookies.txt
fi

# The YouTube audio proxy restarts if it ever crashes; nginx keeps serving
# the static site either way and /api/ simply 502s while it comes back.
(
  while true; do
    node /app/server/youtube-audio.mjs || echo "youtube audio server exited, restarting"
    sleep 1
  done
) &

exec nginx -g 'daemon off;'
