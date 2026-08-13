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

# The PO token provider lets yt-dlp pass YouTube's datacenter-IP bot check
# without account cookies. yt-dlp's bgutil plugin finds it on 127.0.0.1:4416
# and quietly degrades if it is down, so it gets the same restart-forever
# treatment as the audio proxy below.
(
  while true; do
    node /app/pot-provider/build/main.js || echo "pot provider exited, restarting"
    sleep 1
  done
) &

# The YouTube audio proxy restarts if it ever crashes; nginx keeps serving
# the static site either way and /api/ simply 502s while it comes back.
(
  while true; do
    node /app/server/youtube-audio.mjs || echo "youtube audio server exited, restarting"
    sleep 1
  done
) &

exec nginx -g 'daemon off;'
