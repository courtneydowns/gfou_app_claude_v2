"use strict";
const { ipcMain } = require("electron");
const { getDb }   = require("../db/database.cjs");
const { randomUUID } = require("crypto");

function parseItem(row) {
  if (!row) return null;
  return { ...row, tags: safeJSON(row.tags, []) };
}

function safeJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function register() {
  ipcMain.handle("sourceMaterial:getAll", () => {
    return getDb()
      .prepare("SELECT * FROM source_material ORDER BY scope ASC, updated_at DESC")
      .all()
      .map(parseItem);
  });

  ipcMain.handle("sourceMaterial:getForScene", (_e, sceneId) => {
    return getDb()
      .prepare("SELECT * FROM source_material WHERE scene_id=? OR scope='global' ORDER BY scope ASC, updated_at DESC")
      .all(sceneId)
      .map(parseItem);
  });

  ipcMain.handle("sourceMaterial:upsert", (_e, raw) => {
    const db  = getDb();
    const id  = raw.id || randomUUID();
    const tags = JSON.stringify(Array.isArray(raw.tags) ? raw.tags : []);
    const scope   = raw.scene_id ? "scene" : "global";
    const existing = db.prepare("SELECT id FROM source_material WHERE id=?").get(id);

    if (existing) {
      db.prepare(`
        UPDATE source_material
        SET title=?, content=?, tags=?, scene_id=?, scope=?, updated_at=datetime('now')
        WHERE id=?
      `).run(
        String(raw.title || ""),
        String(raw.content || ""),
        tags,
        raw.scene_id || null,
        scope,
        id
      );
    } else {
      db.prepare(`
        INSERT INTO source_material (id, title, content, tags, scene_id, scope)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, String(raw.title || ""), String(raw.content || ""), tags, raw.scene_id || null, scope);
    }

    return parseItem(db.prepare("SELECT * FROM source_material WHERE id=?").get(id));
  });

  ipcMain.handle("sourceMaterial:delete", (_e, id) => {
    getDb().prepare("DELETE FROM source_material WHERE id=?").run(id);
    return { ok: true };
  });
}

module.exports = { register };
