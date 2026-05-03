import React, { useEffect, useMemo, useState } from "react";
import { scenes as scenesApi, drafts as draftsApi, analysis as analysisApi, continuity as continuityApi, revisionQueue as revisionQueueApi, sourceMaterial as smApi } from "../lib/api.js";
// All analysis logic lives in engines — not in this component
import { runAbstractionCheck, runBodyCheck, runDevEditor } from "../engines/devEditor.js";
import { runRhythmCheck } from "../engines/rhythmEngine.js";
import { runContinuityCheck } from "../engines/continuityEngine.js";
import { runVoiceLock, detectRegister } from "../engines/voiceLock.js";
import { checkSceneDone } from "../engines/sceneDoneChecker.js";
import { createToast } from "../components/toast.js";
import "./analysisMode.css";

function runFullAnalysis(text, scene, ledger) {
  return {
    abstraction: runAbstractionCheck(text, scene),
    body:        runBodyCheck(text),
    rhythm:      runRhythmCheck(text),
    completion:  { ...checkSceneDone(text), type: "completion", label: "Scene Completion Check" },
    continuity:  runContinuityCheck(text, ledger.filter(e => e.scene_id === scene.id)),
    voice:       runVoiceLock(text),
  };
}

export default function AnalysisMode({ onOpenScene }) {
  const [scenes, setScenes]           = useState([]);
  const [selectedId, setSelectedId]   = useState(null);
  const [draft, setDraft]             = useState("");
  const [ledger, setLedger]           = useState([]);
  const [results, setResults]         = useState(null);
  const [history, setHistory]         = useState([]);
  const [revQueue, setRevQueue]       = useState([]);
  const [newRevNote, setNewRevNote]   = useState("");
  const [activeTab, setActiveTab]     = useState("run");
  const [loading, setLoading]         = useState(false);
  const [sourceMaterials, setSourceMaterials] = useState([]);

  useEffect(() => {
    // No auto-select: load scenes and ledger only
    scenesApi.getAll().then(list => {
      setScenes(list.filter(s => s.type !== "practice"));
    });
    continuityApi.getAll().then(setLedger);
    revisionQueueApi.getAll().then(setRevQueue);
  }, []);

  // Strict scene resolution — no fallback
  const scene = useMemo(() => selectedId ? scenes.find(s => s.id === selectedId) || null : null, [scenes, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDraft(""); setHistory([]); setResults(null); setSourceMaterials([]);
      return;
    }
    setLoading(true);
    Promise.all([
      draftsApi.get(selectedId),
      analysisApi.getForScene(selectedId),
      smApi.getForScene(selectedId),
    ])
      .then(([d, h, sm]) => {
        setDraft(d?.content || "");
        setHistory(h || []);
        setResults(null);
        setSourceMaterials(sm || []);
      })
      .catch(err => createToast("Load failed: " + err.message, "error"))
      .finally(() => setLoading(false));
  }, [selectedId]);

  async function runAnalysis() {
    if (!scene || !draft.trim()) { createToast("No draft to analyse.", "info"); return; }
    const r = runFullAnalysis(draft, scene, ledger);
    setResults(r);
    await analysisApi.saveResult({
      scene_id: scene.id, check_type: "full",
      passed: Object.values(r).filter(c => c.pass).length,
      total:  Object.keys(r).length,
      verdict: r.completion?.verdict || "",
      details: r,
      word_count: draft.split(/\s+/).filter(Boolean).length,
    });
    createToast("Analysis saved.", "success");
    analysisApi.getForScene(scene.id).then(setHistory);
  }

  async function addRevNote() {
    if (!newRevNote.trim() || !scene) return;
    await revisionQueueApi.add({ scene_id: scene.id, note: newRevNote, priority: "normal" });
    setNewRevNote(""); revisionQueueApi.getAll().then(setRevQueue);
    createToast("Added.", "success");
  }

  return (
    <div className="analysis-shell">
      <header className="analysis-header">
        <p className="analysis-kicker">Good for One Use</p>
        <h1 className="analysis-h1">Analysis Mode</h1>
        <p style={{color:"var(--text-3)",fontSize:13}}>Deterministic checks — no API calls</p>
      </header>

      <div className="analysis-layout">
        <aside className="analysis-sidebar">
          <p className="analysis-label">Scene</p>
          <select value={selectedId||""} onChange={e=>setSelectedId(e.target.value||null)} style={{width:"100%",marginBottom:12}}>
            <option value="">— Select scene —</option>
            {scenes.map(s=><option key={s.id} value={s.id}>{s.number?`${s.number}. `:""}{s.title} [{s.status}]</option>)}
          </select>

          {!selectedId && (
            <div className="analysis-empty" style={{marginTop:8}}>Select a scene to begin.</div>
          )}

          {scene && (
            <div className="analysis-scene-meta">
              <p><strong>{scene.title}</strong></p>
              <p style={{fontSize:12,color:"var(--text-3)"}}>{scene.system} · {scene.status}</p>
              {scene.function&&<p style={{fontSize:12,color:"var(--text-2)",marginTop:6}}>{scene.function}</p>}
              {scene.rule&&<div className="analysis-rule-box"><p className="analysis-rule-label">Rule</p><p className="analysis-rule-text">{scene.rule}</p></div>}
              <div style={{display:"flex",gap:6,marginTop:10}}>
                <button className="btn-accent" style={{flex:1}} onClick={runAnalysis} disabled={!draft.trim()||loading}>
                  {loading?"Loading…":"Run Analysis"}
                </button>
                {onOpenScene&&<button onClick={()=>onOpenScene(scene.id)} title="Open in V0 Writing">Write →</button>}
              </div>
              {draft&&<p style={{fontSize:11,color:"var(--text-3)",marginTop:8}}>{draft.split(/\s+/).filter(Boolean).length} words in draft</p>}
            </div>
          )}

          {sourceMaterials.length > 0 && (
            <div style={{marginTop:18}}>
              <p className="analysis-label">Source Material ({sourceMaterials.length})</p>
              {sourceMaterials.map(sm => (
                <div key={sm.id} style={{background:"var(--bg-card)",border:"1px solid var(--border-dim)",borderRadius:"var(--r-md)",padding:"8px 10px",marginBottom:6}}>
                  <p style={{fontSize:13,fontWeight:500,color:"var(--text-1)",marginBottom:2}}>{sm.title||"Untitled"}</p>
                  <span style={{fontSize:10,padding:"2px 6px",borderRadius:999,background:sm.scope==="global"?"var(--accent-dim)":"var(--bg-surface)",color:sm.scope==="global"?"var(--accent-hi)":"var(--text-3)",border:"1px solid var(--border-dim)"}}>
                    {sm.scope==="global"?"Global":"Scene"}
                  </span>
                  {sm.content&&<p style={{fontSize:11,color:"var(--text-3)",marginTop:4,lineHeight:1.5,maxHeight:60,overflow:"hidden",whiteSpace:"pre-wrap"}}>{sm.content}</p>}
                </div>
              ))}
            </div>
          )}

          {history.length>0&&(
            <div style={{marginTop:18}}>
              <p className="analysis-label">Recent Analysis</p>
              {history.slice(0,5).map(h=>(
                <div key={h.id} className="history-item">
                  <span className={`history-verdict ${h.verdict==="DONE ENOUGH — MOVE ON"?"v-done":h.verdict==="LIKELY DONE FOR NOW"?"v-likely":"v-keep"}`}>{h.verdict||"—"}</span>
                  <span style={{fontSize:11,color:"var(--text-3)"}}>{h.word_count}w · {new Date(h.created_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </aside>

        <main className="analysis-main">
          <div className="analysis-tabs">
            {[["run","Results"],["revision","Revision Queue"],["continuity","Continuity"]].map(([t,l])=>(
              <button key={t} className={`tab-btn ${activeTab===t?"active":""}`} onClick={()=>setActiveTab(t)}>{l}</button>
            ))}
          </div>

          {activeTab==="run"&&(
            <>
              {!results&&!loading&&<div className="analysis-empty">{!scene?"Select a scene to begin.":!draft.trim()?"No draft yet. Write something first.":"Click \"Run Analysis\" to evaluate this draft."}</div>}
              {loading&&<div className="analysis-empty">Loading…</div>}
              {results&&<FullResults results={results}/>}
            </>
          )}
          {activeTab==="revision"&&(
            <RevisionQueue queue={revQueue.filter(r=>!selectedId||r.scene_id===selectedId)} scenes={scenes} newNote={newRevNote} onNoteChange={setNewRevNote} onAdd={addRevNote} onResolve={async id=>{ await revisionQueueApi.resolve(id); revisionQueueApi.getAll().then(setRevQueue); }} sceneId={scene?.id}/>
          )}
          {activeTab==="continuity"&&(
            <ContinuityView ledger={ledger} scenes={scenes} selectedSceneId={selectedId}/>
          )}
        </main>
      </div>
    </div>
  );
}

function FullResults({ results }) {
  const ORDER = ["abstraction","body","rhythm","completion","voice","continuity"];
  const ICONS = { abstraction:"✎", body:"◉", rhythm:"≋", completion:"✓", voice:"♬", continuity:"⇄" };
  return (
    <div className="results-grid">
      {ORDER.map(key => {
        const r = results[key]; if (!r) return null;
        return (
          <div key={key} className={`result-card ${r.pass?"pass":"fail"}`}>
            <div className="result-card-top">
              <span className="result-icon">{ICONS[key]}</span>
              <strong className="result-label">{r.label}</strong>
              <span className={`result-badge ${r.pass?"pass":"fail"}`}>{r.pass?"Pass":"Fail"}</span>
            </div>
            {r.score!==undefined&&(
              <div className="result-score-bar">
                <div className="result-score-fill" style={{width:`${r.score}%`,background:r.pass?"var(--green)":"var(--red)"}}/>
                <span className="result-score-text">{r.score}%</span>
              </div>
            )}
            <p className="result-summary">{r.summary}</p>
            {key==="abstraction"&&r.findings&&<AbstractionDetail findings={r.findings}/>}
            {key==="completion"&&r.checks&&<CompletionDetail checks={r.checks}/>}
            {key==="voice"&&r.violations?.length>0&&r.violations.map((v,i)=>(
              <div key={i} style={{fontSize:12,padding:"4px 0",borderTop:"1px solid var(--border-dim)",color:"var(--text-2)"}}>
                <strong style={{color:"#e09090"}}>"{v.phrase}"</strong> — {v.reason}
              </div>
            ))}
            {key==="continuity"&&r.issues?.length>0&&r.issues.map((issue,i)=>(
              <div key={i} style={{fontSize:12,color:"var(--text-2)",padding:"3px 0"}}>
                <strong>{issue.keyword}</strong> — {issue.count}x · from ledger: "{issue.ledger}"
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function AbstractionDetail({ findings }) {
  const all = [...(findings.abstraction||[]),...(findings.bodyDrift||[])].slice(0,5);
  if (!all.length) return null;
  return (
    <div style={{marginTop:8}}>
      {all.map((f,i)=>(
        <div key={i} style={{fontSize:12,padding:"4px 0",borderTop:"1px solid var(--border-dim)"}}>
          <strong style={{color:"#e09090"}}>{f.sentenceNumber?`Sentence ${f.sentenceNumber}`:f.word}</strong>
          {f.sentenceText&&<p style={{color:"var(--text-3)",fontFamily:"var(--font-mono)",fontSize:11}}>"{f.sentenceText}"</p>}
          <p style={{color:"var(--text-2)"}}>{f.reason}</p>
        </div>
      ))}
    </div>
  );
}

function CompletionDetail({ checks }) {
  return (
    <div style={{marginTop:8}}>
      {checks.map(c=>(
        <div key={c.id||c.label} style={{display:"flex",gap:6,padding:"3px 0",borderTop:"1px solid var(--border-dim)"}}>
          <span style={{color:c.pass?"var(--green)":"var(--red)",fontSize:12}}>{c.pass?"✓":"✗"}</span>
          <div><p style={{fontSize:12,color:"var(--text-2)"}}>{c.label}</p><p style={{fontSize:11,color:"var(--text-3)"}}>{c.detail}</p>{!c.pass&&<p style={{fontSize:11,color:"var(--amber)"}}>{c.fix}</p>}</div>
        </div>
      ))}
    </div>
  );
}

function RevisionQueue({ queue, scenes, newNote, onNoteChange, onAdd, onResolve, sceneId }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{display:"flex",gap:8}}>
        <input value={newNote} onChange={e=>onNoteChange(e.target.value)} placeholder="Add revision note…" onKeyDown={e=>e.key==="Enter"&&onAdd()} style={{flex:1}}/>
        <button className="btn-accent" onClick={onAdd} disabled={!newNote.trim()||!sceneId}>Add</button>
      </div>
      {queue.length===0
        ? <div className="analysis-empty">No open revision items.</div>
        : queue.map(item=>(
          <div key={item.id} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,background:"var(--bg-card)",border:"1px solid var(--border-dim)",borderRadius:"var(--r-md)",padding:"12px 14px"}}>
            <div><p style={{fontSize:14,color:"var(--text-1)"}}>{item.note}</p><p style={{fontSize:11,color:"var(--text-3)"}}>{scenes.find(s=>s.id===item.scene_id)?.title||"Unknown"} · {new Date(item.created_at).toLocaleDateString()}</p></div>
            <button className="btn-ghost" style={{fontSize:11}} onClick={()=>onResolve(item.id)}>Resolve</button>
          </div>
        ))
      }
    </div>
  );
}

function ContinuityView({ ledger, scenes, selectedSceneId }) {
  const filtered = selectedSceneId ? ledger.filter(e=>e.scene_id===selectedSceneId) : ledger;
  return (
    <div>
      {filtered.length===0
        ? <div className="analysis-empty">No continuity ledger entries for this scene.</div>
        : filtered.map(entry=>(
          <div key={entry.id} style={{background:"var(--bg-card)",border:"1px solid var(--border-dim)",borderRadius:"var(--r-md)",padding:"12px 14px",marginBottom:8}}>
            <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text-3)"}}>{entry.entry_type}</span>
            <p style={{fontSize:13,color:"var(--text-2)",marginTop:3}}>{entry.content}</p>
            <p style={{fontSize:11,color:"var(--text-3)"}}>{scenes.find(s=>s.id===entry.scene_id)?.title||"—"} · {new Date(entry.created_at).toLocaleDateString()}</p>
          </div>
        ))
      }
    </div>
  );
}
