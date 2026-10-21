// server.mjs — KKfy: a local, Spotify-shaped music server.
//
// No dependencies. Node's own http module does everything:
//   • static files        GET /
//   • library JSON        GET /api/library
//   • cover art (jpg)     GET /api/cover/:id
//   • audio with seeking  GET /api/stream/:id   (HTTP 206 Range responses)
//   • likes/playlists     GET|PUT /api/state
//   • play counters       POST /api/play { id }
//
// Why Range matters: without it the browser cannot seek inside a track,
// because it has to download the whole file before you may jump to 3:00.

import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildLibrary } from "./lib/scan.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const CACHE = path.join(DATA, "covers");

// One music folder feeds both modes: the local server reads it directly, and
// scripts/build-static.mjs scans the same folder for the static/Vercel build.
const MUSIC_DIR = process.env.KKFY_MUSIC || path.join(PUBLIC, "KK");
const PORT = Number(process.env.KKFY_PORT || 7770);

/* ------------------------------------------------------------------ data --- */

let library = { tracks: [], albums: [], totalSeconds: 0 };

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 1));
}

const STATE_FILE = path.join(DATA, "userstate.json");
const STATS_FILE = path.join(DATA, "stats.json");

const emptyState = () => ({
  liked: [],
  playlists: [],
  volume: 0.8,
  shuffle: false,
  repeat: "off", // off | all | one
  lastTrackId: null,
});

const byId = (id) => library.tracks.find((t) => t.id === id) || null;

/* ---------------------------------------------------------------- helpers --- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
};

const json = (res, code, body) => {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": buf.length });
  res.end(buf);
};

async function body(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Parse "bytes=0-1023" -> {start, end} clamped to the file size. */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!m) return null;
  let start = m[1] === "" ? null : Number(m[1]);
  let end = m[2] === "" ? null : Number(m[2]);
  if (start === null && end === null) return null;
  if (start === null) {          // suffix range: last N bytes
    start = Math.max(0, size - end);
    end = size - 1;
  } else {
    end = end === null ? size - 1 : Math.min(end, size - 1);
  }
  if (start > end || start >= size) return { invalid: true };
  return { start, end };
}

/* ----------------------------------------------------------------- routes --- */

async function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: "forbidden" }); // no ../
  try {
    const buf = await fs.readFile(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
      "content-length": buf.length,
      "cache-control": "no-cache",
    });
    res.end(buf);
  } catch {
    // single-page app: unknown paths fall back to index.html
    const html = await fs.readFile(path.join(PUBLIC, "index.html"));
    res.writeHead(200, { "content-type": MIME[".html"], "content-length": html.length });
    res.end(html);
  }
}

async function serveStream(req, res, id) {
  const track = byId(id);
  if (!track) return json(res, 404, { error: "unknown track" });
  const file = path.join(MUSIC_DIR, track.file);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) return json(res, 404, { error: "file missing" });

  const range = parseRange(req.headers.range, stat.size);
  const headers = {
    "content-type": "audio/mpeg",
    "accept-ranges": "bytes",
    "cache-control": "no-cache",
  };

  if (!range) {
    res.writeHead(200, { ...headers, "content-length": stat.size });
    if (req.method === "HEAD") return res.end();
    return createReadStream(file).pipe(res);
  }
  if (range.invalid) {
    res.writeHead(416, { "content-range": `bytes */${stat.size}` });
    return res.end();
  }
  res.writeHead(206, {
    ...headers,
    "content-range": `bytes ${range.start}-${range.end}/${stat.size}`,
    "content-length": range.end - range.start + 1,
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file, { start: range.start, end: range.end }).pipe(res);
}

async function serveCover(res, id) {
  const file = path.join(CACHE, `${id}.jpg`);
  try {
    const buf = await fs.readFile(file);
    res.writeHead(200, {
      "content-type": "image/jpeg",
      "content-length": buf.length,
      "cache-control": "public, max-age=86400",
    });
    res.end(buf);
  } catch {
    res.writeHead(404).end();
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  try {
    if (p === "/api/library") return json(res, 200, library);

    if (p.startsWith("/api/cover/")) return serveCover(res, p.split("/").pop());

    if (p.startsWith("/api/stream/")) return serveStream(req, res, p.split("/").pop());

    if (p === "/api/state" && req.method === "GET") {
      return json(res, 200, await readJson(STATE_FILE, emptyState()));
    }
    if (p === "/api/state" && req.method === "PUT") {
      const next = JSON.parse(await body(req));
      const base = emptyState();
      const safe = Object.fromEntries(
        Object.entries(base).map(([k, v]) => [k, next[k] !== undefined ? next[k] : v]),
      );
      // only ids that still exist survive a rescan
      safe.liked = safe.liked.filter((id) => byId(id));
      safe.playlists = safe.playlists.map((pl) => ({
        id: pl.id,
        name: String(pl.name).slice(0, 60),
        trackIds: (pl.trackIds || []).filter((id) => byId(id)),
      }));
      await writeJson(STATE_FILE, safe);
      return json(res, 200, safe);
    }

    if (p === "/api/play" && req.method === "POST") {
      const { id } = JSON.parse(await body(req));
      if (!byId(id)) return json(res, 404, { error: "unknown track" });
      const stats = await readJson(STATS_FILE, {});
      const row = stats[id] || { plays: 0, lastPlayed: 0 };
      row.plays += 1;
      row.lastPlayed = Date.now();
      stats[id] = row;
      await writeJson(STATS_FILE, stats);
      return json(res, 200, row);
    }

    if (p === "/api/stats") return json(res, 200, await readJson(STATS_FILE, {}));

    if (p === "/api/rescan" && req.method === "POST") {
      library = await buildLibrary(MUSIC_DIR, DATA);
      return json(res, 200, { tracks: library.tracks.length, albums: library.albums.length });
    }

    return serveStatic(res, p);
  } catch (err) {
    console.error(err);
    json(res, 500, { error: String(err?.message || err) });
  }
});

/* ------------------------------------------------------------------- boot --- */

const cached = await readJson(path.join(DATA, "library.json"), null);
if (cached?.tracks?.length) {
  library = cached;
  console.log(`library: ${cached.tracks.length} tracks (cached index)`);
} else {
  console.log(`scanning ${MUSIC_DIR} …`);
  library = await buildLibrary(MUSIC_DIR, DATA);
  console.log(`library: ${library.tracks.length} tracks scanned`);
}
if (library.skipped?.length) {
  for (const s of library.skipped) console.log(`  skipped: ${s.file} — ${s.reason}`);
}

server.listen(PORT, "127.0.0.1", () => {
  const mins = Math.round(library.totalSeconds / 60);
  console.log(`KKfy ready  →  http://127.0.0.1:${PORT}   (${library.tracks.length} songs, ${mins} min)`);
});
