"use strict";
const { ipcMain } = require("electron");
const { getDb } = require("../db/database.cjs");
const { randomUUID } = require("crypto");

const VALID_STATUSES = ["Draft", "Canon", "Archived", "Practice"];
const VALID_SYSTEMS  = ["Mask", "Fuel", "Break", "Exception", "Shattering", "Unassigned"];

// Normalize a stuck_bank value from raw input.
// Priority: raw.stuck_bank (new) → migrate raw.stuck_options into use_a_line (legacy) → empty.
function normalizeStuckBank(raw) {
  const empty = { use_a_line: [], start_a_sentence: [], move_the_body: [], change_the_pressure: [], end_the_beat: [] };

  let bank = empty;

  if (raw.stuck_bank && typeof raw.stuck_bank === "object" && !Array.isArray(raw.stuck_bank)) {
    // New format already present — merge over defaults so all keys exist
    bank = {
      use_a_line:          Array.isArray(raw.stuck_bank.use_a_line)          ? raw.stuck_bank.use_a_line          : [],
      start_a_sentence:    Array.isArray(raw.stuck_bank.start_a_sentence)    ? raw.stuck_bank.start_a_sentence    : [],
      move_the_body:       Array.isArray(raw.stuck_bank.move_the_body)       ? raw.stuck_bank.move_the_body       : [],
      change_the_pressure: Array.isArray(raw.stuck_bank.change_the_pressure) ? raw.stuck_bank.change_the_pressure : [],
      end_the_beat:        Array.isArray(raw.stuck_bank.end_the_beat)        ? raw.stuck_bank.end_the_beat        : [],
    };
  } else if (Array.isArray(raw.stuck_options) && raw.stuck_options.length > 0) {
    // Legacy migration: move old flat options into use_a_line
    bank = { ...empty, use_a_line: raw.stuck_options };
  }

  return bank;
}

function normalizeScene(raw) {
  return {
    id:               raw.id || randomUUID(),
    number:           Number(raw.number || 0),
    title:            String(raw.title || "Untitled Scene"),
    system:           VALID_SYSTEMS.includes(raw.system)   ? raw.system  : "Unassigned",
    status:           VALID_STATUSES.includes(raw.status)  ? raw.status  : "Draft",
    type:             raw.type === "practice" ? "practice" : "manuscript",
    function:         String(raw.function || ""),
    start_here:       JSON.stringify(Array.isArray(raw.start_here)        ? raw.start_here        : []),
    rule:             String(raw.rule || ""),
    // Legacy fields — kept for backward compat
    stuck_directive:  String(raw.stuck_directive || ""),
    stuck_options:    JSON.stringify(Array.isArray(raw.stuck_options)      ? raw.stuck_options      : []),
    success_looks_like: JSON.stringify(Array.isArray(raw.success_looks_like) ? raw.success_looks_like : []),
    notes:            String(raw.notes || ""),
    // New guidance fields
    dont_forget:      String(raw.dont_forget || ""),
    source_anchor:    String(raw.source_anchor || ""),
    do_not_do_this:   JSON.stringify(Array.isArray(raw.do_not_do_this) ? raw.do_not_do_this : []),
    stuck_bank:       JSON.stringify(normalizeStuckBank(raw)),
  };
}

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// Parse a DB row back into a JS object with all fields properly typed.
function parseScene(row) {
  if (!row) return null;

  // Parse stuck_bank and ensure all five keys exist
  const rawBank = safeParseJSON(row.stuck_bank, {});
  const stuckBank = {
    use_a_line:          Array.isArray(rawBank.use_a_line)          ? rawBank.use_a_line          : [],
    start_a_sentence:    Array.isArray(rawBank.start_a_sentence)    ? rawBank.start_a_sentence    : [],
    move_the_body:       Array.isArray(rawBank.move_the_body)       ? rawBank.move_the_body       : [],
    change_the_pressure: Array.isArray(rawBank.change_the_pressure) ? rawBank.change_the_pressure : [],
    end_the_beat:        Array.isArray(rawBank.end_the_beat)        ? rawBank.end_the_beat        : [],
  };

  return {
    ...row,
    number:             Number(row.number),
    // Legacy parsed fields
    start_here:         safeParseJSON(row.start_here, []),
    stuck_options:      safeParseJSON(row.stuck_options, []),
    success_looks_like: safeParseJSON(row.success_looks_like, []),
    stuck_directive:    String(row.stuck_directive || ""),
    // New parsed fields
    dont_forget:        String(row.dont_forget || ""),
    source_anchor:      String(row.source_anchor || ""),
    do_not_do_this:     safeParseJSON(row.do_not_do_this, []),
    stuck_bank:         stuckBank,
  };
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
          function=?, start_here=?, rule=?,
          stuck_directive=?, stuck_options=?, success_looks_like=?, notes=?,
          dont_forget=?, source_anchor=?, do_not_do_this=?, stuck_bank=?,
          updated_at=datetime('now')
        WHERE id=?
      `).run(
        scene.number, scene.title, scene.system, scene.status, scene.type,
        scene.function, scene.start_here, scene.rule,
        scene.stuck_directive, scene.stuck_options, scene.success_looks_like, scene.notes,
        scene.dont_forget, scene.source_anchor, scene.do_not_do_this, scene.stuck_bank,
        scene.id
      );
    } else {
      db.prepare(`
        INSERT INTO scenes
          (id, number, title, system, status, type, function, start_here, rule,
           stuck_directive, stuck_options, success_looks_like, notes,
           dont_forget, source_anchor, do_not_do_this, stuck_bank)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        scene.id, scene.number, scene.title, scene.system, scene.status,
        scene.type, scene.function, scene.start_here, scene.rule,
        scene.stuck_directive, scene.stuck_options, scene.success_looks_like, scene.notes,
        scene.dont_forget, scene.source_anchor, scene.do_not_do_this, scene.stuck_bank
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
        (id, number, title, system, status, type, function, start_here, rule,
         stuck_directive, stuck_options, success_looks_like, notes,
         dont_forget, source_anchor, do_not_do_this, stuck_bank)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const importAll = db.transaction((list) => {
      for (const raw of list) {
        const s = normalizeScene(raw);
        insert.run(
          s.id, s.number, s.title, s.system, s.status,
          s.type, s.function, s.start_here, s.rule,
          s.stuck_directive, s.stuck_options, s.success_looks_like, s.notes,
          s.dont_forget, s.source_anchor, s.do_not_do_this, s.stuck_bank
        );
      }
    });
    importAll(rawScenes);
    return { ok: true, count: rawScenes.length };
  });
}

module.exports = { register };
