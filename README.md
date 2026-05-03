# Good for One Use (GFOU) — v2.0

Two-mode manuscript execution system. SQLite-first. Electron desktop app.

---

## Quick Start

```bash
# 1. Install dependencies (also rebuilds better-sqlite3 for Electron)
npm install

# 2. Run as Electron app (required — IPC bridge needs Electron)
npm run electron
```

> **Do not use `npm run dev` alone.** The app requires Electron for all data operations.  
> `npm run dev` starts Vite only — API calls will throw immediately.

---

## Commands

| Command | Purpose |
|---|---|
| `npm install` | Install + rebuild native SQLite module |
| `npm run electron` | Start app (Vite + Electron, dev mode) |
| `npm run build` | Build React for production |
| `npm run electron:build` | Package distributable app |

---

## Architecture

### Data: SQLite only

All critical data lives in SQLite at:
- **macOS:** `~/Library/Application Support/gfou/gfou_data/gfou.sqlite`
- **Windows:** `%APPDATA%\gfou\gfou_data\gfou.sqlite`
- **Linux:** `~/.config/gfou/gfou_data/gfou.sqlite`

**localStorage is used only for UI preferences** (active tab, collapsed panels). Never for data.

### SQLite Tables

| Table | Contents |
|---|---|
| `scenes` | Scene cards — metadata, rules, start lines |
| `drafts` | Scene drafts, keyed by scene_id |
| `source_material` | Reference material |
| `rules` | Global and per-scene rules |
| `v0_sessions` | Writing session records |
| `continuity_ledger` | Cross-scene continuity facts |
| `analysis_results` | Saved analysis runs |
| `revision_queue` | Notes flagged for revision |
| `snapshots` | Named draft copies |
| `exports_metadata` | Export history |
| `migrations` | Applied schema migrations |

### IPC Bridge

Renderer → `src/lib/api.js` → `window.electronAPI` → `electron/preload.cjs` → `ipcMain.handle` → SQLite

The renderer **never** talks to SQLite directly. All data flows through IPC.

### File Structure

```
electron/
  main.cjs              — Electron entry, IPC registration, window
  preload.cjs           — contextBridge (exposes electronAPI)
  db/
    database.cjs        — SQLite init, schema, WAL mode, migrations
  ipc/
    scenes.cjs          — scene CRUD
    drafts.cjs          — draft save/load, snapshots
    backups.cjs         — daily + manual backup, restore
    exports.cjs         — panic export (JSON + MD + TXT)
    analysis.cjs        — analysis results, continuity, sessions, revision queue

src/
  App.jsx               — root with nav (Library / V0 / Analysis / Backups)
  lib/
    api.js              — thin wrapper around window.electronAPI
  scenes/
    SceneLibrary.jsx    — scene grid, filters, editor modal
  v0writing/
    V0WritingPanel.jsx  — 3-column writing mode
    ruleEngine.js       — abstraction/body-drift detector
    sceneDoneChecker.js — 5-check completion evaluator
  analysis/
    AnalysisMode.jsx    — full analysis view
    analysisEngines.js  — abstraction, body, rhythm, completion, continuity checks
  backup/
    BackupPanel.jsx     — backup list, manual backup, restore, panic export
  components/
    ToastHost.jsx       — toast notifications
    toast.js            — createToast() event emitter
```

---

## Modes

### V0 Writing Mode
- Forward-only drafting
- Live correction: abstraction detection, body-drift, compression
- Scene guidance: START HERE, NON-NEGOTIABLE RULE, I'M STUCK, WHAT SUCCESS LOOKS LIKE
- Draft autosaves to SQLite every 700ms
- Session tracking (words written, findings count)
- Snapshot: save a named copy of the current draft at any moment
- Scene done check: 5-point deterministic evaluation

### Analysis Mode
- Select any scene (after writing a draft)
- Run all checks: abstraction, body, rhythm, completion, continuity
- All deterministic — no API calls, no network
- Results save to `analysis_results` table
- History: see previous analysis runs per scene
- Revision queue: flag anything for later
- Continuity ledger: cross-scene fact tracking

### Scene Library
- Create, edit, archive, delete scenes
- Filter by status, system, free text
- Sort by number, updated, title, status
- Import / export as JSON
- Panic Export: full state → JSON + Markdown + TXT

### Backups
- Automatic daily SQLite backup on app launch (kept 30 days)
- Manual backup at any time
- Restore from any backup (current state safeguarded before restore)
- Full export history
- Panic Export: all scenes + drafts + source material + rules + continuity → export folder

---

## Backup Locations

```
gfou_data/
  gfou.sqlite                    ← primary database
  backups/
    daily/
      gfou-YYYY-MM-DD.sqlite     ← auto daily backups
      gfou-manual-TIMESTAMP.sqlite
      gfou-pre-restore-TIMESTAMP.sqlite
  exports/
    PANIC_EXPORT_TIMESTAMP/
      full_state.json
      manuscript.md
      manuscript.txt
      scenes/
        001-scene-title.txt
      source_material.json
      continuity_ledger.json
      rules.json
      revision_queue.json
    scenes/
      individual scene exports
```

---

## No Hardcoded Scenes

The app ships with no manuscript scenes. On first launch you get a blank library. Add your own scenes via the Scene Library, or import a JSON file.

---

## Phase Roadmap

| Phase | Status | Contents |
|---|---|---|
| Phase 1 | ✅ This build | Electron + SQLite + V0 Writing + Analysis + Backups |
| Phase 2 | Planned | Additional deterministic checkers, register check, voice lock |
| Phase 3 | Planned | Claude API (Haiku/Sonnet/Opus) as optional power layer |
| Phase 4 | Optional | Cloud sync (Supabase / Turso) — backup only, not primary |
