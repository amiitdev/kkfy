// app.js — the KKfy player.  No framework, no build step.
//
//   index.html  ->  structure (top bar, sidebar, main, player, queue)
//   app.js      ->  state + routing + rendering + the <audio> engine
//   server.mjs  ->  /api/library  /api/stream/:id  /api/cover/:id  /api/state
//
// Everything the user does (likes, playlists, volume, shuffle/repeat) is
// mirrored to the server so it survives a reload or a different browser.

const $ = (s) => document.querySelector(s);
const audio = $("#audio");

const S = {
  lib: null,                 // { tracks, albums, skipped }
  byId: new Map(),
  user: null,                // { liked, playlists, volume, shuffle, repeat, lastTrackId }
  stats: {},                 // { [trackId]: { plays, lastPlayed } }
  view: { name: "home" },
  queue: [],                 // track ids, in play order
  qpos: -1,                  // index into queue
  libFilter: "all",
  saveTimer: null,
  toastTimer: null,
};

/* --------------------------------------------------------------- helpers --- */

// The same bundle runs in two places: against `node server.mjs` (every /api/*
// route exists) and against a static host such as Vercel (nothing but files).
// Detected once at boot from which library endpoint answered.
const API = { server: false, state: "kkfy:state", stats: "kkfy:stats" };

const localState = () => ({
  liked: [], playlists: [], volume: 0.8, shuffle: false, repeat: "off", lastTrackId: null,
});

async function firstOk(paths) {
  for (const p of paths) {
    try {
      const r = await fetch(p);
      if (r.ok) return { path: p, body: await r.json() };
    } catch { /* try the next source */ }
  }
  throw new Error(`none of these answered: ${paths.join(", ")}`);
}

const lsGet = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
};
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

