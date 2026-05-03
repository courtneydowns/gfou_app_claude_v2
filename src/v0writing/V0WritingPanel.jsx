import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scenes as scenesApi, drafts as draftsApi, sessions as sessionsApi, analysis as analysisApi, sourceMaterial as smApi } from "../lib/api.js";
// Engine imports — all logic lives in src/engines/, not here
import { analyzeV0Text, getForwardDirective, splitSentences } from "../engines/ruleEngine.js";
import { checkSceneDone } from "../engines/sceneDoneChecker.js";
import { createToast } from "../components/toast.js";
import "./v0Writing.css";

function wc(t) { return String(t||"").trim().split(/\s+/).filter(Boolean).length; }

export default function V0WritingPanel({ sceneId: providedSceneId, onBackToLibrary }) {
  const [allScenes, setAllScenes] = useState([]);
  // sceneId is always an explicit ID — never falls back to allScenes[0]
  const [sceneId, setSceneId]     = useState(providedSceneId || null);
  const [text, setText]           = useState("");
  const [draftLocked, setDraftLocked] = useState(false);
  const [savedAt, setSavedAt]     = useState(null);
  const [openSection, setOpenSection] = useState("start");
  const [showDoneCheck, setShowDoneCheck] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [sourceMaterials, setSourceMaterials] = useState([]);
  const sessionRef = useRef(null);
  const saveTimer  = useRef(null);
  // Ref to always hold the latest text for session cleanup — avoids stale closure
  const textRef    = useRef("");

  // Keep textRef in sync with text
  useEffect(() => { textRef.current = text; }, [text]);

  useEffect(() => {
    scenesApi.getAll().then(list => {
      setAllScenes(list);
      setLoading(false);
    }).catch(err => {
      createToast("Failed to load scenes: " + err.message, "error");
      setLoading(false);
    });
  }, []);

  // Sync provided sceneId from Library
  useEffect(() => {
    if (providedSceneId && providedSceneId !== sceneId) setSceneId(providedSceneId);
  }, [providedSceneId]);

  // Strict scene resolution — NO fallback to allScenes[0]
  const scene = useMemo(() => {
    if (!sceneId) return null;
    return allScenes.find(s => s.id === sceneId) || null;
  }, [allScenes, sceneId]);

  // Load draft when scene ID changes — keyed strictly by scene.id
  useEffect(() => {
    if (!scene?.id) { setText(""); setSourceMaterials([]); return; }
    draftsApi.get(scene.id).then(d => { setText(d?.content || ""); setSavedAt(null); });
    smApi.getForScene(scene.id).then(sm => setSourceMaterials(sm || [])).catch(() => setSourceMaterials([]));
  }, [scene?.id]);

  // Session tracking — uses textRef to avoid stale text in cleanup
  useEffect(() => {
    if (!scene?.id) return;
    sessionsApi.start(scene.id).then(r => { sessionRef.current = r?.session_id || null; });
    return () => {
      if (sessionRef.current) {
        sessionsApi.end(sessionRef.current, wc(textRef.current), 0).catch(() => {});
      }
    };
  }, [scene?.id]);

  // Autosave debounced — only for current scene.id
  useEffect(() => {
    if (draftLocked || !scene?.id) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await draftsApi.save(scene.id, text);
      setSavedAt(new Date());
    }, 700);
    return () => clearTimeout(saveTimer.current);
  }, [scene?.id, text, draftLocked]);

  // Engine calls — pass scene for scene-specific vocabulary
  const findings     = useMemo(() => scene ? analyzeV0Text(text, scene) : [], [text, scene]);
  const abstractF    = useMemo(() => findings.filter(f => f.type==="abstraction"||f.type==="compression"), [findings]);
  const bodyF        = useMemo(() => findings.filter(f => f.type==="body_check"), [findings]);
  const directive    = useMemo(() => getForwardDirective(text), [text]);
  const sentenceCount= useMemo(() => splitSentences(text).length, [text]);
  const doneCheck    = useMemo(() => showDoneCheck ? checkSceneDone(text) : null, [text, showDoneCheck]);

  async function handleSave() {
    if (!scene?.id) return;
    await draftsApi.save(scene.id, text); setSavedAt(new Date()); createToast("Saved.", "success");
  }
  async function handleClear() {
    if (draftLocked||!scene?.id) return;
    if (!window.confirm("Clear this draft?")) return;
    await draftsApi.clear(scene.id); setText(""); setSavedAt(null); createToast("Draft cleared.", "info");
  }
  async function handleSnapshot() {
    if (!scene?.id) return;
    await draftsApi.snapshot(scene.id, `Snapshot ${new Date().toLocaleString()}`);
    createToast("Snapshot saved.", "success");
  }
  async function handleExport() {
    if (!scene) return;
    const slug  = `${String(scene.number||0).padStart(2,"0")}-${scene.title.replace(/[^a-z0-9]+/gi,"-").toLowerCase()}`;
    const blob  = new Blob([[`Scene ${scene.number}: ${scene.title}`,`System: ${scene.system}`,`Rule: ${scene.rule||"—"}`,"","DRAFT:","",text||""].join("\n")], {type:"text/plain"});
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement("a"); a.href=url; a.download=`${slug}.txt`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    createToast("Exported.", "success");
  }
  async function handleSaveAnalysis() {
    if (!scene?.id) return;
    const d = checkSceneDone(text);
    await analysisApi.saveResult({ scene_id: scene.id, check_type: "full", passed: d.passed, total: d.total, verdict: d.verdict, details: { findings_count: findings.length, abstraction: abstractF.length, body_drift: bodyF.length, checks: d.checks }, word_count: wc(text) });
    createToast("Analysis saved.", "success");
  }
  async function handleSceneSwitch(e) {
    const nextId = e.target.value;
    if (nextId === sceneId) return;
    if (scene?.id) await draftsApi.save(scene.id, text);
    setSceneId(nextId);
    createToast("Scene loaded.", "info");
  }

  function insertLine(line) { if (draftLocked) return; setText(t => t ? `${t}\n${line}` : line); }
  function replaceSentence(item, replacement) {
    if (!item.sentenceText||!replacement) return;
    setText(t => t.replace(item.sentenceText, replacement));
    createToast(`Sentence ${item.sentenceNumber} replaced.`, "success");
  }
  function toggle(key) { setOpenSection(o => o===key?"":key); }

  if (loading) return <div style={{padding:40,color:"var(--text-3)"}}>Loading…</div>;

  // Strict empty state — no scene selected or scene ID doesn't match any scene
  if (!sceneId || !scene) {
    return (
      <div className="v0-shell">
        <div className="v0-empty">
          <h2 style={{fontWeight:400,fontSize:22,color:"var(--text-2)"}}>No scene selected</h2>
          <p style={{color:"var(--text-3)",fontSize:14}}>Select a scene from the library to begin writing.</p>
          {onBackToLibrary && <button onClick={onBackToLibrary} style={{marginTop:12}}>← Scene Library</button>}
        </div>
      </div>
    );
  }

  const isDone = directive.startsWith("DONE:");
  const savedLabel = savedAt
    ? `Saved ${savedAt.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}`
    : "Autosave ready";

  return (
    <div className="v0-shell">
      <header className="v0-topbar">
        <div>
          <p className="v0-kicker">Good for One Use</p>
          <h1 className="v0-h1">V0 Writing Mode</h1>
        </div>
        <div className="v0-topbar-actions">
          {onBackToLibrary && <button onClick={onBackToLibrary}>← Library</button>}
          <button onClick={handleSave}>Save</button>
          <button onClick={() => setDraftLocked(v=>!v)}>{draftLocked?"Unlock":"Lock"}</button>
          <button onClick={handleSnapshot}>Snapshot</button>
          <button onClick={handleSaveAnalysis}>Save Analysis</button>
          <button onClick={handleExport}>Export TXT</button>
          <button onClick={handleClear} disabled={draftLocked}>Clear</button>
        </div>
      </header>

      <div className="v0-grid">
        <aside className="v0-card">
          <p className="v0-label">Scene</p>
          <select value={scene.id} onChange={handleSceneSwitch}>
            {allScenes.map(s => (
              <option key={s.id} value={s.id}>{s.number?`${s.number}. `:""}{s.title} [{s.status}]</option>
            ))}
          </select>
          <div style={{display:"flex",gap:6,margin:"8px 0",flexWrap:"wrap"}}>
            <span className="v0-tag">{scene.system}</span>
            <span className="v0-tag">{scene.status}</span>
          </div>
          {scene.function && <p className="v0-scene-fn">{scene.function}</p>}
          <Section label="START HERE" open={openSection==="start"} onToggle={()=>toggle("start")}>
            {(!scene.start_here||scene.start_here.length===0)
              ? <p className="v0-hint">No start lines — edit in Scene Library.</p>
              : <div className="v0-opts">{scene.start_here.map(l=><button key={l} className="v0-opt" onClick={()=>insertLine(l)} disabled={draftLocked}>{l}</button>)}</div>}
          </Section>
          <Section label="NON-NEGOTIABLE RULE" open={openSection==="rule"} onToggle={()=>toggle("rule")}>
            <p className="v0-rule-text">{scene.rule||"No rule set."}</p>
          </Section>
          <Section label="I'M STUCK" open={openSection==="stuck"} onToggle={()=>toggle("stuck")}>
            {scene.stuck_directive && <p className="v0-hint" style={{marginBottom:6}}>{scene.stuck_directive}</p>}
            {(scene.stuck_options||[]).length>0
              ? <div className="v0-opts">{scene.stuck_options.map(l=><button key={l} className="v0-opt" onClick={()=>insertLine(l)} disabled={draftLocked}>{l}</button>)}</div>
              : <p className="v0-hint">No stuck options set.</p>}
          </Section>
          <Section label="WHAT SUCCESS LOOKS LIKE" open={openSection==="success"} onToggle={()=>toggle("success")}>
            {(scene.success_looks_like||[]).length===0
              ? <p className="v0-hint">No criteria set.</p>
              : <ul className="v0-success-list">{scene.success_looks_like.map(i=><li key={i}>{i}</li>)}</ul>}
          </Section>
        </aside>

        <section className="v0-editor-card">
          <div className="v0-editor-header">
            <div><p className="v0-kicker">Forward-only draft</p><h2 className="v0-scene-title">{scene.title}</h2></div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              <span className={`v0-badge ${draftLocked?"locked":"writing"}`}>{draftLocked?"Locked":"Writing"}</span>
              <span className="v0-badge">{savedLabel}</span>
              <span className="v0-badge">{sentenceCount} sent.</span>
              <span className="v0-badge">{wc(text)} words</span>
            </div>
          </div>
          <textarea className="v0-textarea" value={text} disabled={draftLocked}
            onChange={e=>setText(e.target.value)}
            placeholder="Write the next physical sentence. Do not reread. Do not explain."
          />
          <div className={`v0-directive ${isDone?"done":""}`}>
            <strong>{isDone?"Done:":"Next:"}</strong>{" "}{directive.replace(/^(DONE|NEXT):\s*/,"")}
          </div>
          <div className="v0-done-row">
            <button className="btn-ghost" style={{fontSize:12}} onClick={()=>setShowDoneCheck(v=>!v)}>
              {showDoneCheck?"Hide scene check":"Check if scene is done"}
            </button>
            {doneCheck && (
              <span className={`v0-verdict ${doneCheck.verdict==="DONE ENOUGH — MOVE ON"?"v-done":doneCheck.verdict==="LIKELY DONE FOR NOW"?"v-likely":"v-keep"}`}>
                {doneCheck.verdict}
              </span>
            )}
          </div>
          {doneCheck && (
            <div className="v0-checks">
              {doneCheck.checks.map(c=>(
                <div key={c.id||c.label} className={`v0-check ${c.pass?"pass":"fail"}`}>
                  <span className="v0-check-icon">{c.pass?"✓":"✗"}</span>
                  <div><strong>{c.label}</strong><small>{c.detail}</small>{!c.pass&&<em>{c.fix}</em>}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="v0-card v0-correction">
          <h2 className="v0-correction-h">Live Correction</h2>
          {findings.length===0
            ? <p className="v0-clean">Clean. Keep moving.</p>
            : <>
                {abstractF.length>0&&<FindingGroup label="Fix what breaks the rule" items={abstractF.slice(0,6)} soft={false} locked={draftLocked} onReplace={replaceSentence}/>}
                {bodyF.length>0&&<FindingGroup label="Body check" items={bodyF.slice(0,4)} soft locked={draftLocked} onReplace={replaceSentence}/>}
              </>
          }

          {sourceMaterials.length > 0 && (
            <div style={{marginTop:20,paddingTop:14,borderTop:"1px solid var(--border-dim)"}}>
              <h3 style={{fontSize:11,letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-3)",fontWeight:500,marginBottom:8}}>
                Source Material
              </h3>
              {sourceMaterials.map(sm => (
                <div key={sm.id} style={{marginBottom:8,background:"var(--bg-surface)",border:"1px solid var(--border-dim)",borderRadius:"var(--r-md)",padding:"8px 10px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:6,marginBottom:3}}>
                    <p style={{fontSize:12,fontWeight:500,color:"var(--text-1)"}}>{sm.title||"Untitled"}</p>
                    <span style={{fontSize:10,padding:"1px 5px",borderRadius:999,background:sm.scope==="global"?"var(--accent-dim)":"transparent",color:sm.scope==="global"?"var(--accent-hi)":"var(--text-3)",border:"1px solid var(--border-dim)",whiteSpace:"nowrap"}}>
                      {sm.scope==="global"?"Global":"Scene"}
                    </span>
                  </div>
                  {sm.content&&<p style={{fontSize:11,color:"var(--text-3)",lineHeight:1.5,maxHeight:72,overflow:"hidden",whiteSpace:"pre-wrap"}}>{sm.content}</p>}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Section({ label, open, onToggle, children }) {
  return (
    <div className="v0-section">
      <button className="v0-section-toggle" onClick={onToggle}>
        <span>{label}</span><span style={{fontSize:9,opacity:.6}}>{open?"▲":"▼"}</span>
      </button>
      {open && <div className="v0-section-body">{children}</div>}
    </div>
  );
}

function FindingGroup({ label, items, soft, locked, onReplace }) {
  return (
    <div className="v0-finding-group">
      <h3>{label}</h3>
      {items.map((item, i) => (
        <div key={i} className={`v0-finding ${soft?"soft":""}`}>
          <strong className="v0-finding-label">
            {item.sentenceNumber?`Sentence ${item.sentenceNumber}`:item.word}
            {item.type==="abstraction"?` · "${item.word}"`:""}
          </strong>
          {item.sentenceText&&<p className="v0-finding-excerpt">"{item.sentenceText}"</p>}
          <p className="v0-finding-reason">{item.reason}</p>
          <small className="v0-finding-fix">{item.fix}</small>
          {(item.alternatives||[]).filter(Boolean).length>0&&(
            <div className="v0-alts">
              {item.alternatives.filter(Boolean).map(opt=>(
                <button key={opt} className="v0-alt-btn" disabled={locked} onClick={()=>onReplace(item,opt)}>{opt}</button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
