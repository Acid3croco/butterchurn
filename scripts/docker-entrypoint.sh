#!/bin/sh
set -e

# The YouTube audio proxy restarts if it ever crashes; nginx keeps serving
# the static site either way and /api/ simply 502s while it comes back.
(
  while true; do
    node /app/server/youtube-audio.mjs || echo "youtube audio server exited, restarting"
    sleep 1
  done
) &

exec nginx -g 'daemon off;'
