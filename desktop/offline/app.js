/* Offline workspace renderer. All user text is inserted with textContent only. */
(function () {
  "use strict";
  const api = window.setarchitectOffline, C = window.OfflineCore;
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
  const state = { data: null, index: null, event: null, overlay: {}, availability: {}, picker: null, report: null, busy: false };
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
    $("events").replaceChildren(...state.data.events.map(e => el("button", { type: "button", "aria-current": state.event && state.event.id === e.id ? "true" : "false", text: e.name || "Untitled event", on: { click: () => openEvent(e.id) } })));
  }

  async function openEvent(id) {
    const ev = state.data.events.find(e => e.id === id);
    const res = await api.event(id);
    if (!res.ok) { status(res.error, "error"); return; }
    Object.assign(state, { event: ev, overlay: res.overlay, availability: res.availability, picker: null, report: null });
    renderEvents(); renderDetail();
  }

  function selectionFor(section, i) { return C.effectiveSelection(state.event, { selections: state.overlay }, section, i); }

  function songRow(section, i, song) {
    const sel = selectionFor(section, i), st = C.songStatus(sel);
    const labels = { confirmed: "Confirmed recording (saved)", local: "Chosen offline — this Mac only", tentative: "Suggested, not confirmed — won't export", none: "No recording chosen", excluded: "Excluded from DJ export" };
    const files = ((st === "confirmed" || st === "local") && sel.paths || []).map(p => {
      const t = state.index.tracks[state.index.byPath.get(p)];
      const full = C.fullPath(p, state.data.roots);
      const problem = !t ? "not in saved library" : !full ? "unknown music folder location" : state.availability[full] !== "available" ? "file missing on this Mac" : "";
      return el("div", { class: "file" }, `${t ? `${t.artist} — ${t.title}` : p}${problem ? ` · ${problem}` : ""}`);
    });
    const id = `song-${section}-${i}`;
    const li = el("li", { class: "song", id },
      el("span", { class: "num", text: String(i + 1) }),
      el("div", {}, el("span", { class: "title", text: `${song.artist} — ${song.song}` }), el("span", { class: `badge ${st}`, text: labels[st] }), ...files),
      el("div", { class: "actions" },
        el("button", { type: "button", "aria-expanded": state.picker === id ? "true" : "false", "aria-label": `Choose recording for ${song.artist} — ${song.song}`, text: "Choose recording", on: { click: () => { state.picker = state.picker === id ? null : id; renderDetail(id); } } }),
        st === "local" ? el("button", { type: "button", text: "Undo offline choice", on: { click: () => choose(section, i, { clear: true }) } }) : null));
    if (state.picker === id) li.append(picker(section, i, song, id));
    return li;
  }

  function picker(section, i, song, rowId) {
    const input = el("input", { type: "search", "aria-label": "Search saved library", value: `${song.artist} ${song.song}` });
    const list = el("ul", { class: "results", "aria-label": "Matching recordings (up to 25)" });
    let timer = null;
    const run = () => {
      const hits = C.search(state.index, input.value, 25);
      list.replaceChildren(...(hits.length ? hits.map(h => {
        const t = state.index.tracks[h.i];
        return el("li", {}, el("div", {}, el("div", { class: "title", text: `${t.artist} — ${t.title}${t.remix ? ` (${t.remix})` : ""}` }), el("div", { class: "file", text: `${t.filePath}${t.bpm ? ` · ${t.bpm} BPM` : ""}${t.key ? ` · ${t.key}` : ""}${Number.isFinite(t.playCount) ? ` · played ${t.playCount}×` : ""}` })),
          el("button", { type: "button", class: "primary", text: "Use this recording", "aria-label": `Use ${t.artist} — ${t.title}`, on: { click: () => choose(section, i, { path: t.filePath }) } }));
      }) : [el("li", { class: "muted", text: "No matching recordings in the saved library." })]));
    };
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 150); });
    const wrap = el("div", { class: "picker", on: { keydown: e => { if (e.key === "Escape") { state.picker = null; renderDetail(rowId, true); } } } }, input, list);
    run();
    setTimeout(() => input.focus(), 0);
    return wrap;
  }

  async function choose(section, index, change) {
    if (state.busy) return; state.busy = true;
    try {
      const res = await api.choose(state.event.id, { section, index, ...change });
      if (!res.ok) { status(res.error, "error"); return; }
      state.overlay = res.overlay; state.availability = res.availability; state.picker = null;
      status(change.clear ? "Offline choice removed." : "Recording confirmed on this Mac. Your saved online event is unchanged.", "ok");
      renderDetail(`song-${section}-${index}`, true);
    } finally { state.busy = false; }
  }

  async function doExport() {
    if (state.busy) return; state.busy = true;
    try {
      status("Choose a folder for the playlists…");
      const res = await api.exportPlaylists(state.event.id);
      if (res.canceled) { status("Export cancelled."); return; }
      state.report = res;
      status(res.ok ? `Exported ${res.written.length} files.` : (res.error || "Export failed."), res.ok ? "ok" : "error");
      renderDetail();
    } finally { state.busy = false; }
  }

  function report() {
    const r = state.report; if (!r) return null;
    const s = r.summary;
    return el("div", { class: "report", "aria-label": "Export readiness" },
      el("h3", { text: r.ok ? "Export complete" : "Export problem" }),
      r.error ? el("p", { class: "error", text: r.error }) : null,
      s ? el("p", { text: `Requested ${s.requested} songs · ${s.approved} approved recordings · ${s.localChoices} offline choices · ${s.omitted} omitted · ${s.unavailable} missing files` }) : null,
      r.written && r.written.length ? el("p", { text: `Written to ${r.folder}: ${r.written.join(", ")}` }) : null,
      r.problems && r.problems.length ? el("ul", {}, ...r.problems.slice(0, 200).map(p => el("li", {}, el("button", { type: "button", text: `${p.section} #${p.index + 1}`, on: { click: () => focusSong(`song-${p.section}-${p.index}`) } }), ` ${p.title} — ${p.reason}`))) : null);
  }
  function focusSong(id) { const n = document.getElementById(id); if (!n) return; n.classList.add("flash"); n.scrollIntoView({ block: "center" }); const b = n.querySelector("button"); if (b) b.focus(); }

  function renderDetail(focusId, focusButton) {
    const e = state.event;
    const sections = C.SECTIONS.filter(([k]) => e.lists[k].length).map(([k, label]) => [el("h3", { text: label }), el("ol", { class: "songs" }, ...e.lists[k].map((s, i) => songRow(k, i, s)))]).flat();
    const local = Object.keys(state.overlay).length;
    $("detail").replaceChildren(
      el("h2", { text: e.name || "Untitled event" }),
      el("p", { class: "muted", text: `Saved event as of ${when(state.data.preparedAt)}. Unsaved edits from the online workspace are kept separately and are not shown here.${local ? ` ${local} recording choice(s) made offline on this Mac.` : ""}${e.staleOverlays ? ` ${e.staleOverlays} earlier offline choice set(s) for an older copy of this event are kept but not applied.` : ""}` }),
      el("div", { class: "actions" }, el("button", { type: "button", class: "primary", text: "Export VirtualDJ playlists", on: { click: doExport } })),
      report(),
      ...(sections.length ? sections : [el("p", { class: "muted", text: "This event has no song lists yet." })]));
    if (focusId && focusButton) { const n = document.getElementById(focusId); const b = n && n.querySelector("button"); if (b) b.focus(); }
  }

  boot();
})();
