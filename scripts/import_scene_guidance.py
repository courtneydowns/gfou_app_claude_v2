#!/usr/bin/env python3
import os
import re
import json
import shutil
import sqlite3
from datetime import datetime

DB_PATH = os.path.expanduser(
    "~/Library/Application Support/gfou/gfou_data/gfou.sqlite"
)

SCENE_MASTER = "/Users/courtneydowns/Desktop/cgpt_gfou_app/src/gfou-system/knowledge/GFOU_scene_master_NARRATIVE.md"

def require_file(path):
    if not os.path.exists(path):
        raise FileNotFoundError(path)

def clean(s):
    return re.sub(r"\n{3,}", "\n\n", str(s or "").strip())

def json_list(items):
    return json.dumps([clean(x) for x in items if clean(x)], ensure_ascii=False)

def extract_heading_id_title(heading):
    m = re.match(r"##\s+\[(\d+)/67\]\s+(.+?)\s+—\s+(.+)$", heading.strip())
    if not m:
        return None
    number   = int(m.group(1))
    scene_id = m.group(2).strip()
    rest     = m.group(3).strip()
    title    = rest.split(" — ")[0].strip()
    return number, scene_id, title

def split_scene_sections(text):
    pattern = re.compile(r"(?m)^## \[\d+/67\] .+$")
    matches = list(pattern.finditer(text))
    sections = []

    for i, match in enumerate(matches):
        start   = match.start()
        end     = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        heading = match.group(0).strip()
        body    = text[match.end():end].strip()
        parsed  = extract_heading_id_title(heading)
        if parsed:
            number, scene_id, title = parsed
            sections.append({
                "number":  number,
                "id":      scene_id,
                "title":   title,
                "heading": heading,
                "body":    body,
                "full":    text[start:end].strip(),
            })

    return sections

def extract_block(body, label):
    pattern = re.compile(
        r"\*\*" + re.escape(label) + r":\*\*\s*(.*?)(?=\n\*\*[^*\n]+:\*\*|\n\*\*Starter Prompt:\*\*|\Z)",
        re.S
    )
    m = pattern.search(body)
    return clean(m.group(1)) if m else ""

def extract_bold_line(body, label):
    m = re.search(r"\*\*" + re.escape(label) + r":\*\*\s*(.+)", body)
    return clean(m.group(1)) if m else ""

def extract_starter_prompt(body):
    m = re.search(r"\*\*Starter Prompt:\*\*\s*```(.*?)```", body, re.S)
    return clean(m.group(1)) if m else ""

def extract_architecture_bullets(architecture):
    out = {}
    for label in ["Opens With", "Turning Point", "Motif Embedded", "Closes With", "Structural Job"]:
        m = re.search(r"- \*\*" + re.escape(label) + r":\*\*\s*(.*?)(?=\n- \*\*|\Z)", architecture, re.S)
        out[label] = clean(m.group(1)) if m else ""
    return out

def extract_prompt_field(prompt, field):
    m = re.search(
        r"^" + re.escape(field) + r":\s*(.*?)(?=\n[A-Z][A-Z /()''.\-]{2,}:\s|\nRULES:\s|\nCRAFT DIRECTIVES:\s|\nSENSORY CONSTANTS|\Z)",
        prompt, re.M | re.S,
    )
    return clean(m.group(1)) if m else ""

def extract_rules(prompt):
    m = re.search(
        r"^RULES:\s*(.*?)(?=\n[A-Z][A-Z /()''.\-]{2,}:\s|\nTRACKS:\s|\nECHO:\s|\Z)",
        prompt, re.M | re.S,
    )
    if not m:
        return []
    raw = clean(m.group(1))
    lines   = []
    current = ""
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("—") or re.match(r"^\d+\.", stripped):
            if current:
                lines.append(current.strip())
            current = stripped
        else:
            current += " " + stripped
    if current:
        lines.append(current.strip())
    return lines

