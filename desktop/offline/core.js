/* SetArchitect offline workspace — pure, dependency-free logic shared by the
 * native main process (export/validation) and the bundled offline renderer
 * (search/display). No DOM, no network, no Node APIs. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OfflineCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const SECTIONS = [
    ["warmUp", "Warm Up"],
    ["transition", "Transition"],
    ["peak", "Peak"],
  ];
  const absolute = p => /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(p);
  const unsafePath = p => typeof p !== "string" || !p || p.length > 4000 || /[\r\n\0]/.test(p) || p.split(/[\\/]/).includes("..");

  /** Same rule as src/lib/fileIdentity fullFilePath: label-relative paths need a known root. */
  function fullPath(filePath, roots) {
    if (unsafePath(filePath)) return null;
    if (absolute(filePath)) return filePath;
    const [label, ...rest] = filePath.split(/[\\/]/);
    const rootPath = roots && Object.prototype.hasOwnProperty.call(roots, label) ? roots[label] : undefined;
    if (typeof rootPath !== "string" || !rootPath || !rest.length || unsafePath(rootPath)) return null;
    const sep = /^[A-Za-z]:\\/.test(rootPath) ? "\\" : "/";
    return [rootPath.replace(/[\\/]+$/, ""), ...rest].join(sep);
  }

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\bfeaturing\b|\bft\.?(?=\s|$)|\bfeat\.?(?=\s|$)/g, " feat ")
      .replace(/&/g, " and ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  // Exact port of src/lib/danceFloor.ts normalizeKey/artistParts/stripArtistFromTitle/dedupeKey
  // (parity is enforced by tests/offlineAccess.test.ts), so saved selection keys match exactly.
  function normalizeKey(s) {
    return (s || "")
      .toLowerCase()
      .replace(/[([{][^)\]}]*[)\]}]/g, " ")
      .replace(/\s+(feat\.?|ft\.?|featuring|with|w\/)\s+.*$/gi, " ")
      .replace(/\s*[-–—:]\s*(the\s+)?(\d{2,4}\s+)?(re[- ]?master(ed)?|radio edit|edit|extended( (mix|version|edit))?|version|mix|live|mono|stereo|deluxe|single|album version|anniversary( edition)?|bonus track|explicit|clean|instrumental|acoustic|demo|reissue|original( mix| version)?)(\s+\d{2,4})?\s*$/gi, " ")
      .replace(/\s+[-–—]\s+(from\s.*|.*\b(version|remix|mix|edit|re-?master(ed)?|live|mono|stereo)\b.*)$/gi, " ")
      .replace(/\s+(&|and|x|vs\.?)\s+.*$/gi, " ")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  const stripThe = s => s.replace(/^the\s+/, "");
  function artistParts(artist) {
    const raw = (artist || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .split(/\s*(?:,|;|\/|&|\+|\band\b|\bx\b|\bvs\.?|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/i);
    const out = new Set();
    for (const p of raw) { const n = stripThe(p.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim()); if (n) out.add(n); }
    return [...out];
  }
  function stripArtistFromTitle(artist, song) {
    const s = (song || "").trim();
    const a = normalizeKey(artist).replace(/^(the|a)\s+/, "");
    if (!s || !a) return s;
    const m = s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (!m) return s;
    const left = normalizeKey(m[1]).replace(/^(the|a)\s+/, "");
    const right = normalizeKey(m[2]).replace(/^(the|a)\s+/, "");
    const parts = new Set(artistParts(artist));
    const isArtist = x => x === a || parts.has(x);
    if (isArtist(left) && m[2].trim()) return m[2].trim();
    if (isArtist(right) && m[1].trim()) return m[1].trim();
    return s;
  }
  const dedupeKey = (artist, song) => `${normalizeKey(artist).replace(/^(the|a)\s+/, "")}|${normalizeKey(stripArtistFromTitle(artist, song))}`;
  const songKey = (section, index, song) => `${section}:${index}:${dedupeKey(song.artist, song.song)}`;
  const songIdentity = song => dedupeKey(song && song.artist, song && song.song);

  /** The saved choice whose key is exactly this song's canonical key. A key for the same
   * position but a different song identity is stale and never applies. */
  function cachedSelection(selections, section, index, song) {
    if (!selections || !song) return null;
    const exact = songKey(section, index, song);
    if (Object.prototype.hasOwnProperty.call(selections, exact)) return selections[exact];
    const prefix = `${section}:${index}:`;
    return Object.keys(selections).some(k => k.startsWith(prefix)) ? { stale: true, paths: [] } : null;
  }

  /** Overlay choices apply only to the same song identity at the same position. */
  function effectiveSelection(event, overlay, section, index) {
    const song = event.lists[section][index];
    const local = overlay && overlay.selections ? overlay.selections[`${section}:${index}`] : null;
    if (local && local.song && songIdentity(local.song) === songIdentity(song)) return { ...local, source: "local" };
    const saved = cachedSelection(event.lists.selections, section, index, song);
    return saved ? { ...saved, source: "saved" } : null;
  }

  function songStatus(selection) {
    if (!selection) return "none";
    if (selection.stale) return "stale";
    if (selection.excluded) return "excluded";
    if (selection.confirmed === true && selection.paths && selection.paths.length) return selection.source === "local" ? "local" : "confirmed";
    return selection.paths && selection.paths.length ? "tentative" : "none";
  }

  /** Build an index over every saved track once; searches never rebuild it. */
  function buildIndex(tracks) {
    const byPath = new Map();
    const duplicates = new Set();
    const hay = new Array(tracks.length);
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (byPath.has(t.filePath)) duplicates.add(t.filePath);
      else byPath.set(t.filePath, i);
      const base = String(t.filePath).split(/[\\/]/).pop();
      hay[i] = { all: ` ${norm([t.artist, t.title, t.remix, base].join(" "))} `, artist: norm(t.artist), title: norm(t.title) };
    }
    return { tracks, byPath, duplicates, hay };
  }

  /** Linear, bounded search. Never fuzzy-approves anything — results are suggestions only. */
  function search(index, query, limit) {
    const max = Math.max(1, Math.min(50, limit || 25));
    const tokens = norm(query).split(" ").filter(Boolean).slice(0, 12);
    if (!tokens.length) return [];
    const q = tokens.join(" ");
    const top = [];
    for (let i = 0; i < index.hay.length; i++) {
      const h = index.hay[i];
      let hit = 0;
      for (const tok of tokens) if (h.all.includes(` ${tok}`)) hit++;
      if (hit < tokens.length) continue;
      const t = index.tracks[i];
      let score = 10;
      if (q === `${h.artist} ${h.title}`) score += 100;
      if (q.includes(h.title) && h.title) score += 20;
      if (q.includes(h.artist) && h.artist) score += 10;
      score += Math.min(9, Math.log2(1 + (Number.isFinite(t.playCount) ? t.playCount : 0)));
      if (top.length < max || score > top[top.length - 1].s) {
        top.push({ i, s: score });
        top.sort((a, b) => b.s - a.s || a.i - b.i);
        if (top.length > max) top.pop();
      }
    }
    return top;
  }

  /** Exact identity plan for export. Unapproved, excluded, unknown or missing files are never written. */
  function exportPlan(event, overlay, index, roots, availability) {
    const sections = [];
    const problems = [];
    const recordings = new Set();
    let requested = 0, omitted = 0, unavailable = 0, localChoices = 0;
    for (const [section, label] of SECTIONS) {
      const songs = (event.lists[section] || []);
      if (!songs.length) continue;
      const entries = [];
      songs.forEach((song, i) => {
        requested++;
        const title = `${song.artist} — ${song.song}`;
        const sel = effectiveSelection(event, overlay, section, i);
        const status = songStatus(sel);
        const at = { section, index: i };
        if (status !== "confirmed" && status !== "local") {
          omitted++;
          problems.push({ ...at, title, reason: status === "excluded" ? "Excluded from DJ export" : status === "tentative" ? "Recording not confirmed" : status === "stale" ? "Saved choice belongs to a different song at this position" : "No confirmed recording" });
          return;
        }
        if (status === "local") localChoices++;
        let wrote = 0;
        for (const p of [...new Set(sel.paths)]) {
          const ti = index.byPath.get(p);
          if (ti === undefined) { problems.push({ ...at, title, reason: "Chosen file is not in the saved library" }); continue; }
          const full = fullPath(p, roots);
          if (!full) { problems.push({ ...at, title, reason: unsafePath(p) ? "Unsafe file path" : "Unknown music folder location" }); continue; }
          if (availability && availability[full] !== "available") { unavailable++; problems.push({ ...at, title, reason: "File missing on this Mac" }); continue; }
          entries.push({ track: index.tracks[ti], path: full, at });
          recordings.add(full);
          wrote++;
        }
        if (!wrote) omitted++;
      });
      sections.push({ section, label, entries });
    }
    return { sections, problems, summary: { requested, approved: recordings.size, omitted, unavailable, localChoices } };
  }

  const single = v => String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim();
  const xml = v => single(v).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
  const tag = (n, v) => (single(v) ? `<${n}>${xml(v)}</${n}>` : "");

  /** VirtualDJ .m3u identical in shape to the online exporter. */
  function m3u(entries) {
    const lines = ["#EXTM3U"];
    for (const { track: t, path } of entries) {
      if (/[\r\n]/.test(path)) throw Error("A file path contains a line break. No playlist was written.");
      lines.push(`#EXTVDJ:${tag("filesize", t.fileSize)}${tag("artist", t.artist)}${tag("title", t.title)}${tag("remix", t.remix)}${tag("bpm", t.bpm)}${tag("key", t.key)}`);
      lines.push(`#EXTINF:-1,${t.artist ? `${single(t.artist)} - ` : ""}${single(t.title)}`);
      lines.push(path);
    }
    return lines.join("\r\n") + "\r\n";
  }

  function readinessText(plan, meta) {
    const s = plan.summary;
    return [
      "SetArchitect — Offline export readiness",
      `Event: ${single(meta.name)}`,
      `Saved copy prepared: ${single(meta.preparedAt)}`,
      `Exported offline: ${single(meta.exportedAt)}`,
      `Requested songs: ${s.requested}`,
      `Approved recordings (distinct, including extras): ${s.approved}`,
      `Local offline choices used (not synced): ${s.localChoices}`,
      `Omitted songs: ${s.omitted}`,
      `Missing files: ${s.unavailable}`,
      "Unconfirmed, excluded and unavailable songs are not in the playlists.",
      ...plan.problems.map(p => `${p.section} #${p.index + 1}. ${single(p.title)} — ${p.reason}`),
    ].join("\r\n") + "\r\n";
  }

  const safeFileName = s => single(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "_").slice(0, 120) || "Event";

  return { SECTIONS, fullPath, norm, normalizeKey, dedupeKey, songKey, songIdentity, cachedSelection, effectiveSelection, songStatus, buildIndex, search, exportPlan, m3u, readinessText, safeFileName, unsafePath };
});
