import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scenes as scenesApi, exports_ } from "../lib/api.js";
import { createToast } from "../components/toast.js";
import "./sceneLibrary.css";

const STATUSES = ["Draft", "Canon", "Archived"];
const SYSTEMS  = ["Mask", "Fuel", "Break", "Exception", "Shattering", "Unassigned"];
const MANUSCRIPT_STATUSES = ["Draft", "Canon", "Archived"];

function listToText(a) { return (Array.isArray(a) ? a : []).join("\n"); }
function textToList(s) { return String(s || "").split("\n").map(x => x.trim()).filter(Boolean); }

function blankScene() {
  return {
    id: `scene-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    number: 0, title: "Untitled Scene", system: "Unassigned",
    status: "Draft", type: "manuscript", function: "",
    start_here: [], rule: "",
    // Legacy fields — kept for backward compat but superseded below
    stuck_directive: "", stuck_options: [],
    // New fields
    dont_forget: "",
    source_anchor: "",
    do_not_do_this: [],
    stuck_bank: {
      use_a_line: [],
      start_a_sentence: [],
      move_the_body: [],
      change_the_pressure: [],
      end_the_beat: [],
    },
    success_looks_like: [], notes: ""
  };
}

export default function SceneLibrary({ onOpenScene }) {
  const [scenes, setScenes]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [query, setQuery]             = useState("");
  const [statusFilter, setStatusFilter] = useState("Draft");
  const [systemFilter, setSystemFilter] = useState("All");
  const [sortMode, setSortMode]       = useState("number");
  const [editingScene, setEditingScene] = useState(null);
  const importRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setScenes(await scenesApi.getAll()); }
    catch (err) { createToast("Failed to load scenes: " + err.message, "error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const manuscriptScenes = useMemo(() => scenes.filter(s => s.type !== "practice"), [scenes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...manuscriptScenes]
      .filter(s => {
        if (statusFilter !== "All" && s.status !== statusFilter) return false;
        if (systemFilter !== "All" && s.system !== systemFilter) return false;
        if (q && !`${s.title} ${s.function} ${s.notes} ${s.system}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortMode === "updated") return b.updated_at?.localeCompare(a.updated_at || "") || 0;
        if (sortMode === "title")   return a.title.localeCompare(b.title);
        if (sortMode === "status")  return a.status.localeCompare(b.status);
        return Number(a.number || 0) - Number(b.number || 0);
      });
  }, [manuscriptScenes, query, statusFilter, systemFilter, sortMode]);

  const counts = useMemo(() =>
    MANUSCRIPT_STATUSES.reduce((a, s) => { a[s] = manuscriptScenes.filter(x => x.status === s).length; return a; }, {}),
    [manuscriptScenes]
  );

  async function handleSave(raw) {
    try {
      await scenesApi.upsert(raw);
      createToast("Scene saved.", "success");
      setEditingScene(null);
      await load();
    } catch (err) { createToast("Save failed: " + err.message, "error"); }
  }

  async function handleArchive(id) {
    await scenesApi.archive(id);
    createToast("Archived.", "info");
    await load();
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this scene permanently?")) return;
    await scenesApi.delete(id);
    createToast("Deleted.", "info");
    await load();
  }

  async function handlePanicExport() {
    const result = await exports_.panicExport();
    if (result.ok) createToast(`Panic export complete → ${result.path}`, "success");
    else createToast("Export failed: " + result.error, "error");
  }

  async function handleExportJSON() {
    const all = await scenesApi.getAll();
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `gfou-scenes-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    createToast("Scenes exported to JSON.", "success");
  }

  function handleImport(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed)) throw new Error("Expected array");
        await scenesApi.importBatch(parsed);
        createToast(`Imported ${parsed.length} scenes.`, "success");
        await load();
      } catch (err) { createToast("Import failed: " + err.message, "error"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  if (loading) return <div style={{ padding: 40, color: "var(--text-3)" }}>Loading scenes…</div>;

  return (
    <div className="lib-shell">
      <header className="lib-header">
        <div>
          <p className="lib-kicker">Good for One Use</p>
          <h1 className="lib-title">Scene Library</h1>
          <p style={{ color: "var(--text-3)", fontSize: 13 }}>
            {manuscriptScenes.length} scene{manuscriptScenes.length !== 1 ? "s" : ""} · SQLite
          </p>
        </div>
        <div className="lib-actions">
          <button className="btn-accent" onClick={() => setEditingScene(blankScene())}>+ New Scene</button>
          <button onClick={handleExportJSON}>Export JSON</button>
          <label className="btn-file">Import JSON<input type="file" accept=".json" ref={importRef} onChange={handleImport} /></label>
          <button className="btn-danger-soft" onClick={handlePanicExport}>⚠ Panic Export</button>
        </div>
      </header>

      <div className="lib-status-bar">
        {MANUSCRIPT_STATUSES.map(s => (
          <button key={s}
            className={`lib-status-btn ${statusFilter === s ? "active" : ""}`}
            onClick={() => setStatusFilter(statusFilter === s ? "All" : s)}
          >
            <span>{s}</span><strong>{counts[s] || 0}</strong>
          </button>
        ))}
      </div>

      <div className="lib-controls">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search title, function, notes…" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option>All</option>{MANUSCRIPT_STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={systemFilter} onChange={e => setSystemFilter(e.target.value)}>
          <option>All</option>{SYSTEMS.map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={sortMode} onChange={e => setSortMode(e.target.value)}>
          <option value="number">Sort: Number</option>
          <option value="updated">Sort: Updated</option>
          <option value="title">Sort: Title</option>
          <option value="status">Sort: Status</option>
        </select>
      </div>

      {filtered.length === 0
        ? <div className="lib-empty">{query || statusFilter !== "All" || systemFilter !== "All" ? "No scenes match." : "No scenes yet. Create your first scene above."}</div>
        : <div className="lib-grid">
            {filtered.map(s => (
              <SceneCard key={s.id} scene={s}
                onOpen={() => { onOpenScene(s.id); }}
                onEdit={() => setEditingScene({ ...s })}
                onArchive={() => handleArchive(s.id)}
                onDelete={() => handleDelete(s.id)}
              />
            ))}
          </div>
      }

      {editingScene && (
        <SceneEditorModal
          scene={editingScene}
          onCancel={() => setEditingScene(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// Extract a clean 1–2 sentence preview from raw master-scene notes.
// Returns null if nothing clean can be extracted.
function extractNotesPreview(notes) {
  if (!notes) return null;
  const text = String(notes);
  const parts = [];

  // Pull the final trailing descriptor from a heading like:
  // ## [02/67] PROLOGUE — The Caretaker — body at rest
  const headingMatch = text.match(/^##\s+\[[^\]]+\][^\n]*[—–-]\s*([^—–\n]+)\s*$/m);
  if (headingMatch) {
    const descriptor = headingMatch[1].trim();
    if (descriptor && descriptor.length < 80) parts.push(descriptor.replace(/\.$/, "") + ".");
  }

  // Pull the short cup state value: "CUP STATE: Full — ..." → "Cup state: Full."
  const cupMatch = text.match(/CUP\s+STATE:\s*([^—–\n]+)/i);
  if (cupMatch) {
    const cup = cupMatch[1].trim().replace(/\.$/, "");
    if (cup && cup.length < 60) parts.push(`Cup state: ${cup}.`);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

function SceneCard({ scene, onOpen, onEdit, onArchive, onDelete }) {
  const preview = scene.source_anchor
    || scene.function
    || extractNotesPreview(scene.notes)
    || "Scene guidance available in Edit and V0 Writing.";
  return (
    <article className={`scene-card status-${scene.status?.toLowerCase()}`}>
      <div className="scene-card-top">
        <span className="scene-badge">{scene.number ? `Scene ${scene.number}` : "Unnumbered"}</span>
        <span className={`scene-status-badge s-${scene.status?.toLowerCase()}`}>{scene.status}</span>
      </div>
      <h2 className="scene-card-title">{scene.title}</h2>
      <span className="scene-badge" style={{ alignSelf: "flex-start" }}>{scene.system}</span>
      <p className="scene-card-preview">{preview}</p>
      <div className="scene-card-actions">
        <button className="btn-accent" onClick={onOpen}>Open →</button>
        <button onClick={onEdit}>Edit</button>
        {scene.status !== "Archived" && <button onClick={onArchive}>Archive</button>}
        <button className="btn-danger" onClick={onDelete}>Delete</button>
      </div>
    </article>
  );
}

function SceneEditorModal({ scene, onCancel, onSave }) {
  // Flatten stuck_bank sub-arrays into temp string fields for textarea editing.
  // Migration: if stuck_bank doesn't exist, fall back to old stuck_options for use_a_line.
  const [d, setD] = useState({
    ...scene,
    dont_forget:   scene.dont_forget   || scene.stuck_directive || "",
    source_anchor: scene.source_anchor || "",
    // Temp string fields for stuck_bank — prefixed with _ so they're stripped on save
    _ual: listToText(scene.stuck_bank?.use_a_line         || scene.stuck_options || []),
    _sas: listToText(scene.stuck_bank?.start_a_sentence   || []),
    _mtb: listToText(scene.stuck_bank?.move_the_body      || []),
    _ctp: listToText(scene.stuck_bank?.change_the_pressure || []),
    _etb: listToText(scene.stuck_bank?.end_the_beat       || []),
    _dnd: listToText(scene.do_not_do_this                 || []),
  });

  const set = (k, v) => setD(p => ({ ...p, [k]: v }));

  function save() {
    // Destructure out temp fields so they don't pollute the saved object
    const { _ual, _sas, _mtb, _ctp, _etb, _dnd, ...rest } = d;
    onSave({
      ...rest,
      number: Number(rest.number || 0),
      start_here:        textToList(listToText(rest.start_here)),
      success_looks_like: textToList(listToText(rest.success_looks_like)),
      do_not_do_this:    textToList(_dnd),
      stuck_bank: {
        use_a_line:          textToList(_ual),
        start_a_sentence:    textToList(_sas),
        move_the_body:       textToList(_mtb),
        change_the_pressure: textToList(_ctp),
        end_the_beat:        textToList(_etb),
      },
    });
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal">
        <div className="modal-header">
          <h2>Scene Card</h2>
          <button className="btn-ghost" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-row-2">
            <label className="form-label">Number<input type="number" value={d.number || ""} onChange={e => set("number", e.target.value)} placeholder="0" /></label>
            <label className="form-label" style={{ gridColumn: "2/4" }}>Title<input value={d.title} onChange={e => set("title", e.target.value)} /></label>
          </div>
          <div className="form-row-2">
            <label className="form-label">System
              <select value={d.system} onChange={e => set("system", e.target.value)}>
                {SYSTEMS.map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="form-label">Status
              <select value={d.status} onChange={e => set("status", e.target.value)}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
          </div>

          <label className="form-label full">Scene Function
            <input value={d.function || ""} onChange={e => set("function", e.target.value)} placeholder="What this scene must accomplish" />
          </label>

          <label className="form-label full">Non-Negotiable Rule
            <input value={d.rule || ""} onChange={e => set("rule", e.target.value)} placeholder="The one rule that cannot be broken" />
          </label>

          <label className="form-label full">Source Anchor
            <textarea rows={3} value={d.source_anchor} onChange={e => set("source_anchor", e.target.value)}
              placeholder="Scene-specific source material this scene is allowed to draw from. Prevents invention/contamination." />
          </label>

          <label className="form-label full">Don't Forget (register reminders — one block of text)
            <textarea rows={3} value={d.dont_forget} onChange={e => set("dont_forget", e.target.value)}
              placeholder="e.g. Body at rest. Ungoverned. No mask. No audience. Present tense." />
          </label>

          <div style={{fontSize:11,letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-3)",fontWeight:600,marginTop:4,paddingTop:10,borderTop:"1px solid var(--border-dim)"}}>I'm Stuck — Options (one per line per subcategory)</div>

          <label className="form-label full">Use a line
            <textarea rows={4} value={d._ual} onChange={e => set("_ual", e.target.value)}
              placeholder="3–5 polished / near-usable lines drawn from this scene's source material" />
          </label>
          <label className="form-label full">Start a sentence
            <textarea rows={3} value={d._sas} onChange={e => set("_sas", e.target.value)}
              placeholder="3–5 partial sentence starters" />
          </label>
          <label className="form-label full">Move the body
            <textarea rows={3} value={d._mtb} onChange={e => set("_mtb", e.target.value)}
              placeholder="3–5 physical movement prompts" />
          </label>
          <label className="form-label full">Change the pressure
            <textarea rows={3} value={d._ctp} onChange={e => set("_ctp", e.target.value)}
              placeholder="3–5 escalation / de-escalation options" />
          </label>
          <label className="form-label full">End the beat
            <textarea rows={3} value={d._etb} onChange={e => set("_etb", e.target.value)}
              placeholder="3–5 possible closing motions or stillness lines" />
          </label>

          <label className="form-label full">Do Not Do This (one warning per line)
            <textarea rows={4} value={d._dnd} onChange={e => set("_dnd", e.target.value)}
              placeholder={"Do not name her.\nDo not explain the wetness.\nDo not describe thought."} />
          </label>

          <label className="form-label full">Start Here (one per line)
            <textarea rows={3} value={listToText(d.start_here)} onChange={e => set("start_here", textToList(e.target.value))}
              placeholder="Each line → a clickable start option" />
          </label>

          <label className="form-label full">What Success Looks Like (one per line)
            <textarea rows={3} value={listToText(d.success_looks_like)} onChange={e => set("success_looks_like", textToList(e.target.value))} />
          </label>

          <label className="form-label full">Notes
            <textarea rows={2} value={d.notes || ""} onChange={e => set("notes", e.target.value)} />
          </label>
        </div>
        <div className="modal-footer">
          <button onClick={onCancel}>Cancel</button>
          <button className="btn-accent" onClick={save}>Save Scene</button>
        </div>
      </div>
    </div>
  );
}
