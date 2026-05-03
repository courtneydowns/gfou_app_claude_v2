#!/usr/bin/env python3
import os
import re
import json
import sqlite3

DB_PATH = os.path.expanduser(
    "~/Library/Application Support/gfou/gfou_data/gfou.sqlite"
)

BODY_WORDS = re.compile(
    r"\b(body|throat|jaw|mouth|teeth|tongue|breath|chest|rib|ribs|stomach|gut|skin|"
    r"hand|hands|palm|fingers|knuckle|shoulder|spine|back|hip|hips|knee|knees|leg|legs|"
    r"foot|feet|heel|toes|eyes|face|neck|hair|weight|cold|warm|heat|pressure|tight|"
    r"tremble|shake|shaking|breathing|floor|carpet|mirror|bed|door|room|sink|light|"
    r"smell|taste|metallic|resin|barre|cup|glass|liquid)\b",
    re.I,
)

BAD_SOURCE_WORDS = re.compile(
    r"\b(STARTER PROMPT|WHAT THE WRITER KNOWS|CUP STATE|LOCKS|GATES|NOTES|ARCHITECTURE|"
    r"STRUCTURAL|reader|narrator|register|source|rule|do not|must|preserve|motif|theme)\b",
    re.I,
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

def parse_jsonish(raw):
    if not raw:
        return []
    try:
        obj = json.loads(raw)
        if isinstance(obj, list):
            return [str(x) for x in obj]
        if isinstance(obj, dict):
            return [json.dumps(obj, ensure_ascii=False)]
    except Exception:
        pass
    return [str(raw)]

def parse_bank(raw):
    if not raw:
        return {k: [] for k in BUCKETS}
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            return {
                k: obj.get(k, []) if isinstance(obj.get(k, []), list) else []
                for k in BUCKETS
            }
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

def split_candidate_lines(text):
    if not text:
        return []
    pieces = []
    for raw in re.split(r"[\n•●]+", text):
        raw = raw.strip(" -\t")
        if not raw:
            continue
        # Split very long prose into sentence-like pieces.
        parts = re.split(r"(?<=[.!?])\s+", raw)
        for p in parts:
            p = p.strip(" -\t")
            if 20 <= len(p) <= 180:
                pieces.append(p)
    return pieces

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
rows = conn.execute("""
    SELECT id, number, title, start_here, stuck_directive, stuck_options,
           success_looks_like, notes, dont_forget, stuck_bank
    FROM scenes
    ORDER BY number, id
""").fetchall()

print("STUCK BANK RESCUE PLANNING REPORT")
print("=" * 100)

for row in rows:
    bank = parse_bank(row["stuck_bank"])
    problem_items = []
    empty_buckets = []

    for bucket in BUCKETS:
        items = bank.get(bucket, [])
        if not items:
            empty_buckets.append(bucket)
        for item in items:
            probs = item_problems(item)
            if probs:
                problem_items.append((bucket, item, probs))

    if not problem_items and not empty_buckets:
        continue

    source_texts = []
    for key in ["stuck_directive", "dont_forget", "start_here", "success_looks_like", "notes"]:
        vals = parse_jsonish(row[key])
        for v in vals:
            source_texts.append((key, v))

    candidates = []
    for key, text in source_texts:
        for line in split_candidate_lines(text):
            if BODY_WORDS.search(line) and not BAD_SOURCE_WORDS.search(line):
                candidates.append((key, line))

    # de-dupe while preserving order
    seen = set()
    clean_candidates = []
    for key, line in candidates:
        norm = re.sub(r"\s+", " ", line.lower())
        if norm in seen:
            continue
        seen.add(norm)
        clean_candidates.append((key, line))

    print()
    print(f"{row['id']} — {row['title']}")
    print("-" * 100)
    print(f"Empty buckets: {', '.join(empty_buckets) if empty_buckets else 'none'}")
    print(f"Flagged items: {len(problem_items)}")
    print(f"Clean body/sensory candidate lines found: {len(clean_candidates)}")

    if problem_items[:5]:
        print("\nFirst flagged items:")
        for bucket, item, probs in problem_items[:5]:
            print(f"  [{bucket}] {', '.join(probs)} — {item}")

    if clean_candidates[:8]:
        print("\nPossible rescue material:")
        for key, line in clean_candidates[:8]:
            print(f"  [{key}] {line}")
    else:
        print("\nPossible rescue material: NONE FOUND")

print()
print("=" * 100)
print("Report complete.")
conn.close()
