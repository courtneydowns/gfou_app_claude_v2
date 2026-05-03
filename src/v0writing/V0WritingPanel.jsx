import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scenes as scenesApi, drafts as draftsApi, sessions as sessionsApi, analysis as analysisApi, sourceMaterial as smApi } from "../lib/api.js";
import { analyzeV0Text, getForwardDirective, splitSentences } from "../engines/ruleEngine.js";
import { checkSceneDone } from "../engines/sceneDoneChecker.js";
import { createToast } from "../components/toast.js";
import "./v0Writing.css";

function wc(t) { return String(t || "").trim().split(/\s+/).filter(Boolean).length; }

// Migrate old flat stuck_options into the new stuck_bank shape.
// If scene.stuck_bank already exists and is a plain object, use it directly.
function resolveStuckBank(scene) {
  if (!scene) return null;
  if (scene.stuck_bank && typeof scene.stuck_bank === "object" && !Array.isArray(scene.stuck_bank)) {
    return scene.stuck_bank;
  }
  return {
    use_a_line: Array.isArray(scene.stuck_options) ? scene.stuck_options : [],
    start_a_sentence: [],
    move_the_body: [],
    change_the_pressure: [],
    end_the_beat: [],
  };
}

export default function V0WritingPanel({ sceneId: providedSceneId, onBackToLibrary }) {
  const [allScenes, setAllScenes]       = useState([]);
  const [sceneId, setSceneId]           = useState(providedSceneId || null);
  const [text, setText]                 = useState("");
  const [draftLocked, setDraftLocked]   = useState(false);
  const [savedAt, setSavedAt]           = useState(null);
  // openSection is an exclusive toggle among: anchor / dontforget / nextmove / stuck
  const [openSection, setOpenSection]   = useState("");
  // DO NOT DO THIS has its own boolean so auto-open doesn't conflict with exclusive toggle
  const [doNotDoOpen, setDoNotDoOpen]   = useState(false);
  const [showDoneCheck, setShowDoneCheck] = useState(false);
  const [loading, setLoading]           = useState(true);
  const [sourceMaterials, setSourceMaterials] = useState([]);
  // Tracks which correction card is currently selected (e.g. "abs-0", "body-2")
  const [selectedFindingKey, setSelectedFindingKey] = useState(null);
  // Brief flash on the textarea after insert / replace
  const [textareaFlash, setTextareaFlash] = useState(false);

  const sessionRef     = useRef(null);
  const saveTimer      = useRef(null);
  const analysisTimer  = useRef(null);
  const textRef        = useRef("");
  const textareaRef    = useRef(null);
  const lastCursorRef  = useRef({ start: null, end: null });

  // Separate debounced text for live corrections (1.2 s) so typing isn't noisy
  const [analysisText, setAnalysisText] = useState("");

  useEffect(() => { textRef.current = text; }, [text]);

  useEffect(() => {
    clearTimeout(analysisTimer.current);
    analysisTimer.current = setTimeout(() => setAnalysisText(text), 1200);
    return () => clearTimeout(analysisTimer.current);
  }, [text]);

  useEffect(() => {
    scenesApi.getAll().then(list => {
      setAllScenes(list);
      setLoading(false);
    }).catch(err => {
      createToast("Failed to load scenes: " + err.message, "error");
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (providedSceneId && providedSceneId !== sceneId) setSceneId(providedSceneId);
  }, [providedSceneId]);

  const scene = useMemo(() => {
    if (!sceneId) return null;
    return allScenes.find(s => s.id === sceneId) || null;
  }, [allScenes, sceneId]);

  useEffect(() => {
    if (!scene?.id) { setText(""); setSourceMaterials([]); return; }
    draftsApi.get(scene.id).then(d => { setText(d?.content || ""); setSavedAt(null); });
    smApi.getForScene(scene.id).then(sm => setSourceMaterials(sm || [])).catch(() => setSourceMaterials([]));
  }, [scene?.id]);

  // Reset UI state on scene change
  useEffect(() => {
    setSelectedFindingKey(null);
    setOpenSection("");
    setDoNotDoOpen(false);
  }, [scene?.id]);

  useEffect(() => {
    if (!scene?.id) return;
    sessionsApi.start(scene.id).then(r => { sessionRef.current = r?.session_id || null; });
    return () => {
      if (sessionRef.current) {
        sessionsApi.end(sessionRef.current, wc(textRef.current), 0).catch(() => {});
      }
    };
  }, [scene?.id]);

  useEffect(() => {
    if (draftLocked || !scene?.id) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await draftsApi.save(scene.id, text);
      setSavedAt(new Date());
    }, 700);
    return () => clearTimeout(saveTimer.current);
  }, [scene?.id, text, draftLocked]);

  // All finding computations use analysisText (debounced), not live text
  const findings    = useMemo(() => scene ? analyzeV0Text(analysisText, scene) : [], [analysisText, scene]);
  const abstractF   = useMemo(() => findings.filter(f => f.type === "abstraction" || f.type === "compression"), [findings]);
  const bodyF       = useMemo(() => findings.filter(f => f.type === "body_check"), [findings]);
  const directive   = useMemo(() => getForwardDirective(text), [text]);
  const sentenceCount = useMemo(() => splitSentences(text).length, [text]);
  const doneCheck   = useMemo(() => showDoneCheck ? checkSceneDone(text) : null, [text, showDoneCheck]);

  // Auto-open DO NOT DO THIS when rule violations appear; close when they clear
  const doNotDoThis = useMemo(() => scene?.do_not_do_this || [], [scene]);
  useEffect(() => {
    if (doNotDoThis.length > 0 && abstractF.length > 0) setDoNotDoOpen(true);
    if (abstractF.length === 0) setDoNotDoOpen(false);
  }, [abstractF.length, doNotDoThis.length]);

  // Reset finding selection when corrections change
  useEffect(() => { setSelectedFindingKey(null); }, [findings]);

  const stuckBank  = useMemo(() => resolveStuckBank(scene), [scene]);
  const dontForget = scene?.dont_forget || scene?.stuck_directive || "";
  const sourceAnchor = scene?.source_anchor || "";
  const isDone     = directive.startsWith("DONE:");
  const savedLabel = savedAt
    ? `Saved ${savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "Autosave ready";

  // ── Actions ──────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!scene?.id) return;
    await draftsApi.save(scene.id, text); setSavedAt(new Date()); createToast("Saved.", "success");
  }
  async function handleClear() {
    if (draftLocked || !scene?.id) return;
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
    const slug = `${String(scene.number || 0).padStart(2, "0")}-${scene.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    const blob = new Blob([[`Scene ${scene.number}: ${scene.title}`, `System: ${scene.system}`, `Rule: ${scene.rule || "—"}`, "", "DRAFT:", "", text || ""].join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${slug}.txt`;
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

    // Refresh scene records on switch so guidance/sidebar fields cannot stay stale.
    try {
      const freshScenes = await scenesApi.getAll();
      setAllScenes(freshScenes || []);
    } catch (err) {
      createToast("Scene switched, but refresh failed: " + err.message, "error");
    }

    setSceneId(nextId);
    setAnalysisText("");
    setSelectedFindingKey(null);
    setOpenSection("");
    setDoNotDoOpen(false);
    createToast("Scene loaded.", "info");
  }

  function flashTextarea() {
    setTextareaFlash(true);
    setTimeout(() => setTextareaFlash(false), 900);
  }

  function rememberCursor() {
    const ta = textareaRef.current;
    if (!ta) return;

    lastCursorRef.current = {
      start: ta.selectionStart,
      end: ta.selectionEnd
    };
  }

  function revealTextRange(start, end) {
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;

      ta.focus();
      ta.setSelectionRange(start, end);

      const NL = String.fromCharCode(10);
      const val = ta.value || "";
      const before = val.slice(0, start);
      const lineCountBefore = before.split(NL).length - 1;
      const totalLines = Math.max(1, val.split(NL).length);
      const approxLineHeight = ta.scrollHeight / totalLines;

      ta.scrollTop = Math.max(
        0,
        lineCountBefore * approxLineHeight - ta.clientHeight / 2
      );

      lastCursorRef.current = { start: end, end };
    });
  }

  // Insert at remembered cursor position. If no cursor was placed, append.
  function insertAtCursor(line) {
    if (draftLocked) return;

    const rememberedStart = lastCursorRef.current?.start;
    const rememberedEnd = lastCursorRef.current?.end;

    setText(currentText => {
      const NL = String.fromCharCode(10);
      const hasRememberedCursor =
        Number.isInteger(rememberedStart) &&
        Number.isInteger(rememberedEnd);

      const start = hasRememberedCursor
        ? Math.min(rememberedStart, currentText.length)
        : currentText.length;

      const end = hasRememberedCursor
        ? Math.min(rememberedEnd, currentText.length)
        : currentText.length;

      const before = currentText.slice(0, start);
      const after = currentText.slice(end);

      const sepBefore = before && !before.endsWith(NL) ? NL : "";
      const sepAfter = after && !after.startsWith(NL) ? NL : "";

      const insertedStart = before.length + sepBefore.length;
      const insertedEnd = insertedStart + line.length;
      const nextText = before + sepBefore + line + sepAfter + after;

      requestAnimationFrame(() => revealTextRange(insertedStart, insertedEnd));
      return nextText;
    });

    flashTextarea();
  }

  // Scroll textarea to sentence and select it
  function locateSentence(item) {
    const ta = textareaRef.current;
    if (!ta || !item?.sentenceText) return;
    const val = ta.value;
    const idx = val.indexOf(item.sentenceText);
    if (idx === -1) return;
    ta.focus();
    ta.setSelectionRange(idx, idx + item.sentenceText.length);
    // Approximate scroll: position sentence roughly centered in textarea
    const pct = idx / (val.length || 1);
    ta.scrollTop = Math.max(0, pct * ta.scrollHeight - ta.clientHeight / 3);
  }

  // Replace the problem sentence with a suggested fix
  function replaceSentence(item, replacement) {
    if (!item.sentenceText || !replacement) return;
    setText(t => t.replace(item.sentenceText, replacement));
    setSelectedFindingKey(null);
    flashTextarea();
    createToast("Replaced.", "success");
  }

  // Insert a suggested fix after the problem sentence
  function insertAfterSentence(item, toInsert) {
    if (!item.sentenceText || !toInsert) return;
    setText(t => {
      const idx = t.indexOf(item.sentenceText);
      if (idx === -1) return t + "\n" + toInsert;
      const end = idx + item.sentenceText.length;
      return t.slice(0, end) + "\n" + toInsert + t.slice(end);
    });
    setSelectedFindingKey(null);
    flashTextarea();
  }

  function toggleSection(key) {
    setOpenSection(o => o === key ? "" : key);
  }

  // ── Loading / empty states ────────────────────────────────────────────────

  if (loading) return <div style={{ padding: 40, color: "var(--text-3)" }}>Loading…</div>;

  if (!sceneId || !scene) {
    return (
      <div className="v0-shell">
        <div className="v0-empty">
          <h2 style={{ fontWeight: 400, fontSize: 22, color: "var(--text-2)" }}>No scene selected</h2>
          <p style={{ color: "var(--text-3)", fontSize: 14 }}>Select a scene from the library to begin writing.</p>
          {onBackToLibrary && <button onClick={onBackToLibrary} style={{ marginTop: 12 }}>← Scene Library</button>}
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

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
          <button onClick={() => setDraftLocked(v => !v)}>{draftLocked ? "Unlock" : "Lock"}</button>
          <button onClick={handleSnapshot}>Snapshot</button>
          <button onClick={handleSaveAnalysis}>Save Analysis</button>
          <button onClick={handleExport}>Export TXT</button>
          <button onClick={handleClear} disabled={draftLocked}>Clear</button>
        </div>
      </header>

      <div className="v0-grid">

        {/* ── LEFT SIDEBAR ── */}
        <aside key={scene.id} className="v0-card">
          <p className="v0-label">Scene</p>
          <select value={scene.id} onChange={handleSceneSwitch}>
            {allScenes.map(s => (
              <option key={s.id} value={s.id}>{s.number ? `${s.number}. ` : ""}{s.title} [{s.status}]</option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 6, margin: "8px 0", flexWrap: "wrap" }}>
            <span className="v0-tag">{scene.system}</span>
            <span className="v0-tag">{scene.status}</span>
          </div>
          {scene.function && <p className="v0-scene-fn">{scene.function}</p>}

          {/* 1. NON-NEGOTIABLE — always visible, not collapsible */}
          <div className="v0-nn-block">
            <p className="v0-nn-label">Non-Negotiable</p>
            <p className="v0-nn-text">{scene.rule || "No rule set."}</p>
          </div>

          {/* 2. SOURCE ANCHOR — collapsed by default */}
          <Section label="SOURCE ANCHOR" open={openSection === "anchor"} onToggle={() => toggleSection("anchor")}>
            {sourceAnchor
              ? <p className="v0-source-anchor">{sourceAnchor}</p>
              : sourceMaterials.length > 0
                ? <div className="v0-source-list">
                    {sourceMaterials.map(sm => (
                      <div key={sm.id} className="v0-source-item">
                        <p className="v0-source-item-title">{sm.title || "Untitled"}</p>
                        {sm.content && <p className="v0-source-item-body">{sm.content}</p>}
                      </div>
                    ))}
                  </div>
                : <p className="v0-hint">No source anchor set — add in Scene Library.</p>
            }
          </Section>

          {/* 3. DON'T FORGET */}
          <Section label="DON'T FORGET" open={openSection === "dontforget"} onToggle={() => toggleSection("dontforget")}>
            {dontForget
              ? <p className="v0-dont-forget">{dontForget}</p>
              : <p className="v0-hint">No reminders set.</p>
            }
          </Section>

          {/* 4. NEXT MOVE */}
          <Section label="NEXT MOVE" open={openSection === "nextmove"} onToggle={() => toggleSection("nextmove")}>
            <p className={`v0-next-move${isDone ? " done" : ""}`}>
              {directive.replace(/^(DONE|NEXT):\s*/, "")}
            </p>
          </Section>

          {/* 5. I'M STUCK — subcategory rescue bank */}
          <Section label="I'M STUCK" open={openSection === "stuck"} onToggle={() => toggleSection("stuck")}>
            <StuckPanel
              key={scene.id}
              scene={scene}
              stuckBank={stuckBank}
              locked={draftLocked}
              onInsert={insertAtCursor}
              currentWordCount={wc(text)}
            />
          </Section>

          {/* 6. DO NOT DO THIS — auto-opens on violations */}
          <Section
            label="DO NOT DO THIS"
            open={doNotDoOpen}
            onToggle={() => setDoNotDoOpen(v => !v)}
            flagged={abstractF.length > 0 && doNotDoThis.length > 0}
          >
            {doNotDoThis.length === 0
              ? <p className="v0-hint">No scene warnings set — add in Scene Library.</p>
              : <ul className="v0-donotdo-list">
                  {doNotDoThis.map((rule, i) => <li key={i}>{rule}</li>)}
                </ul>
            }
          </Section>
        </aside>

        {/* ── EDITOR ── */}
        <section className="v0-editor-card">
          <div className="v0-editor-header">
            <div>
              <p className="v0-kicker">Forward-only draft</p>
              <h2 className="v0-scene-title">{scene.title}</h2>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span className={`v0-badge ${draftLocked ? "locked" : "writing"}`}>{draftLocked ? "Locked" : "Writing"}</span>
              <span className="v0-badge">{savedLabel}</span>
              <span className="v0-badge">{sentenceCount} sent.</span>
              <span className="v0-badge">{wc(text)} words</span>
            </div>
          </div>
          <textarea
            ref={textareaRef}
            className={`v0-textarea${textareaFlash ? " flash" : ""}`}
            value={text}
            disabled={draftLocked}
            onChange={e => {
              setText(e.target.value);
              requestAnimationFrame(rememberCursor);
            }}
            onClick={rememberCursor}
            onKeyUp={rememberCursor}
            onSelect={rememberCursor}
            onFocus={rememberCursor}
            placeholder="Write the next physical sentence. Do not reread. Do not explain."
          />
          <div className={`v0-directive ${isDone ? "done" : ""}`}>
            <strong>{isDone ? "Done:" : "Next:"}</strong>{" "}{directive.replace(/^(DONE|NEXT):\s*/, "")}
          </div>
          <div className="v0-done-row">
            <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowDoneCheck(v => !v)}>
              {showDoneCheck ? "Hide scene check" : "Check if scene is done"}
            </button>
            {doneCheck && (
              <span className={`v0-verdict ${doneCheck.verdict === "DONE ENOUGH — MOVE ON" ? "v-done" : doneCheck.verdict === "LIKELY DONE FOR NOW" ? "v-likely" : "v-keep"}`}>
                {doneCheck.verdict}
              </span>
            )}
          </div>
          {doneCheck && (
            <div className="v0-checks">
              {doneCheck.checks.map(c => (
                <div key={c.id || c.label} className={`v0-check ${c.pass ? "pass" : "fail"}`}>
                  <span className="v0-check-icon">{c.pass ? "✓" : "✗"}</span>
                  <div><strong>{c.label}</strong><small>{c.detail}</small>{!c.pass && <em>{c.fix}</em>}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── RIGHT PANEL: LIVE CORRECTION ── */}
        <aside className="v0-card v0-correction">
          <h2 className="v0-correction-h">Live Correction</h2>
          {findings.length === 0
            ? <p className="v0-clean">Clean. Keep moving.</p>
            : <>
                {abstractF.length > 0 && (
                  <FindingGroup
                    label="Fix what breaks the rule"
                    items={abstractF.slice(0, 6)}
                    soft={false}
                    locked={draftLocked}
                    prefix="abs"
                    selectedKey={selectedFindingKey}
                    onSelect={setSelectedFindingKey}
                    onLocate={locateSentence}
                    onReplace={replaceSentence}
                    onInsertAfter={insertAfterSentence}
                  />
                )}
                {bodyF.length > 0 && (
                  <FindingGroup
                    label="Body check"
                    items={bodyF.slice(0, 4)}
                    soft
                    locked={draftLocked}
                    prefix="body"
                    selectedKey={selectedFindingKey}
                    onSelect={setSelectedFindingKey}
                    onLocate={locateSentence}
                    onReplace={replaceSentence}
                    onInsertAfter={insertAfterSentence}
                  />
                )}
              </>
          }
        </aside>
      </div>
    </div>
  );
}

// ── Section toggle ────────────────────────────────────────────────────────────

function Section({ label, open, onToggle, children, flagged }) {
  return (
    <div className={`v0-section${flagged ? " flagged" : ""}`}>
      <button className="v0-section-toggle" onClick={onToggle}>
        <span>{label}</span>
        {flagged && !open && <span className="v0-section-flag">●</span>}
        <span style={{ fontSize: 9, opacity: .6, marginLeft: "auto" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="v0-section-body">{children}</div>}
    </div>
  );
}

// ── StuckPanel — scene-specific subcategory rescue bank ───────────────────────

const STUCK_CATS = [
  { key: "use_a_line",         label: "Use a line" },
  { key: "start_a_sentence",   label: "Start a sentence" },
  { key: "move_the_body",      label: "Move the body" },
  { key: "change_the_pressure", label: "Change the pressure" },
  { key: "end_the_beat",       label: "End the beat" },
];

function StuckPanel({ scene, stuckBank, locked, onInsert, currentWordCount }) {
  const [openCat, setOpenCat]   = useState("use_a_line");
  const [usedOpts, setUsedOpts] = useState(new Set());

  // Auto-open most relevant subcategory when scene loads, based on current word count
  useEffect(() => {
    let cat = "use_a_line";
    if (currentWordCount > 300) cat = "move_the_body";
    if (currentWordCount > 500) cat = "end_the_beat";
    setOpenCat(cat);
    setUsedOpts(new Set());
  }, [scene?.id]); // intentionally only on scene change

  function handleInsert(opt) {
    onInsert(opt);
    setUsedOpts(s => new Set([...s, opt]));
  }

  if (!stuckBank) return <p className="v0-hint">No stuck bank — add options in Scene Library.</p>;

  return (
    <div className="v0-stuck-bank">
      {STUCK_CATS.map(({ key, label }) => {
        const all  = stuckBank[key] || [];
        // Unused options first; used options pushed to bottom
        const opts = [...all].sort((a, b) => (usedOpts.has(a) ? 1 : 0) - (usedOpts.has(b) ? 1 : 0));
        const isOpen = openCat === key;

        return (
          <div key={key} className="v0-stuck-cat">
            <button
              className="v0-stuck-cat-toggle"
              onClick={() => setOpenCat(k => k === key ? null : key)}
            >
              <span>{label}</span>
              {all.length > 0 && <span className="v0-stuck-count">{all.length}</span>}
              <span className="v0-stuck-chevron">{isOpen ? "▲" : "▼"}</span>
            </button>
            {isOpen && (
              <div className="v0-opts">
                {opts.length === 0
                  ? <p className="v0-hint" style={{ paddingLeft: 4 }}>No options — add in Scene Library.</p>
                  : opts.map(opt => (
                    <button
                      key={opt}
                      className={`v0-opt${usedOpts.has(opt) ? " v0-opt-used" : ""}`}
                      disabled={locked}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleInsert(opt);
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        handleInsert(opt);
                      }}
                      title={usedOpts.has(opt) ? "Already used this session" : undefined}
                    >
                      {opt}
                    </button>
                  ))
                }
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Live correction components ────────────────────────────────────────────────

function FindingGroup({ label, items, soft, locked, prefix, selectedKey, onSelect, onLocate, onReplace, onInsertAfter }) {
  return (
    <div className="v0-finding-group">
      <h3>{label}</h3>
      {items.map((item, i) => {
        const key = `${prefix}-${i}`;
        return (
          <FindingCard
            key={i}
            item={item}
            soft={soft}
            locked={locked}
            active={selectedKey === key}
            onLocate={() => { onSelect(key); onLocate(item); }}
            onToggleFixes={() => onSelect(selectedKey === key ? null : key)}
            onReplace={opt => onReplace(item, opt)}
            onInsertAfter={opt => onInsertAfter(item, opt)}
          />
        );
      })}
    </div>
  );
}

function FindingCard({ item, soft, locked, active, onLocate, onToggleFixes, onReplace, onInsertAfter }) {
  const alts = (item.alternatives || []).filter(Boolean);
  return (
    <div className={`v0-finding${soft ? " soft" : ""}${active ? " active" : ""}`}>

      {/* Snippet first — clicking locates + selects in editor */}
      {item.sentenceText && (
        <button className="v0-finding-snippet" onClick={onLocate} title="Click to locate in editor">
          "{item.sentenceText}"
        </button>
      )}

      {/* Secondary metadata */}
      <div className="v0-finding-meta">
        {item.sentenceNumber != null && (
          <span className="v0-finding-num">#{item.sentenceNumber}</span>
        )}
        {item.type === "abstraction" && item.word && (
          <span className="v0-finding-word">· "{item.word}"</span>
        )}
      </div>

      <p className="v0-finding-reason">{item.reason}</p>
      <small className="v0-finding-fix">{item.fix}</small>

      {alts.length > 0 && (
        <button className="v0-finding-expand" onClick={onToggleFixes}>
          {active ? "▲ hide fixes" : "▼ try one"}
        </button>
      )}

      {active && alts.length > 0 && (
        <div className="v0-alts">
          {alts.map(opt => (
            <div key={opt} className="v0-alt-row">
              <button
                className="v0-alt-btn"
                disabled={locked}
                onClick={() => onReplace(opt)}
                title="Replace problem sentence"
              >
                {opt}
              </button>
              <button
                className="v0-alt-after"
                disabled={locked}
                onClick={() => onInsertAfter(opt)}
                title="Insert after problem sentence"
              >
                +↓
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
