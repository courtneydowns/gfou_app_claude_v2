"use strict";
const { ipcMain } = require("electron");
const { getDb } = require("../db/database.cjs");
const { randomUUID } = require("crypto");

function register() {
  // ── Analysis Results ─────────────────────────────────────────
  ipcMain.handle("analysis:saveResult", (_e, result) => {
    const db = getDb();
    db.prepare(`
      INSERT INTO analysis_results (id, scene_id, check_type, passed, total, verdict, details, word_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      result.scene_id,
      result.check_type || "full",
      Number(result.passed || 0),
      Number(result.total || 0),
      String(result.verdict || ""),
      JSON.stringify(result.details || {}),
      Number(result.word_count || 0)
    );
    return { ok: true };
  });

  ipcMain.handle("analysis:getForScene", (_e, sceneId) => {
    const rows = getDb()
      .prepare("SELECT * FROM analysis_results WHERE scene_id=? ORDER BY created_at DESC LIMIT 20")
      .all(sceneId);
    return rows.map((r) => ({ ...r, details: safeParseJSON(r.details, {}) }));
  });

  ipcMain.handle("analysis:getAll", () => {
    const rows = getDb()
      .prepare("SELECT * FROM analysis_results ORDER BY created_at DESC LIMIT 100")
      .all();
    return rows.map((r) => ({ ...r, details: safeParseJSON(r.details, {}) }));
  });

  // ── Continuity Ledger ────────────────────────────────────────
  ipcMain.handle("continuity:getAll", () => {
    return getDb().prepare("SELECT * FROM continuity_ledger ORDER BY created_at ASC").all();
  });

  ipcMain.handle("continuity:addEntry", (_e, entry) => {
    const db = getDb();
    db.prepare(`
      INSERT INTO continuity_ledger (id, scene_id, entry_type, content)
      VALUES (?, ?, ?, ?)
    `).run(randomUUID(), entry.scene_id, String(entry.entry_type || "fact"), String(entry.content || ""));
    return { ok: true };
  });

  ipcMain.handle("continuity:deleteEntry", (_e, id) => {
    getDb().prepare("DELETE FROM continuity_ledger WHERE id=?").run(id);
    return { ok: true };
  });

  // ── V0 Sessions ─────────────────────────────────────────────
  ipcMain.handle("sessions:start", (_e, sceneId) => {
    const id = randomUUID();
    getDb().prepare(`
      INSERT INTO v0_sessions (id, scene_id) VALUES (?, ?)
    `).run(id, sceneId);
    return { ok: true, session_id: id };
  });

  ipcMain.handle("sessions:end", (_e, sessionId, wordsWritten, findingsCount) => {
    getDb().prepare(`
      UPDATE v0_sessions SET ended_at=datetime('now'), words_written=?, findings_count=?
      WHERE id=?
    `).run(Number(wordsWritten || 0), Number(findingsCount || 0), sessionId);
    return { ok: true };
  });

  ipcMain.handle("sessions:getForScene", (_e, sceneId) => {
    return getDb()
      .prepare("SELECT * FROM v0_sessions WHERE scene_id=? ORDER BY started_at DESC LIMIT 20")
      .all(sceneId);
  });

  // ── Revision Queue ───────────────────────────────────────────
  ipcMain.handle("revisionQueue:getAll", () => {
    return getDb()
      .prepare("SELECT rq.*, s.title as scene_title FROM revision_queue rq LEFT JOIN scenes s ON s.id=rq.scene_id WHERE rq.resolved=0 ORDER BY rq.created_at ASC")
      .all();
  });

  ipcMain.handle("revisionQueue:add", (_e, item) => {
    getDb().prepare(`
      INSERT INTO revision_queue (id, scene_id, note, priority)
      VALUES (?, ?, ?, ?)
    `).run(randomUUID(), item.scene_id, String(item.note || ""), String(item.priority || "normal"));
    return { ok: true };
  });

  ipcMain.handle("revisionQueue:resolve", (_e, id) => {
    getDb().prepare("UPDATE revision_queue SET resolved=1 WHERE id=?").run(id);
    return { ok: true };
  });
}

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = { register };
