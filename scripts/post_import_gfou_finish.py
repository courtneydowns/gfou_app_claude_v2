#!/usr/bin/env python3
import sqlite3, json, shutil, re
from pathlib import Path
from datetime import datetime

APP_DB = Path.home() / "Library/Application Support/gfou/gfou_data/gfou.sqlite"
LEDGER_PATH = Path("/Users/courtneydowns/Desktop/GFOU/APP/knowledge/manuscript/continuity_ledger.txt")

def now():
    return datetime.now().isoformat(timespec="seconds")

def table_exists(cur, table):
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
    return cur.fetchone() is not None

def cols(cur, table):
    cur.execute(f"PRAGMA table_info({table})")
    return [r[1] for r in cur.fetchall()]

def first_col(existing, candidates):
    for c in candidates:
        if c in existing:
            return c
    return None

def active_where(scene_cols):
    """
    Your DB errored because it has no `archived` column.
    This checks all likely archive/status columns and falls back to all scenes.
    """
    if "archived" in scene_cols:
        return "(COALESCE(archived, 0)=0 OR archived IS NULL)"
    if "is_archived" in scene_cols:
        return "(COALESCE(is_archived, 0)=0 OR is_archived IS NULL)"
    if "isArchived" in scene_cols:
        return "(COALESCE(isArchived, 0)=0 OR isArchived IS NULL)"
    if "status" in scene_cols:
        return "(status IS NULL OR LOWER(status) NOT IN ('archived','hidden','smoke-test','smoke_test'))"
    return "1=1"

def split_options(value):
    if not value:
        return []
    s = str(value).strip()
    if not s:
        return []
    try:
        obj = json.loads(s)
        if isinstance(obj, list):
            return [str(x).strip() for x in obj if str(x).strip()]
    except Exception:
        pass
    return [x.strip(" -•\t") for x in re.split(r"\n|;", s) if x.strip(" -•\t")]

def fallback_stuck_options(scene):
    title = scene.get("title") or scene.get("name") or "this scene"
    source_id = scene.get("source_id") or scene.get("sourceId") or scene.get("id") or ""
    notes = scene.get("notes") or ""
    start = scene.get("start_here") or scene.get("startHere") or ""
    rule = scene.get("rule") or scene.get("non_negotiable_rule") or ""
    blob = " ".join([str(title), str(source_id), str(notes), str(start), str(rule)]).lower()

    if "caretaker" in blob:
        return [
            "Return to the caretaker’s body: hands, breath, mouth, weight.",
            "Use one concrete motion before any meaning.",
            "Let the room stay physical: floor, light, sound, distance.",
            "Do not explain what the caretaker means. Show what the body does."
        ]

    if "ballet" in blob:
        return [
            "Return to posture: feet, knees, spine, shoulders, chin.",
            "Make correction visible through the body.",
            "Use repetition, pressure, balance, or breath.",
            "Do not name the feeling. Show the body holding it."
        ]

    if "childhood" in blob or "conditional" in blob:
        return [
            "Return to a small physical adjustment.",
            "Show compliance through hands, posture, stillness, or breath.",
            "Let the room apply pressure without explaining it.",
            "Do not interpret the wound. Keep it in the body."
        ]

    if "prologue" in blob or "body track" in blob:
        return [
            "Stay with the body before identity.",
            "Use throat, jaw, spine, shoulder, breath, fingers, floor.",
            "Make one physical change only.",
            "Do not explain where she is or what it means yet."
        ]

    return [
        "Choose one body part and make it move, stop, tighten, or fail.",
        "Use pressure, breath, weight, contact, distance, or sound.",
        "Remove explanation and replace it with a visible action.",
        "Keep the sentence scene-specific and physical."
    ]

def parse_ledger_text(text):
    rows = []
    current_header = "Imported Continuity Ledger"

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue

        clean_header = re.sub(r"^#{1,6}\s*", "", line).rstrip(":").strip()
        is_header = (
            line.startswith("#")
            or line.endswith(":")
            or re.match(r"^[A-Z][A-Z0-9 /&'’.-]{4,}$", line)
        )

        if is_header and len(clean_header) < 120:
            current_header = clean_header
            continue

        clean = line.strip("-•* \t")
        if len(clean) < 8:
            continue

        rows.append({
            "title": current_header,
            "content": clean,
            "category": current_header,
            "source": str(LEDGER_PATH),
            "status": "active",
            "created_at": now(),
            "updated_at": now()
        })

    return rows

