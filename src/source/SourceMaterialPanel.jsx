import React, { useEffect, useState } from "react";
import { sourceMaterial as smApi, scenes as scenesApi } from "../lib/api.js";
import { createToast } from "../components/toast.js";

function blankItem(sceneId = null) {
  return { id: null, title: "", content: "", tags: [], scene_id: sceneId, scope: sceneId ? "scene" : "global" };
}

export default function SourceMaterialPanel({ activeSceneId }) {
  const [items, setItems]       = useState([]);
  const [scenes, setScenes]     = useState([]);
  const [editing, setEditing]   = useState(null);
  const [filterScope, setFilterScope] = useState("all");
  const [filterScene, setFilterScene] = useState(activeSceneId || "");
  const [loading, setLoading]   = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [all, sc] = await Promise.all([smApi.getAll(), scenesApi.getAll()]);
      setItems(all);
      setScenes(sc);
    } catch (err) { createToast("Failed to load: " + err.message, "error"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { if (activeSceneId) setFilterScene(activeSceneId); }, [activeSceneId]);

  const filtered = items.filter(item => {
    if (filterScope === "global" && item.scope !== "global") return false;
    if (filterScope === "scene"  && item.scope !== "scene")  return false;
    if (filterScene && item.scope === "scene" && item.scene_id !== filterScene) return false;
    return true;
  });

  const sceneName = (id) => scenes.find(s => s.id === id)?.title || "Unknown scene";

  async function handleSave(item) {
    try {
      await smApi.upsert(item);
      createToast("Saved.", "success");
      setEditing(null);
      await load();
    } catch (err) { createToast("Save failed: " + err.message, "error"); }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this source material?")) return;
    await smApi.delete(id);
    createToast("Deleted.", "info");
    await load();
  }

  if (loading) return <div style={{ padding: 40, color: "var(--text-3)" }}>Loading…</div>;

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1200 }}>
      <p style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 5 }}>Good for One Use</p>
      <h1 style={{ fontSize: 28, fontWeight: 400, letterSpacing: "-.02em", marginBottom: 6 }}>Source Material</h1>
      <p style={{ color: "var(--text-3)", fontSize: 13, marginBottom: 20 }}>
        Global entries are available everywhere. Scene-scoped entries are linked to a specific scene.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn-accent" onClick={() => setEditing(blankItem(activeSceneId))}>+ Add Source Material</button>
        <select value={filterScope} onChange={e => setFilterScope(e.target.value)} style={{ width: 140 }}>
          <option value="all">All scope</option>
          <option value="global">Global only</option>
          <option value="scene">Scene-scoped</option>
        </select>
        {filterScope !== "global" && (
          <select value={filterScene} onChange={e => setFilterScene(e.target.value)} style={{ width: 220 }}>
            <option value="">All scenes</option>
            {scenes.map(s => <option key={s.id} value={s.id}>{s.number ? `${s.number}. ` : ""}{s.title}</option>)}
          </select>
        )}
        <span style={{ fontSize: 12, color: "var(--text-3)", marginLeft: "auto" }}>{filtered.length} item{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-dim)", borderRadius: "var(--r-lg)", padding: 28, color: "var(--text-3)", fontSize: 14 }}>
          No source material yet. Add your first entry above.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
          {filtered.map(item => (
            <div key={item.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border-dim)", borderRadius: "var(--r-lg)", padding: "16px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
                <h3 style={{ fontSize: 16, fontWeight: 400, color: "var(--text-1)" }}>{item.title || "Untitled"}</h3>
                <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, background: item.scope === "global" ? "var(--accent-dim)" : "var(--bg-surface)", color: item.scope === "global" ? "var(--accent-hi)" : "var(--text-3)", border: "1px solid var(--border-dim)", whiteSpace: "nowrap" }}>
                  {item.scope === "global" ? "Global" : "Scene"}
                </span>
              </div>

              {item.scope === "scene" && item.scene_id && (
                <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>
                  ↳ {sceneName(item.scene_id)}
                </p>
              )}

              <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55, marginBottom: item.tags?.length ? 8 : 0, whiteSpace: "pre-wrap", maxHeight: 120, overflow: "hidden" }}>
                {item.content || "(no content)"}
              </p>

              {item.tags?.length > 0 && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                  {item.tags.map(tag => (
                    <span key={tag} style={{ fontSize: 11, padding: "2px 7px", borderRadius: 999, background: "var(--bg-surface)", color: "var(--text-3)", border: "1px solid var(--border-dim)" }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 6, marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border-dim)" }}>
                <button onClick={() => setEditing({ ...item })}>Edit</button>
                <button className="btn-danger" onClick={() => handleDelete(item.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <SourceMaterialModal
          item={editing}
          scenes={scenes}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function SourceMaterialModal({ item, scenes, onCancel, onSave }) {
  const [d, setD] = useState({ ...item, tags: Array.isArray(item.tags) ? item.tags : [] });
  const set = (k, v) => setD(p => ({ ...p, [k]: v }));

  function handleScopeChange(e) {
    const scoped = e.target.value === "scene";
    setD(p => ({ ...p, scope: e.target.value, scene_id: scoped ? p.scene_id : null }));
  }

  function handleTagInput(e) {
    const tags = e.target.value.split(",").map(t => t.trim()).filter(Boolean);
    set("tags", tags);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={e => e.target === e.currentTarget && onCancel()}>
      <div style={{ width: "min(680px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "var(--bg-card)", border: "1px solid var(--border-mid)", borderRadius: "var(--r-xl)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px 12px", borderBottom: "1px solid var(--border-dim)" }}>
          <h2 style={{ fontSize: 17, fontWeight: 400 }}>{d.id ? "Edit Source Material" : "New Source Material"}</h2>
          <button className="btn-ghost" onClick={onCancel}>✕</button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 11 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--text-3)" }}>
            Title
            <input value={d.title} onChange={e => set("title", e.target.value)} placeholder="Source material title" />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--text-3)" }}>
            Content
            <textarea rows={6} value={d.content} onChange={e => set("content", e.target.value)} placeholder="Paste or type your source material here…" />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--text-3)" }}>
              Scope
              <select value={d.scope || "global"} onChange={handleScopeChange}>
                <option value="global">Global (all scenes)</option>
                <option value="scene">Scene-specific</option>
              </select>
            </label>
            {(d.scope === "scene") && (
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--text-3)" }}>
                Scene
                <select value={d.scene_id || ""} onChange={e => set("scene_id", e.target.value || null)}>
                  <option value="">— Select scene —</option>
                  {scenes.map(s => <option key={s.id} value={s.id}>{s.number ? `${s.number}. ` : ""}{s.title}</option>)}
                </select>
              </label>
            )}
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--text-3)" }}>
            Tags (comma-separated)
            <input
              value={d.tags.join(", ")}
              onChange={handleTagInput}
              placeholder="character, location, object…"
            />
          </label>
        </div>

        <div style={{ padding: "12px 20px 16px", borderTop: "1px solid var(--border-dim)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel}>Cancel</button>
          <button className="btn-accent" onClick={() => onSave(d)}>Save</button>
        </div>
      </div>
    </div>
  );
}
