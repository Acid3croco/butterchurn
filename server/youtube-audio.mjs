// Minimal audio proxy for the demo page: fetches the audio track of a
// YouTube video with yt-dlp and streams it to the browser, which cannot
// reach YouTube media directly (CORS, signed URLs).
//
// Standalone usage (also serves the repo statically for local dev):
//   node server/youtube-audio.mjs
// In the Docker image nginx serves the static files and proxies /api/ here.

import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
const MAX_CONCURRENT_FETCHES = 3;
const MAX_FETCH_MS = 5 * 60 * 1000;
const MAX_DURATION_SECONDS = 2 * 60 * 60;
const STATIC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

let activeFetches = 0;
const activeClientIps = new Set();

function clientIp(req) {
  // nginx sits in front and sets X-Forwarded-For; fall back to the socket.
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

// Accepts a bare 11-character video id or any of the usual YouTube URL
// shapes (watch, youtu.be, shorts, live, music.youtube.com).
function extractVideoId(input) {
  const value = (input || "").trim();
  if (/^[\w-]{11}$/.test(value)) return value;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\.|^m\.|^music\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const fromQuery = url.searchParams.get("v");
    if (fromQuery && /^[\w-]{11}$/.test(fromQuery)) return fromQuery;
    const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/);
    if (match) return match[1];
  }
  return null;
}

// A playlist reference needs a valid list id; the video id is optional and
// required only for mix ("RD…") playlists, which YouTube generates around a
// starting video.
function extractPlaylistTarget(input) {
  let url;
  try {
    url = new URL((input || "").trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\.|^music\./, "");
  if (!["youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host)) {
    return null;
  }
  const listId = url.searchParams.get("list");
  if (!listId || !/^[\w-]{2,64}$/.test(listId)) return null;
  return { listId, videoId: extractVideoId(input) };
}

function sendJSON(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// Arguments shared by every yt-dlp invocation. YouTube's player challenges
// need a JavaScript runtime; the image ships Node, so point yt-dlp at it
// (deno is its default and is not installed). Cookies are the reliable
// answer to YouTube bot-checking the server's datacenter IP.
function sharedYtdlpArgs() {
  const args = ["--js-runtimes", "node"];
  if (process.env.YTDLP_COOKIES && existsSync(process.env.YTDLP_COOKIES)) {
    args.push("--cookies", process.env.YTDLP_COOKIES);
  }
  return args;
}

// Turn yt-dlp's stderr tail into a message the page can show. yt-dlp's own
// bot-check error suggests command-line flags, which mean nothing to a
// visitor, so that one gets rephrased.
function ytdlpFailureReason(outputTail) {
  const lastError = outputTail
    .split("\n")
    .filter((line) => line.includes("ERROR"))
    .pop();
  if (lastError && lastError.includes("Sign in to confirm")) {
    return (
      "YouTube is blocking requests from this server (bot check). " +
      "The site owner needs to install fresh YouTube cookies."
    );
  }
  return lastError;
}

// Best-effort title lookup through YouTube's keyless oEmbed endpoint so the
// page can show what is playing. Failures are silently ignored.
async function fetchVideoTitle(videoId) {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`
      )}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.title === "string" ? data.title : null;
  } catch {
    return null;
  }
}

async function listPlaylistEntries(req, res, requestUrl) {
  const target = extractPlaylistTarget(requestUrl.searchParams.get("url"));
  if (!target) {
    sendJSON(res, 400, {
      error: "Provide a YouTube playlist or mix URL in the “url” parameter.",
    });
    return;
  }
  const ip = clientIp(req);
  if (activeClientIps.has(ip) || activeFetches >= MAX_CONCURRENT_FETCHES) {
    sendJSON(res, 429, {
      error: "Too many simultaneous YouTube fetches. Try again shortly.",
    });
    return;
  }

  activeFetches += 1;
  activeClientIps.add(ip);
  try {
    const canonical = target.videoId
      ? `https://www.youtube.com/watch?v=${target.videoId}&list=${target.listId}`
      : `https://www.youtube.com/playlist?list=${target.listId}`;
    const ytdlp = spawn(
      YTDLP,
      [
        ...sharedYtdlpArgs(),
        "--flat-playlist",
        "--dump-single-json",
        "--no-warnings",
        "--playlist-items",
        "1:100",
        "--",
        canonical,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderrTail = "";
    ytdlp.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 20 * 1024 * 1024) ytdlp.kill("SIGKILL");
    });
    ytdlp.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });

    const abortLookup = () => ytdlp.kill("SIGKILL");
    req.on("close", abortLookup);
    const killTimer = setTimeout(abortLookup, 90 * 1000);
    const exitCode = await new Promise((resolve, reject) => {
      ytdlp.on("error", reject);
      ytdlp.on("close", resolve);
    }).finally(() => {
      req.off("close", abortLookup);
      clearTimeout(killTimer);
    });

    if (exitCode !== 0) {
      const reason = ytdlpFailureReason(stderrTail);
      console.error(
        `yt-dlp playlist lookup failed for ${target.listId}: ${stderrTail.trim()}`
      );
      // 500, not 502: Cloudflare replaces origin 502/504 bodies with its own
      // error page, which would hide this message from the browser.
      sendJSON(res, 500, {
        error: reason || "Could not read this playlist.",
      });
      return;
    }

    const data = JSON.parse(stdout);
    const rawEntries = Array.isArray(data.entries)
      ? data.entries
      : [{ id: data.id, title: data.title }];
    const entries = rawEntries
      .map((entry) => ({ id: entry.id, title: entry.title || "Untitled" }))
      .filter((entry) => /^[\w-]{11}$/.test(entry.id || ""));
    sendJSON(res, 200, { title: data.title || "YouTube playlist", entries });
  } catch (error) {
    console.error(`Playlist lookup failed for ${target.listId}:`, error);
    sendJSON(res, 500, { error: "Could not read this playlist." });
  } finally {
    activeFetches -= 1;
    activeClientIps.delete(ip);
  }
}