def extract_craft_directives(prompt):
    m = re.search(
        r"^CRAFT DIRECTIVES:\s*(.*?)(?=\n[A-Z][A-Z /()''.\-]{2,}:\s|\nRULES:\s|\nTRACKS:\s|\Z)",
        prompt, re.M | re.S,
    )
    if not m:
        return []
    raw   = clean(m.group(1))
    lines = []
    current = ""
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if re.match(r"^\d+\.", stripped):
            if current:
                lines.append(current.strip())
            current = stripped
        else:
            current += " " + stripped
    if current:
        lines.append(current.strip())
    return lines


# ---------------------------------------------------------------------------
# New structured-field builders
# ---------------------------------------------------------------------------

_NEGATIVE_PREFIX = re.compile(r"^(?:[—\-]\s*|\d+\.\s*)?(do not|never|no (?:explanation|interpret|nam|senti|abstrac|summari|metaphor|diagnos|psycholog))", re.I)

_DO_NOT_PATTERNS = [
    re.compile(r"^\s*(?:[—\-•]\s*|\d+\.\s*)(Do not\s.{6,})", re.I),
    re.compile(r"^\s*(?:[—\-•]\s*|\d+\.\s*)(Do NOT\s.{6,})", re.I),
    re.compile(r"^\s*(?:[—\-•]\s*|\d+\.\s*)(DO NOT\s.{6,})"),
    re.compile(r"^\s*(?:[—\-•]\s*|\d+\.\s*)(Never\s.{6,})", re.I),
    re.compile(r"^\s*(?:[—\-•]\s*|\d+\.\s*)(No interiority.+)", re.I),
    re.compile(r"^\s*(?:[—\-•]\s*|\d+\.\s*)(No explanation.+)", re.I),
    re.compile(r"^\s*(?:[—\-•]\s*|\d+\.\s*)(No audience.+)", re.I),
    re.compile(r"^\s*(?:[—\-•]\s*|\d+\.\s*)(No (?:naming|sentimental|abstract|summariz|metaphor|diagnos|psycholog|interpret).{4,})", re.I),
]

EMPTY_STUCK_BANK = {
    "use_a_line": [],
    "start_a_sentence": [],
    "move_the_body": [],
    "change_the_pressure": [],
    "end_the_beat": [],
}

# --- stuck_bank classifier helpers (mirrors refine_guidance_fields.py) ---

_META_PREFIXES_IMPORT = re.compile(
    r"^(Return to register[:\s]|Use tracks?[:\s]|Body track[:\s—]|"
    r"Relationship track[:\s—]|Register track[:\s—]|Object track[:\s—]|"
    r"Sensation track[:\s—]|[A-Z][a-z]+ track[:\s—]|"
    r"REGISTER SHIFT|CUP STATE[:\s]|LOCKS\s*/|"
    r"Echo[:\s]|^Tracks?[:\s]|Use the )",
    re.I,
)
_BODY_WORDS_IMPORT = re.compile(
    r"\b(hand|hands|throat|jaw|shoulder|shoulders|breath|breathing|spine|"
    r"stomach|chest|fingers|finger|mouth|skin|body|feet|foot|carpet|barre|"
    r"floor|hip|hips|knee|knees|wrist|eye|eyes|face|neck|back|arm|arms|"
    r"tongue|teeth|forehead|temple|belly|ribs|collarbone|ankle|elbow|"
    r"weight|swallow|exhale|inhale|tighten|loosen|stiffen|clench)\b",
    re.I,
)
_PRESSURE_WORDS_IMPORT = re.compile(
    r"\b(pressure|shift|crack|cup|tension|escalat|register shift|soften|"
    r"harden|release|silence|pause|drop|rise|lower|raise|cool|cold|heat|"
    r"warm|resist|surrender|hold|let go|push|pull)\b",
    re.I,
)
_END_BEAT_WORDS_IMPORT = re.compile(
    r"\b(endpoint|end point|end the beat|closes?|stops?|stopped|still|"
    r"stillness|settles?|settled|silence|done|finish|final|last|"
    r"away|exits?|leaves?|empties|emptied|absence|empty|gone|ends?\b)\b",
    re.I,
)


