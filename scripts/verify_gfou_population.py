#!/usr/bin/env python3
import sqlite3, json
from pathlib import Path

DB = Path.home() / "Library/Application Support/gfou/gfou_data/gfou.sqlite"

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

def table_exists(table):
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
    return cur.fetchone() is not None

def cols(table):
    cur.execute(f"PRAGMA table_info({table})")
    return [r[1] for r in cur.fetchall()]

def first_col(table, candidates):
    c = cols(table)
    for x in candidates:
        if x in c:
            return x
    return None

def active_where(scene_cols):
    if "status" in scene_cols:
        return "(status IS NULL OR LOWER(status) NOT IN ('archived','hidden','smoke-test','smoke_test'))"
    return "1=1"

print("")
print("=== GFOU POPULATION VERIFY ===")
print("DB:", DB)

for table in ["scenes", "drafts", "source_material", "rules", "continuity_ledger", "revision_queue"]:
    if table_exists(table):
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        print(f"{table}: {cur.fetchone()[0]}")
    else:
        print(f"{table}: MISSING")

if table_exists("scenes"):
    scene_cols = cols("scenes")
    where_active = active_where(scene_cols)

    print("")
    print("scenes columns:")
    print(", ".join(scene_cols))
    print("active scene filter:", where_active)

    title_col = first_col("scenes", ["title", "name"])
    number_col = first_col("scenes", ["number"])
    status_col = first_col("scenes", ["status"])
    type_col = first_col("scenes", ["type"])
    function_col = first_col("scenes", ["function"])
    start_col = first_col("scenes", ["start_here", "startHere"])
    rule_col = first_col("scenes", ["rule", "non_negotiable_rule"])
    stuck_col = first_col("scenes", ["stuck_options", "stuckOptions"])
    success_col = first_col("scenes", ["success_looks_like", "success", "what_success_looks_like"])

    cur.execute(f"SELECT COUNT(*) FROM scenes WHERE {where_active}")
    active = cur.fetchone()[0]

    print("")
    print("active/non-hidden scenes:", active)

    for label, col in [
        ("start_here", start_col),
        ("rule", rule_col),
        ("success_looks_like", success_col),
        ("stuck_options", stuck_col),
    ]:
        if col:
            cur.execute(f"""
                SELECT COUNT(*) FROM scenes
                WHERE {where_active}
                  AND {col} IS NOT NULL
                  AND TRIM({col}) != ''
            """)
            print(f"{label} populated:", cur.fetchone()[0], "of", active)
        else:
            print(f"{label} populated: UNKNOWN / no column")

    print("")
    print("First 10 active scenes:")
    cur.execute(f"""
        SELECT number, title, status, type, function
        FROM scenes
        WHERE {where_active}
        ORDER BY number
        LIMIT 10
    """)
    for r in cur.fetchall():
        print(f"  {r['number']}: {r['title']} | status={r['status']} | type={r['type']} | function={r['function']}")

    print("")
    print("Key title spot check:")
    checks = [
        ("Prologue Zero", "%Prologue Zero%"),
        ("The Caretaker", "%Caretaker%"),
        ("Ballet", "%Ballet%"),
        ("Childhood conditional love", "%Childhood%"),
    ]

    for label, pattern in checks:
        cur.execute(f"""
            SELECT *
            FROM scenes
            WHERE {where_active}
              AND title LIKE ?
            ORDER BY number
            LIMIT 3
        """, (pattern,))
        rows = cur.fetchall()

        if not rows:
            print(f"  {label}: MISSING BY TITLE SEARCH")
            continue

        for row in rows:
            row = dict(row)
            title = row.get(title_col) if title_col else ""
            number = row.get(number_col) if number_col else ""
            start = (row.get(start_col) or "")[:90].replace("\n", " ") if start_col else ""
            rule = (row.get(rule_col) or "")[:90].replace("\n", " ") if rule_col else ""
            success = (row.get(success_col) or "")[:90].replace("\n", " ") if success_col else ""
            stuck = row.get(stuck_col) if stuck_col else ""

            try:
                stuck_count = len(json.loads(stuck)) if stuck else 0
            except Exception:
                stuck_count = len([x for x in str(stuck).splitlines() if x.strip()])

            print(f"  {number}: {title}")
            print(f"    start: {start}")
            print(f"    rule: {rule}")
            print(f"    success: {success}")
            print(f"    stuck options: {stuck_count}")

if table_exists("continuity_ledger"):
    print("")
    print("Continuity sample:")
    cur.execute("SELECT * FROM continuity_ledger LIMIT 5")
    for row in cur.fetchall():
        d = dict(row)
        print(" ", {k: d[k] for k in d.keys() if k in ["scene_id", "entry_type", "content", "created_at"]})

if table_exists("revision_queue"):
    print("")
    print("Revision queue sample:")
    cur.execute("SELECT * FROM revision_queue LIMIT 5")
    for row in cur.fetchall():
        print(" ", dict(row))

conn.close()
print("")
print("Verify complete.")
