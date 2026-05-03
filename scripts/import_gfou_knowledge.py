#!/usr/bin/env python3
import os
import re
import json
import uuid
import shutil
import sqlite3
from datetime import datetime

DB_PATH = os.path.expanduser(
    "~/Library/Application Support/gfou/gfou_data/gfou.sqlite"
)

AUTOSAVE_PATH = (
    "/Users/courtneydowns/Desktop/cgpt_gfou_app/"
    "Good for One Use - App Outputs/outputs/backups/json/"
    "gfou_autosave_2026-05-01T23-22-14-331Z.json"
)

KNOWLEDGE_FILES = [
    {
        "title": "GFOU Continuity Ledger",
        "path": "/Users/courtneydowns/Desktop/GFOU/APP/knowledge/manuscript/continuity_ledger.txt",
        "tags": ["continuity", "ledger", "manuscript", "source-of-truth"],
        "also_rule": False,
    },
    {
        "title": "GFOU Craft Rules",
        "path": "/Users/courtneydowns/Desktop/GFOU/APP/knowledge/rules/craft_rules.txt",
        "tags": ["rules", "craft", "voice", "source-of-truth"],
        "also_rule": True,
    },
    {
        "title": "GFOU Session Anchor Priority Rules",
        "path": "/Users/courtneydowns/Desktop/GFOU/APP/knowledge/rules/session_anchor_priority_rules.txt",
        "tags": ["rules", "session", "anchor", "priority"],
        "also_rule": True,
    },
    {
        "title": "GFOU Manuscript Source",
        "path": "/Users/courtneydowns/Desktop/GFOU/APP/knowledge/source/manuscript.txt",
        "tags": ["manuscript", "source", "full-text"],
        "also_rule": False,
    },
    {
        "title": "GFOU Protection Rules Quick Reference",
        "path": "/Users/courtneydowns/Desktop/GFOU/APP/knowledge/writing/protection_rules_quick_reference.txt",
        "tags": ["rules", "protection", "quick-reference"],
        "also_rule": True,
    },
    {
        "title": "GFOU Scene Master Narrative",
        "path": "/Users/courtneydowns/Desktop/cgpt_gfou_app/src/gfou-system/knowledge/GFOU_scene_master_NARRATIVE.md",
        "tags": ["scene-master", "narrative", "source-of-truth"],
        "also_rule": False,
    },
    {
        "title": "GFOU Scene Master Wave Order",
        "path": "/Users/courtneydowns/Desktop/cgpt_gfou_app/src/gfou-system/knowledge/GFOU_scene_master_WAVE_ORDER.md",
        "tags": ["scene-master", "wave-order", "source-of-truth"],
        "also_rule": False,
    },
    {
        "title": "GFOU Rules File",
        "path": "/Users/courtneydowns/Desktop/cgpt_gfou_app/src/gfou-system/knowledge/RULES_FILE.md",
        "tags": ["rules", "source-of-truth"],
        "also_rule": True,
    },
    {
        "title": "GFOU Structure Bible",
        "path": "/Users/courtneydowns/Desktop/cgpt_gfou_app/knowledge/source_of_truth/gfou_structure_bible.md",
        "tags": ["structure", "bible", "source-of-truth"],
        "also_rule": False,
    },
    {
        "title": "GFOU Timeline Map",
        "path": "/Users/courtneydowns/Desktop/cgpt_gfou_app/knowledge/source_of_truth/gfou_timeline_map.md",
        "tags": ["timeline", "map", "source-of-truth"],
        "also_rule": False,
    },
    {
        "title": "GFOU Voice Bible",
        "path": "/Users/courtneydowns/Desktop/cgpt_gfou_app/knowledge/source_of_truth/gfou_voice_bible.md",
        "tags": ["voice", "bible", "source-of-truth"],
        "also_rule": True,
    },
]

def slug(text):
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")

def pick_text(*values):
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""

