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

for (const t of lib.tracks) {
  t.src = `KK/${encodeURIComponent(t.file)}`;
  t.cover = t.cover ? `covers/${t.id}.jpg` : null;
}
for (const a of lib.albums) a.cover = a.cover ? `covers/${a.id}.jpg` : null;

const out = {
  generatedAt: lib.generatedAt,
  tracks: lib.tracks,
  albums: lib.albums,
  skipped: lib.skipped,
  totalSeconds: lib.totalSeconds,
  staticBuild: true,
};
await fs.writeFile(path.join(PUBLIC, "library.json"), JSON.stringify(out, null, 1));

console.log(`covers copied : ${copied}`);
console.log(`tracks         : ${lib.tracks.length}`);
console.log(`albums         : ${lib.albums.length}`);
console.log(`skipped        : ${lib.skipped.length ? lib.skipped.map((s) => s.file).join(", ") : "none"}`);
console.log(`written        : public/library.json (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
console.log(`took           : ${Date.now() - t0} ms`);
