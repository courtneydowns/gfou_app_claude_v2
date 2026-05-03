"use strict";
const { ipcMain, app } = require("electron");
const path = require("path");
const fs   = require("fs");
const { getDb, getDataDir, getDbPath, closeDatabase, reopenDatabase, verifyDatabase } = require("../db/database.cjs");

function getBackupDir() { return path.join(getDataDir(app), "backups", "daily"); }
function todayStr()     { return new Date().toISOString().slice(0, 10); }
function tsStr()        { return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); }

function pruneOldBackups(dir, keepDays) {
  try {
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".sqlite"))) {
      const full = path.join(dir, f);
      if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); console.log("[Backup] Pruned:", f); }
    }
  } catch { /* non-fatal */ }
}

function runDailyBackup() {
  try {
    const dir  = getBackupDir();
    const dest = path.join(dir, `gfou-${todayStr()}.sqlite`);
    if (!fs.existsSync(dest)) { getDb().backup(dest); console.log("[Backup] Daily backup:", dest); }
    pruneOldBackups(dir, 30);
  } catch (err) { console.error("[Backup] Daily backup failed:", err.message); }
}

function register() {
  ipcMain.handle("backups:createManual", async () => {
    try {
      const filename = `gfou-manual-${tsStr()}.sqlite`;
      const dest = path.join(getBackupDir(), filename);
      await getDb().backup(dest);
      return { ok: true, filename, path: dest };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("backups:list", () => {
    try {
      const dir = getBackupDir();
      const files = fs.readdirSync(dir)
        .filter(f => f.endsWith(".sqlite"))
        .map(f => { const full = path.join(dir, f); const stat = fs.statSync(full); return { filename: f, path: full, size: stat.size, mtime: stat.mtime.toISOString() }; })
        .sort((a, b) => b.mtime.localeCompare(a.mtime));
      return { ok: true, backups: files };
    } catch (err) { return { ok: false, error: err.message, backups: [] }; }
  });

  ipcMain.handle("backups:restore", async (_e, filename) => {
    const dir = getBackupDir();
    const src = path.join(dir, filename);

    if (!fs.existsSync(src)) return { ok: false, error: "Backup file not found." };

    let safeguardName = null;
    try {
      // 1. Safeguard: back up current DB before restore
      safeguardName = `gfou-pre-restore-${tsStr()}.sqlite`;
      const safeguardPath = path.join(dir, safeguardName);
      await getDb().backup(safeguardPath);
      console.log("[Restore] Safeguard saved:", safeguardName);

      // 2. Close DB and reset cached reference
      closeDatabase(); // sets _db = null, closes file handle

      // 3. Copy selected backup over live database
      const dbPath = getDbPath(app);
      fs.copyFileSync(src, dbPath);
      console.log("[Restore] Copied backup to:", dbPath);

      // 4. Reopen cleanly (applies pragmas + skips already-applied migrations)
      reopenDatabase(app);
      console.log("[Restore] Reopened database.");

      // 5. Verify the DB is readable
      const check = verifyDatabase();
      if (!check.ok) throw new Error("DB verification failed after restore: " + check.error);

      return {
        ok: true,
        message: `Restored from "${filename}". Previous state saved as "${safeguardName}".`,
        migrations: check.migrations,
      };
    } catch (err) {
      console.error("[Restore] Failed:", err.message);
      // Attempt to reopen whatever was there
      try { reopenDatabase(app); } catch { /* last resort */ }
      return { ok: false, error: err.message, safeguard: safeguardName };
    }
  });

  ipcMain.handle("backups:getPaths", () => ({
    dataDir:   getDataDir(app),
    backupDir: getBackupDir(),
    dbPath:    getDbPath(app),
  }));
}

module.exports = { register, runDailyBackup };
