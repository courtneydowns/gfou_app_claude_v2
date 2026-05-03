"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");

const DB_PATH = path.join(
  process.env.HOME,
  "Library/Application Support/gfou/gfou_data/gfou.sqlite"
);

const AUTOSAVE_PATH =
  "/Users/courtneydowns/Desktop/cgpt_gfou_app/Good for One Use - App Outputs/outputs/backups/json/gfou_autosave_2026-05-01T23-22-14-331Z.json";

const KNOWLEDGE_FILES = [
  {
    title: "GFOU Continuity Ledger",
    path: "/Users/courtneydowns/Desktop/GFOU/APP/knowledge/manuscript/continuity_ledger.txt",
    tags: ["continuity", "ledger", "manuscript", "source-of-truth"],
    alsoRule: false,
  },
  {
    title: "GFOU Craft Rules",
    path: "/Users/courtneydowns/Desktop/GFOU/APP/knowledge/rules/craft_rules.txt",
    tags: ["rules", "craft", "voice", "source-of-truth"],
    alsoRule: true,
  },
  {
    title: "GFOU Session Anchor Priority Rules",
    path: "/Users/courtneydowns/Desktop/GFOU/APP/knowledge/rules/session_anchor_priority_rules.txt",
    tags: ["rules", "session", "anchor", "priority"],
    alsoRule: true,
  },
  {
    title: "GFOU Manuscript Source",
    path: "/Users/courtneydowns/Desktop/GFOU/APP/knowledge/source/manuscript.txt",
    tags: ["manuscript", "source", "full-text"],
    alsoRule: false,
  },
  {
    title: "GFOU Protection Rules Quick Reference",
    path: "/Users/courtneydowns/Desktop/GFOU/APP/knowledge/writing/protection_rules_quick_reference.txt",
    tags: ["rules", "protection", "quick-reference"],
    alsoRule: true,
  },
  {
    title: "GFOU Scene Master Narrative",
    path: "/Users/courtneydowns/Desktop/cgpt_gfou_app/src/gfou-system/knowledge/GFOU_scene_master_NARRATIVE.md",
    tags: ["scene-master", "narrative", "source-of-truth"],
    alsoRule: false,
  },
  {
    title: "GFOU Scene Master Wave Order",
    path: "/Users/courtneydowns/Desktop/cgpt_gfou_app/src/gfou-system/knowledge/GFOU_scene_master_WAVE_ORDER.md",
    tags: ["scene-master", "wave-order", "source-of-truth"],
    alsoRule: false,
  },
  {
    title: "GFOU Rules File",
    path: "/Users/courtneydowns/Desktop/cgpt_gfou_app/src/gfou-system/knowledge/RULES_FILE.md",
    tags: ["rules", "source-of-truth"],
    alsoRule: true,
  },
  {
    title: "GFOU Structure Bible",
    path: "/Users/courtneydowns/Desktop/cgpt_gfou_app/knowledge/source_of_truth/gfou_structure_bible.md",
    tags: ["structure", "bible", "source-of-truth"],
    alsoRule: false,
  },
  {
    title: "GFOU Timeline Map",
    path: "/Users/courtneydowns/Desktop/cgpt_gfou_app/knowledge/source_of_truth/gfou_timeline_map.md",
    tags: ["timeline", "map", "source-of-truth"],
    alsoRule: false,
  },
  {
    title: "GFOU Voice Bible",
    path: "/Users/courtneydowns/Desktop/cgpt_gfou_app/knowledge/source_of_truth/gfou_voice_bible.md",
    tags: ["voice", "bible", "source-of-truth"],
    alsoRule: true,
  },
];

