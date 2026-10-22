// scripts/build-static.mjs — turn the local library into files a static host can serve.
//
//   node scripts/build-static.mjs
//
//   public/library.json   the index the browser fetches instead of /api/library
//   public/covers/*.jpg   cover art (a static host has no /api/cover/:id)
//   public/KK/*.mp3       already there — the browser streams them straight from
//                         the CDN, which does HTTP Range natively
//
// Track entries get two extra fields in the static build:
//   src    →  "KK/<urlencoded file>"   instead of /api/stream/:id
//   cover  →  "covers/<id>.jpg"        instead of /api/cover/:id

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLibrary } from "../lib/scan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const MUSIC = path.join(PUBLIC, "KK");

const t0 = Date.now();
console.log(`scanning ${MUSIC} …`);
const lib = await buildLibrary(MUSIC, DATA);

// covers: data/covers (extracted by the scanner) → public/covers
await fs.mkdir(path.join(PUBLIC, "covers"), { recursive: true });
let copied = 0;
for (const f of await fs.readdir(path.join(DATA, "covers"))) {
  await fs.copyFile(path.join(DATA, "covers", f), path.join(PUBLIC, "covers", f));
  copied++;
}

/** "/api/cover/932a2749f3ca" -> "covers/932a2749f3ca.jpg".
 *  The file is named after the TRACK it was extracted from, which is not the
 *  same as the album id — using a.id here broke 75 of 76 album covers. */
const coverFile = (url) => {
  const id = url?.split("/").pop();
  return id ? `covers/${id}.jpg` : null;
};

for (const t of lib.tracks) {
  t.src = `KK/${encodeURIComponent(t.file)}`;
  t.cover = coverFile(t.cover);
}
for (const a of lib.albums) a.cover = coverFile(a.cover);

const out = {
  generatedAt: lib.generatedAt,
  tracks: lib.tracks,
  albums: lib.albums,
  skipped: lib.skipped,
  totalSeconds: lib.totalSeconds,
  staticBuild: true,
};
const FILE = path.join(PUBLIC, "library.json");
const body = JSON.stringify(out, null, 1);

// Idempotent on purpose: compare ignoring the timestamp, otherwise every run
// rewrites "generatedAt" and ships a 1-line commit + a pointless Vercel rebuild.
const stable = (s) => { const o = JSON.parse(s); delete o.generatedAt; return JSON.stringify(o); };
let prev = null;
try { prev = await fs.readFile(FILE, "utf8"); } catch {}
const unchanged = prev !== null && stable(prev) === stable(body);

console.log(`covers copied : ${copied}`);
console.log(`tracks         : ${lib.tracks.length}`);
console.log(`albums         : ${lib.albums.length}`);
console.log(`skipped        : ${lib.skipped.length ? lib.skipped.map((s) => s.file).join(", ") : "none"}`);
console.log(unchanged
  ? `written        : public/library.json (unchanged, kept previous timestamp)`
  : `written        : public/library.json (${(body.length / 1024).toFixed(0)} KB)`);
console.log(`took           : ${Date.now() - t0} ms`);

if (!unchanged) await fs.writeFile(FILE, body);
