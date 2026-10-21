// lib/scan.mjs — build a library index from a folder of mp3 files.
//
// For every *.mp3 we ask ffprobe for its tags + stream info (one process per
// file, ~40 ms each) and pull the embedded cover art out with ffmpeg.
// The result is a plain JSON structure the server can serve as-is.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const run = promisify(execFile);

// Site names that pirates inject into tags. Any of these means "this field is junk".
// They usually arrive as "- DJMaza" or, from filenames, as "_128-(DJMaza)", so the
// numeric download artefact is removed together with the site name.
const SITES =
  "jio\\s*songs|pagal\\s*world|pagal\\s*songs?|pagal\\s*new|pagla\\s*songs|djmaza|hot\\s*mentos|sab\\s*tunes|mp3\\s*wale|raag\\.?\\s*fm|songspk|mr-?jatt|top\\s*mp3";
const JUNK_RE = new RegExp(`[-_]?\\s*\\d{2,3}\\s*[-_]?\\s*\\(?\\s*(?:${SITES})\\)?|\\(?\\s*(?:${SITES})\\)?`, "gi");

// A real host name — deliberately strict so "Life In A Metro" and "Main" are safe.
const DOMAIN_RE =
  /\b(?:www\.)?[a-z0-9][a-z0-9-]*\.(?:com|in|net|fm|org|co|live|cool|me|xyz|club|info)\b/gi;

/** Strip site names, HTML entities, download-artefacts and stray punctuation. */
export function clean(input) {
  let t = String(input ?? "");
  t = t.replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
  t = t.replace(/[_\u00a0]/g, " ");             // "KK_128" -> "KK 128"
  t = t.replace(DOMAIN_RE, " ");                // "www.hotmentos.com" -> " "
  t = t.replace(JUNK_RE, " ");                  // "DJMaza" -> " "
  t = t.replace(/\b\d{2,3}\s*kbps\b/gi, " ");   // "128 kbps"
  t = t.replace(/\(\s*\)|\[\s*\]/g, " ");        // empty brackets left behind
  t = t.replace(/\bkk[\s._-]*\d{2,3}\b/gi, " "); // "- KK 128" scrap left by the filename
  t = t.replace(/\s*[-–]\s*k\.?k\.?\s*$/i, " "); // "- KK" uploader scrap
  t = t.replace(/\.{2,}/g, ".");                // "By..kk" -> "By.kk"
  t = t.replace(/\s*by\s*[\s._]*k\.?k\.?\s*$/i, " "); // "…By..kk" -> drop the uploader tag
  t = t.replace(/^\s*\d{1,2}\s*[-–.,]?\s+/, "");  // "09 - " track prefix
  t = t.replace(/\s{2,}/g, " ").trim();
  t = t.replace(/^[\s\-–.,:]+|[\s\-–.,:]+$/g, "");
  return t;
}

/** "KK", "K.K", "Kk", "kk" -> "KK" so one artist isn't split into five. */
const normArtist = (s) => (/^k\.?\s*k\.?$/i.test(s.trim()) ? "KK" : s.trim());

const isKK = (s) => normArtist(clean(s)) === "KK";

/** Fallback: "Dil Ibaadat (Rock) - Tum Mile 128 Kbps.mp3" */
function fromFilename(file) {
  const base = path.basename(file, path.extname(file));
  const stripped = clean(base);
  const parts = stripped.split(/\s+[-–]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { title: parts[0], album: parts[parts.length - 1] };
  return { title: stripped, album: "" };
}

function yearOf(tags, albumFallback) {
  const d = clean(tags.date || tags.year || "");
  const m = d.match(/\b(19|20)\d{2}\b/);
  if (m) return Number(m[0]);
  const fromAlbum = String(albumFallback || "").match(/\((19|20)\d{2}\)/);
  return fromAlbum ? Number(fromAlbum[0].slice(1, 5)) : null;
}

async function probe(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,bit_rate:format_tags:stream=codec_type,codec_name,width,height",
    "-of", "json",
    file,
  ], { maxBuffer: 1024 * 1024 * 8 });
  const j = JSON.parse(stdout);
  const tags = Object.fromEntries(
    Object.entries(j.format?.tags ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    tags,
    duration: Number(j.format?.duration ?? 0),
    bitrate: Math.round(Number(j.format?.bit_rate ?? 0) / 1000),
    hasCover: (j.streams ?? []).some((s) => s.codec_type === "video" && /jpeg|png|bmp/.test(s.codec_name)),
  };
}