function safeJson(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function pickText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeSystem(scene) {
  const raw = String(scene.system || scene.arcSystem || scene.mode || "").toLowerCase();
  if (raw.includes("mask")) return "Mask";
  if (raw.includes("fuel")) return "Fuel";
  if (raw.includes("break")) return "Break";
  if (raw.includes("exception")) return "Exception";
  if (raw.includes("shatter")) return "Shattering";

  const label = String(scene.label || scene.title || "").toLowerCase();
  if (label.includes("caretaker")) return "Exception";
  if (label.includes("shattering")) return "Shattering";
  return "Unassigned";
}

function normalizeScene(oldScene, number) {
  const id = String(oldScene.sceneId || oldScene.id || oldScene.sourceId || `imported-${number}`);
  const title = pickText(oldScene.label, oldScene.title, oldScene.name) || id;

  const startHereCandidates = [
    oldScene.startHere,
    oldScene.start_here,
    oldScene.startLines,
    oldScene.entryPrompts,
    oldScene.openingPrompts,
  ];

  let start_here = [];
  for (const c of startHereCandidates) {
    const parsed = safeJson(c, c);
    if (Array.isArray(parsed)) {
      start_here = parsed.map(String).filter(Boolean);
      break;
    }
  }

  const stuckOptionsCandidates = [
    oldScene.stuckOptions,
    oldScene.stuck_options,
    oldScene.bodyOptions,
    oldScene.nextMoves,
  ];

  let stuck_options = [];
  for (const c of stuckOptionsCandidates) {
    const parsed = safeJson(c, c);
    if (Array.isArray(parsed)) {
      stuck_options = parsed.map(String).filter(Boolean);
      break;
    }
  }

  const successCandidates = [
    oldScene.successLooksLike,
    oldScene.success_looks_like,
    oldScene.successCriteria,
    oldScene.doneWhen,
  ];

  let success_looks_like = [];
  for (const c of successCandidates) {
    const parsed = safeJson(c, c);
    if (Array.isArray(parsed)) {
      success_looks_like = parsed.map(String).filter(Boolean);
      break;
    }
  }

  const rule = pickText(
    oldScene.rule,
    oldScene.nonNegotiableRule,
    oldScene.non_negotiable_rule,
    oldScene.hardRule,
    oldScene.constraint
  );

  const stuck_directive = pickText(
    oldScene.stuckDirective,
    oldScene.stuck_directive,
    oldScene.forwardDirective,
    oldScene.directive
  );

  const notesParts = [];
  for (const key of [
    "summary",
    "notes",
    "arcFunction",
    "function",
    "sourceId",
    "chapter",
    "beat",
    "pressure",
  ]) {
    if (oldScene[key]) notesParts.push(`${key}: ${String(oldScene[key])}`);
  }

  return {
    id,
    number,
    title,
    system: normalizeSystem(oldScene),
    status: "Draft",
    type: "manuscript",
    function: pickText(oldScene.arcFunction, oldScene.function, oldScene.sceneFunction, oldScene.summary),
    start_here: JSON.stringify(start_here),
    rule,
    stuck_directive,
    stuck_options: JSON.stringify(stuck_options),
    success_looks_like: JSON.stringify(success_looks_like),
    notes: notesParts.join("\n"),
  };
}

function extractDraft(oldScene) {
  return pickText(
    oldScene.draft,
    oldScene.text,
    oldScene.content,
    oldScene.currentDraft,
    oldScene.manuscriptText,
    oldScene.body,
    oldScene.v0Draft
  );
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function requireFile(p) {
  if (!fs.existsSync(p)) throw new Error(`Missing required file: ${p}`);
}

function main() {
  requireFile(DB_PATH);
  requireFile(AUTOSAVE_PATH);

  const backupPath = `${DB_PATH}.pre_gfou_import_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(DB_PATH, backupPath);

  const autosave = JSON.parse(fs.readFileSync(AUTOSAVE_PATH, "utf8"));
  const scenesObj = autosave.scenes || {};
  const sceneEntries = Object.entries(scenesObj);

  if (!sceneEntries.length) {
    throw new Error("No scenes found in autosave.");
  }

  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  const upsertScene = db.prepare(`
    INSERT INTO scenes
      (id, number, title, system, status, type, function, start_here, rule,
       stuck_directive, stuck_options, success_looks_like, notes)
    VALUES
      (@id, @number, @title, @system, @status, @type, @function, @start_here, @rule,
       @stuck_directive, @stuck_options, @success_looks_like, @notes)
    ON CONFLICT(id) DO UPDATE SET
      number=excluded.number,
      title=excluded.title,
      system=excluded.system,
      status=excluded.status,
      type=excluded.type,
      function=excluded.function,
      start_here=excluded.start_here,
      rule=excluded.rule,
      stuck_directive=excluded.stuck_directive,
      stuck_options=excluded.stuck_options,
      success_looks_like=excluded.success_looks_like,
      notes=excluded.notes,
      updated_at=datetime('now')
  `);

  const upsertDraft = db.prepare(`
    INSERT INTO drafts (scene_id, content, word_count)
    VALUES (?, ?, ?)
    ON CONFLICT(scene_id) DO UPDATE SET
      content=excluded.content,
      word_count=excluded.word_count,
      saved_at=datetime('now')
  `);

  const upsertSource = db.prepare(`
    INSERT INTO source_material (id, title, content, tags, scene_id, scope)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,
      content=excluded.content,
      tags=excluded.tags,
      scene_id=excluded.scene_id,
      scope=excluded.scope,
      updated_at=datetime('now')
  `);

  const upsertRule = db.prepare(`
    INSERT INTO rules (id, label, rule_text, scope, scene_id, active)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      label=excluded.label,
      rule_text=excluded.rule_text,
      scope=excluded.scope,
      scene_id=excluded.scene_id,
      active=1
  `);

  const tx = db.transaction(() => {
    let number = 1;

    for (const [key, oldScene] of sceneEntries) {
      const scene = normalizeScene({ ...oldScene, sceneId: oldScene.sceneId || key }, number++);
      upsertScene.run(scene);

      const draft = extractDraft(oldScene);
      if (draft) {
        upsertDraft.run(scene.id, draft, wordCount(draft));
      }
    }

    for (const item of KNOWLEDGE_FILES) {
      if (!fs.existsSync(item.path)) {
        console.warn("[skip missing]", item.path);
        continue;
      }

      const content = fs.readFileSync(item.path, "utf8");
      const id = `knowledge:${item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;

      upsertSource.run(
        id,
        item.title,
        content,
        JSON.stringify(item.tags),
        null,
        "global"
      );

      if (item.alsoRule) {
        upsertRule.run(
          `rule:${item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`,
          item.title,
          content,
          "global",
          null
        );
      }
    }

    const chapterBlueprint = autosave.chapterBlueprint
      ? JSON.stringify(autosave.chapterBlueprint, null, 2)
      : "";

    if (chapterBlueprint) {
      upsertSource.run(
        "knowledge:chapter-blueprint-from-autosave",
        "GFOU Chapter Blueprint from Latest Autosave",
        chapterBlueprint,
        JSON.stringify(["chapter-blueprint", "autosave", "structure"]),
        null,
        "global"
      );
    }

    const sourceOfTruth = autosave.sourceOfTruth
      ? JSON.stringify(autosave.sourceOfTruth, null, 2)
      : "";

    if (sourceOfTruth) {
      upsertSource.run(
        "knowledge:source-of-truth-from-autosave",
        "GFOU Source of Truth from Latest Autosave",
        sourceOfTruth,
        JSON.stringify(["source-of-truth", "autosave"]),
        null,
        "global"
      );
    }

    const oldContinuityLedger = autosave.continuityLedger
      ? JSON.stringify(autosave.continuityLedger, null, 2)
      : "";

    if (oldContinuityLedger) {
      upsertSource.run(
        "knowledge:continuity-ledger-from-autosave",
        "GFOU Continuity Ledger from Latest Autosave",
        oldContinuityLedger,
        JSON.stringify(["continuity", "ledger", "autosave"]),
        null,
        "global"
      );
    }
  });

  tx();

  const counts = {
    scenes: db.prepare("SELECT COUNT(*) AS n FROM scenes").get().n,
    drafts: db.prepare("SELECT COUNT(*) AS n FROM drafts").get().n,
    source_material: db.prepare("SELECT COUNT(*) AS n FROM source_material").get().n,
    rules: db.prepare("SELECT COUNT(*) AS n FROM rules WHERE active=1").get().n,
    continuity_ledger: db.prepare("SELECT COUNT(*) AS n FROM continuity_ledger").get().n,
    revision_queue: db.prepare("SELECT COUNT(*) AS n FROM revision_queue").get().n,
  };

  db.close();

  console.log("");
  console.log("GFOU knowledge import complete.");
  console.log("Backup created:");
  console.log(backupPath);
  console.log("");
  console.log("Counts:");
  for (const [k, v] of Object.entries(counts)) {
    console.log(`${k}: ${v}`);
  }
}

try {
  main();
} catch (err) {
  console.error("IMPORT FAILED:", err.message);
  process.exit(1);
}
