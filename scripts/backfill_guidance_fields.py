#!/usr/bin/env python3
"""
One-time safe backfill of structured guidance fields for existing GFOU scenes.

Safe rules:
  - Creates a timestamped backup before any writes.
  - Does NOT overwrite fields that already have content.
  - Does NOT touch notes.
  - Does NOT overwrite Prologue Zero's populated fields.
  - Does NOT invent placeholder content.
  - Only uses actual content already present in notes / rule / stuck_directive / stuck_options.
"""

import os
import re
import json
import shutil
import sqlite3
from datetime import datetime

DB_PATH = os.path.expanduser(
    "~/Library/Application Support/gfou/gfou_data/gfou.sqlite"
)

EMPTY_STUCK_BANK = {
    "use_a_line": [],
    "start_a_sentence": [],
    "move_the_body": [],
    "change_the_pressure": [],
    "end_the_beat": [],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def clean(s):
    return re.sub(r"\n{3,}", "\n\n", str(s or "").strip())


def parse_json_list(value):
    if not value:
        return []
    s = str(value).strip()
    if not s or s in ("[]", ""):
        return []
    try:
        obj = json.loads(s)
        if isinstance(obj, list):
            return [str(x).strip() for x in obj if str(x).strip()]
    except Exception:
        pass
    return []


def parse_stuck_bank(value):
    if not value:
        return EMPTY_STUCK_BANK.copy()
    s = str(value).strip()
    if not s or s in ("{}", ""):
        return EMPTY_STUCK_BANK.copy()
    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            return {
                "use_a_line":          obj.get("use_a_line")          if isinstance(obj.get("use_a_line"),          list) else [],
                "start_a_sentence":    obj.get("start_a_sentence")    if isinstance(obj.get("start_a_sentence"),    list) else [],
                "move_the_body":       obj.get("move_the_body")       if isinstance(obj.get("move_the_body"),       list) else [],
                "change_the_pressure": obj.get("change_the_pressure") if isinstance(obj.get("change_the_pressure"), list) else [],
                "end_the_beat":        obj.get("end_the_beat")        if isinstance(obj.get("end_the_beat"),        list) else [],
            }
    except Exception:
        pass
    return EMPTY_STUCK_BANK.copy()


def stuck_bank_has_content(bank):
    return any(len(bank.get(k, [])) > 0 for k in EMPTY_STUCK_BANK)


# ---------------------------------------------------------------------------
# source_anchor
# Notes from import_scene_guidance.py always start with:
#   ## [N/67] SCENE-ID — Title — full subtitle
# Older autosave-based notes look like:
#   summary: ...\nnotes: ...\n...
# Fall back to "id — title" for both.
# ---------------------------------------------------------------------------

def extract_source_anchor(scene):
    notes = str(scene.get("notes") or "")
    # Heading-based format
    m = re.match(r"## \[\d+/67\]\s+(.+?)(?:\n|$)", notes)
    if m:
        heading_body = m.group(1).strip()
        # "NEW-4 — Prologue Zero — age 30, a room, before everything"
        # → "NEW-4 — Prologue Zero"
        parts = [p.strip() for p in heading_body.split(" — ")]
        if len(parts) >= 2:
            return parts[0] + " — " + parts[1]
        return parts[0]

    # Fallback: id — title
    scene_id = str(scene.get("id") or "")
    title    = str(scene.get("title") or "")
    if scene_id and title and scene_id != title:
        return scene_id + " — " + title
    return (scene_id or title).strip()


# ---------------------------------------------------------------------------
# dont_forget
# Priority: stuck_directive → CUP STATE in notes → REGISTER in notes → first
#           non-negative RULES line from notes.
# We want a short positive reminder, not a "do not" directive.
# ---------------------------------------------------------------------------

_NEGATIVE_PREFIX = re.compile(r"^(do not|never|no |don't)", re.I)


def extract_dont_forget(scene):
    # 1. stuck_directive is already scene-specific and written as a directive
    sd = clean(scene.get("stuck_directive") or "")
    if sd and not _NEGATIVE_PREFIX.match(sd):
        return sd

    notes = str(scene.get("notes") or "")

    # 2. CUP STATE section in notes
    cup_m = re.search(
        r"CUP STATE:\n(.+?)(?:\n\n|\nLOCKS|\nECHO|\nPROTECTION|\nSTARTER|\Z)",
        notes, re.S,
    )
    if cup_m:
        cup_val = clean(cup_m.group(1))
        if cup_val and cup_val != "—":
            return cup_val

    # 3. REGISTER: inside the STARTER PROMPT block of notes
    reg_m = re.search(
        r"\bREGISTER:\s*(.+?)(?:\n[A-Z][A-Z /()''.\-]{2,}:|\nRULES:|\n\n|\Z)",
        notes, re.S,
    )
    if reg_m:
        reg_val = clean(reg_m.group(1))
        if reg_val and reg_val != "—":
            return reg_val

    # 4. First meaningful RULES line that isn't a negative
    rules_m = re.search(
        r"\bRULES:\s*\n(.*?)(?:\nCRAFT DIRECTIVES:|\nTRACKS:|\nECHO:|\nSOURCE:|\Z)",
        notes, re.S,
    )
    if rules_m:
        for raw_line in rules_m.group(1).splitlines():
            line = raw_line.strip(" —•\t")
            if len(line) > 10 and not _NEGATIVE_PREFIX.match(line):
                return line

    # 5. rule field (if it's short enough to be a directive)
    rule = clean(scene.get("rule") or "")
    if rule and len(rule) < 200 and not _NEGATIVE_PREFIX.match(rule):
        first_line = rule.splitlines()[0].strip()
        if len(first_line) > 10:
            return first_line

    return ""


# ---------------------------------------------------------------------------
# do_not_do_this
# Only extract lines that are explicitly negative directives.
# Pattern matches: "— Do not …", "— Never …", "— No <verb>…", numbered
# variants, and bare "DO NOT …" lines.
# ---------------------------------------------------------------------------

_DO_NOT_PATTERNS = [
    re.compile(r"^\s*(?:[—\-]\s*|\d+\.\s*)(Do not\s.{6,})", re.I),
    re.compile(r"^\s*(?:[—\-]\s*|\d+\.\s*)(Never\s.{6,})", re.I),
    re.compile(r"^\s*(?:[—\-]\s*|\d+\.\s*)(No (?:explanation|interpret|naming|sentimental|abstract|summariz|metaphor|diagnos|psycholog).{4,})", re.I),
    re.compile(r"^\s*DO NOT\s*[:—\-]?\s*(.{6,})"),
]


def extract_do_not_do_this(scene):
    candidates = []
    seen = set()

    sources = [
        str(scene.get("notes") or ""),
        str(scene.get("rule") or ""),
    ]

    for text in sources:
        for line in text.splitlines():
            for pat in _DO_NOT_PATTERNS:
                m = pat.match(line)
                if m:
                    item = clean(m.group(1))
                    if item and item not in seen:
                        seen.add(item)
                        candidates.append(item)
                    break

    return candidates


# ---------------------------------------------------------------------------
# stuck_bank
# If bank is already populated, leave it.
# If legacy stuck_options exist and bank is empty, migrate into use_a_line.
# ---------------------------------------------------------------------------

_META_PREFIXES_BF = re.compile(
    r"^(Return to register[:\s]|Use tracks?[:\s]|Body track[:\s—]|"
    r"Relationship track[:\s—]|Register track[:\s—]|Object track[:\s—]|"
    r"Sensation track[:\s—]|[A-Z][a-z]+ track[:\s—]|"
    r"REGISTER SHIFT|CUP STATE[:\s]|LOCKS\s*/|"
    r"Echo[:\s]|^Tracks?[:\s]|Use the )",
    re.I,
)
_BODY_WORDS_BF = re.compile(
    r"\b(hand|hands|throat|jaw|shoulder|shoulders|breath|breathing|spine|"
    r"stomach|chest|fingers|finger|mouth|skin|body|feet|foot|carpet|barre|"
    r"floor|hip|hips|knee|knees|wrist|eye|eyes|face|neck|back|arm|arms|"
    r"tongue|teeth|forehead|temple|belly|ribs|collarbone|ankle|elbow|"
    r"weight|swallow|exhale|inhale|tighten|loosen|stiffen|clench)\b",
    re.I,
)
_PRESSURE_WORDS_BF = re.compile(
    r"\b(pressure|shift|crack|cup|tension|escalat|register shift|soften|"
    r"harden|release|silence|pause|drop|rise|lower|raise|cool|cold|heat|"
    r"warm|resist|surrender|hold|let go|push|pull)\b",
    re.I,
)
_END_BEAT_WORDS_BF = re.compile(
    r"\b(endpoint|end point|end the beat|closes?|stops?|stopped|still|"
    r"stillness|settles?|settled|silence|done|finish|final|last|"
    r"away|exits?|leaves?|empties|emptied|absence|empty|gone|ends?\b)\b",
    re.I,
)
_WARN_PATS_BF = [
    re.compile(r"^\s*(?:[—\-•]\s*|\d+\.\s*)(Do not\s.{6,})", re.I),
    re.compile(r"^\s*(?:[—\-•]\s*|\d+\.\s*)(Do NOT\s.{6,})", re.I),
    re.compile(r"^\s*(?:[—\-•]\s*|\d+\.\s*)(DO NOT\s.{6,})"),
    re.compile(r"^\s*(?:[—\-•]\s*|\d+\.\s*)(Never\s.{6,})", re.I),
    re.compile(r"^\s*(?:[—\-•]\s*|\d+\.\s*)(No interiority.+)", re.I),
    re.compile(r"^\s*(?:[—\-•]\s*|\d+\.\s*)(No explanation.+)", re.I),
    re.compile(r"^\s*(?:[—\-•]\s*|\d+\.\s*)(No audience.+)", re.I),
    re.compile(r"^\s*(?:[—\-•]\s*|\d+\.\s*)(No (?:naming|sentimental|abstract|summariz|metaphor|diagnos|psycholog|interpret).{4,})", re.I),
]


def _is_warn_bf(text):
    raw = re.sub(r"^[\s—\-•*]+", "", text).strip()
    for pat in _WARN_PATS_BF:
        if pat.match(raw) or pat.match(text.strip()):
            return True
    return False


def _classify_bf(text):
    if _is_warn_bf(text):
        return "warning"
    if _META_PREFIXES_BF.search(text.strip()):
        return "meta"
    if len(text.strip()) > 220 and re.search(r"[A-Z][A-Z /]{2,}:", text):
        return "too_long"
    t = text.strip()
    body_n     = len(_BODY_WORDS_BF.findall(t))
    pressure_n = len(_PRESSURE_WORDS_BF.findall(t))
    end_n      = len(_END_BEAT_WORDS_BF.findall(t))
    if body_n >= 1 and len(t) <= 140:
        return "move_the_body"
    if end_n >= 1 and len(t) <= 120:
        return "end_the_beat"
    if pressure_n >= 1 and len(t) <= 160:
        return "change_the_pressure"
    if len(t) <= 80 and not t.endswith((".", "?", "!")) and re.match(r"^[A-Za-z]", t):
        return "start_a_sentence"
    return "use_a_line"


def build_stuck_bank(scene):
    bank = parse_stuck_bank(scene.get("stuck_bank"))
    if stuck_bank_has_content(bank):
        return None  # Already has content — don't touch

    legacy = parse_json_list(scene.get("stuck_options"))
    if not legacy:
        return None  # Nothing to migrate

    new_bank = {k: [] for k in EMPTY_STUCK_BANK}
    seen = set()
    for raw in legacy:
        text = clean(raw)
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        bucket = _classify_bf(text)
        if bucket in ("warning", "meta", "too_long"):
            continue
        new_bank[bucket].append(text)
    return new_bank


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if not os.path.exists(DB_PATH):
        raise SystemExit(f"Database not found: {DB_PATH}")

    timestamp   = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = f"{DB_PATH}.pre_backfill_{timestamp}"
    shutil.copy2(DB_PATH, backup_path)
    print(f"Backup created: {backup_path}")
    print()

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Ensure new columns exist (idempotent — migration004 may already have run)
    existing_cols = {r[1] for r in cur.execute("PRAGMA table_info(scenes)").fetchall()}
    for col, defn in [
        ("source_anchor",  "TEXT NOT NULL DEFAULT ''"),
        ("dont_forget",    "TEXT NOT NULL DEFAULT ''"),
        ("do_not_do_this", "TEXT NOT NULL DEFAULT '[]'"),
        ("stuck_bank",     "TEXT NOT NULL DEFAULT '{}'"),
    ]:
        if col not in existing_cols:
            cur.execute(f"ALTER TABLE scenes ADD COLUMN {col} {defn}")
            print(f"Added missing column: {col}")

    cur.execute("SELECT * FROM scenes")
    scenes = [dict(r) for r in cur.fetchall()]

    stats = dict(total=len(scenes), source_anchor=0, dont_forget=0,
                 do_not_do_this=0, stuck_bank=0)

    for scene in scenes:
        scene_id = scene.get("id", "")
        updates  = {}

        # source_anchor
        if not clean(scene.get("source_anchor") or ""):
            anchor = extract_source_anchor(scene)
            if anchor:
                updates["source_anchor"] = anchor
                stats["source_anchor"] += 1

        # dont_forget
        if not clean(scene.get("dont_forget") or ""):
            df = extract_dont_forget(scene)
            if df:
                updates["dont_forget"] = df
                stats["dont_forget"] += 1

        # do_not_do_this
        if not parse_json_list(scene.get("do_not_do_this")):
            dndt = extract_do_not_do_this(scene)
            if dndt:
                updates["do_not_do_this"] = json.dumps(dndt, ensure_ascii=False)
                stats["do_not_do_this"] += 1

        # stuck_bank
        new_bank = build_stuck_bank(scene)
        if new_bank is not None:
            updates["stuck_bank"] = json.dumps(new_bank, ensure_ascii=False)
            stats["stuck_bank"] += 1

        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates)
            values = list(updates.values()) + [scene_id]
            cur.execute(
                f"UPDATE scenes SET {set_clause}, updated_at=datetime('now') WHERE id=?",
                values,
            )

    conn.commit()

    print("Backfill complete.")
    print(f"  Scenes processed:       {stats['total']}")
    print(f"  source_anchor set:      {stats['source_anchor']}")
    print(f"  dont_forget set:        {stats['dont_forget']}")
    print(f"  do_not_do_this set:     {stats['do_not_do_this']}")
    print(f"  stuck_bank set:         {stats['stuck_bank']}")
    print()

    # Verification counts matching the target metrics
    checks = [
        ("total_scenes",          "SELECT COUNT(*) FROM scenes"),
        ("has_source_anchor",     "SELECT COUNT(*) FROM scenes WHERE source_anchor IS NOT NULL AND TRIM(source_anchor) != ''"),
        ("has_dont_forget",       "SELECT COUNT(*) FROM scenes WHERE dont_forget IS NOT NULL AND TRIM(dont_forget) != ''"),
        ("has_do_not_do_this",    "SELECT COUNT(*) FROM scenes WHERE do_not_do_this IS NOT NULL AND do_not_do_this NOT IN ('[]','') AND TRIM(do_not_do_this) != ''"),
        ("has_stuck_bank",        "SELECT COUNT(*) FROM scenes WHERE stuck_bank IS NOT NULL AND stuck_bank NOT IN ('{}','') AND json_array_length(json_extract(stuck_bank,'$.use_a_line')) > 0"),
        ("has_legacy_stuck_opts", "SELECT COUNT(*) FROM scenes WHERE stuck_options IS NOT NULL AND stuck_options NOT IN ('[]','') AND TRIM(stuck_options) != ''"),
        ("has_notes",             "SELECT COUNT(*) FROM scenes WHERE notes IS NOT NULL AND TRIM(notes) != ''"),
    ]

    print("Verification counts:")
    for label, sql in checks:
        cur.execute(sql)
        print(f"  {label}: {cur.fetchone()[0]}")

    # Spot-check Prologue Zero
    print()
    print("Prologue Zero spot check:")
    cur.execute(
        "SELECT id, title, source_anchor, dont_forget, do_not_do_this, stuck_bank "
        "FROM scenes WHERE id LIKE '%NEW-4%' OR LOWER(title) LIKE '%prologue zero%' LIMIT 3"
    )
    for row in cur.fetchall():
        bank = parse_stuck_bank(row[5])
        print(f"  id={row[0]}")
        print(f"    title={row[1]}")
        print(f"    source_anchor={repr((row[2] or '')[:80])}")
        print(f"    dont_forget={repr((row[3] or '')[:80])}")
        dndt = parse_json_list(row[4])
        print(f"    do_not_do_this count={len(dndt)}")
        print(f"    stuck_bank.use_a_line count={len(bank.get('use_a_line', []))}")

    conn.close()


if __name__ == "__main__":
    main()
