#!/usr/bin/env python3
"""
Fifth-pass refinement of structured guidance fields for GFOU scenes.

Key changes from fourth pass:
  1. Final strict cleanup layer applied AFTER bucket classification and
     BEFORE saving — removes bad items already in stuck_bank buckets:
       a. Broken/incomplete fragments:
            - starts lowercase with no concrete sensory noun
            - ends with "the body" (no period), "between", or "for"
            - contains unmatched opening curly quote
            - under 18 chars with no sensory noun
            - known exact-match fragments (e.g. "No exceptions",
              "The caretaker scene", "A yearly tradition", etc.)
       b. Meta/context markers (Section I, Wave 1, new_draft, Echo:,
          ● RELATIONSHIP, ● BODY, Body at rest, Body in the space)
       c. Exposition/memory-summary lines (remembers, What I remember,
          mechanism that will later, came and I have misplaced, etc.)
       d. Register leakage (no audience. The body arrives, Pure body
          sensation, Present tense, no calculation)

Safe rules:
  - Creates a timestamped backup before any writes.
  - Preserves notes and source_anchor exactly.
  - Preserves existing do_not_do_this entries; only cleans/adds.
  - Never invents content — only reclassifies existing text.
  - Idempotent: second run produces zero updates.
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
# Hard-reject: these strings/prefixes can NEVER enter any stuck_bank bucket.
# ---------------------------------------------------------------------------

_HARD_REJECT_PREFIX = re.compile(
    r"^("
    r"from prompt[:\s]?|"
    r"\*{0,2}caretaker\*{0,2}[:\s]|"
    r"register[:\s]|"
    r"protection[:\s]|"
    r"source\s*:|"                               # SOURCE: label prefix
    r"tracks?\s*:|"
    r"craft directive[s]?[:\s]|"
    r"body track[:\s\u2014\-]|"
    r"relationship track[:\s\u2014\-]|"
    r"object track[:\s\u2014\-]|"
    r"sensation track[:\s\u2014\-]|"
    r"cup state[:\s]|"
    r"locks\s*/|"
    r"locks\s*\\|"
    r"echo pairs?[:\s]|"
    r"motifs?\s*:|"
    r"themes?\s*:|"
    r"architecture[:\s]|"
    r"starter prompt[:\s]|"
    r"return to register[:\s]|"
    r"use tracks?[:\s]|"
    r"register shift|"
    r"full\s*[\u2014\-]\s*(wrong|unconditional)|"
    r"pure body sensation\.?\s*(present tense)?$|"
    r"body only\.?\s*(present tense)?$|"
    r"present tense\.?\s*$|"
    r"present continuous\.?\s*$|"
    r"fragments acceptable\.?\s*$|"
    # ---- Fourth-pass additions ----
    r"target\s*:|"                               # TARGET: ...
    r"end\s*:|"                                  # END: ...
    r"start\s*:|"                                # START: ...
    r"context\s*:|"                              # CONTEXT: ...
    r"sensory\s+anchor[:\s(]|"                  # SENSORY ANCHOR: / (
    r"sensory\s+constants?[:\s(]|"              # SENSORY CONSTANTS: / (
    r"approved\s+draft|"                         # APPROVED DRAFT —
    r"what\s+the\s+writer\s+knows?[:\s]|"       # WHAT THE WRITER KNOWS:
    r"motifs?\s+active[:\s]|"                   # MOTIFS ACTIVE:
    r"three\s+lenses[:\s]|"                     # THREE LENSES:
    r"##\s*\["
    r")",
    re.I,
)

_HARD_REJECT_CONTAINS = re.compile(
    r"(from prompt:|craft directives?:|starter prompt:|"
    r"\*\*caretaker\*\*|never named\.?\s*anonymity is structural|"
    r"wrong filling installs|unconditional love present and active|"
    r"belongs to prologue-b|"
    # ---- Fourth-pass additions ----
    r"use as source|"
    r"not source text|"
    r"must survive|"
    r"revision runs|"
    r"must be present\b|"
    r"not dramatized|"
    r"is structural[,\.]|"
    r"load[\-\u2014]?bearing|"
    r"not villains?|"
    r"made from love|"
    r"parental love|"
    r"love is real"
    r")",
    re.I,
)

# Dangling / incomplete endings — fragment cannot end with these words
_DANGLING_END = re.compile(
    r"\s(?:what|that|or|and|the|a|an|to|of|with|from|they)$",
    re.I,
)

# ---------------------------------------------------------------------------
# Fifth-pass strict cleanup patterns — applied after bucket classification
# ---------------------------------------------------------------------------

# Dangling endings beyond what _DANGLING_END covers.
# "the body" only matches without a terminal period so that
# "The yes leaves the body." (valid complete sentence) is kept.
_FIFTH_PASS_DANGLING_END = re.compile(
    r"\b(?:the\s+body|between|for)\s*$",
    re.I,
)

# Meta / structural markers that should never appear in stuck_bank items.
_FIFTH_PASS_META_CONTAINS = re.compile(
    r"(?:"
    r"Section\s+I\b|"
    r"Wave\s+1\b|"
    r"new_draft|"
    r"Echo\s*:|"
    r"[\u25cf\u2022]\s*(?:RELATIONSHIP|BODY)\b|"   # ● RELATIONSHIP / ● BODY
    r"\bBody at rest\b|"
    r"\bBody in the space\b"
    r")",
    re.I,
)

# Exposition / memory-summary lines.
_FIFTH_PASS_EXPOSITION_CONTAINS = re.compile(
    r"(?:"
    r"\bremembers\b|"
    r"\bregretted\b|"
    r"decision her entire life|"
    r"approval instead of|"
    r"What I remember|"
    r"came and I have misplaced|"
    r"first time she remembers|"
    r"mechanism that will later|"
    r"Everything that follows"
    r")",
    re.I,
)

# Register leakage.
_FIFTH_PASS_REGISTER_LEAKAGE = re.compile(
    r"(?:"
    r"no audience\.\s+[Tt]he body arrives|"
    r"(?:^|\s)Pure body sensation|"
    r"(?:^|\s)Present tense|"
    r"\bno calculation\b"
    r")",
    re.I,
)

# Exact fragments (trailing punctuation stripped before comparison).
_FIFTH_PASS_EXACT_REJECT: frozenset = frozenset({
    "exists without a mask",
    "the caretaker scene",
    "a yearly tradition",
    "no exceptions",
    "before the conversation",
    "the scene does not say it",
})

# Sensory/concrete nouns that permit a sub-18-char item.
_FIFTH_PASS_SENSORY_NOUNS = re.compile(
    r"\b(?:barre|resin|popcorn|tights|cold|butter|grease|fried|perfume|"
    r"chanel|skin|floor|counter|shadow|smoke|wool|cotton|sugar|salt|"
    r"metal|leather|chalk|wax|starch|linen|cedar|pine|soap|rust|"
    r"throat|cheek|palm|breath|sweat|mist|cheek|shoulder|spine|"
    r"stomach|fingers?|mouth|feet|foot|hip|knee|wrist|tongue|"
    r"forehead|belly|ribs|ankle|elbow|heel)\b",
    re.I,
)

# Lowercase fragments are only kept when they start with "something [adj/noun]"
# (e.g. "something metallic, something like the inside of a cheek…").
# Any other lowercase start is rejected — narrative/agent lines that happen
# to contain a body-part word ("inside the throat before the door closes")
# are NOT sensory fragments.
_FIFTH_PASS_SENSORY_FRAGMENT_START = re.compile(r"^something\s+\S", re.I)

# Agent / character-action signals that disqualify a fragment from
# the "something …" lowercase exception.
_FIFTH_PASS_AGENT_ACTION = re.compile(
    r"\b(?:the\s+caretaker\b|before\s+the\s+door\b|"
    r"before\s+(?:she|he|they)\b|"
    r"(?:she|he|they|her|him)\s+\w+s?\b)",
    re.I,
)


def _fifth_pass_reject(item: str) -> bool:
    """Return True if item must be removed in the fifth-pass cleanup."""
    t = item.strip()
    if not t:
        return True

    # Exact-match check (normalise trailing punctuation)
    t_norm = re.sub(r"[.!?,;]+$", "", t.lower().strip())
    if t_norm in _FIFTH_PASS_EXACT_REJECT:
        return True

    # Starts lowercase: only genuine "something [adj/noun] …" sensory fragments
    # are allowed. Narrative or conceptual lines that happen to mention a body
    # part (e.g. "inside the throat before the door closes behind her.") are NOT
    # deliberate sensory fragments and must be rejected.
    if t[0].islower():
        is_sensory_fragment = (
            bool(_FIFTH_PASS_SENSORY_FRAGMENT_START.match(t))
            and not bool(_FIFTH_PASS_AGENT_ACTION.search(t))
        )
        if not is_sensory_fragment:
            return True

    # Under 18 chars without a sensory noun
    if len(t) < 18 and not _FIFTH_PASS_SENSORY_NOUNS.search(t):
        return True

    # Ends with dangling phrase (no terminal period required for "between"/"for";
    # "the body" only flagged without period — complete sentences like
    # "The yes leaves the body." are intentionally preserved).
    if _FIFTH_PASS_DANGLING_END.search(t):
        return True

    # Unmatched opening curly quote
    if t.count('\u201c') > t.count('\u201d'):
        return True

    # Meta / structural markers
    if _FIFTH_PASS_META_CONTAINS.search(t):
        return True

    # Exposition / memory-summary lines
    if _FIFTH_PASS_EXPOSITION_CONTAINS.search(t):
        return True

    # Register leakage
    if _FIFTH_PASS_REGISTER_LEAKAGE.search(t):
        return True

    return False


# ---------------------------------------------------------------------------
# Warning patterns — matched against individual clauses
# ---------------------------------------------------------------------------

_WARNING_PATTERNS = [
    re.compile(r"^(?:[^\w]*)?(Do\s+not\s+.{3,})", re.I),
    re.compile(r"^(?:[^\w]*)?(Do\s+NOT\s+.{3,})", re.I),
    re.compile(r"^(?:[^\w]*)?(DO\s+NOT\s+.{3,})"),
    re.compile(r"^(?:[^\w]*)?(Never\s+.{3,})", re.I),
    re.compile(r"^(?:[^\w]*)?(NEVER\s+NAMED.*)"),
    # "No date. February 13, 2003..." — specific full-sentence pattern (MUST come before general No [word])
    re.compile(r"^(No date\..{4,})", re.I),
    # General "No [word]" — negative lookahead prevents matching when more sentence follows
    re.compile(r"^(?:[^\w]*)?(No\s+(?:interiority|audience|explanation|performance|calculation|date|name|sentiment)(?!\.\s+[A-Z])[^.]*\.?)", re.I),
    re.compile(r"^(?:[^\w]*)?(Write (?:her|him|them|the \w+) without\s+.{3,})", re.I),
    re.compile(r"^(?:[^\w]*)?(Write without\s+.{3,})", re.I),
    re.compile(r"^(?:[^\w]*)?((?:Do not|Never)\s+write.{3,}(?:villain|dramatiz|sentimentali).{0,80})", re.I),
    re.compile(r"^(?:[^\w]*)?((?:parents?|caretaker|figure)\s+(?:not|are not|never)\s+(?:villain|dramatiz).{0,80})", re.I),
    re.compile(r"^(No (?:performance|calculation|audience|interiority|explanation|naming|date)\.?\s*)$", re.I),
]

# ---------------------------------------------------------------------------
# Body / pressure / end-beat word lists
# ---------------------------------------------------------------------------

_BODY_WORDS = re.compile(
    r"\b(hand|hands|throat|jaw|shoulder|shoulders|breath|breathing|spine|"
    r"stomach|chest|fingers|finger|mouth|skin|body|feet|foot|carpet|barre|"
    r"floor|hip|hips|knee|knees|wrist|eye|eyes|face|neck|back|arm|arms|"
    r"tongue|teeth|forehead|temple|belly|ribs|collarbone|ankle|elbow|"
    r"weight|swallow|exhale|inhale|tighten|loosen|stiffen|clench|"
    r"palm|tights|resin|cheek|heel|heels)\b",
    re.I,
)

_PRESSURE_WORDS = re.compile(
    r"\b(pressure|shift|crack|tension|escalat|"
    r"softens?|hardens?|tightens?|releases?|pauses?|gap|"
    r"drops?|rises?|lowers?|raises?|cold|heat|warms?|steady|unsteady|"
    r"resists?|surrenders?|holds?|held|let go|overflows?|spills?)\b",
    re.I,
)

_END_BEAT_WORDS = re.compile(
    r"\b(endpoint|end point|end the beat|closes?|stops?|stopped|still|"
    r"stillness|settles?|settled|done|finish|final|last|"
    r"exits?|leaves?|empties|emptied|absence|empty|gone|"
    r"after\b|what the body does after)\b",
    re.I,
)

# ---------------------------------------------------------------------------
# Clause splitter
# ---------------------------------------------------------------------------

_EMDASH_WARN_SPLIT = re.compile(
    r"\s*[\u2014\u2013\-]{1,2}\s*(?="
    r"(?:Do\s+not|Do\s+NOT|Never|No\s+(?:interiority|audience|explanation|"
    r"performance|calculation|date|name|sentiment)|Write\s+(?:her|him|without))"
    r"\b)",
    re.I,
)

_SENT_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")

_WARN_START = re.compile(
    r"^(?:Do\s+not|Do\s+NOT|DO\s+NOT|Never|NEVER|"
    r"No\s+(?:interiority|audience|explanation|performance|calculation|date|name|sentiment)|"
    r"Write\s+(?:her|him|them|the\s+\w+|without))\b",
    re.I,
)


def split_into_clauses(text: str) -> list:
    if not text or not text.strip():
        return []

    all_clauses = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        content = re.sub(r"^\d+\.\s+", "", line)
        content = re.sub(r"^[—\-\u2014•*]\s+", "", content).strip()
        if not content:
            continue

        if _WARN_START.match(content):
            if len(content) >= 4:
                all_clauses.append(content)
            continue

        parts = _EMDASH_WARN_SPLIT.split(content)
        for part in parts:
            part = part.strip()
            if not part:
                continue
            if _WARN_START.match(part):
                if len(part) >= 4:
                    all_clauses.append(part)
                continue
            for s in _SENT_BOUNDARY.split(part):
                s = s.strip()
                if len(s) >= 4:
                    all_clauses.append(s)

    seen = set()
    result = []
    for c in all_clauses:
        k = c.lower().strip()
        if k not in seen:
            seen.add(k)
            result.append(c)
    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def clean(s: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", str(s or "").strip())


def normalize_bullet(s: str) -> str:
    return re.sub(r"^[\s\u2014\-•*\d.]+", "", s).strip()


def parse_json_list(value) -> list:
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


def parse_stuck_bank(value) -> dict:
    if not value:
        return {k: [] for k in EMPTY_STUCK_BANK}
    s = str(value).strip()
    if not s or s in ("{}", ""):
        return {k: [] for k in EMPTY_STUCK_BANK}
    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            return {k: (obj.get(k) if isinstance(obj.get(k), list) else [])
                    for k in EMPTY_STUCK_BANK}
    except Exception:
        pass
    return {k: [] for k in EMPTY_STUCK_BANK}


# ---------------------------------------------------------------------------
# Per-clause classification
# ---------------------------------------------------------------------------

def _cap(s: str) -> str:
    s = s.strip()
    return s[0].upper() + s[1:] if s else s


def is_warning(clause: str) -> tuple:
    """Return (True, normalized_text) if clause is an explicit prohibition."""
    c = normalize_bullet(clause.strip())
    for pat in _WARNING_PATTERNS:
        for candidate in (c, clause.strip()):
            m = pat.match(candidate)
            if m:
                return True, _cap(clean(m.group(1)))
    return False, ""


def _extract_warning_from_malformed(entry: str) -> tuple:
    """
    For malformed dndt entries like "no audience. The body arrives at..."
    try to extract just the leading warning clause.
    Returns (True, normalized_text) on success, (False, "") otherwise.
    """
    # First try the whole entry
    flag, warn_text = is_warning(entry)
    if flag and warn_text:
        return flag, warn_text

    # Try first sentence only (text before the first ". " followed by capital)
    first = re.split(r"\.\s+[A-Z]", entry.strip())[0].strip()
    if first and first != entry.strip():
        # Ensure it ends with a period
        candidate = first if first.endswith(".") else first + "."
        flag2, warn_text2 = is_warning(candidate)
        if flag2 and warn_text2:
            return flag2, warn_text2

    return False, ""


def is_hard_reject(clause: str) -> bool:
    t = clause.strip()

    # Global minimum length (fourth pass: raised from 4 to 12)
    if not t or len(t) < 12:
        return True

    if _HARD_REJECT_PREFIX.match(t):
        return True
    if _HARD_REJECT_CONTAINS.search(t):
        return True

    # All-caps label at start (even with lowercase trailing text, e.g. "SENSORY CONSTANTS (locked…)")
    if re.match(r"^[A-Z]{2}[A-Z\s]{1,}[:\s(—]", t):
        return True

    # Bare all-caps section label (original check, kept)
    if re.match(r"^[A-Z][A-Z\s/\-]{3,}:?\s*$", t):
        return True

    # Numbered track/directive label with no usable prose after colon
    if re.match(r"^\d+\.\s*[A-Z][a-z]+ (track|directive)[:\s]", t, re.I):
        return True

    # Incomplete / dangling fragment endings
    if _DANGLING_END.search(t):
        return True

    # Short abstract pronoun phrases without physical anchor (e.g. "She has regretted", "They are not")
    if (re.match(r"^(?:She|He|They|It|This|That)\s+\w+\s+\w+\s*$", t, re.I)
            and not _BODY_WORDS.search(t)
            and not _PRESSURE_WORDS.search(t)):
        return True

    # "Their/His/Her X" — possessive + single noun, no verb (e.g. "Their love")
    if re.match(r"^(?:Their|His|Her)\s+\w+\s*$", t, re.I):
        return True

    # "The X" — article + single noun, no verb (e.g. "The decorations")
    if re.match(r"^The\s+\w+\s*$", t, re.I):
        return True

    return False


def is_too_long_non_prose(clause: str) -> bool:
    t = clause.strip()
    if len(t) <= 220:
        return False
    if re.search(r"[A-Z][A-Z /()''.:\-]{3,}:", t):
        return True
    if len(t) > 400:
        return True
    return False


def classify_clause(clause: str) -> str:
    flag, _ = is_warning(clause)
    if flag:
        return "warning"
    if is_hard_reject(clause):
        return "reject"
    if is_too_long_non_prose(clause):
        return "reject"

    t = clause.strip()
    body_n     = len(_BODY_WORDS.findall(t))
    pressure_n = len(_PRESSURE_WORDS.findall(t))
    end_n      = len(_END_BEAT_WORDS.findall(t))

    if body_n >= 1 and len(t) <= 160:
        return "move_the_body"
    if end_n >= 1 and len(t) <= 130:
        return "end_the_beat"
    if pressure_n >= 1 and len(t) <= 160:
        return "change_the_pressure"
    if (len(t) <= 80
            and not t.endswith((".", "?", "!"))
            and re.match(r"^[A-Za-z]", t)):
        return "start_a_sentence"
    return "use_a_line"


# ---------------------------------------------------------------------------
# Source text → raw chunks for splitting
# ---------------------------------------------------------------------------

def _raw_chunks_from_block(text: str) -> list:
    chunks = []

    for line in text.splitlines():
        s = line.strip()
        if re.match(r"^\d+\.\s+\S", s) or re.match(r"^[—\-\u2014•*]\s+\S", s):
            chunks.append(s)

    for m in re.finditer(
        r"^(?:REGISTER|SOURCE|END)[:\s]+(.+?)(?=\n[A-Z]|\n\n|\Z)",
        text, re.M | re.S,
    ):
        val = m.group(1).strip()
        if val and len(val) <= 400:
            chunks.append(val)

    for m in re.finditer(
        r"^CUP STATE[:\s]+(.+?)(?=\n[A-Z][A-Z /]{2,}:|\n\n|\Z)",
        text, re.M | re.S,
    ):
        val = m.group(1).strip()
        if val and len(val) <= 300:
            chunks.append(val)

    for m in re.finditer(
        r"^TRACKS[:\s]+(.+?)(?=\n[A-Z][A-Z /]{2,}:|\n\n|\Z)",
        text, re.M | re.S,
    ):
        for subline in m.group(1).splitlines():
            sub = subline.strip()
            if not sub:
                continue
            bm = re.match(r"body track\s*[\u2014\-:\s]+(.+)", sub, re.I)
            chunks.append(bm.group(1).strip() if bm else sub)

    for m in re.finditer(
        r"^CRAFT DIRECTIVES[:\s]*\n(.*?)(?=\n[A-Z][A-Z /]{2,}:|\n\n\n|\Z)",
        text, re.M | re.S,
    ):
        for line in m.group(1).splitlines():
            line = line.strip()
            if re.match(r"^\d+\.\s+\S", line):
                chunks.append(line)

    for m in re.finditer(
        r"^RULES[:\s]*\n(.*?)(?=\n[A-Z][A-Z /]{2,}:|\n\n\n|\Z)",
        text, re.M | re.S,
    ):
        for line in m.group(1).splitlines():
            line = line.strip()
            if line and (re.match(r"^[—\-\u2014•*]\s+\S", line)
                         or re.match(r"^\d+\.\s+\S", line)):
                chunks.append(line)

    return chunks


def _dedupe_clauses(raw_chunks: list) -> list:
    all_clauses = []
    for chunk in raw_chunks:
        all_clauses.extend(split_into_clauses(chunk))

    seen = set()
    result = []
    for c in all_clauses:
        k = c.lower().strip()
        if k and k not in seen:
            seen.add(k)
            result.append(c)
    return result


def collect_existing_stuck_clauses(scene: dict) -> list:
    """
    Stuck-bank content must come only from existing rescue content,
    not from notes/rules/starter prompts.

    Reason: starter prompts contain source locks, rules, register notes,
    and structural guidance. Those are useful for do_not_do_this, but they
    make bad I’M STUCK options.
    """
    raw_chunks = []

    bank = parse_stuck_bank(scene.get("stuck_bank"))
    for bucket_items in bank.values():
        raw_chunks.extend(bucket_items)

    raw_chunks.extend(parse_json_list(scene.get("stuck_options")))

    return _dedupe_clauses(raw_chunks)


def collect_guidance_warning_clauses(scene: dict) -> list:
    """
    Guidance text may still be mined for explicit warnings only.
    Non-warning clauses from notes/rules must never populate stuck_bank.
    """
    raw_chunks = []

    rule_text = str(scene.get("rule") or "")
    if rule_text:
        raw_chunks.extend(_raw_chunks_from_block(rule_text))
        raw_chunks.append(rule_text)

    notes_text = str(scene.get("notes") or "")
    if notes_text:
        starter_m = re.search(r"STARTER PROMPT[:\s]*\n(.*)", notes_text, re.S)
        section = starter_m.group(1) if starter_m else notes_text
        raw_chunks.extend(_raw_chunks_from_block(section))
        raw_chunks.append(section)

    return _dedupe_clauses(raw_chunks)


# ---------------------------------------------------------------------------
# Per-scene refinement
# ---------------------------------------------------------------------------

def refine_scene(scene: dict):
    existing_dndt = parse_json_list(scene.get("do_not_do_this"))
    existing_bank = parse_stuck_bank(scene.get("stuck_bank"))

    stuck_clauses = collect_existing_stuck_clauses(scene)
    guidance_warning_clauses = collect_guidance_warning_clauses(scene)

    new_use_a_line      = []
    new_start_sentence  = []
    new_move_body       = []
    new_change_pressure = []
    new_end_beat        = []

    def _wkey(s):
        return re.sub(r"[.,;:!?]+$", "", s.strip().lower())

    # ----------------------------------------------------------------
    # Clean existing do_not_do_this entries.
    # Malformed entries like "no audience. The body arrives at..."
    # are trimmed to just the leading warning clause.
    # Then subsumption is applied across the cleaned set so that
    # "No audience." is dropped when "No performance, no calculation,
    # no audience." is already present.
    # ----------------------------------------------------------------
    cleaned_existing = []  # list of (wkey, normalized_text)
    for entry in existing_dndt:
        flag, warn_text = _extract_warning_from_malformed(entry)
        if flag and warn_text:
            normalized = warn_text
        else:
            normalized = entry.strip()
        k = _wkey(normalized)
        if k:
            cleaned_existing.append((k, normalized))

    # Deduplicate cleaned entries, then apply subsumption
    seen_clean_keys = set()
    deduped_existing = []
    for k, normalized in cleaned_existing:
        if k not in seen_clean_keys:
            seen_clean_keys.add(k)
            deduped_existing.append((k, normalized))

    seen_warn = set()
    new_warnings = []
    all_existing_keys = [k for k, _ in deduped_existing]
    for k, normalized in deduped_existing:
        is_subsumed = any(
            ek != k and re.search(r"\b" + re.escape(k) + r"\b", ek)
            for ek in all_existing_keys
        )
        if not is_subsumed:
            seen_warn.add(k)
            new_warnings.append(normalized)

    seen_stuck = set()

    # Mine notes/rules/starter prompts for warnings only.
    # They must not feed I’M STUCK.
    for clause in guidance_warning_clauses:
        flag, warn_text = is_warning(clause)
        if not flag:
            continue
        normalized = warn_text if warn_text else _cap(normalize_bullet(clause))
        k = _wkey(normalized)
        if k not in seen_warn:
            is_subsumed = any(
                re.search(r"\b" + re.escape(k) + r"\b", ek)
                for ek in seen_warn
            )
            if not is_subsumed:
                seen_warn.add(k)
                new_warnings.append(normalized)

    # Reclassify/clean only existing rescue material.
    for clause in stuck_clauses:
        bucket = classify_clause(clause)

        if bucket in ("warning", "reject"):
            continue

        k = clause.strip().lower()
        if k in seen_stuck:
            continue
        seen_stuck.add(k)

        if bucket == "move_the_body":
            new_move_body.append(clause)
        elif bucket == "end_the_beat":
            new_end_beat.append(clause)
        elif bucket == "change_the_pressure":
            new_change_pressure.append(clause)
        elif bucket == "start_a_sentence":
            new_start_sentence.append(clause)
        else:
            new_use_a_line.append(clause)

    new_bank = {
        "use_a_line":          new_use_a_line,
        "start_a_sentence":    new_start_sentence,
        "move_the_body":       new_move_body,
        "change_the_pressure": new_change_pressure,
        "end_the_beat":        new_end_beat,
    }

    # ----------------------------------------------------------------
    # Fifth-pass: strict cleanup — remove junk/meta/exposition/register
    # fragments from every stuck_bank bucket before saving.
    # ----------------------------------------------------------------
    for _bk in list(new_bank.keys()):
        new_bank[_bk] = [
            item for item in new_bank[_bk]
            if not _fifth_pass_reject(item)
        ]

    def _bank_eq(a, b):
        return all(sorted(a.get(k, [])) == sorted(b.get(k, [])) for k in EMPTY_STUCK_BANK)

    dndt_changed = sorted(new_warnings) != sorted(existing_dndt)
    # Long-term guardrail:
    # This refine script may clean/update do_not_do_this, but it must NOT
    # rewrite stuck_bank. I’M STUCK rescue options need a separate shaping
    # script because starter prompts/source notes do not equal usable rescues.
    bank_changed = False

    if not dndt_changed and not bank_changed:
        return None

    result = {}
    if dndt_changed:
        result["do_not_do_this"] = json.dumps(new_warnings, ensure_ascii=False)
    # stuck_bank intentionally frozen here.
    # Use a dedicated rescue-bank shaping script for I’M STUCK updates.
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if not os.path.exists(DB_PATH):
        raise SystemExit(f"Database not found: {DB_PATH}")

    timestamp   = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = f"{DB_PATH}.pre_refine5_{timestamp}"
    shutil.copy2(DB_PATH, backup_path)
    print(f"Backup created: {backup_path}\n")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur  = conn.cursor()

    cur.execute("SELECT * FROM scenes")
    scenes = [dict(r) for r in cur.fetchall()]

    stats = dict(total=len(scenes), updated=0, dndt=0, bank=0)

    for scene in scenes:
        updates = refine_scene(scene)
        if updates is None:
            continue
        set_clause = ", ".join(f"{k}=?" for k in updates)
        cur.execute(
            f"UPDATE scenes SET {set_clause}, updated_at=datetime('now') WHERE id=?",
            list(updates.values()) + [scene["id"]],
        )
        stats["updated"] += 1
        if "do_not_do_this" in updates: stats["dndt"] += 1
        if "stuck_bank"     in updates: stats["bank"] += 1

    conn.commit()
    print(f"Refinement complete.")
    print(f"  Scenes processed:       {stats['total']}")
    print(f"  Scenes updated:         {stats['updated']}")
    print(f"  do_not_do_this updated: {stats['dndt']}")
    print(f"  stuck_bank updated:     {stats['bank']}\n")

    # ---- Verification ----
    print("=" * 60)
    print("VERIFICATION")
    print("=" * 60)

    seen_ids = set()
    for id_pat in ["%PROLOGUE%", "%NEW-1A%"]:
        cur.execute(
            "SELECT id, title, source_anchor, dont_forget, do_not_do_this, stuck_bank "
            "FROM scenes WHERE id LIKE ? LIMIT 1",
            (id_pat,),
        )
        row = cur.fetchone()
        if not row or row["id"] in seen_ids:
            continue
        seen_ids.add(row["id"])

        bank = parse_stuck_bank(row["stuck_bank"])
        dndt = parse_json_list(row["do_not_do_this"])
        print(f"\n--- {row['id']} / {row['title']} ---")
        print(f"  source_anchor:  {repr(row['source_anchor'])}")
        print(f"  dont_forget:    {repr((row['dont_forget'] or '')[:100])}")
        print(f"  do_not_do_this ({len(dndt)} items):")
        for w in dndt:
            print(f"    • {w}")
        for bucket in EMPTY_STUCK_BANK:
            items = bank.get(bucket, [])
            print(f"  stuck_bank.{bucket} ({len(items)} items):")
            for item in items[:8]:
                print(f"    – {item[:110]}")
            if len(items) > 8:
                print(f"    … +{len(items)-8} more")

    print()
    conn.close()


if __name__ == "__main__":
    main()
