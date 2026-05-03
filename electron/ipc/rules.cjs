"use strict";
const { ipcMain } = require("electron");
const { getDb }   = require("../db/database.cjs");
const { randomUUID } = require("crypto");

function register() {
  ipcMain.handle("rules:getAll", () => {
    return getDb()
      .prepare("SELECT * FROM rules WHERE active=1 ORDER BY scope ASC, created_at ASC")
      .all();
  });

  ipcMain.handle("rules:getForScene", (_e, sceneId) => {
    return getDb()
      .prepare("SELECT * FROM rules WHERE active=1 AND (scope='global' OR scene_id=?) ORDER BY scope ASC")
      .all(sceneId);
  });

  ipcMain.handle("rules:upsert", (_e, raw) => {
    const db = getDb();
    const id = raw.id || randomUUID();
    const existing = db.prepare("SELECT id FROM rules WHERE id=?").get(id);
    if (existing) {
      db.prepare("UPDATE rules SET label=?, rule_text=?, scope=?, scene_id=?, active=? WHERE id=?")
        .run(String(raw.label || ""), String(raw.rule_text || ""), String(raw.scope || "global"), raw.scene_id || null, raw.active !== false ? 1 : 0, id);
    } else {
      db.prepare("INSERT INTO rules (id, label, rule_text, scope, scene_id) VALUES (?,?,?,?,?)")
        .run(id, String(raw.label || ""), String(raw.rule_text || ""), String(raw.scope || "global"), raw.scene_id || null);
    }
    return { ok: true, id };
  });

  ipcMain.handle("rules:delete", (_e, id) => {
    getDb().prepare("UPDATE rules SET active=0 WHERE id=?").run(id);
    return { ok: true };
  });
}

module.exports = { register };
