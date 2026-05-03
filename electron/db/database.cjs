"use strict";
const path = require("path");
const fs   = require("fs");
const Database = require("better-sqlite3");

let _db  = null;
let _app = null;

function getDataDir(app) {
  const base = (app || _app).getPath("userData");
  const dir  = path.join(base, "gfou_data");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "backups", "daily"),      { recursive: true });
  fs.mkdirSync(path.join(dir, "exports", "manuscript"), { recursive: true });
  fs.mkdirSync(path.join(dir, "exports", "scenes"),     { recursive: true });
  return dir;
}

function getDbPath(app) {
  return path.join(getDataDir(app || _app), "gfou.sqlite");
}

function applyPragmas(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
}

function initDatabase(app) {
  if (_db && _db.open) return _db;
  _app = app;
  const dbPath = getDbPath(app);
  _db = new Database(dbPath);
  applyPragmas(_db);
  runMigrations(_db);
  console.log("[DB] Opened:", dbPath);
  return _db;
}

function getDb() {
  if (!_db || !_db.open) throw new Error("Database not initialized or closed.");
  return _db;
}

function closeDatabase() {
  if (_db) {
    try { if (_db.open) _db.close(); } catch (err) { console.error("[DB] Close error:", err.message); }
    _db = null;
    console.log("[DB] Closed and reset.");
  }
}

function resetDatabase() { _db = null; }

function reopenDatabase(app) {
  if (!app && !_app) throw new Error("No app reference available.");
  _app = app || _app;
  _db  = null;
  return initDatabase(_app);
}

function verifyDatabase() {
  try {
    const row = getDb().prepare("SELECT COUNT(*) AS count FROM migrations").get();
    return { ok: true, migrations: row.count };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  const applied = new Set(db.prepare("SELECT name FROM migrations").all().map(r => r.name));
  const migrations = [
    { name: "001_core_schema",       sql: MIGRATION_001 },
    { name: "002_analysis_tables",   sql: MIGRATION_002 },
    { name: "003_session_and_queue", sql: MIGRATION_003 },
  ];
  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    db.transaction(() => { db.exec(m.sql); db.prepare("INSERT INTO migrations (name) VALUES (?)").run(m.name); })();
    console.log("[DB] Applied migration:", m.name);
  }
}

const MIGRATION_001 = `
  CREATE TABLE IF NOT EXISTS scenes (id TEXT PRIMARY KEY, number INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL DEFAULT 'Untitled Scene', system TEXT NOT NULL DEFAULT 'Unassigned', status TEXT NOT NULL DEFAULT 'Draft', type TEXT NOT NULL DEFAULT 'manuscript', function TEXT NOT NULL DEFAULT '', start_here TEXT NOT NULL DEFAULT '[]', rule TEXT NOT NULL DEFAULT '', stuck_directive TEXT NOT NULL DEFAULT '', stuck_options TEXT NOT NULL DEFAULT '[]', success_looks_like TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS drafts (scene_id TEXT PRIMARY KEY, content TEXT NOT NULL DEFAULT '', word_count INTEGER NOT NULL DEFAULT 0, saved_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS source_material (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', scene_id TEXT, scope TEXT NOT NULL DEFAULT 'global', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '', rule_text TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT 'global', scene_id TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS continuity_ledger (id TEXT PRIMARY KEY, scene_id TEXT NOT NULL, entry_type TEXT NOT NULL DEFAULT 'fact', content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, scene_id TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '', word_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS exports_metadata (id TEXT PRIMARY KEY, export_type TEXT NOT NULL DEFAULT 'manual', filename TEXT NOT NULL DEFAULT '', path TEXT NOT NULL DEFAULT '', scene_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`;
const MIGRATION_002 = `CREATE TABLE IF NOT EXISTS analysis_results (id TEXT PRIMARY KEY, scene_id TEXT NOT NULL, check_type TEXT NOT NULL, passed INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, verdict TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '{}', word_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE);`;
const MIGRATION_003 = `
  CREATE TABLE IF NOT EXISTS v0_sessions (id TEXT PRIMARY KEY, scene_id TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT, words_written INTEGER NOT NULL DEFAULT 0, findings_count INTEGER NOT NULL DEFAULT 0, FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS revision_queue (id TEXT PRIMARY KEY, scene_id TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT 'normal', resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE);
`;

module.exports = { initDatabase, getDb, getDataDir, getDbPath, closeDatabase, resetDatabase, reopenDatabase, verifyDatabase };