const fmt = (s) => {
  s = Math.max(0, Math.round(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dur = (s) => {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} hr ${m} min` : `${m} min`;
};
const track = (id) => S.byId.get(id) || null;
const albumById = (id) => S.lib.albums.find((a) => a.id === id) || null;
/** Where the bytes live: the static build ships `src`, the local server uses /api/stream. */
const srcOf = (t) => t.src || `/api/stream/${t.id}`;

const cover = (t, cls = "cover") =>
  t?.cover
    ? `<img class="${cls}" src="${t.cover}" alt="" loading="lazy" />`
    : `<div class="${cls} ph">${ICONS.disc}</div>`;

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(() => (el.hidden = true), 1800);
}

/** Persist user state: always in this browser, plus the server when there is one. */
function save() {
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(async () => {
    lsSet(API.state, S.user);
    if (!API.server) return;
    try {
      const res = await fetch("/api/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(S.user),
      });
      S.user = await res.json();
    } catch (e) {
      console.warn("state not saved", e);
    }
  }, 400);
}

/* ---------------------------------------------------------------- player --- */

function playQueue(ids, pos = 0, autoplay = true) {
  S.queue = ids.slice();
  S.qpos = pos;
  loadCurrent(autoplay);
}

function loadCurrent(autoplay = true) {
  const t = track(S.queue[S.qpos]);
  if (!t) return;
  audio.src = srcOf(t);
  S.user.lastTrackId = t.id;
  save();
  paintNowPlaying();
  renderQueue();
  if (autoplay) audio.play().catch((e) => toast(`Cannot play: ${e.message}`));
  else paintPlayButton(false);
}

function togglePlay() {
  if (!S.queue.length) return playQueue(S.lib.tracks.map((t) => t.id), 0);
  if (audio.paused) audio.play().catch((e) => toast(e.message));
  else audio.pause();
}

/** Shuffle: pick the next id from what is left, never repeating the last one. */
function pickShuffled() {
  const rest = S.queue.filter((_, i) => i !== S.qpos);
  if (!rest.length) return S.qpos;
  return S.queue.indexOf(rest[Math.floor(Math.random() * rest.length)]);
}

function next(auto = false) {
  if (!S.queue.length) return;
  if (S.user.repeat === "one" && auto) return void (audio.currentTime = 0) || audio.play();
  if (S.user.shuffle) {
    if (S.qpos >= S.queue.length - 1 && S.user.repeat !== "all") return stop();
    return void (S.qpos = pickShuffled(), loadCurrent(true));
  }
  if (S.qpos < S.queue.length - 1) return void (S.qpos++, loadCurrent(true));
  if (S.user.repeat === "all") return void (S.qpos = 0, loadCurrent(true));
  if (auto) stop();
}

function prev() {
  if (!S.queue.length) return;
  if (audio.currentTime > 3) return void (audio.currentTime = 0);   // like Spotify: 3 s rule
  if (S.qpos > 0) return void (S.qpos--, loadCurrent(true));
  audio.currentTime = 0;
}

function stop() {
  audio.pause();
  audio.currentTime = 0;
  paintPlayButton(false);
}

function toggleLike(id) {
  const i = S.user.liked.indexOf(id);
  if (i >= 0) S.user.liked.splice(i, 1);
  else S.user.liked.push(id);
  save();
  paintLike();
  if (S.view.name === "liked") render();
  refreshTableLikes();
}

/* ------------------------------------------------------------ rendering ---- */

const playIdsOf = (tracks) => tracks.map((t) => t.id);

function shelf(title, inner, href = "") {
  return `<section class="shelf">
    <div class="headline">
      <h2>${esc(title)}</h2>
      ${href ? `<a class="see-all" href="${href}">Show all</a>` : ""}
    </div>${inner}
  </section>`;
}

function card({ href, coverHtml, title, sub }) {
  return `<a class="card" href="${href}">
    ${coverHtml}
    <div class="card-title">${esc(title)}</div>
    <div class="card-sub">${esc(sub)}</div>
  </a>`;
}

function trackTable(tracks, { contextName, startId } = {}) {
  if (!tracks.length) return `<p class="empty">Nothing here yet.</p>`;
  const ids = playIdsOf(tracks);
  return `<table class="table" data-ids="${ids.join(",")}">
    <thead><tr><th class="t-index">#</th><th>Title</th><th class="t-like"></th><th class="t-dur">${ICONS.clock}</th></tr></thead>
    <tbody>
      ${tracks
        .map((t, i) => {
          const cur = S.queue[S.qpos] === t.id;
          const liked = S.user.liked.includes(t.id);
          return `<tr data-id="${t.id}" class="${cur ? "playing" : ""}">
            <td class="t-index">${i + 1}</td>
            <td>
              <div class="t-title">${esc(t.title)}</div>
              <div class="t-sub">${esc(t.artists.join(", "))}${t.album ? " · " + esc(t.album) : ""}</div>
            </td>
            <td class="t-like ${liked ? "liked" : ""}" data-like="${t.id}">${liked ? ICONS.heartFill : ICONS.heart}</td>
            <td class="t-dur">${fmt(t.duration)}</td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>`;
}

function viewHome() {
  const tracks = S.lib.tracks;
  const recent = [...tracks].sort((a, b) => b.addedAt - a.addedAt).slice(0, 10);
  const top = [...tracks]
    .filter((t) => S.stats[t.id]?.plays)
    .sort((a, b) => (S.stats[b.id].plays ?? 0) - (S.stats[a.id].plays ?? 0))
    .slice(0, 10);
  const decade = (lo, hi) => tracks.filter((t) => t.year && t.year >= lo && t.year <= hi);

  const cards = (list) =>
    `<div class="grid">${list
      .map((t) =>
        card({
          href: `#/album/${S.lib.albums.find((a) => a.trackIds.includes(t.id))?.id ?? ""}`,
          coverHtml: cover(t),
          title: t.title,
          sub: t.artists.join(", "),
        }),
      )
      .join("")}</div>`;

  const albumCard = (a) =>
    card({
      href: `#/album/${a.id}`,
      coverHtml: cover({ cover: a.cover }),
      title: a.name,
      sub: a.year ? `${a.year} · ${a.trackIds.length} songs` : `${a.trackIds.length} songs`,
    });

  return `
    ${S.lib.skipped?.length ? `<div class="banner">${S.lib.skipped.length} file could not be read and was skipped: ${esc(
      S.lib.skipped.map((s) => s.file).join(", "),
    )}</div>` : ""}
    <div class="headline"><h1>Good ${greeting()}</h1></div>
    <div class="grid wide">
      <a class="card" href="#/liked" style="display:flex;gap:12px;align-items:center;background:linear-gradient(135deg,#3b2f63,#121212)">
        <div class="heart-tile" style="width:72px;height:72px;border-radius:6px;background:linear-gradient(135deg,#450af5,#c4efd9);display:grid;place-items:center;color:#fff;flex:none">${ICONS.heartFill}</div>
        <div><div class="card-title">Liked Songs</div><div class="card-sub">${S.user.liked.length} songs</div></div>
      </a>
      ${S.lib.albums.slice(0, 5)
        .map((a) => `<a class="card" href="#/album/${a.id}" style="display:flex;gap:12px;align-items:center;background:#1f1f1f">
          ${cover({ cover: a.cover }, "art")}
          <div class="card-title">${esc(a.name)}</div>
        </a>`)
        .join("")}
    </div>
    ${top.length ? shelf("Your top songs", cards(top), "#/songs") : ""}
    ${shelf("Recently added", cards(recent), "#/songs")}
    ${shelf("Albums", `<div class="grid">${S.lib.albums.slice(0, 10).map(albumCard).join("")}</div>`, "#/albums")}
    ${decade(1999, 2005).length ? shelf("Late 90s & 2000s", cards(decade(1999, 2005))) : ""}
    ${decade(2006, 2012).length ? shelf("2006 – 2012", cards(decade(2006, 2012))) : ""}
    ${decade(2013, 2030).length ? shelf("2013 and later", cards(decade(2013, 2030))) : ""}`;
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
};