/** Extract the embedded picture to cache/covers/<id>.jpg (once). */
async function extractCover(file, id, coverDir) {
  const out = path.join(coverDir, `${id}.jpg`);
  try {
    await fs.access(out);
    return true;
  } catch {}
  try {
    await run("ffmpeg", [
      "-v", "error", "-y",
      "-i", file,
      "-an", "-vcodec", "copy",
      "-frames:v", "1",
      out,
    ], { maxBuffer: 1024 * 1024 * 4 });
    await fs.access(out);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} musicDir  folder with mp3 files
 * @param {string} dataDir   where library.json + covers live
 */
export async function buildLibrary(musicDir, dataDir) {
  const coverDir = path.join(dataDir, "covers");
  await fs.mkdir(coverDir, { recursive: true });

  const files = (await fs.readdir(musicDir))
    .filter((f) => /\.mp3$/i.test(f))
    .sort((a, b) => a.localeCompare(b));

  const tracks = [];
  const skipped = [];
  for (const file of files) {
    const abs = path.join(musicDir, file);
    const id = crypto.createHash("sha1").update(file).digest("hex").slice(0, 12);

    // Dead downloads happen: a 0-byte or truncated mp3 must not kill the scan.
    const stat = await fs.stat(abs);
    const size = stat.size;
    let info;
    try {
      if (size === 0) throw new Error("empty file (0 bytes)");
      info = await probe(abs);
    } catch (err) {
      skipped.push({ file, reason: String(err.message || err).split("\n")[0] });
      continue;
    }
    const { tags } = info;

    const fallback = fromFilename(file);
    let rawTitle = String(tags.title ?? "");
    let album = clean(tags.album);
    let artistRaw = clean(tags.artist);

    // Some rips put the movie in "album" and "KK" in "artist" (or the reverse).
    if (isKK(album) && artistRaw && !isKK(artistRaw)) [album, artistRaw] = [artistRaw, "KK"];

    // A compilation keeps "Song - Movie" inside the title field. Recover both halves.
    if (/best of|greatest|\bhits\b|vol\b|collection/i.test(album)) {
      const m = rawTitle.match(/^(.+?)\s+[-–]\s+(.+)$/);
      if (m) {
        rawTitle = m[1];
        const movie = clean(m[2]);
        if (movie && !isKK(movie)) album = movie;   // "… - KK" is not a movie name
      }
    }

    let title = clean(rawTitle);
    if (!title || isKK(title)) title = fallback.title;
    if (!album || isKK(album)) album = fallback.album;
    if (!album) album = "Singles";

    const artists = artistRaw
      .split(",")
      .map((a) => normArtist(clean(a)))
      .filter((a) => a && !/^\d+$/.test(a));
    if (artists.length === 0) artists.push("KK");

    const cover = info.hasCover && (await extractCover(abs, id, coverDir)) ? `/api/cover/${id}` : null;
    const year = yearOf(tags, tags.album);

    tracks.push({
      id,
      file,
      title,
      album,
      year,
      artists,
      artist: artists[0],
      duration: Math.round(info.duration),
      bitrate: info.bitrate,
      cover,
      addedAt: Math.round(stat.mtimeMs),
    });
  }

  // albums = group by album name — the same thing Spotify does
  const albumMap = new Map();
  for (const t of tracks) {
    const key = t.album;
    if (!albumMap.has(key)) {
      albumMap.set(key, {
        id: crypto.createHash("sha1").update(key).digest("hex").slice(0, 10),
        name: t.album,
        year: null,
        cover: t.cover,
        trackIds: [],
        yearVotes: {},
      });
    }
    const a = albumMap.get(key);
    a.trackIds.push(t.id);
    if (!a.cover) a.cover = t.cover;
    if (t.year) a.yearVotes[t.year] = (a.yearVotes[t.year] || 0) + 1;
  }
  // year = the one most of the album's tracks agree on (ties -> earliest)
  for (const a of albumMap.values()) {
    a.year = Number(
      Object.entries(a.yearVotes).sort((x, y) => y[1] - x[1] || Number(x[0]) - Number(y[0]))[0]?.[0],
    ) || null;
    delete a.yearVotes;
  }
  const albums = [...albumMap.values()].sort(
    (a, b) => (b.year ?? 0) - (a.year ?? 0) || a.name.localeCompare(b.name),
  );

  const lib = {
    generatedAt: new Date().toISOString(),
    musicDir,
    tracks,
    albums,
    skipped,
    totalSeconds: tracks.reduce((n, t) => n + t.duration, 0),
  };

  await fs.writeFile(path.join(dataDir, "library.json"), JSON.stringify(lib, null, 1));
  return lib;
}
