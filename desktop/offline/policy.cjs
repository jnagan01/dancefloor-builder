/* Shared browser/native preparation rules. No DOM, network, filesystem or mutable state. */
(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PreparationPolicy = api;
})(typeof self !== "undefined" ? self : this, function() {
  "use strict";
  const DEFAULTS = { ownedOnlyExpansion: true, includeSeasonalTracks: false, requireCleanVersions: true };
  function cleanEvidence(track) {
    if (!track) return "unknown";
    const text = [track.title, track.remix, String(track.filePath || "").split(/[\\/]/).pop(), track.comment].filter(Boolean).join(" ");
    const clean = /(?:^|[\s([_-])(?:clean(?:\s+(?:edit|version))?|radio\s+clean)(?=$|[\s)\]_.-])/i.test(text);
    const dirty = track.explicit === true || /(?:^|[\s([_-])(?:dirty|explicit|uncensored)(?=$|[\s)\]_.-])/i.test(text);
    return clean && dirty ? "conflicting" : dirty ? "dirty" : clean ? "clean" : "unknown";
  }
  function requiresClean(inputs) {
    return !!inputs && (inputs.requireCleanVersions === true || inputs.eventType === "school_dance" || inputs.eventType === "corporate");
  }
  function needsPolicyConsumer(inputs) {
    // Existing strict event types predate policy support; passive legacy backups remain v1.
    return !!inputs && ["ownedOnlyExpansion", "includeSeasonalTracks", "requireCleanVersions"].some(k => inputs[k] !== undefined);
  }
  function cleanReason(track, required) {
    if (!required || cleanEvidence(track) === "clean") return null;
    const evidence = cleanEvidence(track);
    return `Clean version needed — ${evidence === "dirty" ? "Dirty/explicit-labelled file" : evidence === "conflicting" ? "conflicting Clean and Dirty labels" : "no clean label"}. Choose a labelled clean file${required === "strict" ? "." : " or change this event’s clean policy."}`;
  }
  function seasonal(track) {
    // Deliberately no “winter”, “snow”, “December” or artist-name heuristics.
    const text = [track.song, track.title, track.genre, track.tags && track.tags.join(" ")].filter(Boolean).join(" ").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    return /\b(christmas|xmas|noel|navidad|hanukkah|chanukah|kwanzaa|yuletide|yuletime|jingle bells|silent night|santa claus|auld lang syne)\b/i.test(text) || /^(?:holiday|holidays|seasonal)$/i.test(String(track.genre || "").trim());
  }
  const norm = s => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");
  function versionTitle(s) {
    // Only interchangeable content labels/ordinary edits. Live, remix, acoustic etc stay significant.
    return norm(String(s || "").replace(/\b(clean|dirty|explicit|uncensored|radio\s+edit|radio\s+clean|clean\s+edit|clean\s+version)\b/gi, " "));
  }
  function intendedKey(song) { return `${norm(song.artist)}|${versionTitle(song.song === undefined ? song.title : song.song)}`; }
  function intended(song, track) {
    if (!song.artist || !(song.song || song.title) || !track.artist || !track.title || !track.filePath) return false;
    if (intendedKey(song) !== intendedKey(track)) return false;
    // A requested named mix must match the recording's actual mix as well.
    const labels = v => [...new Set((String(v || "").toLowerCase().match(/\b(live|remix|acoustic|instrumental|extended|dub)\b/g) || []))].sort().join("|");
    if (labels(song.song || song.title) !== labels([track.title, track.remix].join(" "))) return false;
    return true;
  }
  function buildResolver(tracks, inputs) {
    const buckets = new Map();
    tracks.forEach((t, i) => { const k = intendedKey(t), b = buckets.get(k) || []; b.push(i); buckets.set(k, b); });
    const resolve = song => {
      const ids = buckets.get(intendedKey(song)) || [];
      return ids.filter(i => intended(song, tracks[i]) && !cleanReason(tracks[i], requiresClean(inputs)) && (inputs?.includeSeasonalTracks !== false || !seasonal(tracks[i])))
        .sort((a, b) => Number(cleanEvidence(tracks[b]) === "clean") - Number(cleanEvidence(tracks[a]) === "clean") || a - b)[0];
    };
    return { resolve, allowed: song => (!inputs || inputs.includeSeasonalTracks !== false || !seasonal(song)) && (!inputs || inputs.ownedOnlyExpansion !== true || resolve(song) !== undefined) };
  }
  function omissionText(s) {
    const out = [];
    if (s.excluded) out.push(`${s.excluded} explicitly excluded`);
    if (s.unapproved) out.push(`${s.unapproved} unapproved/unresolved`);
    if (s.missing) out.push(`${s.missing} missing/unavailable file${s.missing === 1 ? "" : "s"}`);
    if (s.cleanBlocked) out.push(`${s.cleanBlocked} clean-policy block${s.cleanBlocked === 1 ? "" : "s"}`);
    return out.join(" · ");
  }
  return { DEFAULTS, cleanEvidence, requiresClean, needsPolicyConsumer, cleanReason, seasonal, intended, intendedKey, buildResolver, omissionText };
});