function viewAlbum(id) {
  const a = albumById(id);
  if (!a) return `<p class="empty">Album not found.</p>`;
  const tracks = a.trackIds.map(track).filter(Boolean);
  const mins = Math.round(tracks.reduce((n, t) => n + t.duration, 0) / 60);
  return `
    <div class="detail-head">
      <div class="cover">${a.cover ? `<img class="cover" src="${a.cover}" alt="" />` : ICONS.disc}</div>
      <div>
        <div class="detail-kind">Album</div>
        <h1 class="detail-title">${esc(a.name)}</h1>
        <div class="detail-meta">${a.year ? esc(String(a.year)) + " · " : ""}${tracks.length} songs · ${mins} min</div>
      </div>
    </div>
    <div class="detail-actions">
      <button class="big-play" data-playall="${idsOf(tracks)}">${ICONS.play}</button>
    </div>
    ${trackTable(tracks)}`;
}

const idsOf = (tracks) => playIdsOf(tracks).join(",");

function viewPlaylist(id) {
  const pl = S.user.playlists.find((p) => p.id === id);
  if (!pl) return `<p class="empty">Playlist not found.</p>`;
  const tracks = pl.trackIds.map(track).filter(Boolean);
  return `
    <div class="detail-head">
      <div class="cover">${ICONS.queue}</div>
      <div>
        <div class="detail-kind">Playlist</div>
        <h1 class="detail-title">${esc(pl.name)}</h1>
        <div class="detail-meta">${tracks.length} songs · ${dur(tracks.reduce((n, t) => n + t.duration, 0))}</div>
      </div>
    </div>
    <div class="detail-actions">
      <button class="big-play" data-playall="${idsOf(tracks)}">${ICONS.play}</button>
      <button class="icon-btn" data-deletepl="${pl.id}" title="Delete playlist">${ICONS.close}</button>
    </div>
    ${trackTable(tracks)}`;
}

function viewLiked() {
  const tracks = S.user.liked.map(track).filter(Boolean);
  return `
    <div class="detail-head">
      <div class="cover" style="background:linear-gradient(135deg,#450af5,#c4efd9);display:grid;place-items:center;color:#fff">${ICONS.heartFill}</div>
      <div>
        <div class="detail-kind">Playlist</div>
        <h1 class="detail-title">Liked Songs</h1>
        <div class="detail-meta">${tracks.length} songs · ${dur(tracks.reduce((n, t) => n + t.duration, 0))}</div>
      </div>
    </div>
    <div class="detail-actions"><button class="big-play" data-playall="${idsOf(tracks)}">${ICONS.play}</button></div>
    ${tracks.length ? trackTable(tracks) : `<p class="empty">Songs you like with the heart button will show up here.</p>`}`;
}

function viewSongs() {
  const tracks = S.lib.tracks;
  return `<div class="headline"><h1>All songs</h1></div>
    <p class="detail-meta">${tracks.length} songs · ${dur(S.lib.totalSeconds)}</p>
    <div class="detail-actions"><button class="big-play" data-playall="${idsOf(tracks)}">${ICONS.play}</button></div>
    ${trackTable(tracks)}`;
}

