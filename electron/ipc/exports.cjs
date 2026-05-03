"use strict";
const { ipcMain, app } = require("electron");
const path = require("path");
const fs   = require("fs");
const { getDb, getDataDir } = require("../db/database.cjs");
const { randomUUID } = require("crypto");

function safeJSON(str, fallback) { try { return JSON.parse(str); } catch { return fallback; } }
function wc(t) { return String(t||"").trim().split(/\s+/).filter(Boolean).length; }
function slug(s) { return String(s||"untitled").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,48); }

// Parse a raw scenes DB row into a fully hydrated object for export.
// Keeps all new guidance fields alongside legacy fields.
function parseSceneForExport(s) {
  const rawBank = safeJSON(s.stuck_bank, {});
  return {
    ...s,
    start_here:         safeJSON(s.start_here, []),
    stuck_options:      safeJSON(s.stuck_options, []),
    success_looks_like: safeJSON(s.success_looks_like, []),
    do_not_do_this:     safeJSON(s.do_not_do_this, []),
    stuck_bank: {
      use_a_line:          Array.isArray(rawBank.use_a_line)          ? rawBank.use_a_line          : [],
      start_a_sentence:    Array.isArray(rawBank.start_a_sentence)    ? rawBank.start_a_sentence    : [],
      move_the_body:       Array.isArray(rawBank.move_the_body)       ? rawBank.move_the_body       : [],
      change_the_pressure: Array.isArray(rawBank.change_the_pressure) ? rawBank.change_the_pressure : [],
      end_the_beat:        Array.isArray(rawBank.end_the_beat)        ? rawBank.end_the_beat        : [],
    },
    dont_forget:   String(s.dont_forget   || ""),
    source_anchor: String(s.source_anchor || ""),
  };
}

function gather(db) {
  const scenes = db.prepare("SELECT * FROM scenes ORDER BY number ASC").all().map(parseSceneForExport);
  const drafts       = Object.fromEntries(db.prepare("SELECT * FROM drafts").all().map(d => [d.scene_id, d.content]));
  const sourceMat    = db.prepare("SELECT * FROM source_material ORDER BY created_at ASC").all().map(m => ({...m, tags: safeJSON(m.tags,[])}));
  const rules        = db.prepare("SELECT * FROM rules WHERE active=1 ORDER BY created_at ASC").all();
  const ledger       = db.prepare("SELECT * FROM continuity_ledger ORDER BY created_at ASC").all();
  const analysisRes  = db.prepare("SELECT * FROM analysis_results ORDER BY created_at DESC").all();
  const revisionQ    = db.prepare("SELECT * FROM revision_queue WHERE resolved=0 ORDER BY created_at ASC").all();
  const snapshots    = db.prepare("SELECT * FROM snapshots ORDER BY created_at DESC").all();
  return { scenes, drafts, sourceMat, rules, ledger, analysisRes, revisionQ, snapshots };
}

function buildMd(scenes, drafts) {
  const lines = ["# Good for One Use — Full Export\n", `Exported: ${new Date().toISOString()}\n`];
  for (const s of scenes) {
    lines.push(`\n---\n\n## Scene ${s.number||"?"}: ${s.title}\n`);
    lines.push(`**System:** ${s.system}  \n**Status:** ${s.status}\n`);
    if (s.function) lines.push(`\n**Function:** ${s.function}\n`);
    if (s.rule)     lines.push(`\n**Rule:** ${s.rule}\n`);
    lines.push(`\n### Draft\n\n${drafts[s.id]||"_(no draft yet)_"}\n`);
  }
  return lines.join("\n");
}

function buildTxt(scenes, drafts) {
  const lines = ["GOOD FOR ONE USE — MANUSCRIPT EXPORT", new Date().toISOString(), "",""];
  for (const s of scenes) {
    lines.push("=".repeat(60));
    lines.push(`Scene ${s.number||"?"}: ${s.title.toUpperCase()}`);
    lines.push(`System: ${s.system} | Status: ${s.status}`);
    lines.push("=".repeat(60),"");
    lines.push(drafts[s.id]||"(no draft yet)","","");
  }
  return lines.join("\n");
}

