"use strict";
const { ipcMain } = require("electron");
const { getDb } = require("../db/database.cjs");

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function register() {
  ipcMain.handle("drafts:get", (_e, sceneId) => {
    const row = getDb().prepare("SELECT * FROM drafts WHERE scene_id = ?").get(sceneId);
    return row ? { ...row, word_count: Number(row.word_count) } : { scene_id: sceneId, content: "", word_count: 0 };
  });

  ipcMain.handle("drafts:save", (_e, sceneId, content) => {
    const wc = wordCount(content);
    const db = getDb();
    const existing = db.prepare("SELECT scene_id FROM drafts WHERE scene_id = ?").get(sceneId);
    if (existing) {
      db.prepare(`
        UPDATE drafts SET content=?, word_count=?, saved_at=datetime('now')
        WHERE scene_id=?
      `).run(content, wc, sceneId);
    } else {
      db.prepare(`
        INSERT INTO drafts (scene_id, content, word_count) VALUES (?, ?, ?)
      `).run(sceneId, content, wc);
    }
    return { ok: true, word_count: wc };
  });

  ipcMain.handle("drafts:clear", (_e, sceneId) => {
    getDb().prepare("DELETE FROM drafts WHERE scene_id = ?").run(sceneId);
    return { ok: true };
  });

  ipcMain.handle("drafts:getAll", () => {
    return getDb().prepare("SELECT * FROM drafts").all();
  });

  // Snapshot: save a named copy of current draft
  ipcMain.handle("drafts:snapshot", (_e, sceneId, label) => {
    const { randomUUID } = require("crypto");
    const db = getDb();
    const draft = db.prepare("SELECT content FROM drafts WHERE scene_id = ?").get(sceneId);
    if (!draft) return { ok: false, error: "No draft found" };
    const wc = wordCount(draft.content);
    db.prepare(`
      INSERT INTO snapshots (id, scene_id, content, label, word_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), sceneId, draft.content, label || new Date().toISOString(), wc);
    return { ok: true };
  });

  ipcMain.handle("drafts:getSnapshots", (_e, sceneId) => {
    return getDb()
      .prepare("SELECT * FROM snapshots WHERE scene_id = ? ORDER BY created_at DESC")
      .all(sceneId);
  });
}

module.exports = { register };
