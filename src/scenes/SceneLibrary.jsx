import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scenes as scenesApi, exports_ } from "../lib/api.js";
import { createToast } from "../components/toast.js";
import "./sceneLibrary.css";

const STATUSES = ["Draft", "Canon", "Archived", "Practice"];
const SYSTEMS  = ["Mask", "Fuel", "Break", "Exception", "Shattering", "Unassigned"];
const MANUSCRIPT_STATUSES = ["Draft", "Canon", "Archived"];

function listToText(a) { return (Array.isArray(a) ? a : []).join("\n"); }
function textToList(s) { return String(s||"").split("\n").map(x=>x.trim()).filter(Boolean); }

function blankScene() {
  return {
    id: `scene-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    number: 0, title: "Untitled Scene", system: "Unassigned",
    status: "Draft", type: "manuscript", function: "",
    start_here: [], rule: "", stuck_directive: "",
    stuck_options: [], success_looks_like: [], notes: ""
  };
}

export default function SceneLibrary({ onOpenScene }) {
  const [scenes, setScenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("Draft");
  const [systemFilter, setSystemFilter] = useState("All");
  const [sortMode, setSortMode] = useState("number");
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
      .sort((a,b) => {
        if (sortMode === "updated") return b.updated_at?.localeCompare(a.updated_at||"")||0;
        if (sortMode === "title")   return a.title.localeCompare(b.title);
        if (sortMode === "status")  return a.status.localeCompare(b.status);
        return Number(a.number||0) - Number(b.number||0);
      });
  }, [manuscriptScenes, query, statusFilter, systemFilter, sortMode]);

  const counts = useMemo(() =>
    MANUSCRIPT_STATUSES.reduce((a,s) => { a[s] = manuscriptScenes.filter(x=>x.status===s).length; return a; }, {}),
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
    a.download = `gfou-scenes-${new Date().toISOString().slice(0,10)}.json`;
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

  if (loading) return <div style={{padding:40,color:"var(--text-3)"}}>Loading scenes…</div>;

  return (
    <div className="lib-shell">
      <header className="lib-header">
        <div>
          <p className="lib-kicker">Good for One Use</p>
          <h1 className="lib-title">Scene Library</h1>
          <p style={{color:"var(--text-3)",fontSize:13}}>
            {manuscriptScenes.length} scene{manuscriptScenes.length!==1?"s":""} · SQLite
          </p>
        </div>
        <div className="lib-actions">
          <button className="btn-accent" onClick={() => setEditingScene(blankScene())}>+ New Scene</button>
          <button onClick={handleExportJSON}>Export JSON</button>
          <label className="btn-file">Import JSON<input type="file" accept=".json" ref={importRef} onChange={handleImport}/></label>
          <button className="btn-danger-soft" onClick={handlePanicExport}>⚠ Panic Export</button>
        </div>
      </header>

      <div className="lib-status-bar">
        {MANUSCRIPT_STATUSES.map(s => (
          <button key={s}
            className={`lib-status-btn ${statusFilter===s?"active":""}`}
            onClick={() => setStatusFilter(statusFilter===s?"All":s)}
          >
            <span>{s}</span><strong>{counts[s]||0}</strong>
          </button>
        ))}
      </div>

      <div className="lib-controls">
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search title, function, notes…"/>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option>All</option>{MANUSCRIPT_STATUSES.map(s=><option key={s}>{s}</option>)}
        </select>
        <select value={systemFilter} onChange={e=>setSystemFilter(e.target.value)}>
          <option>All</option>{SYSTEMS.map(s=><option key={s}>{s}</option>)}
        </select>
        <select value={sortMode} onChange={e=>setSortMode(e.target.value)}>
          <option value="number">Sort: Number</option>
          <option value="updated">Sort: Updated</option>
          <option value="title">Sort: Title</option>
          <option value="status">Sort: Status</option>
        </select>
      </div>

      {filtered.length === 0
        ? <div className="lib-empty">{query||statusFilter!=="All"||systemFilter!=="All"?"No scenes match.":"No scenes yet. Create your first scene above."}</div>
        : <div className="lib-grid">
            {filtered.map(s => (
              <SceneCard key={s.id} scene={s}
                onOpen={() => { onOpenScene(s.id); }}
                onEdit={() => setEditingScene({...s})}
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

function SceneCard({ scene, onOpen, onEdit, onArchive, onDelete }) {
  return (
    <article className={`scene-card status-${scene.status?.toLowerCase()}`}>
      <div className="scene-card-top">
        <span className="scene-badge">{scene.number ? `Scene ${scene.number}` : "Unnumbered"}</span>
        <span className={`scene-status-badge s-${scene.status?.toLowerCase()}`}>{scene.status}</span>
      </div>
      <h2 className="scene-card-title">{scene.title}</h2>
      <div style={{display:"flex",gap:6,marginBottom:8}}>
        <span className="scene-badge">{scene.system}</span>
      </div>
      {scene.function && <p className="scene-card-fn">{scene.function}</p>}
      {scene.rule && (
        <div className="scene-card-rule">
          <p className="rule-label">Rule</p>
          <p className="rule-text">{scene.rule}</p>
        </div>
      )}
      {scene.notes && <p style={{fontSize:12,color:"var(--text-3)",fontStyle:"italic"}}>{scene.notes}</p>}
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
  const [d, setD] = useState({...scene});
  const set = (k,v) => setD(p=>({...p,[k]:v}));

  function save() {
    onSave({
      ...d, number: Number(d.number||0),
      start_here: textToList(listToText(d.start_here)),
      stuck_options: textToList(listToText(d.stuck_options)),
      success_looks_like: textToList(listToText(d.success_looks_like)),
    });
  }

  return (
    <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&onCancel()}>
      <div className="modal">
        <div className="modal-header">
          <h2>Scene Card</h2>
          <button className="btn-ghost" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-row-2">
            <label className="form-label">Number<input type="number" value={d.number||""} onChange={e=>set("number",e.target.value)} placeholder="0"/></label>
            <label className="form-label" style={{gridColumn:"2/4"}}>Title<input value={d.title} onChange={e=>set("title",e.target.value)}/></label>
          </div>
          <div className="form-row-2">
            <label className="form-label">System
              <select value={d.system} onChange={e=>set("system",e.target.value)}>
                {SYSTEMS.map(s=><option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="form-label">Status
              <select value={d.status} onChange={e=>set("status",e.target.value)}>
                {STATUSES.map(s=><option key={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <label className="form-label full">Scene Function<input value={d.function||""} onChange={e=>set("function",e.target.value)} placeholder="What this scene must accomplish"/></label>
          <label className="form-label full">Non-Negotiable Rule<input value={d.rule||""} onChange={e=>set("rule",e.target.value)} placeholder="The one rule that cannot be broken"/></label>
          <label className="form-label full">Start Here (one per line)
            <textarea rows={4} value={listToText(d.start_here)} onChange={e=>set("start_here",textToList(e.target.value))} placeholder="Each line → a clickable start option"/>
          </label>
          <label className="form-label full">I'm Stuck — Directive<input value={d.stuck_directive||""} onChange={e=>set("stuck_directive",e.target.value)}/></label>
          <label className="form-label full">I'm Stuck — Options (one per line)
            <textarea rows={3} value={listToText(d.stuck_options)} onChange={e=>set("stuck_options",textToList(e.target.value))}/>
          </label>
          <label className="form-label full">What Success Looks Like (one per line)
            <textarea rows={3} value={listToText(d.success_looks_like)} onChange={e=>set("success_looks_like",textToList(e.target.value))}/>
          </label>
          <label className="form-label full">Notes<textarea rows={2} value={d.notes||""} onChange={e=>set("notes",e.target.value)}/></label>
        </div>
        <div className="modal-footer">
          <button onClick={onCancel}>Cancel</button>
          <button className="btn-accent" onClick={save}>Save Scene</button>
        </div>
      </div>
    </div>
  );
}