def normalize_system(scene):
    raw = str(scene.get("system") or scene.get("arcSystem") or scene.get("mode") or "").lower()
    label = str(scene.get("label") or scene.get("title") or "").lower()

    if "mask" in raw:
        return "Mask"
    if "fuel" in raw:
        return "Fuel"
    if "break" in raw:
        return "Break"
    if "exception" in raw:
        return "Exception"
    if "shatter" in raw:
        return "Shattering"
    if "caretaker" in label:
        return "Exception"
    if "shattering" in label:
        return "Shattering"
    return "Unassigned"

def array_from_scene(scene, keys):
    for key in keys:
        value = scene.get(key)
        if isinstance(value, list):
            return [str(x) for x in value if str(x).strip()]
        if isinstance(value, str) and value.strip().startswith("["):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return [str(x) for x in parsed if str(x).strip()]
            except Exception:
                pass
    return []

def normalize_scene(old_scene, key, number):
    scene_id = str(old_scene.get("sceneId") or old_scene.get("id") or old_scene.get("sourceId") or key)
    title = pick_text(old_scene.get("label"), old_scene.get("title"), old_scene.get("name")) or scene_id

    start_here = array_from_scene(old_scene, [
        "startHere", "start_here", "startLines", "entryPrompts", "openingPrompts"
    ])

    stuck_options = array_from_scene(old_scene, [
        "stuckOptions", "stuck_options", "bodyOptions", "nextMoves"
    ])

    success_looks_like = array_from_scene(old_scene, [
        "successLooksLike", "success_looks_like", "successCriteria", "doneWhen"
    ])

    rule = pick_text(
        old_scene.get("rule"),
        old_scene.get("nonNegotiableRule"),
        old_scene.get("non_negotiable_rule"),
        old_scene.get("hardRule"),
        old_scene.get("constraint"),
    )

    stuck_directive = pick_text(
        old_scene.get("stuckDirective"),
        old_scene.get("stuck_directive"),
        old_scene.get("forwardDirective"),
        old_scene.get("directive"),
    )

    notes_parts = []
    for k in ["summary", "notes", "arcFunction", "function", "sourceId", "chapter", "beat", "pressure"]:
        if old_scene.get(k):
            notes_parts.append(f"{k}: {old_scene.get(k)}")

    return {
        "id": scene_id,
        "number": number,
        "title": title,
        "system": normalize_system(old_scene),
        "status": "Draft",
        "type": "manuscript",
        "function": pick_text(
            old_scene.get("arcFunction"),
            old_scene.get("function"),
            old_scene.get("sceneFunction"),
            old_scene.get("summary"),
        ),
        "start_here": json.dumps(start_here),
        "rule": rule,
        "stuck_directive": stuck_directive,
        "stuck_options": json.dumps(stuck_options),
        "success_looks_like": json.dumps(success_looks_like),
        "notes": "\n".join(notes_parts),
    }

def extract_draft(old_scene):
    return pick_text(
        old_scene.get("draft"),
        old_scene.get("text"),
        old_scene.get("content"),
        old_scene.get("currentDraft"),
        old_scene.get("manuscriptText"),
        old_scene.get("body"),
        old_scene.get("v0Draft"),
    )

def word_count(text):
    return len([x for x in str(text or "").strip().split() if x])

def require_file(path):
    if not os.path.exists(path):
        raise FileNotFoundError(path)

def upsert_source(cur, item_id, title, content, tags, scene_id=None, scope="global"):
    cur.execute(
        """
        INSERT INTO source_material (id, title, content, tags, scene_id, scope)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title,
          content=excluded.content,
          tags=excluded.tags,
          scene_id=excluded.scene_id,
          scope=excluded.scope,
          updated_at=datetime('now')
        """,
        (item_id, title, content, json.dumps(tags), scene_id, scope),
    )

def upsert_rule(cur, rule_id, label, rule_text, scope="global", scene_id=None):
    cur.execute(
        """
        INSERT INTO rules (id, label, rule_text, scope, scene_id, active)
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET
          label=excluded.label,
          rule_text=excluded.rule_text,
          scope=excluded.scope,
          scene_id=excluded.scene_id,
          active=1
        """,
        (rule_id, label, rule_text, scope, scene_id),
    )

