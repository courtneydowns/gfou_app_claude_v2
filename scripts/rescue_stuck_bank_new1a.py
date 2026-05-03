#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = os.path.expanduser(
    "~/Library/Application Support/gfou/gfou_data/gfou.sqlite"
)

SCENE_ID = "NEW-1A"

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

RESCUED_BANK = {
    "use_a_line": [
        "The barre is cold through her palm.",
        "Resin sits at the back of her throat.",
        "The floor gives under the ball of her foot.",
        "Her mouth gets ready before the rest of her does.",
        "The word waits behind her teeth.",
        "She keeps one hand on the barre.",
        "The room smells like resin and floor wax.",
        "Her tights pull tight across her knees.",
    ],
    "start_a_sentence": [
        "The barre",
        "Her palm",
        "The floor",
        "The resin smell",
        "Her mouth",
        "The yes",
        "Her knees",
        "For a second, her body",
    ],
    "move_the_body": [
        "Her fingers close around the barre.",
        "Her heel lowers before she tells it to.",
        "Her knees soften, then lock.",
        "Her throat tightens around the word.",
        "Her shoulders stay lifted too long.",
        "Her palm slides once on the cold wood.",
        "Her toes press into the floor.",
        "Her mouth opens before her body agrees.",
    ],
    "change_the_pressure": [
        "Keep the love warm and the body resisting.",
        "Let the room stay ordinary while the body gives way.",
        "Make the yes feel smaller than the wanting.",
        "Hold the beat between the body’s pull and the mouth’s answer.",
        "Let the pressure move from the barre into the throat.",
        "Keep the parents gentle; let the body carry the harm.",
    ],
    "end_the_beat": [
        "The yes leaves her mouth before the wanting does.",
        "Her hand stays on the barre after the answer is over.",
        "The floor gives, and she gives with it.",
        "The room keeps its resin smell.",
        "Her body is still holding the no.",
        "The word is out, and her palm is still cold.",
    ],
}

def backup_db():
    root = Path("gfou_backups")
    root.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest_dir = root / f"before_new1a_stuck_bank_rescue_{stamp}"
    dest_dir.mkdir()
    dest = dest_dir / "gfou.sqlite"
    shutil.copy2(DB_PATH, dest)
    return dest

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

def validate_bank(bank):
    errors = []
    for bucket in BUCKETS:
        items = bank.get(bucket, [])
        if not isinstance(items, list):
            errors.append(f"{bucket}: not a list")
            continue
        if not items:
            errors.append(f"{bucket}: empty")
        for item in items:
            probs = item_problems(item)
            if probs:
                errors.append(f"{bucket}: {', '.join(probs)} — {item}")
    return errors

def print_bank(label, bank):
    print(f"\n{label}")
    print("=" * 80)
    for bucket in BUCKETS:
        print(f"\n{bucket}:")
        for item in bank.get(bucket, []):
            print(f"  - {item}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Write rescued bank to DB.")
    args = ap.parse_args()

    errors = validate_bank(RESCUED_BANK)
    if errors:
        print("RESCUED BANK FAILED VALIDATION")
        print("=" * 80)
        for e in errors:
            print(f"- {e}")
        raise SystemExit(1)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    row = cur.execute(
        "SELECT id, title, stuck_bank FROM scenes WHERE id = ?",
        (SCENE_ID,),
    ).fetchone()

    if not row:
        print(f"ERROR: scene not found: {SCENE_ID}")
        raise SystemExit(1)

    old_bank = json.loads(row["stuck_bank"] or "{}")

    print(f"Scene: {row['id']} — {row['title']}")
    print(f"Mode: {'APPLY' if args.apply else 'DRY RUN'}")

    print_bank("CURRENT BANK", old_bank)
    print_bank("RESCUED BANK", RESCUED_BANK)

    if not args.apply:
        print("\nNo DB write made. Rerun with --apply to update NEW-1A only.")
        conn.close()
        return

    backup_path = backup_db()
    cur.execute(
        """
        UPDATE scenes
        SET stuck_bank = ?, updated_at = datetime('now')
        WHERE id = ?
        """,
        (json.dumps(RESCUED_BANK, ensure_ascii=False), SCENE_ID),
    )
    conn.commit()
    conn.close()

    print("\nDB updated for NEW-1A only.")
    print(f"Backup created: {backup_path}")

if __name__ == "__main__":
    main()