function writeFile(p, content) { fs.writeFileSync(p, content, "utf8"); }

function register() {
  ipcMain.handle("exports:panicExport", async () => {
    try {
      const db = getDb();
      const data = gather(db);
      const ts = new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
      const exportDir = path.join(app.getPath("documents"), "gfou_exports");
      const panicDir  = path.join(exportDir, `PANIC_EXPORT_${ts}`);
      const scenesDir = path.join(panicDir, "scenes");
      fs.mkdirSync(scenesDir, { recursive: true });

      writeFile(path.join(panicDir, "full_state.json"),
        JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2));

      writeFile(path.join(panicDir, "manuscript.md"),  buildMd(data.scenes, data.drafts));
      writeFile(path.join(panicDir, "manuscript.txt"), buildTxt(data.scenes, data.drafts));

      for (const s of data.scenes) {
        const fn = `${String(s.number||0).padStart(3,"0")}-${slug(s.title)}.txt`;
        writeFile(path.join(scenesDir, fn), [
          `Scene ${s.number}: ${s.title}`,
          `System: ${s.system} | Status: ${s.status}`,
          `Function: ${s.function||"—"}`,
          `Rule: ${s.rule||"—"}`,
          "", "--- DRAFT ---", "",
          data.drafts[s.id] || "(no draft yet)",
        ].join("\n"));
      }

      writeFile(path.join(panicDir, "source_material.json"),
        JSON.stringify(data.sourceMat.length ? data.sourceMat : [], null, 2));
      writeFile(path.join(panicDir, "continuity_ledger.json"),
        JSON.stringify(data.ledger.length ? data.ledger : [], null, 2));
      writeFile(path.join(panicDir, "rules.json"),
        JSON.stringify(data.rules.length ? data.rules : [], null, 2));
      writeFile(path.join(panicDir, "revision_queue.json"),
        JSON.stringify(data.revisionQ.length ? data.revisionQ : [], null, 2));

      db.prepare("INSERT INTO exports_metadata (id,export_type,filename,path,scene_count) VALUES (?,?,?,?,?)")
        .run(randomUUID(), "panic", `PANIC_EXPORT_${ts}`, panicDir, data.scenes.length);

      return { ok: true, path: panicDir, sceneCount: data.scenes.length,
        files: ["full_state.json","manuscript.md","manuscript.txt","source_material.json","continuity_ledger.json","rules.json","revision_queue.json",`scenes/ (${data.scenes.length} files)`] };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("exports:exportScene", async (_e, sceneId) => {
    try {
      const db = getDb();
      const scene = db.prepare("SELECT * FROM scenes WHERE id=?").get(sceneId);
      if (!scene) return { ok: false, error: "Scene not found" };
      const draft = db.prepare("SELECT content FROM drafts WHERE scene_id=?").get(sceneId);
      const fn    = `${String(scene.number||0).padStart(3,"0")}-${slug(scene.title)}-${new Date().toISOString().slice(0,10)}.txt`;
      const destDir = path.join(app.getPath("documents"), "gfou_exports", "scenes");
      fs.mkdirSync(destDir, { recursive: true });
      const dest = path.join(destDir, fn);
      writeFile(dest, [`Scene ${scene.number}: ${scene.title}`,`System: ${scene.system} | Status: ${scene.status}`,`Function: ${scene.function||"—"}`,`Rule: ${scene.rule||"—"}`,"","--- DRAFT ---","", draft?.content||"(no draft yet)"].join("\n"));
      return { ok: true, path: dest, filename: fn };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("exports:listExports", () => {
    try {
      return { ok: true, exports: getDb().prepare("SELECT * FROM exports_metadata ORDER BY created_at DESC LIMIT 50").all() };
    } catch (err) { return { ok: false, error: err.message, exports: [] }; }
  });
}

module.exports = { register };