function viewAlbums() {
  return `<div class="headline"><h1>Albums</h1></div>
    <div class="grid">
      ${S.lib.albums
        .map((a) =>
          card({ href: `#/album/${a.id}`, coverHtml: cover({ cover: a.cover }), title: a.name, sub: a.year ? `${a.year} · ${a.trackIds.length} songs` : `${a.trackIds.length} songs` }),
        )
        .join("")}
    </div>`;
}

function viewArtists() {
  const map = new Map();
  for (const t of S.lib.tracks) for (const a of t.artists) map.set(a, (map.get(a) || 0) + 1);
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]);
  return `<div class="headline"><h1>Artists</h1></div>
    <div class="grid">
      ${rows
        .map(
          ([name, n]) =>
            `<a class="card" href="#/search?q=${encodeURIComponent(name)}">
              <div class="cover round ph" style="background:linear-gradient(135deg,#2a2a3a,#121212)">${ICONS.disc}</div>
              <div class="card-title">${esc(name)}</div>
              <div class="card-sub">${n} songs</div>
            </a>`,
        )
        .join("")}
    </div>`;
}

function viewSearch(q) {
  const needle = (q || "").trim().toLowerCase();
  const hit = (t) => [t.title, t.album, t.artists.join(" ")].join(" ").toLowerCase().includes(needle);
  if (!needle) return `<div class="headline"><h1>Search</h1></div><p class="empty">Type a song, movie or artist name above.</p>`;
  const tracks = S.lib.tracks.filter(hit);
  const albums = S.lib.albums.filter((a) => a.name.toLowerCase().includes(needle));
  const artists = [...new Set(S.lib.tracks.flatMap((t) => t.artists))].filter((a) => a.toLowerCase().includes(needle));
  if (!tracks.length && !albums.length) return `<div class="headline"><h1>Search</h1></div><p class="empty">No results for “${esc(q)}”.</p>`;
  return `
    <div class="headline"><h1>Search</h1></div>
    ${tracks.length ? shelf(`Top result & songs`, `<div class="grid wide">${card({ href: `#/song/${tracks[0].id}`, coverHtml: cover(tracks[0]), title: tracks[0].title, sub: tracks[0].artists.join(", ") })}</div>`) : ""}
    ${tracks.length ? shelf("Songs", trackTable(tracks)) : ""}
    ${albums.length ? shelf("Albums", `<div class="grid">${albums.map((a) => card({ href: `#/album/${a.id}`, coverHtml: cover({ cover: a.cover }), title: a.name, sub: a.year ? `${a.year}` : "" })).join("")}</div>`) : ""}
    ${artists.length ? shelf("Artists", `<div class="grid">${artists.map((n) => `<a class="card" href="#/search?q=${encodeURIComponent(n)}"><div class="cover round ph" style="background:linear-gradient(135deg,#2a2a3a,#121212)">${ICONS.disc}</div><div class="card-title">${esc(n)}</div></a>`).join("")}</div>`) : ""}`;
}

/* ---------------------------------------------------------------- router --- */

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, query] = h.split("?");
  const [name, arg] = path.split("/");
  return { name: name || "home", arg, q: new URLSearchParams(query || "").get("q") || "" };
}

function render() {
  const v = S.view;
  const html =
    v.name === "album" ? viewAlbum(v.arg)
    : v.name === "playlist" ? viewPlaylist(v.arg)
    : v.name === "liked" ? viewLiked()
    : v.name === "songs" ? viewSongs()
    : v.name === "albums" ? viewAlbums()
    : v.name === "artists" ? viewArtists()
    : v.name === "search" ? viewSearch(v.q)
    : viewHome();

  $("#view").innerHTML = html;
  $("#main").scrollTop = 0;
  paintIcons($("#view"));
  renderSidebar();
  paintNav();
  refreshTableLikes();
}

function renderSidebar() {
  const f = S.libFilter;
  const likedRow = `<div class="row" data-open="liked">
      <div class="art tile" style="background:linear-gradient(135deg,#450af5,#c4efd9);color:#fff">${ICONS.heartFill}</div>
      <div><div class="row-name">Liked Songs</div><div class="row-sub">Playlist · ${S.user.liked.length} songs</div></div>
    </div>`;

  const pls = S.user.playlists
    .map((p) => `<div class="row" data-open="playlist:${p.id}">
        <div class="art tile" style="background:#282828;color:#b3b3b3">${ICONS.queue}</div>
        <div><div class="row-name">${esc(p.name)}</div><div class="row-sub">Playlist · ${p.trackIds.length} songs</div></div>
      </div>`);

  const als = S.lib.albums.map((a) => `<div class="row" data-open="album:${a.id}">
        ${a.cover ? `<img class="art" src="${a.cover}" alt="" />` : `<div class="art tile" style="background:#282828;color:#b3b3b3">${ICONS.disc}</div>`}
        <div><div class="row-name">${esc(a.name)}</div><div class="row-sub">Album · ${esc([...new Set(a.trackIds.map((id) => track(id)?.artist))].filter(Boolean).slice(0, 2).join(", "))}</div></div>
      </div>`);

  const all = `<div class="row" data-open="songs">
      <div class="art tile" style="background:linear-gradient(135deg,#1ed760,#0b6b31);color:#000">${ICONS.disc}</div>
      <div><div class="row-name">All Songs</div><div class="row-sub">${S.lib.tracks.length} songs</div></div>
    </div>`;

  $("#lib-list").innerHTML =
    (f === "all" || f === "playlists" ? likedRow + pls.join("") : "") +
    (f === "all" || f === "albums" ? als.join("") : "") +
    (f === "all" ? all : "");
  $("#library-stats").textContent =
    `${S.lib.tracks.length} songs · ${dur(S.lib.totalSeconds)}` +
    (S.lib.staticBuild ? "" : ` in ${S.lib.musicDir}`);
}

function renderQueue() {
  const now = track(S.queue[S.qpos]);
  const nextIds = S.queue.slice(S.qpos + 1);
  $("#queue-body").innerHTML = `
    ${now ? `<div class="queue-label">Now playing</div>
      <div class="row current" data-queueplay="${S.qpos}">
        ${now.cover ? `<img class="art" src="${now.cover}" alt="" />` : `<div class="art tile" style="background:#282828">${ICONS.note}</div>`}
        <div><div class="row-name">${esc(now.title)}</div><div class="row-sub">${esc(now.artists.join(", "))}</div></div>
      </div>` : `<p class="empty" style="padding:16px">Queue is empty.</p>`}
    ${nextIds.length ? `<div class="queue-label">Next up</div>` : ""}
    ${nextIds
      .map((id, i) => {
        const t = track(id);
        if (!t) return "";
        return `<div class="row" data-queueplay="${S.qpos + 1 + i}">
          ${t.cover ? `<img class="art" src="${t.cover}" alt="" />` : `<div class="art tile" style="background:#282828">${ICONS.note}</div>`}
          <div><div class="row-name">${esc(t.title)}</div><div class="row-sub">${esc(t.artists.join(", "))}</div></div>
        </div>`;
      })
      .join("")}`;
}

/* -------------------------------------------------------------- painting --- */

function paintNowPlaying() {
  const t = track(S.queue[S.qpos]);
  $("#np-title").textContent = t ? t.title : "Nothing playing";
  $("#np-artist").textContent = t ? t.artists.join(", ") : "Pick a song to start";
  $("#sheet-title").textContent = t ? t.title : "Nothing playing";
  $("#sheet-artist").textContent = t ? t.artists.join(", ") : "";
  $("#sheet-album").textContent = t ? t.album || "" : "";

  const img = $("#np-cover"), sheetImg = $("#sheet-cover");
  if (t?.cover) {
    img.src = t.cover; img.hidden = false; $("#np-tile").hidden = true;
    sheetImg.src = t.cover; sheetImg.hidden = false; $("#sheet-tile").hidden = true;
  } else {
    img.hidden = true; $("#np-tile").hidden = false;
    sheetImg.hidden = true; $("#sheet-tile").hidden = false;
  }
  document.title = t ? `${t.title} · KKfy` : "KKfy — your local music";
  paintLike();

  // lock-screen / media-key integration, exactly like a desktop player would
  if (t && "mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artists.join(", "), album: t.album,
      artwork: t.cover ? [{ src: t.cover, sizes: "512x512", type: "image/jpeg" }] : [],
    });
  }
}

/** Every control exists twice (player bar + now-plying sheet), so paint them all. */
const all = (sel) => [...document.querySelectorAll(sel)];

const paintPlayButton = (playing) => {
  for (const b of all('[data-act="play"]')) {
    b.innerHTML = playing ? ICONS.pause : ICONS.play;
    b.title = playing ? "Pause" : "Play";
    b.setAttribute("aria-label", b.title);
  }
};

const paintLike = () => {
  const t = track(S.queue[S.qpos]);
  const on = t && S.user.liked.includes(t.id);
  for (const b of all('[data-act="like"]')) {
    b.innerHTML = on ? ICONS.heartFill : ICONS.heart;
    b.classList.toggle("liked", !!on);
    b.title = on ? "Remove from Liked Songs" : "Save to Liked Songs";
  }
};

function paintControls() {
  for (const b of all('[data-act="shuffle"]')) b.classList.toggle("on", S.user.shuffle);
  for (const b of all('[data-act="repeat"]')) {
    b.classList.toggle("on", S.user.repeat !== "off");
    b.innerHTML = S.user.repeat === "one" ? ICONS.repeat1 : ICONS.repeat;
    b.title = S.user.repeat === "off" ? "Disable repeat" : S.user.repeat === "all" ? "Repeat all" : "Repeat one";
  }
  const silent = audio.muted || S.user.volume === 0;
  for (const b of all('[data-act="mute"]')) b.innerHTML = silent ? ICONS.mute : ICONS.volume;
  for (const el of all('[data-act="volume"]')) {
    el.value = Math.round(S.user.volume * 100);
    setFill(el, Math.round(S.user.volume * 100));
  }
}

const setFill = (el, pct) => el.style.setProperty("--fill", `${pct}%`);

function refreshTableLikes() {
  document.querySelectorAll("[data-like]").forEach((el) => {
    const on = S.user.liked.includes(el.dataset.like);
    el.classList.toggle("liked", on);
    el.innerHTML = on ? ICONS.heartFill : ICONS.heart;
  });
}

/* ------------------------------------------------------------------ events --- */

function onClick(e) {
  const row = e.target.closest("[data-open]");
  if (row) {
    const [kind, id] = row.dataset.open.split(":");
    location.hash = kind === "liked" ? "#/liked" : `#/${kind}/${id}`;
    return;
  }
  const likeEl = e.target.closest("[data-like]");
  if (likeEl) return toggleLike(likeEl.dataset.like);

  const playAll = e.target.closest("[data-playall]");
  if (playAll) return playQueue(playAll.dataset.playall.split(","), 0);

  const qRow = e.target.closest("[data-queueplay]");
  if (qRow) return void (S.qpos = Number(qRow.dataset.queueplay), loadCurrent(true));

  const del = e.target.closest("[data-deletepl]");
  if (del) {
    S.user.playlists = S.user.playlists.filter((p) => p.id !== del.dataset.deletepl);
    save();
    location.hash = "#/home";
    return render();
  }

  const tr = e.target.closest("tr[data-id]");
  if (tr) {
    const ids = tr.closest("table").dataset.ids.split(",");
    return playQueue(ids, ids.indexOf(tr.dataset.id));
  }
}

function newPlaylist() {
  const name = prompt("Playlist name");
  if (!name) return;
  const current = track(S.queue[S.qpos]);
  const pl = {
    id: `pl-${Date.now().toString(36)}`,
    name: name.slice(0, 60),
    trackIds: current ? [current.id] : [],
  };
  S.user.playlists.push(pl);
  save();
  toast(`Created “${pl.name}”`);
  location.hash = `#/playlist/${pl.id}`;
  render();
}

/** Add the current song to a playlist of your choice (right-click alternative). */
function addCurrentToPlaylist() {
  const t = track(S.queue[S.qpos]);
  if (!t) return toast("Nothing is playing");
  if (!S.user.playlists.length) return toast("Create a playlist first (the + button)");
  const names = S.user.playlists.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
  const pick = prompt(`Add “${t.title}” to which playlist?\n\n${names}`);
  const p = S.user.playlists[Number(pick) - 1];
  if (!p) return;
  if (!p.trackIds.includes(t.id)) p.trackIds.push(t.id);
  save();
  toast(`Added to ${p.name}`);
}

/* ---- controls ----------------------------------------------------------------
   Every transport control exists twice (bottom bar + full-screen sheet), so the
   HTML carries data-act attributes and one delegated handler drives them all.  */

function handleAction(act) {
  switch (act) {
    case "play": togglePlay(); break;
    case "next": next(); break;
    case "prev": prev(); break;
    case "like": toggleLike(S.queue[S.qpos]); break;
    case "mute": audio.muted = !audio.muted; paintControls(); break;
    case "shuffle":
      S.user.shuffle = !S.user.shuffle;
      save(); paintControls(); toast(S.user.shuffle ? "Shuffle on" : "Shuffle off");
      break;
    case "repeat":
      S.user.repeat = S.user.repeat === "off" ? "all" : S.user.repeat === "all" ? "one" : "off";
      save(); paintControls();
      toast(S.user.repeat === "off" ? "Repeat off" : S.user.repeat === "all" ? "Repeat all" : "Repeat one");
      break;
    case "open-sheet": if (S.queue.length) openSheet(true); break;
    case "close-sheet": openSheet(false); break;
    default: break;
  }
}

function openSheet(open) {
  const sheet = $("#sheet");
  if (open && !S.queue.length) return;
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.toggle("open", open));
  if (!open) setTimeout(() => (sheet.hidden = true), 250);
  $("#player").setAttribute("aria-expanded", String(open));
}

function toggleSidebar(open) {
  $("#sidebar").classList.toggle("open", open);
  $("#scrim").hidden = !open;
}

function paintNav() {
  const name = S.view.name;
  const key = name === "search" ? "search" : name === "home" || name === "" ? "home" : "library";
  for (const b of document.querySelectorAll("[data-nav]")) b.classList.toggle("active", b.dataset.nav === key);
}

function wireEvents() {
  document.addEventListener("click", onClick);

  /* delegated: transport buttons + sliders, in both the bar and the sheet */
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (el) handleAction(el.dataset.act);
  });
  document.addEventListener("input", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    if (el.dataset.act === "seek") {
      if (!audio.duration) return;
      audio.currentTime = (el.value / 100) * audio.duration;
      setFill(el, el.value);
    }
    if (el.dataset.act === "volume") {
      S.user.volume = el.value / 100;
      audio.muted = false;
      audio.volume = S.user.volume;
      setFill(el, el.value);
      save(); paintControls();
    }
  });

  $("#new-playlist").onclick = newPlaylist;
  $("#queue-btn").onclick = () => {
    const q = $("#queue");
    q.hidden = !q.hidden;
    if (!q.hidden) renderQueue();
  };
  $("#sheet-queue").onclick = () => { openSheet(false); $("#queue").hidden = false; renderQueue(); };
  $("#queue-close").onclick = () => ($("#queue").hidden = true);

  /* mobile: bottom nav + library drawer */
  for (const b of document.querySelectorAll("[data-nav]")) {
    b.onclick = () => {
      const n = b.dataset.nav;
      if (n === "home") location.hash = "#/home";
      else if (n === "search") { location.hash = "#/search"; setTimeout(() => $("#search-input").focus(), 0); }
      else toggleSidebar(true);
      paintNav();
    };
  }
  $("#side-close").onclick = () => toggleSidebar(false);
  $("#scrim").onclick = () => toggleSidebar(false);

  $("#lib-chips").onclick = (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    S.libFilter = chip.dataset.filter;
    document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
    renderSidebar();
  };

  const searchInput = $("#search-input");
  searchInput.oninput = () => {
    const q = searchInput.value;
    if (S.view.name !== "search" || S.view.q !== q) {
      location.hash = `#/search?q=${encodeURIComponent(q)}`;
    }
    S.view = { name: "search", q };
    render();
  };

  /* the <audio> element is the whole engine — every UI pixel follows it */
  audio.addEventListener("play", () => paintPlayButton(true));
  audio.addEventListener("pause", () => paintPlayButton(false));
  audio.addEventListener("ended", () => next(true));
  audio.addEventListener("loadedmetadata", () => {
    for (const el of ["#dur-time", "#sheet-dur"]) $(el).textContent = fmt(audio.duration);
    const t = track(S.queue[S.qpos]);
    if (t && "mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("play", () => audio.play());
      navigator.mediaSession.setActionHandler("pause", () => audio.pause());
      navigator.mediaSession.setActionHandler("nexttrack", () => next());
      navigator.mediaSession.setActionHandler("previoustrack", prev);
    }
  });
  audio.addEventListener("timeupdate", () => {
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    for (const el of all('[data-act="seek"]')) { el.value = pct; setFill(el, pct); }
    $("#cur-time").textContent = fmt(audio.currentTime);
    $("#sheet-cur").textContent = fmt(audio.currentTime);
  });
  audio.addEventListener("playing", () => {
    const t = track(S.queue[S.qpos]);
    if (!t) return;
    if (API.server) {
      fetch("/api/play", { method: "POST", body: JSON.stringify({ id: t.id }) }).catch(() => {});
    } else {
      // no backend on a static host: count plays in this browser instead
      const s = lsGet(API.stats, {});
      s[t.id] = { plays: (s[t.id]?.plays || 0) + 1, lastPlayed: Date.now() };
      lsSet(API.stats, s);
      S.stats = s;
    }
  });
  audio.volume = S.user.volume;

  document.addEventListener("keydown", (e) => {
    const typing = /input|textarea/i.test(document.activeElement?.tagName || "");
    if (e.key === "Escape") {
      $("#queue").hidden = true;
      if (!$("#sheet").hidden) openSheet(false);
      toggleSidebar(false);
      return;
    }
    if (typing) return;
    switch (e.key) {
      case " ": e.preventDefault(); togglePlay(); break;
      case "ArrowRight": audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); break;
      case "ArrowLeft": audio.currentTime = Math.max(0, audio.currentTime - 5); break;
      case "ArrowUp": e.preventDefault(); audio.volume = Math.min(1, audio.volume + 0.05); S.user.volume = audio.volume; save(); paintControls(); break;
      case "ArrowDown": e.preventDefault(); audio.volume = Math.max(0, audio.volume - 0.05); S.user.volume = audio.volume; save(); paintControls(); break;
      case "m": case "M": audio.muted = !audio.muted; paintControls(); break;
      case "l": case "L": toggleLike(S.queue[S.qpos]); break;
      case "s": case "S": handleAction("shuffle"); break;
      case "r": case "R": handleAction("repeat"); break;
      case "q": case "Q": $("#queue-btn").click(); break;
      case "n": case "N": next(); break;
      case "p": case "P": prev(); break;
      case "/": e.preventDefault(); $("#search-input").focus(); break;
      case "a": case "A": addCurrentToPlaylist(); break;
      default: break;
    }
  });

  window.addEventListener("hashchange", () => {
    S.view = parseHash();
    render();
    paintNav();
    toggleSidebar(false);           // a phone taps a row -> the drawer must close
    if (S.view.name === "search") $("#search-input").focus();
  });
}