def _is_warning_line(text: str) -> tuple:
    raw = re.sub(r"^[\s—\-•*]+|\s*^\d+\.\s*", "", text).strip()
    for pat in _DO_NOT_PATTERNS:
        m = pat.match(raw) or pat.match(text.strip())
        if m:
            return True, m.group(1).strip()
    return False, ""


def _classify_stuck_line(text: str) -> str:
    flag, _ = _is_warning_line(text)
    if flag:
        return "warning"
    if _META_PREFIXES_IMPORT.search(text.strip()):
        return "meta"
    if len(text.strip()) > 220 and re.search(r"[A-Z][A-Z /]{2,}:", text):
        return "too_long"
    t = text.strip()
    body_score     = len(_BODY_WORDS_IMPORT.findall(t))
    pressure_score = len(_PRESSURE_WORDS_IMPORT.findall(t))
    end_score      = len(_END_BEAT_WORDS_IMPORT.findall(t))
    if body_score >= 1 and len(t) <= 140:
        return "move_the_body"
    if end_score >= 1 and len(t) <= 120:
        return "end_the_beat"
    if pressure_score >= 1 and len(t) <= 160:
        return "change_the_pressure"
    if (len(t) <= 80 and not t.endswith((".", "?", "!"))
            and re.match(r"^[A-Za-z]", t)):
        return "start_a_sentence"
    return "use_a_line"


def build_source_anchor(section):
    """'SCENE-ID — Title' — short, clean, specific."""
    return section["id"] + " — " + section["title"]


def build_dont_forget(register, cup_from_prompt, craft_directives, rules, stuck_directive):
    """
    Prefer REGISTER (how the scene sounds/feels) as the primary reminder.
    Fall back to CUP STATE, then first non-negative craft directive / rule.
    Do NOT use a negative directive here.
    """
    for candidate in [register, cup_from_prompt]:
        val = clean(candidate)
        if val and val != "—":
            return val

    for items in [craft_directives, rules]:
        for item in items:
            stripped = re.sub(r"^\d+\.\s*", "", item.strip())
            if stripped and not _NEGATIVE_PREFIX.search(stripped):
                return stripped

    val = clean(stuck_directive)
    if val and not _NEGATIVE_PREFIX.search(val):
        return val

    return ""


def build_do_not_do_this(rules, craft_directives):
    """Extract explicitly negative directives from rules + craft directives."""
    candidates = []
    seen = set()
    for items in [rules, craft_directives]:
        for item in items:
            line = item.strip()
            for pat in _DO_NOT_PATTERNS:
                m = pat.match(line)
                if m:
                    extracted = clean(m.group(1))
                    if extracted and extracted not in seen:
                        seen.add(extracted)
                        candidates.append(extracted)
                    break
    return candidates


def build_stuck_bank(stuck_options):
    """
    Classify stuck_options into the five buckets intelligently.
    Warning / meta / too-long lines are dropped here (warnings go into
    do_not_do_this via build_do_not_do_this; meta/instruction lines are
    discarded from stuck_bank entirely).
    """
    bank = {k: [] for k in EMPTY_STUCK_BANK}
    seen = set()
    for raw in stuck_options:
        text = clean(raw)
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        bucket = _classify_stuck_line(text)
        if bucket in ("warning", "meta", "too_long"):
            continue
        bank[bucket].append(text)
    return bank


# ---------------------------------------------------------------------------
# Main build function
# ---------------------------------------------------------------------------

