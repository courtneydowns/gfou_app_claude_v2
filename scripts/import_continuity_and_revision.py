#!/usr/bin/env python3
import sqlite3, shutil, re
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
    if "status" in scene_cols:
        return "(status IS NULL OR LOWER(status) NOT IN ('archived','hidden','smoke-test','smoke_test'))"
    return "1=1"

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
            "entry_type": current_header,
            "content": clean,
        })

    return rows

def main():
    if not APP_DB.exists():
        raise SystemExit(f"DB not found: {APP_DB}")

    backup = APP_DB.with_suffix(f".sqlite.pre_continuity_revision_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
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
    scene_id_col = first_col(scene_cols, ["id", "scene_id", "sceneId"])
    where_active = active_where(scene_cols)

    cur.execute(f"SELECT {scene_id_col}, title FROM scenes WHERE {where_active} ORDER BY number LIMIT 1")
    anchor_scene = cur.fetchone()

    if not anchor_scene:
        raise SystemExit("No active scene found to use as GLOBAL continuity anchor.")

    anchor_scene_id = anchor_scene[scene_id_col]
    anchor_title = anchor_scene["title"] if "title" in scene_cols else ""

    print("")
    print("Continuity anchor scene:")
    print(f"{anchor_scene_id} — {anchor_title}")

    continuity_imported = 0
    continuity_skipped = None

    if not table_exists(cur, "continuity_ledger"):
        continuity_skipped = "No continuity_ledger table found."
    elif not LEDGER_PATH.exists():
        continuity_skipped = f"Ledger file not found: {LEDGER_PATH}"
    else:
        continuity_cols = cols(cur, "continuity_ledger")
        print("")
        print("Continuity columns:")
        print(", ".join(continuity_cols))

        scene_col = first_col(continuity_cols, ["scene_id", "sceneId"])
        type_col = first_col(continuity_cols, ["entry_type", "type", "category"])
        content_col = first_col(continuity_cols, ["content", "text", "description", "note", "body"])
        created_col = first_col(continuity_cols, ["created_at", "createdAt"])

        if not scene_col or not content_col:
            continuity_skipped = f"continuity_ledger missing required scene/content columns. Columns: {continuity_cols}"
        else:
            rows = parse_ledger_text(LEDGER_PATH.read_text(encoding="utf-8", errors="ignore"))

            for row in rows:
                cur.execute(
                    f"SELECT COUNT(*) FROM continuity_ledger WHERE {scene_col}=? AND {content_col}=?",
                    (anchor_scene_id, row["content"])
                )
                if cur.fetchone()[0] > 0:
                    continue

                insert_cols = [scene_col, content_col]
                vals = [anchor_scene_id, row["content"]]

                if type_col:
                    insert_cols.append(type_col)
                    vals.append(row["entry_type"])

                if created_col:
                    insert_cols.append(created_col)
                    vals.append(now())

                placeholders = ",".join(["?"] * len(insert_cols))
                cur.execute(
                    f"INSERT INTO continuity_ledger ({','.join(insert_cols)}) VALUES ({placeholders})",
                    vals
                )
                continuity_imported += 1

    revision_added = 0
    revision_skipped = None

    if not table_exists(cur, "revision_queue"):
        revision_skipped = "No revision_queue table found."
    else:
        revision_cols = cols(cur, "revision_queue")
        print("")
        print("Revision queue columns:")
        print(", ".join(revision_cols))

        cur.execute("SELECT COUNT(*) FROM revision_queue")
        existing = cur.fetchone()[0]

        if existing > 0:
            revision_skipped = f"revision_queue already has {existing} row(s); no scaffold added."
        else:
            scene_col = first_col(revision_cols, ["scene_id", "sceneId"])
            type_col = first_col(revision_cols, ["entry_type", "type", "category"])
            content_col = first_col(revision_cols, ["content", "text", "description", "note", "body", "task"])
            created_col = first_col(revision_cols, ["created_at", "createdAt"])

            tasks = [
                ("Phase 2 continuity pass", "After 3–5 V0 scenes are drafted, check continuity against imported ledger and source material."),
                ("Voice consistency pass", "Compare drafted scenes against GFOU Voice Bible and Protection Rules before polishing."),
                ("Scene completion audit", "Verify each scene has physical progression, no explanation leakage, and a clear stop point."),
            ]

            if not content_col:
                revision_skipped = f"revision_queue has no recognizable content column. Columns: {revision_cols}"
            else:
                for label, body in tasks:
                    insert_cols = [content_col]
                    vals = [f"{label}: {body}"]

                    if scene_col:
                        insert_cols.append(scene_col)
                        vals.append(anchor_scene_id)

                    if type_col:
                        insert_cols.append(type_col)
                        vals.append("GLOBAL_REVISION_SCAFFOLD")

                    if created_col:
                        insert_cols.append(created_col)
                        vals.append(now())

                    placeholders = ",".join(["?"] * len(insert_cols))
                    cur.execute(
                        f"INSERT INTO revision_queue ({','.join(insert_cols)}) VALUES ({placeholders})",
                        vals
                    )
                    revision_added += 1

    conn.commit()

    print("")
    print("Import complete.")
    print(f"Continuity rows imported: {continuity_imported}")
    if continuity_skipped:
        print(f"Continuity note: {continuity_skipped}")
    print(f"Revision queue rows added: {revision_added}")
    if revision_skipped:
        print(f"Revision note: {revision_skipped}")

    for table in ["scenes", "source_material", "rules", "continuity_ledger", "revision_queue", "drafts"]:
        if table_exists(cur, table):
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            print(f"{table}: {cur.fetchone()[0]}")

    conn.close()

if __name__ == "__main__":
    main()
