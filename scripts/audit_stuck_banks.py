#!/usr/bin/env python3
import os
import re
import json
import sqlite3

DB_PATH = os.path.expanduser(
    "~/Library/Application Support/gfou/gfou_data/gfou.sqlite"
)

BUCKETS = [
    "use_a_line",
    "start_a_sentence",
    "move_the_body",
    "change_the_pressure",
    "end_the_beat",
]

BAD_PATTERNS = [
    ("source/rule label", re.compile(r"\b(SOURCE|REGISTER|RULES|TRACKS|CUP STATE|STARTER PROMPT|TARGET|END:|CONTEXT:)\b", re.I)),
    ("instructional note", re.compile(r"\b(must survive|do not|do NOT|never|not once|belongs to|structural|revision|prompt|source text|approved draft)\b", re.I)),
    ("exposition summary", re.compile(r"\b(mechanism installs|understand|suggested|because|approval|conditional love|unconditional love|scene's structural|reader|narrator)\b", re.I)),
    ("broken quote", re.compile(r"^\"[^\"]*$|^[“][^”]*$")),
    ("dangling ending", re.compile(r"\b(the|a|an|to|of|with|from|between|for|more than)$", re.I)),
]

def parse_bank(raw):
    if not raw:
        return {k: [] for k in BUCKETS}
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            return {k: obj.get(k, []) if isinstance(obj.get(k, []), list) else [] for k in BUCKETS}
    except Exception:
        pass
    return {k: [] for k in BUCKETS}

def item_problems(item):
    problems = []
    s = str(item).strip()
    if not s:
        problems.append("empty")
        return problems

    if len(s) > 180:
        problems.append("too long")

    for label, pat in BAD_PATTERNS:
        if pat.search(s):
            problems.append(label)

    return problems

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

rows = cur.execute("""
    SELECT id, title, stuck_bank
    FROM scenes
    ORDER BY number, id
""").fetchall()

print("STUCK BANK AUDIT")
print("=" * 80)

scene_problem_count = 0
total_problem_items = 0

for row in rows:
    bank = parse_bank(row["stuck_bank"])
    scene_lines = []

    for bucket in BUCKETS:
        items = bank.get(bucket, [])
        if not items:
            scene_lines.append(f"  EMPTY {bucket}")

        for item in items:
            problems = item_problems(item)
            if problems:
                total_problem_items += 1
                scene_lines.append(f"  {bucket}: {', '.join(problems)}")
                scene_lines.append(f"    - {item}")

    if scene_lines:
        scene_problem_count += 1
        print()
        print(f"{row['id']} — {row['title']}")
        for line in scene_lines:
            print(line)

print()
print("=" * 80)
print(f"Scenes with issues: {scene_problem_count} / {len(rows)}")
print(f"Problem items: {total_problem_items}")
conn.close()
