"use strict";
const { ipcMain } = require("electron");
const { getDb } = require("../db/database.cjs");
const { randomUUID } = require("crypto");

const VALID_STATUSES = ["Draft", "Canon", "Archived", "Practice"];
const VALID_SYSTEMS = ["Mask", "Fuel", "Break", "Exception", "Shattering", "Unassigned"];

function normalizeScene(raw) {
  return {
    id: raw.id || randomUUID(),
    number: Number(raw.number || 0),
    title: String(raw.title || "Untitled Scene"),
    system: VALID_SYSTEMS.includes(raw.system) ? raw.system : "Unassigned",
    status: VALID_STATUSES.includes(raw.status) ? raw.status : "Draft",
    type: raw.type === "practice" ? "practice" : "manuscript",
    function: String(raw.function || ""),
    start_here: JSON.stringify(Array.isArray(raw.start_here) ? raw.start_here : []),
    rule: String(raw.rule || ""),
    stuck_directive: String(raw.stuck_directive || ""),
    stuck_options: JSON.stringify(Array.isArray(raw.stuck_options) ? raw.stuck_options : []),
    success_looks_like: JSON.stringify(Array.isArray(raw.success_looks_like) ? raw.success_looks_like : []),
    notes: String(raw.notes || ""),
  };
}

function parseScene(row) {
  if (!row) return null;
  return {
    ...row,
    number: Number(row.number),
    start_here: safeParseJSON(row.start_here, []),
    stuck_options: safeParseJSON(row.stuck_options, []),
    success_looks_like: safeParseJSON(row.success_looks_like, []),
  };
}

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function register() {
  ipcMain.handle("scenes:getAll", () => {
    const rows = getDb().prepare("SELECT * FROM scenes ORDER BY number ASC, title ASC").all();
    return rows.map(parseScene);
  });

  ipcMain.handle("scenes:getById", (_e, id) => {
    const row = getDb().prepare("SELECT * FROM scenes WHERE id = ?").get(id);
    return parseScene(row);
  });

  ipcMain.handle("scenes:upsert", (_e, raw) => {
    const scene = normalizeScene(raw);
    const db = getDb();
    const existing = db.prepare("SELECT id FROM scenes WHERE id = ?").get(scene.id);
    if (existing) {
      db.prepare(`
        UPDATE scenes SET
          number=?, title=?, system=?, status=?, type=?,
          function=?, start_here=?, rule=?, stuck_directive=?,
          stuck_options=?, success_looks_like=?, notes=?,
          updated_at=datetime('now')
        WHERE id=?
      `).run(
        scene.number, scene.title, scene.system, scene.status, scene.type,
        scene.function, scene.start_here, scene.rule, scene.stuck_directive,
        scene.stuck_options, scene.success_looks_like, scene.notes,
        scene.id
      );
    } else {
      db.prepare(`
        INSERT INTO scenes
          (id,number,title,system,status,type,function,start_here,rule,
           stuck_directive,stuck_options,success_looks_like,notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        scene.id, scene.number, scene.title, scene.system, scene.status,
        scene.type, scene.function, scene.start_here, scene.rule,
        scene.stuck_directive, scene.stuck_options, scene.success_looks_like,
        scene.notes
      );
    }
    return parseScene(db.prepare("SELECT * FROM scenes WHERE id = ?").get(scene.id));
  });

  ipcMain.handle("scenes:archive", (_e, id) => {
    getDb().prepare("UPDATE scenes SET status='Archived', updated_at=datetime('now') WHERE id=?").run(id);
    return { ok: true };
  });

  ipcMain.handle("scenes:delete", (_e, id) => {
    getDb().prepare("DELETE FROM scenes WHERE id=?").run(id);
    return { ok: true };
  });

  ipcMain.handle("scenes:importBatch", (_e, rawScenes) => {
    const db = getDb();
    const insert = db.prepare(`
      INSERT OR REPLACE INTO scenes
        (id,number,title,system,status,type,function,start_here,rule,
         stuck_directive,stuck_options,success_looks_like,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const importAll = db.transaction((list) => {
      for (const raw of list) {
        const s = normalizeScene(raw);
        insert.run(s.id, s.number, s.title, s.system, s.status, s.type,
          s.function, s.start_here, s.rule, s.stuck_directive,
          s.stuck_options, s.success_looks_like, s.notes);
      }
    });
    importAll(rawScenes);
    return { ok: true, count: rawScenes.length };
  });
}

module.exports = { register };