def main():
    require_file(DB_PATH)
    require_file(AUTOSAVE_PATH)

    backup_path = f"{DB_PATH}.pre_gfou_import_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    shutil.copy2(DB_PATH, backup_path)

    with open(AUTOSAVE_PATH, "r", encoding="utf-8") as f:
        autosave = json.load(f)

    scenes_obj = autosave.get("scenes") or {}
    if not scenes_obj:
        raise RuntimeError("No scenes found in autosave.")

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("PRAGMA foreign_keys = ON")

    number = 1
    draft_imports = 0

    for key, old_scene in scenes_obj.items():
        if not isinstance(old_scene, dict):
            continue

        scene = normalize_scene(old_scene, key, number)
        number += 1

        cur.execute(
            """
            INSERT INTO scenes
              (id, number, title, system, status, type, function, start_here, rule,
               stuck_directive, stuck_options, success_looks_like, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            """,
            (
                scene["id"],
                scene["number"],
                scene["title"],
                scene["system"],
                scene["status"],
                scene["type"],
                scene["function"],
                scene["start_here"],
                scene["rule"],
                scene["stuck_directive"],
                scene["stuck_options"],
                scene["success_looks_like"],
                scene["notes"],
            ),
        )

        draft = extract_draft(old_scene)
        if draft:
            draft_imports += 1
            cur.execute(
                """
                INSERT INTO drafts (scene_id, content, word_count)
                VALUES (?, ?, ?)
                ON CONFLICT(scene_id) DO UPDATE SET
                  content=excluded.content,
                  word_count=excluded.word_count,
                  saved_at=datetime('now')
                """,
                (scene["id"], draft, word_count(draft)),
            )

    for item in KNOWLEDGE_FILES:
        if not os.path.exists(item["path"]):
            print(f"[skip missing] {item['path']}")
            continue

        with open(item["path"], "r", encoding="utf-8") as f:
            content = f.read()

        item_id = "knowledge:" + slug(item["title"])
        upsert_source(cur, item_id, item["title"], content, item["tags"])

        if item["also_rule"]:
            upsert_rule(cur, "rule:" + slug(item["title"]), item["title"], content)

    if autosave.get("chapterBlueprint"):
        upsert_source(
            cur,
            "knowledge:chapter-blueprint-from-autosave",
            "GFOU Chapter Blueprint from Latest Autosave",
            json.dumps(autosave["chapterBlueprint"], indent=2),
            ["chapter-blueprint", "autosave", "structure"],
        )

    if autosave.get("sourceOfTruth"):
        upsert_source(
            cur,
            "knowledge:source-of-truth-from-autosave",
            "GFOU Source of Truth from Latest Autosave",
            json.dumps(autosave["sourceOfTruth"], indent=2),
            ["source-of-truth", "autosave"],
        )

    if autosave.get("continuityLedger"):
        upsert_source(
            cur,
            "knowledge:continuity-ledger-from-autosave",
            "GFOU Continuity Ledger from Latest Autosave",
            json.dumps(autosave["continuityLedger"], indent=2),
            ["continuity", "ledger", "autosave"],
        )

    conn.commit()

    counts = {}
    for name, sql in [
        ("scenes", "SELECT COUNT(*) FROM scenes"),
        ("drafts", "SELECT COUNT(*) FROM drafts"),
        ("source_material", "SELECT COUNT(*) FROM source_material"),
        ("rules_active", "SELECT COUNT(*) FROM rules WHERE active=1"),
        ("continuity_ledger", "SELECT COUNT(*) FROM continuity_ledger"),
        ("revision_queue", "SELECT COUNT(*) FROM revision_queue"),
    ]:
        cur.execute(sql)
        counts[name] = cur.fetchone()[0]

    conn.close()

    print("")
    print("GFOU Python import complete.")
    print("Backup created:")
    print(backup_path)
    print("")
    print(f"Autosave scenes found: {len(scenes_obj)}")
    print(f"Drafts imported from autosave: {draft_imports}")
    print("")
    print("Counts:")
    for k, v in counts.items():
        print(f"{k}: {v}")

if __name__ == "__main__":
    main()