def main():
    if not APP_DB.exists():
        raise SystemExit(f"DB not found: {APP_DB}")

    backup = APP_DB.with_suffix(f".sqlite.pre_finish_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    shutil.copy2(APP_DB, backup)

    conn = sqlite3.connect(APP_DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    print("")
    print("Backup created:")
    print(backup)

    if not table_exists(cur, "scenes"):
        raise SystemExit("No scenes table found.")

    scene_cols = cols(cur, "scenes")
    print("")
    print("Scenes columns:")
    print(", ".join(scene_cols))

    where_active = active_where(scene_cols)
    id_col = first_col(scene_cols, ["id", "scene_id", "sceneId"])
    stuck_col = first_col(scene_cols, ["stuck_options", "stuckOptions"])
    updated_col = first_col(scene_cols, ["updated_at", "updatedAt"])

    filled_stuck = 0

    if not id_col or not stuck_col:
        print("SKIP stuck_options: scenes table does not have recognizable id/stuck_options columns.")
    else:
        cur.execute(f"SELECT * FROM scenes WHERE {where_active}")
        scenes = [dict(r) for r in cur.fetchall()]

        for scene in scenes:
            existing = split_options(scene.get(stuck_col))
            if existing:
                continue

            opts = fallback_stuck_options(scene)
            payload = json.dumps(opts, ensure_ascii=False)

            if updated_col:
                cur.execute(
                    f"UPDATE scenes SET {stuck_col}=?, {updated_col}=? WHERE {id_col}=?",
                    (payload, now(), scene[id_col])
                )
            else:
                cur.execute(
                    f"UPDATE scenes SET {stuck_col}=? WHERE {id_col}=?",
                    (payload, scene[id_col])
                )

            filled_stuck += 1

    continuity_imported = 0
    continuity_skipped_reason = None

    if not table_exists(cur, "continuity_ledger"):
        continuity_skipped_reason = "No continuity_ledger table found."
    elif not LEDGER_PATH.exists():
        continuity_skipped_reason = f"Ledger file not found: {LEDGER_PATH}"
    else:
        continuity_cols = cols(cur, "continuity_ledger")
        print("")
        print("Continuity columns:")
        print(", ".join(continuity_cols))

        title_col = first_col(continuity_cols, ["title", "name", "key"])
        content_col = first_col(continuity_cols, ["content", "text", "value", "description", "note", "body"])
        category_col = first_col(continuity_cols, ["category", "type", "scope"])
        source_col = first_col(continuity_cols, ["source", "source_path", "source_file"])
        status_col = first_col(continuity_cols, ["status", "state"])
        created_col = first_col(continuity_cols, ["created_at", "createdAt"])
        updated_col2 = first_col(continuity_cols, ["updated_at", "updatedAt"])

        if not content_col:
            continuity_skipped_reason = f"continuity_ledger has no recognizable content/text column. Columns: {continuity_cols}"
        else:
            rows = parse_ledger_text(LEDGER_PATH.read_text(encoding="utf-8", errors="ignore"))

            for row in rows:
                cur.execute(f"SELECT COUNT(*) FROM continuity_ledger WHERE {content_col}=?", (row["content"],))
                if cur.fetchone()[0] > 0:
                    continue

                insert_cols = []
                vals = []

                if title_col:
                    insert_cols.append(title_col); vals.append(row["title"])
                insert_cols.append(content_col); vals.append(row["content"])
                if category_col:
                    insert_cols.append(category_col); vals.append(row["category"])
                if source_col:
                    insert_cols.append(source_col); vals.append(row["source"])
                if status_col:
                    insert_cols.append(status_col); vals.append(row["status"])
                if created_col:
                    insert_cols.append(created_col); vals.append(row["created_at"])
                if updated_col2:
                    insert_cols.append(updated_col2); vals.append(row["updated_at"])

                placeholders = ",".join(["?"] * len(insert_cols))
                cur.execute(
                    f"INSERT INTO continuity_ledger ({','.join(insert_cols)}) VALUES ({placeholders})",
                    vals
                )
                continuity_imported += 1

    revision_scaffolded = 0
    revision_skipped_reason = None

    if not table_exists(cur, "revision_queue"):
        revision_skipped_reason = "No revision_queue table found."
    else:
        revision_cols = cols(cur, "revision_queue")
        print("")
        print("Revision queue columns:")
        print(", ".join(revision_cols))

        cur.execute("SELECT COUNT(*) FROM revision_queue")
        rev_count = cur.fetchone()[0]

        if rev_count > 0:
            revision_skipped_reason = f"revision_queue already has {rev_count} row(s); no scaffold added."
        else:
            title_col = first_col(revision_cols, ["title", "name"])
            scene_col = first_col(revision_cols, ["scene_id", "sceneId", "source_id", "sourceId"])
            content_col = first_col(revision_cols, ["content", "description", "note", "body", "task"])
            status_col = first_col(revision_cols, ["status", "state"])
            priority_col = first_col(revision_cols, ["priority"])
            created_col = first_col(revision_cols, ["created_at", "createdAt"])
            updated_col3 = first_col(revision_cols, ["updated_at", "updatedAt"])

            tasks = [
                {
                    "title": "Phase 2 continuity pass",
                    "content": "After 3–5 V0 scenes are drafted, check continuity against imported ledger and source material.",
                    "priority": "medium"
                },
                {
                    "title": "Voice consistency pass",
                    "content": "Compare drafted scenes against GFOU Voice Bible and Protection Rules before polishing.",
                    "priority": "medium"
                },
                {
                    "title": "Scene completion audit",
                    "content": "Verify each scene has physical progression, no explanation leakage, and a clear stop point.",
                    "priority": "medium"
                }
            ]

            if not content_col and not title_col:
                revision_skipped_reason = f"revision_queue has no recognizable title/content columns. Columns: {revision_cols}"
            else:
                for task in tasks:
                    insert_cols = []
                    vals = []

                    if title_col:
                        insert_cols.append(title_col); vals.append(task["title"])
                    if scene_col:
                        insert_cols.append(scene_col); vals.append("GLOBAL")
                    if content_col:
                        insert_cols.append(content_col); vals.append(task["content"])
                    if status_col:
                        insert_cols.append(status_col); vals.append("open")
                    if priority_col:
                        insert_cols.append(priority_col); vals.append(task["priority"])
                    if created_col:
                        insert_cols.append(created_col); vals.append(now())
                    if updated_col3:
                        insert_cols.append(updated_col3); vals.append(now())

                    placeholders = ",".join(["?"] * len(insert_cols))
                    cur.execute(
                        f"INSERT INTO revision_queue ({','.join(insert_cols)}) VALUES ({placeholders})",
                        vals
                    )
                    revision_scaffolded += 1

    conn.commit()

    counts = {}
    for table in ["scenes", "source_material", "rules", "continuity_ledger", "revision_queue", "drafts"]:
        if table_exists(cur, table):
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            counts[table] = cur.fetchone()[0]

    cur.execute(f"SELECT COUNT(*) FROM scenes WHERE {where_active}")
    active_scenes = cur.fetchone()[0]

    if stuck_col:
        cur.execute(f"""
            SELECT COUNT(*)
            FROM scenes
            WHERE {where_active}
              AND {stuck_col} IS NOT NULL
              AND TRIM({stuck_col}) != ''
        """)
        stuck_populated = cur.fetchone()[0]
    else:
        stuck_populated = "unknown"

    conn.close()

    print("")
    print("Post-import finish complete.")
    print(f"Missing stuck_options filled: {filled_stuck}")
    print(f"Continuity ledger rows imported: {continuity_imported}")
    if continuity_skipped_reason:
        print(f"Continuity import note: {continuity_skipped_reason}")
    print(f"Revision queue scaffold rows added: {revision_scaffolded}")
    if revision_skipped_reason:
        print(f"Revision queue note: {revision_skipped_reason}")

    print("")
    print("Counts:")
    for k, v in counts.items():
        print(f"{k}: {v}")
    print(f"active/non-hidden scenes according to detected schema: {active_scenes}")
    print(f"active scenes with stuck_options: {stuck_populated} of {active_scenes}")

if __name__ == "__main__":
    main()
