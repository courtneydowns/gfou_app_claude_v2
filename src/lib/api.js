/**
 * src/lib/api.js
 * Thin wrapper around window.electronAPI.
 * All renderer data operations go through here — never directly to SQLite.
 * localStorage used ONLY for UI preferences (activeTab, darkMode, collapsedPanels).
 */

function e() {
  if (typeof window === "undefined" || !window.electronAPI) {
    throw new Error(
      "electronAPI not available. Run with: npm run electron\n" +
      "Do NOT use npm run dev alone — this app requires Electron for all data access."
    );
  }
  return window.electronAPI;
}

export const scenes = {
  getAll:      ()      => e().scenes.getAll(),
  getById:     (id)    => e().scenes.getById(id),
  upsert:      (scene) => e().scenes.upsert(scene),
  archive:     (id)    => e().scenes.archive(id),
  delete:      (id)    => e().scenes.delete(id),
  importBatch: (list)  => e().scenes.importBatch(list),
};

export const drafts = {
  get:          (id)       => e().drafts.get(id),
  save:         (id, text) => e().drafts.save(id, text),
  clear:        (id)       => e().drafts.clear(id),
  getAll:       ()         => e().drafts.getAll(),
  snapshot:     (id, lbl)  => e().drafts.snapshot(id, lbl),
  getSnapshots: (id)       => e().drafts.getSnapshots(id),
};

export const backups = {
  createManual: ()   => e().backups.createManual(),
  list:         ()   => e().backups.list(),
  restore:      (fn) => e().backups.restore(fn),
  getPaths:     ()   => e().backups.getPaths(),
};

export const exports_ = {
  panicExport: ()   => e().exports.panicExport(),
  exportScene: (id) => e().exports.exportScene(id),
  listExports: ()   => e().exports.listExports(),
};

export const analysis = {
  saveResult:  (r)  => e().analysis.saveResult(r),
  getForScene: (id) => e().analysis.getForScene(id),
  getAll:      ()   => e().analysis.getAll(),
};

export const sourceMaterial = {
  getAll:      ()        => e().sourceMaterial.getAll(),
  getForScene: (sceneId) => e().sourceMaterial.getForScene(sceneId),
  upsert:      (item)    => e().sourceMaterial.upsert(item),
  delete:      (id)      => e().sourceMaterial.delete(id),
};

export const rules = {
  getAll:      ()        => e().rules.getAll(),
  getForScene: (sceneId) => e().rules.getForScene(sceneId),
  upsert:      (r)       => e().rules.upsert(r),
  delete:      (id)      => e().rules.delete(id),
};

export const continuity = {
  getAll:      ()      => e().continuity.getAll(),
  addEntry:    (entry) => e().continuity.addEntry(entry),
  deleteEntry: (id)    => e().continuity.deleteEntry(id),
};

export const sessions = {
  start:       (sceneId)              => e().sessions.start(sceneId),
  end:         (sid, words, findings) => e().sessions.end(sid, words, findings),
  getForScene: (sceneId)              => e().sessions.getForScene(sceneId),
};

export const revisionQueue = {
  getAll:  ()     => e().revisionQueue.getAll(),
  add:     (item) => e().revisionQueue.add(item),
  resolve: (id)   => e().revisionQueue.resolve(id),
};

export const appApi = {
  getDataPath:    () => e().app.getDataPath(),
  openDataFolder: () => e().app.openDataFolder(),
};

// ── UI preferences — localStorage ONLY ────────────────────────
// Manuscript data NEVER goes in localStorage.
export const prefs = {
  get: (key, fallback = null) => {
    try {
      const v = localStorage.getItem(`gfou:pref:${key}`);
      return v !== null ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set: (key, value) => {
    try { localStorage.setItem(`gfou:pref:${key}`, JSON.stringify(value)); }
    catch { /* noop */ }
  },
};
