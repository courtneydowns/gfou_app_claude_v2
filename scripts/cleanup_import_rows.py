#!/usr/bin/env python3
import sqlite3, shutil, uuid
from pathlib import Path
from datetime import datetime

DB = Path.home() / "Library/Application Support/gfou/gfou_data/gfou.sqlite"

def table_exists(cur, table):
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
    return cur.fetchone() is not None

def cols(cur, table):
    cur.execute(f"PRAGMA table_info({table})")
    return [r[1] for r in cur.fetchall()]

backup = DB.with_suffix(f".sqlite.pre_cleanup_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
shutil.copy2(DB, backup)

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

print("")
print("Backup created:")
print(backup)

if table_exists(cur, "continuity_ledger"):
    before = cur.execute("SELECT COUNT(*) FROM continuity_ledger").fetchone()[0]

    cur.execute("""
        DELETE FROM continuity_ledger
        WHERE TRIM(content) = ''
           OR content LIKE '====%'
           OR content LIKE '----%'
           OR UPPER(TRIM(content)) IN (
                'CONTINUITY LEDGER — MASTER FILE',
                'THE CONSUMABLE | COMPLETE REFERENCE FOR ALL SESSIONS'
           )
    """)

    after = cur.execute("SELECT COUNT(*) FROM continuity_ledger").fetchone()[0]
    print(f"Continuity cleanup removed: {before - after}")
    print(f"Continuity rows remaining: {after}")

if table_exists(cur, "revision_queue"):
    rq_cols = cols(cur, "revision_queue")
    if "id" in rq_cols:
        rows = cur.execute("SELECT rowid FROM revision_queue WHERE id IS NULL OR TRIM(COALESCE(id,''))=''").fetchall()
        for r in rows:
            cur.execute(
                "UPDATE revision_queue SET id=? WHERE rowid=?",
                (f"rev-global-{uuid.uuid4().hex[:12]}", r["rowid"])
            )
        print(f"Revision queue IDs repaired: {len(rows)}")

conn.commit()

print("")
print("Post-cleanup counts:")
for table in ["scenes", "source_material", "rules", "continuity_ledger", "revision_queue", "drafts"]:
    if table_exists(cur, table):
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        print(f"{table}: {cur.fetchone()[0]}")

if table_exists(cur, "revision_queue"):
    print("")
    print("Revision queue sample:")
    cur.execute("SELECT * FROM revision_queue LIMIT 5")
    for row in cur.fetchall():
        print(dict(row))

conn.close()