async function streamYoutubeAudio(req, res, requestUrl) {
  const videoId = extractVideoId(requestUrl.searchParams.get("v"));
  if (!videoId) {
    sendJSON(res, 400, {
      error: "Provide a YouTube video URL or id in the “v” parameter.",
    });
    return;
  }
  const ip = clientIp(req);
  if (activeClientIps.has(ip) || activeFetches >= MAX_CONCURRENT_FETCHES) {
    sendJSON(res, 429, {
      error: "Too many simultaneous YouTube fetches. Try again shortly.",
    });
    return;
  }

  activeFetches += 1;
  activeClientIps.add(ip);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "butterchurn-yt-"));
  const audioPath = path.join(tempDir, "audio.m4a");
  const cleanup = () => rm(tempDir, { recursive: true, force: true });

  try {
    const title = await fetchVideoTitle(videoId);

    // Download to a file rather than stdout: yt-dlp then fixes up YouTube's
    // DASH-fragmented m4a into a standard MP4 container (browsers cannot
    // play the raw fragments in an <audio> element), and we get a
    // Content-Length for real download progress. m4a (AAC) is forced
    // because Safari cannot play webm/opus.
    const args = [
      ...sharedYtdlpArgs(),
      "--no-playlist",
      "--no-progress",
      "--format",
      "bestaudio[ext=m4a]/140/bestaudio[acodec^=mp4a]/bestaudio",
      "--extract-audio",
      "--audio-format",
      "m4a",
      "--match-filter",
      `!is_live & duration <= ${MAX_DURATION_SECONDS}`,
      "--output",
      path.join(tempDir, "audio.%(ext)s"),
      "--",
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    const ytdlp = spawn(YTDLP, args, { stdio: ["ignore", "pipe", "pipe"] });

    let outputTail = "";
    const collectTail = (chunk) => {
      outputTail = (outputTail + chunk.toString()).slice(-2000);
    };
    ytdlp.stdout.on("data", collectTail);
    ytdlp.stderr.on("data", collectTail);

    const abortDownload = () => ytdlp.kill("SIGKILL");
    req.on("close", abortDownload);
    const killTimer = setTimeout(abortDownload, MAX_FETCH_MS);
    const exitCode = await new Promise((resolve, reject) => {
      ytdlp.on("error", reject);
      ytdlp.on("close", resolve);
    }).finally(() => {
      req.off("close", abortDownload);
      clearTimeout(killTimer);
    });

    if (exitCode !== 0 || !existsSync(audioPath)) {
      let reason = ytdlpFailureReason(outputTail);
      if (!reason && outputTail.includes("does not pass filter")) {
        reason =
          "Live streams and videos longer than 2 hours are not supported.";
      }
      console.error(`yt-dlp failed for ${videoId}: ${outputTail.trim()}`);
      // 500, not 502: Cloudflare replaces origin 502/504 bodies with its own
      // error page, which would hide this message from the browser.
      sendJSON(res, 500, {
        error: reason || "yt-dlp could not fetch this video's audio.",
      });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "audio/mp4",
      "Content-Length": statSync(audioPath).size,
      "Cache-Control": "no-store",
      "X-Video-Id": videoId,
      ...(title ? { "X-Video-Title": encodeURIComponent(title) } : {}),
    });
    await new Promise((resolve) => {
      createReadStream(audioPath).pipe(res).on("close", resolve);
    });
  } catch (error) {
    console.error(`Fetch failed for ${videoId}:`, error);
    if (!res.headersSent) {
      sendJSON(res, 500, { error: `Could not run yt-dlp: ${error.message}` });
    } else {
      res.destroy();
    }
  } finally {
    activeFetches -= 1;
    activeClientIps.delete(ip);
    cleanup().catch(() => {});
  }
}

function serveStatic(req, res, requestUrl) {
  // Mirror the Docker layout: / is the demo and /vendor/ maps to the
  // presets package inside node_modules.
  const relativePath =
    requestUrl.pathname === "/"
      ? "/examples/demo.html"
      : requestUrl.pathname.replace(
          /^\/vendor\/butterchurn-presets\//,
          "/node_modules/butterchurn-presets/dist/"
        );
  const filePath = path.join(STATIC_ROOT, path.normalize(relativePath));
  if (
    !filePath.startsWith(STATIC_ROOT) ||
    !existsSync(filePath) ||
    !statSync(filePath).isFile()
  ) {
    sendJSON(res, 404, { error: "Not found" });
    return;
  }
  res.writeHead(200, {
    "Content-Type":
      MIME_TYPES[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === "/api/youtube/health") {
    sendJSON(res, 200, { ok: true });
    return;
  }

  if (
    requestUrl.pathname === "/api/youtube/audio" ||
    requestUrl.pathname === "/api/youtube/playlist"
  ) {
    if (req.method !== "GET") {
      sendJSON(res, 405, { error: "Method not allowed" });
      return;
    }
    const handler =
      requestUrl.pathname === "/api/youtube/audio"
        ? streamYoutubeAudio
        : listPlaylistEntries;
    handler(req, res, requestUrl).catch((error) => {
      console.error("Unexpected error:", error);
      if (!res.headersSent) sendJSON(res, 500, { error: "Internal error" });
    });
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res, requestUrl);
    return;
  }

  sendJSON(res, 405, { error: "Method not allowed" });
});

server.listen(PORT, HOST, () => {
  console.log(`YouTube audio server listening on ${HOST}:${PORT}`);
});