def build_scene_update(section):
    body         = section["body"]
    prompt       = extract_starter_prompt(body)
    architecture = extract_block(body, "Architecture")
    arch         = extract_architecture_bullets(architecture)

    cup_state        = extract_bold_line(body, "Cup State")
    locks            = extract_block(body, "Locks / Gates / Notes")
    echo_pairs       = extract_block(body, "Echo Pairs")
    protection       = extract_block(body, "Protection")
    motifs           = extract_bold_line(body, "Motifs")
    themes           = ""
    mt               = re.search(r"\*\*Motifs:\*\*\s*(.*?)\s*\|\s*\*\*Themes:\*\*\s*(.+)", body)
    if mt:
        motifs = clean(mt.group(1))
        themes = clean(mt.group(2))

    source        = extract_prompt_field(prompt, "SOURCE")
    end           = extract_prompt_field(prompt, "END")
    register      = extract_prompt_field(prompt, "REGISTER")
    tracks        = extract_prompt_field(prompt, "TRACKS")
    echo          = extract_prompt_field(prompt, "ECHO")
    cup_from_prompt = extract_prompt_field(prompt, "CUP STATE")

    rules             = extract_rules(prompt)
    craft_directives  = extract_craft_directives(prompt)

    start_here = []
    if arch.get("Opens With"):
        start_here.append("Open with: " + arch["Opens With"])
    if source:
        start_here.append("Source entry: " + source)
    if prompt:
        first_lines = "\n".join(prompt.splitlines()[:6]).strip()
        if first_lines:
            start_here.append(first_lines)

    success = []
    if arch.get("Turning Point"):
        success.append("Turning point reached: " + arch["Turning Point"])
    if arch.get("Closes With"):
        success.append("Close with: " + arch["Closes With"])
    if end:
        success.append("End target: " + end)
    if arch.get("Structural Job"):
        success.append("Structural job fulfilled: " + arch["Structural Job"])

    stuck_options = []
    if register:
        stuck_options.append("Return to register: " + register)
    if tracks:
        stuck_options.append("Use tracks: " + tracks)
    if craft_directives:
        stuck_options.extend(craft_directives[:5])
    elif rules:
        stuck_options.extend(rules[:5])
    if echo:
        stuck_options.append("Echo: " + echo)

    rule_text_parts = []
    if rules:
        rule_text_parts.append("RULES:\n" + "\n".join(rules))
    if protection and protection.lower() != "none":
        rule_text_parts.append("PROTECTION:\n" + protection)
    if cup_state:
        rule_text_parts.append("CUP STATE:\n" + cup_state)
    if cup_from_prompt:
        rule_text_parts.append("CUP STATE FROM PROMPT:\n" + cup_from_prompt)
    if register:
        rule_text_parts.append("REGISTER:\n" + register)
    if tracks:
        rule_text_parts.append("TRACKS:\n" + tracks)

    stuck_directive = stuck_options[0] if stuck_options else ""

    notes_parts = [
        section["heading"],
        "",
        "CUP STATE:",
        cup_state or "—",
        "",
        "LOCKS / GATES / NOTES:",
        locks or "—",
        "",
        "ECHO PAIRS:",
        echo_pairs or "—",
        "",
        "PROTECTION:",
        protection or "—",
        "",
        "MOTIFS:",
        motifs or "—",
        "",
        "THEMES:",
        themes or "—",
        "",
        "ARCHITECTURE:",
        architecture or "—",
        "",
        "STARTER PROMPT:",
        prompt or "—",
    ]

    # Build the four new structured fields
    source_anchor  = build_source_anchor(section)
    dont_forget    = build_dont_forget(register, cup_from_prompt, craft_directives, rules, stuck_directive)
    do_not_do_this = build_do_not_do_this(rules, craft_directives)
    stuck_bank     = build_stuck_bank(stuck_options)

    return {
        "id":               section["id"],
        "number":           section["number"],
        "title":            section["title"],
        "start_here":       json_list(start_here),
        "rule":             clean("\n\n".join(rule_text_parts)),
        "stuck_directive":  stuck_directive,
        "stuck_options":    json_list(stuck_options),
        "success_looks_like": json_list(success),
        "notes":            clean("\n".join(notes_parts)),
        "source_content":   clean(section["full"]),
        # New structured fields
        "source_anchor":    source_anchor,
        "dont_forget":      dont_forget,
        "do_not_do_this":   json.dumps(do_not_do_this, ensure_ascii=False),
        "stuck_bank":       json.dumps(stuck_bank, ensure_ascii=False),
    }


