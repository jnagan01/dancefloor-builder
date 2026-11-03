/* Offline workspace renderer. All user text is inserted with textContent only. */
(function () {
  "use strict";
  const api = window.setarchitectOffline, C = window.OfflineCore, P = window.PreparationPolicy;
  const $ = id => document.getElementById(id);
  const el = (tag, props, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "text") n.textContent = v;
      else if (k === "on") for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
      else if (k === "class") n.className = v;
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) n.append(kid);
    return n;
  };
  const state = { data: null, index: null, event: null, overlay: {}, availability: {}, picker: null, report: null, busy: false, gen: 0 };
  // Every event load bumps gen; load/choice/export responses apply only if the captured id+gen is still current,
  // so a delayed response for event A can never be applied to or displayed on event B (A's overlay stays saved).
  const current = (id, gen) => state.event !== null && state.event.id === id && state.gen === gen;
  const status = (text, kind) => { const s = $("status"); s.textContent = text || ""; s.className = `status ${kind || ""}`; };
  const when = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "unknown time" : d.toLocaleString(); };

  $("theme").addEventListener("change", e => { document.documentElement.dataset.theme = e.target.value; });

  async function boot() {
    let res;
    try { res = await api.load(); } catch (e) { res = { ok: false, error: e.message }; }
    if (!res || !res.ok) return empty("Offline copy unavailable", (res && res.error) || "The offline copy could not be opened.");
    if (res.state === "none") return empty("Offline access isn't prepared on this Mac yet", "While you are online and signed in, open Settings › Offline access in SetArchitect and click “Prepare offline access”. That saves your events and music library on this Mac so they open here without internet.");
    if (res.state !== "ready") return empty("Offline copy can't be read", res.error || "Prepare offline access again while online. Nothing was changed.");
    state.data = res;
    state.index = C.buildIndex(res.tracks);
    $("cached").textContent = `Saved copy prepared ${when(res.preparedAt)} · ${res.events.length} events · ${res.tracks.length.toLocaleString()} tracks${res.fallback ? " · showing the earlier copy because the latest one couldn't be read" : ""}. Changes made online after this time are not included.`;
    renderEvents();
    if (res.events.length) await openEvent(res.events[0].id); else $("detail").replaceChildren(el("p", { class: "muted", text: "This offline copy has no saved events." }));
  }

  function empty(title, text) {
    $("cached").textContent = "No offline copy available.";
    $("events").replaceChildren();
    $("detail").replaceChildren(el("div", { class: "empty" }, el("h2", { text: title }), el("p", { text })));
  }

  function renderEvents() {
    $("events").replaceChildren(...state.data.events.map(e => el("button", { type: "button", "aria-current": state.event && state.event.id === e.id ? "true" : "false", disabled: state.busy, text: e.name || "Untitled event", on: { click: () => { if (!state.busy) openEvent(e.id); } } })));
  }

  async function openEvent(id) {
    const ev = state.data.events.find(e => e.id === id);
    const gen = ++state.gen;
    const res = await api.event(id);
    if (gen !== state.gen) return; // a newer event was opened meanwhile
    if (!res.ok) { status(res.error, "error"); return; }
    Object.assign(state, { event: ev, overlay: res.overlay, availability: res.availability, picker: null, report: null });
    renderEvents(); renderDetail();
  }

  function selectionFor(section, i) { return C.effectiveSelection(state.event, { selections: state.overlay }, section, i); }

  function songRow(section, i, song) {
    const sel = selectionFor(section, i), st = C.songStatus(sel);
    const labels = { confirmed: "Confirmed track (saved)", local: "Chosen offline — this Mac only", tentative: "Suggested, not confirmed — won't export", none: "No track chosen", excluded: "Excluded from DJ export", stale: "Saved choice doesn't match this song — choose again" };
    const files = ((st === "confirmed" || st === "local") && sel.paths || []).map(p => {
      const t = state.index.tracks[state.index.byPath.get(p)];
      const full = C.fullPath(p, state.data.roots);
      const clean = P.cleanReason(t, P.requiresClean(state.event.inputs));
      const problem = clean || (!t ? "not in saved library" : !full ? "unknown music folder location" : state.availability[full] !== "available" ? "file missing on this Mac" : "");
      return el("div", { class: "file" }, `${t ? `${t.artist} — ${t.title}${t.remix ? ` (${t.remix})` : ""} · ` : ""}${p}${problem ? ` · ${problem}` : ""}`);
    });
    const id = `song-${section}-${i}`;
    const li = el("li", { class: "song", id },
      el("span", { class: "num", text: String(i + 1) }),
      el("div", {}, el("span", { class: "title", text: `${song.artist} — ${song.song}` }), el("span", { class: `badge ${st}`, text: labels[st] }), ...files),
      el("div", { class: "actions" },
        el("button", { type: "button", "aria-expanded": state.picker === id ? "true" : "false", "aria-label": `Choose track for ${song.artist} — ${song.song}`, text: "Choose track", on: { click: () => { state.picker = state.picker === id ? null : id; renderDetail(id); } } }),
        st === "local" ? el("button", { type: "button", text: "Undo offline choice", on: { click: () => choose(section, i, { clear: true }) } }) : null));
    if (state.picker === id) li.append(picker(section, i, song, id));
    return li;
  }

  function picker(section, i, song, rowId) {
    const input = el("input", { type: "search", "aria-label": "Search saved library", value: `${song.artist} ${song.song}` });
    const list = el("ul", { class: "results", "aria-label": "Matching tracks (up to 25)" });
    let timer = null;
    const run = () => {
      const hits = C.search(state.index, input.value, 25);
      list.replaceChildren(...(hits.length ? hits.map(h => {
        const t = state.index.tracks[h.i];
        return el("li", {}, el("div", {}, el("div", { class: "title", text: `${t.artist} — ${t.title}${t.remix ? ` (${t.remix})` : ""}` }), el("div", { class: "file", text: `${t.filePath}${t.bpm ? ` · ${t.bpm} BPM` : ""}${t.key ? ` · ${t.key}` : ""}${Number.isFinite(t.playCount) ? ` · played ${t.playCount}×` : ""}` })),
          el("button", { type: "button", class: "primary", text: "Use this track", disabled: !!P.cleanReason(t, P.requiresClean(state.event.inputs)), title: P.cleanReason(t, P.requiresClean(state.event.inputs)), "aria-label": `Use ${t.artist} — ${t.title}`, on: { click: () => choose(section, i, { path: t.filePath }) } }));
      }) : [el("li", { class: "muted", text: "No matching tracks in the saved library." })]));
    };
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 150); });
    const wrap = el("div", { class: "picker", on: { keydown: e => { if (e.key === "Escape") { state.picker = null; renderDetail(rowId, true); } } } }, input, list);
    run();
    setTimeout(() => input.focus(), 0);
    return wrap;
  }

  async function choose(section, index, change) {
    if (state.busy || !state.event) return; state.busy = true; renderEvents();
    const id = state.event.id, gen = state.gen;
    status("Saving offline choice…", "pending");
    try {
      const res = await api.choose(id, { section, index, ...change });
      if (!current(id, gen)) return;
      if (!res.ok) { status(res.error, "error"); return; }
      state.overlay = res.overlay; state.availability = res.availability; state.picker = null;
      status(change.clear ? "Offline choice removed." : "Track confirmed on this Mac. Your saved online event is unchanged.", "ok");
      renderDetail(`song-${section}-${index}`, true);
    } finally { state.busy = false; if (state.data) renderEvents(); }
  }

  async function doExport() {
    if (state.busy || !state.event) return; state.busy = true; renderEvents();
    const id = state.event.id, gen = state.gen;
    state.report = null; renderDetail();
    try {
      status("Choose a folder for the playlists…");
      const res = await api.exportPlaylists(id);
      if (!current(id, gen)) return;
      if (res.canceled) { status("Export cancelled · 0 tracks exported."); return; }
      state.report = res;
      status(res.ok ? `Exported ${res.written.length} output files · ${C.exportedTrackCount(res)} tracks exported${P.omissionText(res.summary) ? ` · left out: ${P.omissionText(res.summary)}` : ""}.` : `${res.error || "Export failed."} · 0 tracks exported.`, res.ok ? "ok" : "error");
      renderDetail();
    } catch (e) {
      if (!current(id, gen)) return;
      state.report = { ok: false, exportedTracks: 0, error: e.message || "Export failed." };
      status(`${state.report.error} · 0 tracks exported.`, "error"); renderDetail();
    } finally { state.busy = false; if (state.data) renderEvents(); }
  }

  function report() {
    const r = state.report; if (!r) return null;
    const s = r.summary;
    return el("div", { class: "report", "aria-label": "Export readiness" },
      el("h3", { text: r.ok ? "Export complete" : "Export problem" }),
      r.error ? el("p", { class: "error", text: r.error }) : null,
      el("p", { text: `${C.exportedTrackCount(r)} tracks exported${s ? ` · ${s.approved} eligible tracks${Number.isSafeInteger(s.uniqueTracks) ? ` (${s.uniqueTracks} unique files)` : ""} · Requested ${s.requested} tracks · ${s.localChoices} offline choices${P.omissionText(s) ? ` · left out: ${P.omissionText(s)}` : ""}` : ""}` }),
      r.written && r.written.length ? el("p", { text: `Written to ${r.folder}: ${r.written.join(", ")}` }) : null,
      r.problems && r.problems.length ? el("ul", {}, ...r.problems.slice(0, 200).map(p => el("li", {}, el("button", { type: "button", text: `${p.section} #${p.index + 1}`, on: { click: () => focusSong(`song-${p.section}-${p.index}`) } }), ` ${p.title} — ${p.reason}`))) : null);
  }
  function focusSong(id) { const n = document.getElementById(id); if (!n) return; n.classList.add("flash"); n.scrollIntoView({ block: "center" }); const b = n.querySelector("button"); if (b) b.focus(); }

  function renderDetail(focusId, focusButton) {
    const e = state.event;
    const sections = C.SECTIONS.filter(([k]) => e.lists[k].length).map(([k, label]) => [el("h3", { text: C.sectionLabel(e, k, label) }), el("ol", { class: "songs" }, ...e.lists[k].map((s, i) => songRow(k, i, s)))]).flat();
    const local = Object.keys(state.overlay).length;
    // Optional parts (other-lists notice, export report) may be null; replaceChildren would print "null".
    $("detail").replaceChildren(...[
      el("h2", { text: e.name || "Untitled event" }),
      P.requiresClean(e.inputs) ? el("p", { class: "notice", text: "Clean versions required. Clean labels are metadata/filename evidence, not verified lyrics. Dirty, unknown and conflicting files cannot export; choose a labelled clean file. Change event policy online only." }) : null,
      el("p", { class: "muted", text: `Saved event as of ${when(state.data.preparedAt)}. Unsaved edits from the online workspace are kept separately and are not shown here.${local ? ` ${local} track choice(s) made offline on this Mac.` : ""}${e.staleOverlays ? ` ${e.staleOverlays} earlier offline choice set(s) for an older copy of this event are kept but not applied.` : ""}` }),
      e.otherLists && e.otherLists.length ? el("p", { class: "notice", text: `Not available offline: ${e.otherLists.length} other saved list(s) (${e.otherLists.join(", ")}). Open them online.` }) : null,
      el("div", { class: "actions" }, el("button", { type: "button", class: "primary", text: "Export VirtualDJ playlists", on: { click: doExport } })),
      report(),
      ...(sections.length ? sections : [el("p", { class: "muted", text: "This event has no song lists yet." })])].filter(n => n !== null && n !== undefined && n !== false));
    if (focusId && focusButton) { const n = document.getElementById(focusId); const b = n && n.querySelector("button"); if (b) b.focus(); }
  }

  boot();
})();
