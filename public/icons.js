// icons.js — the small set of glyphs the player needs.
// Real Spotify draws these as inline SVG too, so we do the same.
window.ICONS = {
  logo: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.4a.75.75 0 0 1-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 1 1-.33-1.46c4.56-1.04 8.5-.59 11.66 1.34.35.22.46.68.25 1.03Zm1.22-2.72a.94.94 0 0 1-1.29.31c-3.23-1.98-8.15-2.56-11.97-1.4a.94.94 0 1 1-.54-1.8c4.37-1.32 9.79-.68 13.49 1.6.44.27.58.85.31 1.29Zm.1-2.83C14.13 8.8 8.1 8.6 4.65 9.65a1.12 1.12 0 1 1-.65-2.15c3.94-1.2 10.6-.98 14.85 1.54a1.12 1.12 0 1 1-1.13 1.93Z"/></svg>`,
  home: `<svg viewBox="0 0 24 24"><path d="M12 3.2 3.5 10v10.3h5.6v-6h5.8v6h5.6V10L12 3.2Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>`,
  search: `<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.3" fill="none" stroke="currentColor" stroke-width="2"/><path d="m15.4 15.4 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  library: `<svg viewBox="0 0 24 24"><path d="M4 3v18M9 3v18M13.5 4l5.5 15.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`,
  plus: `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  play: `<svg viewBox="0 0 24 24"><path d="M8 5.2v13.6L19 12 8 5.2Z" fill="currentColor"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><path d="M7 5h3.2v14H7zM13.8 5H17v14h-3.2z" fill="currentColor"/></svg>`,
  prev: `<svg viewBox="0 0 24 24"><path d="M7 6h2v12H7zM19 6v12L10 12l9-6Z" fill="currentColor"/></svg>`,
  next: `<svg viewBox="0 0 24 24"><path d="M15 6h2v12h-2zM5 6v12l9-6L5 6Z" fill="currentColor"/></svg>`,
  shuffle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 4h4v4M3 20l6-6M3 4l18 16M17 20h4v-4M14 4h3v3M7 17h3v3"/></svg>`,
  repeat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l3 3-3 3M4 12V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 12v3a4 4 0 0 1-4 4H4"/></svg>`,
  repeat1: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l3 3-3 3M4 12V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 12v3a4 4 0 0 1-4 4H4"/><path d="M11.5 10.6 13 9.8V15" stroke-width="1.6"/></svg>`,
  heart: `<svg viewBox="0 0 24 24"><path d="M12 20.4 4.2 13a4.8 4.8 0 0 1 0-6.8 4.7 4.7 0 0 1 6.7 0l1.1 1.1 1.1-1.1a4.7 4.7 0 0 1 6.7 0 4.8 4.8 0 0 1 0 6.8L12 20.4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  heartFill: `<svg viewBox="0 0 24 24"><path d="M12 20.4 4.2 13a4.8 4.8 0 0 1 0-6.8 4.7 4.7 0 0 1 6.7 0l1.1 1.1 1.1-1.1a4.7 4.7 0 0 1 6.7 0 4.8 4.8 0 0 1 0 6.8L12 20.4Z" fill="currentColor"/></svg>`,
  queue: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 6h12M4 12h12M4 18h8"/><path d="M17 13v7l5-3.5-5-3.5Z" fill="currentColor" stroke="none"/></svg>`,
  volume: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" fill="currentColor"/><path d="M16 9a4.5 4.5 0 0 1 0 6M18.6 6.4a8 8 0 0 1 0 11.2"/></svg>`,
  mute: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" fill="currentColor"/><path d="m16.5 9.5 5 5M21.5 9.5l-5 5"/></svg>`,
  close: `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  note: `<svg viewBox="0 0 24 24"><path d="M10 18V6l9-2v12" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="7" cy="18" r="3" fill="currentColor"/><circle cx="16" cy="16" r="3" fill="currentColor"/></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 9 7 7 7-7"/></svg>`,
  disc: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3.5 2"/></svg>`,
};

/** Paint every [data-icon] element in a container with its SVG. */
window.paintIcons = (root = document) =>
  root.querySelectorAll("[data-icon]").forEach((el) => {
    const svg = window.ICONS[el.dataset.icon];
    if (svg && el.dataset.painted !== el.dataset.icon) {
      el.innerHTML = svg;
      el.dataset.painted = el.dataset.icon;
    }
  });