def main():
    require_file(DB_PATH)
    require_file(SCENE_MASTER)

    backup_path = f"{DB_PATH}.pre_guidance_import_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    shutil.copy2(DB_PATH, backup_path)

    text     = open(SCENE_MASTER, "r", encoding="utf-8").read()
    sections = split_scene_sections(text)

    conn = sqlite3.connect(DB_PATH)
    cur  = conn.cursor()

    updated      = 0
    source_items = 0

    for section in sections:
        u = build_scene_update(section)

        cur.execute("SELECT id FROM scenes WHERE id=?", (u["id"],))
        if not cur.fetchone():
            continue

        cur.execute(
            """
            UPDATE scenes
            SET
              number=?,
              title=?,
              start_here=?,
              rule=?,
              stuck_directive=?,
              stuck_options=?,
              success_looks_like=?,
              notes=?,
              source_anchor=?,
              dont_forget=?,
              do_not_do_this=?,
              stuck_bank=?,
              updated_at=datetime('now')
            WHERE id=?
            """,
            (
                u["number"],
                u["title"],
                u["start_here"],
                u["rule"],
                u["stuck_directive"],
                u["stuck_options"],
                u["success_looks_like"],
                u["notes"],
                u["source_anchor"],
                u["dont_forget"],
                u["do_not_do_this"],
                u["stuck_bank"],
                u["id"],
            )
        )
        updated += 1

        cur.execute(
            """
            INSERT INTO source_material (id, title, content, tags, scene_id, scope)
            VALUES (?, ?, ?, ?, ?, 'scene')
            ON CONFLICT(id) DO UPDATE SET
              title=excluded.title,
              content=excluded.content,
              tags=excluded.tags,
              scene_id=excluded.scene_id,
              scope=excluded.scope,
              updated_at=datetime('now')
            """,
            (
                "scene-master:" + u["id"],
                "Scene Master — " + u["id"] + " — " + u["title"],
                u["source_content"],
                json.dumps(["scene-master", "scene-guidance", "source-of-truth"]),
                u["id"],
            )
        )
        source_items += 1

    conn.commit()

    counts = {}
    for name, sql in [
        ("scene_guidance_start_here", "SELECT COUNT(*) FROM scenes WHERE start_here IS NOT NULL AND start_here != '[]'"),
        ("scene_guidance_rule",       "SELECT COUNT(*) FROM scenes WHERE length(trim(rule)) > 0"),
        ("scene_guidance_stuck",      "SELECT COUNT(*) FROM scenes WHERE stuck_options IS NOT NULL AND stuck_options != '[]'"),
        ("scene_guidance_success",    "SELECT COUNT(*) FROM scenes WHERE success_looks_like IS NOT NULL AND success_looks_like != '[]'"),
        ("has_source_anchor",         "SELECT COUNT(*) FROM scenes WHERE source_anchor IS NOT NULL AND TRIM(source_anchor) != ''"),
        ("has_dont_forget",           "SELECT COUNT(*) FROM scenes WHERE dont_forget IS NOT NULL AND TRIM(dont_forget) != ''"),
        ("has_do_not_do_this",        "SELECT COUNT(*) FROM scenes WHERE do_not_do_this IS NOT NULL AND do_not_do_this NOT IN ('[]','')"),
        ("has_stuck_bank",            "SELECT COUNT(*) FROM scenes WHERE stuck_bank IS NOT NULL AND stuck_bank NOT IN ('{}','') AND json_array_length(json_extract(stuck_bank,'$.use_a_line')) > 0"),
        ("scene_master_source_items", "SELECT COUNT(*) FROM source_material WHERE id LIKE 'scene-master:%'"),
    ]:
        cur.execute(sql)
        counts[name] = cur.fetchone()[0]

    conn.close()

    print("")
    print("GFOU scene guidance import complete.")
    print("Backup created:")
    print(backup_path)
    print("")
    print(f"Scene master sections found: {len(sections)}")
    print(f"Scenes updated: {updated}")
    print(f"Scene source items upserted: {source_items}")
    print("")
    print("Counts:")
    for k, v in counts.items():
        print(f"  {k}: {v}")

if __name__ == "__main__":
    main()
