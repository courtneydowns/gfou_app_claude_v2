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

BANKS_PATH = Path("scripts/stuck_bank_rescue_banks.json")

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

def load_banks():
    with BANKS_PATH.open("r", encoding="utf-8") as f:
        obj = json.load(f)
    if not isinstance(obj, dict):
        raise SystemExit("ERROR: rescue banks JSON must be an object keyed by scene id.")
    return obj

def backup_db():
    root = Path("gfou_backups")
    root.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest_dir = root / f"before_stuck_bank_rescue_apply_{stamp}"
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

def validate_bank(scene_id, bank):
    errors = []

    if not isinstance(bank, dict):
        return [f"{scene_id}: bank is not an object"]

    for bucket in BUCKETS:
        items = bank.get(bucket)
        if not isinstance(items, list):
            errors.append(f"{scene_id}.{bucket}: missing or not a list")
            continue

        if not items:
            errors.append(f"{scene_id}.{bucket}: empty")

        seen = set()
        for item in items:
            s = str(item).strip()
            if s in seen:
                errors.append(f"{scene_id}.{bucket}: duplicate — {s}")
            seen.add(s)

            probs = item_problems(s)
            if probs:
                errors.append(f"{scene_id}.{bucket}: {', '.join(probs)} — {s}")

    extra = sorted(set(bank.keys()) - set(BUCKETS))
    for key in extra:
        errors.append(f"{scene_id}: unknown bucket — {key}")

    return errors

def read_current_bank(row):
    try:
        return json.loads(row["stuck_bank"] or "{}")
    except Exception:
        return {}

def print_bank(label, bank):
    print(f"\n{label}")
    print("=" * 80)
    for bucket in BUCKETS:
        print(f"\n{bucket}:")
        for item in bank.get(bucket, []):
            print(f"  - {item}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scene", action="append", help="Scene id to dry-run/apply. Repeatable. Defaults to all rescue banks.")
    ap.add_argument("--apply", action="store_true", help="Write validated rescue banks to DB.")
    args = ap.parse_args()

    banks = load_banks()
    selected_ids = args.scene or sorted(banks.keys())

    missing = [sid for sid in selected_ids if sid not in banks]
    if missing:
        raise SystemExit(f"ERROR: no rescue bank found for: {', '.join(missing)}")

    all_errors = []
    for sid in selected_ids:
        all_errors.extend(validate_bank(sid, banks[sid]))

    if all_errors:
        print("RESCUE BANK VALIDATION FAILED")
        print("=" * 80)
        for e in all_errors:
            print(f"- {e}")
        raise SystemExit(1)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    rows = {
        row["id"]: row
        for row in cur.execute(
            "SELECT id, title, stuck_bank FROM scenes WHERE id IN (%s)" %
            ",".join("?" for _ in selected_ids),
            selected_ids,
        ).fetchall()
    }

    not_found = [sid for sid in selected_ids if sid not in rows]
    if not_found:
        raise SystemExit(f"ERROR: scene id not found in DB: {', '.join(not_found)}")

    print(f"Mode: {'APPLY' if args.apply else 'DRY RUN'}")
    print(f"Scenes selected: {', '.join(selected_ids)}")

    changed = []
    for sid in selected_ids:
        row = rows[sid]
        old_bank = read_current_bank(row)
        new_bank = banks[sid]

        print(f"\n\nSCENE: {row['id']} — {row['title']}")
        print("#" * 80)
        print_bank("CURRENT BANK", old_bank)
        print_bank("RESCUE BANK", new_bank)

        old_json = json.dumps(old_bank, ensure_ascii=False, sort_keys=True)
        new_json = json.dumps(new_bank, ensure_ascii=False, sort_keys=True)
        if old_json != new_json:
            changed.append(sid)

    print("\n" + "=" * 80)
    print(f"Validated rescue banks: {len(selected_ids)}")
    print(f"Would update scenes: {len(changed)}")
    for sid in changed:
        print(f"- {sid}")

    if not args.apply:
        print("\nNo DB write made. Add --apply to write selected scene(s).")
        conn.close()
        return

    if not changed:
        print("\nNo changes needed.")
        conn.close()
        return

    backup_path = backup_db()

    for sid in changed:
        cur.execute(
            """
            UPDATE scenes
            SET stuck_bank = ?, updated_at = datetime('now')
            WHERE id = ?
            """,
            (json.dumps(banks[sid], ensure_ascii=False), sid),
        )

    conn.commit()
    conn.close()

    print("\nDB updated.")
    print(f"Backup created: {backup_path}")

if __name__ == "__main__":
    main()