/* ------------------------------------------------------------------- boot --- */

async function boot() {
  // one bundle, two hosts: ask the local server first, fall back to the static file
  const libRes = await firstOk(["/api/library", "/library.json"]);
  API.server = libRes.path === "/api/library";
  const lib = libRes.body;

  let user = { ...localState(), ...lsGet(API.state, {}) };
  let stats = lsGet(API.stats, {});
  if (API.server) {
    try { user = await (await fetch("/api/state")).json(); } catch { /* keep local */ }
    try { stats = await (await fetch("/api/stats")).json(); } catch { /* keep local */ }
  }

  S.lib = lib;
  S.byId = new Map(lib.tracks.map((t) => [t.id, t]));
  S.user = user;
  S.stats = stats;
  audio.volume = S.user.volume;

  S.view = parseHash();
  paintIcons();
  wireEvents();
  paintControls();
  render();
  renderQueue();

  if (S.user.lastTrackId && S.byId.has(S.user.lastTrackId)) {
    // restore the last song without autoplaying it (browsers block that anyway)
    const same = lib.albums.find((a) => a.trackIds.includes(S.user.lastTrackId));
    S.queue = same ? same.trackIds : [S.user.lastTrackId];
    S.qpos = Math.max(0, S.queue.indexOf(S.user.lastTrackId));
    audio.src = srcOf(S.byId.get(S.user.lastTrackId));
    paintNowPlaying();
    paintPlayButton(false);
  }
}

boot().catch((e) => {
  $("#view").innerHTML = `<p class="empty"><h3>Could not start</h3>${esc(e.message)}</p>`;
});
