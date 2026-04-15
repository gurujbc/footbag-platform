#!/usr/bin/env python3
"""
06b_mine_noise_v2.py — Noise Mining v2

Fixes over v1 (06_mine_noise_features.py):
  1. Span masking: compound tricks consume their character range before shorter
     sub-patterns are tried, eliminating substring inflation.
  2. Line classification: division headers, prose, and score-only lines are
     classified before extraction and only eligible classes are mined.
  3. Score type classification: rejects all-caps division words, classifies
     numeric scores into freestyle_judging / consecutive_count / golf_score /
     raw_integer / reject.
  4. Context-window attribution: a rolling deque of the last 2 resolved persons
     is used to attribute tricks that appear on separate continuation lines.
  5. Doubles attribution: both names extracted; team_flag=True in output.
  6. Masked collision recording: suppressed-by-longer counts per trick.
  7. Trick sequence table: ordered trick chains split on > / · / ,
"""
from __future__ import annotations

import argparse
import ast
import csv
import json
import re
import unicodedata
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

import pandas as pd


# ─────────────────────────────────────────────
# Normalization helpers (unchanged from v1)
# ─────────────────────────────────────────────

def strip_accents(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in text if not unicodedata.combining(ch))


def norm_space(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("\xa0", " ")).strip()


def norm_key(text: str) -> str:
    text = strip_accents(norm_space(text)).lower()
    text = re.sub(r"[^a-z0-9\s\-/']", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def presentable_name(text: str) -> str:
    return norm_space(text).strip(" -–—:;,.()[]{}")


# ─────────────────────────────────────────────
# Data containers
# ─────────────────────────────────────────────

@dataclass
class PersonMatch:
    person_id: Optional[str]
    person_canon: Optional[str]
    match_type: str   # exact / unresolved / none
    matched_on: Optional[str]


@dataclass
class RecentPlacement:
    """One entry in the rolling context window."""
    person_id: Optional[str]
    person_canon: Optional[str]
    match_type: str
    name_raw: Optional[str]


# ─────────────────────────────────────────────
# Persons index (unchanged from v1)
# ─────────────────────────────────────────────

def parse_aliases_cell(value) -> list[str]:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return []
    if isinstance(value, list):
        return [str(x) for x in value if str(x).strip()]
    s = str(value).strip()
    if not s:
        return []
    if s.startswith("[") and s.endswith("]"):
        try:
            parsed = ast.literal_eval(s)
            if isinstance(parsed, list):
                return [str(x) for x in parsed if str(x).strip()]
        except Exception:
            pass
    parts = re.split(r"[|;]+", s)
    return [p.strip() for p in parts if p.strip()]


def build_person_index(
    persons_df: pd.DataFrame,
    extra_aliases_path: Optional[Path] = None,
) -> tuple[dict[str, tuple[str, str]], dict[str, list[str]]]:
    """
    Build name → (person_id, person_canon) lookup from Persons_Truth.

    Optional extra_aliases_path: path to a CSV with columns [alias, person_canon]
    providing noise-miner-specific name variants (e.g. "Erik Chan" → "Eric Chan")
    without modifying the canonical identity files.
    """
    exact_name_index: dict[str, tuple[str, str]] = {}
    collisions: dict[str, list[str]] = defaultdict(list)

    person_id_col = None
    for c in ["effective_person_id", "person_id", "canonical_person_id"]:
        if c in persons_df.columns:
            person_id_col = c
            break
    if person_id_col is None:
        raise ValueError("Could not find person ID column in persons file.")

    person_name_col = None
    for c in ["person_canon", "player_name", "person_name", "canonical_name"]:
        if c in persons_df.columns:
            person_name_col = c
            break
    if person_name_col is None:
        raise ValueError("Could not find canonical person name column in persons file.")

    alias_cols = [
        c for c in ["aliases_presentable", "aliases", "player_names_seen", "player_ids_seen"]
        if c in persons_df.columns
    ]

    temp_index: dict[str, list[tuple[str, str]]] = defaultdict(list)

    # Build canon_lookup: person_canon → (pid, canon) for alias resolution
    canon_lookup: dict[str, tuple[str, str]] = {}
    for _, row in persons_df.iterrows():
        pid = str(row[person_id_col]).strip()
        canon = str(row[person_name_col]).strip()
        if not pid or not canon:
            continue
        canon_key = norm_key(canon)
        if canon_key:
            temp_index[canon_key].append((pid, canon))
            canon_lookup[canon_key] = (pid, canon)
        for alias_col in alias_cols:
            for alias in parse_aliases_cell(row.get(alias_col)):
                alias_key = norm_key(alias)
                if alias_key:
                    temp_index[alias_key].append((pid, canon))

    # Load extra noise-miner aliases (alias → person_canon)
    if extra_aliases_path and extra_aliases_path.exists():
        extra_df = pd.read_csv(extra_aliases_path)
        if "alias" in extra_df.columns and "person_canon" in extra_df.columns:
            for _, row in extra_df.iterrows():
                alias = str(row["alias"]).strip()
                target_canon = str(row["person_canon"]).strip()
                alias_key  = norm_key(alias)
                target_key = norm_key(target_canon)
                if alias_key and target_key and target_key in canon_lookup:
                    pid, canon = canon_lookup[target_key]
                    temp_index[alias_key].append((pid, canon))

    for k, vals in temp_index.items():
        uniq = list({(pid, canon) for pid, canon in vals})
        if len(uniq) == 1:
            exact_name_index[k] = uniq[0]
        else:
            collisions[k] = [pid for pid, _ in uniq]

    return exact_name_index, collisions


def safe_match_person(
    name: str,
    exact_name_index: dict[str, tuple[str, str]],
    collisions: dict[str, list[str]],
) -> PersonMatch:
    nk = norm_key(name)
    if not nk:
        return PersonMatch(None, None, "none", None)
    if nk in collisions:
        return PersonMatch(None, None, "unresolved", name)
    if nk in exact_name_index:
        pid, canon = exact_name_index[nk]
        return PersonMatch(pid, canon, "exact", name)

    # Progressive fallback: strip trailing country-code / annotation suffix.
    # Only applied when raw name has 3+ tokens; first 2 tokens tried as the name.
    # Collision-checked to prevent false matches on ambiguous short forms.
    words = nk.split()
    if len(words) >= 3:
        short_key = " ".join(words[:2])
        if short_key in exact_name_index and short_key not in collisions:
            pid, canon = exact_name_index[short_key]
            return PersonMatch(pid, canon, "exact", name)

    return PersonMatch(None, None, "unresolved", name)


# ─────────────────────────────────────────────
# Trick lexicon (unchanged from v1)
# ─────────────────────────────────────────────

DEFAULT_TRICKS = [
    # ── 2-ADD base tricks ──────────────────────────────────────────────────
    "clipper", "mirage", "legover", "pickup", "pixie", "guay",
    # ── 3-ADD named/compound tricks ────────────────────────────────────────
    "whirl", "butterfly", "swirl", "osis", "eclipse",
    "eggbeater", "drifter", "smear", "flurry",
    "rev whirl", "revup",
    "ducking clipper", "spinning clipper",
    "ducking mirage",           # ducking + mirage = 3 ADD
    "paradox mirage",           # paradox + mirage = 3 ADD
    # ── 4-ADD named/compound tricks ────────────────────────────────────────
    "torque", "ripwalk", "blur", "atom smasher", "atomsmasher",
    "blender", "dimwalk", "parkwalk", "barfly",
    "ducking butterfly", "spinning butterfly",   # absorbs standalone modifier tokens
    "spinning osis", "ducking osis",             # absorbs standalone modifier tokens
    "spinning mirage",                           # absorbs standalone modifier tokens
    "stepping butterfly",                        # 4 ADD; named Sidewalk
    "stepping drifter",                          # 4 ADD; named Tombstone
    "atomic butterfly",                          # 4 ADD; named Leg Beater
    "atomic osis",                               # 4 ADD
    "gyro whirl",                                # 4 ADD; absorbs standalone gyro tokens
    "gyro butterfly",                            # 4 ADD; absorbs standalone gyro tokens
    "symposium whirl",
    "symposium dlo",                             # 4 ADD; named Nova
    "paradox whirl", "paradox drifter",
    "tapping whirl",
    # ── 5-ADD named/compound tricks ────────────────────────────────────────
    "blurry whirl", "blurriest", "fog",
    "mobius", "fusion", "tomahawk", "superfly",
    "paradox torque", "paradox blender",
    "spinning whirl",
    "paradox symposium whirl",                   # PS Whirl = 5 ADD
    "paradox symposium mirage",                  # PS Mirage = 4 ADD (listed in 4-ADD)
    # ── 6-ADD named/compound tricks ────────────────────────────────────────
    "food processor",
    "blurry symposium whirl",                    # 6 ADD; high-freq in sequences
    # ── Modifier-only tokens (kept for standalone mentions) ─────────────────
    "atomic", "stepping", "ducking", "spinning", "symposium",
    "gyro", "barraging", "blazing", "tapping",
    "paradox",
    # ── Misc ────────────────────────────────────────────────────────────────
    "double around the world", "double around-the-world",
]

GENERIC_NON_TRICK_TERMS = {
    "men", "women", "open", "novice", "intermediate", "final", "semifinal",
    "routine", "freestyle", "net", "golf", "distance", "accuracy",
    "shred", "sick", "circle", "qualification", "qualifier", "finals",
}

# Division-level words that should cause score name_raw rejection
DIVISION_WORDS = {
    "OPEN", "SHRED", "SICK", "NOVICE", "INTERMEDIATE", "FINALS", "FINAL",
    "SEMIFINALS", "SEMIFINAL", "CONTEST", "DIVISION", "WOMEN", "MEN",
    "DOUBLES", "SINGLES", "MIXED", "FREESTYLE", "NET", "GOLF",
}

# Trick chain separators
CHAIN_SEP_RE = re.compile(r"\s*[>·,]\s*")


def load_trick_lexicon(
    path: Optional[Path],
    alias_path: Optional[Path] = None,
) -> tuple[list[str], dict[str, str]]:
    """Returns (sorted_tricks, alias_map)."""
    tricks: set[str] = set(DEFAULT_TRICKS)
    alias_map: dict[str, str] = {}

    if path and path.exists():
        df = pd.read_csv(path)
        col = None
        for c in ["trick", "trick_name", "name"]:
            if c in df.columns:
                col = c
                break
        if col is None:
            raise ValueError("Trick lexicon CSV must contain one of: trick, trick_name, name")
        for v in df[col].dropna():
            vv = str(v).strip()
            if vv:
                tricks.add(vv)

    if alias_path and alias_path.exists():
        df = pd.read_csv(alias_path)
        if "alias" in df.columns and "trick_canon" in df.columns:
            for _, row in df.iterrows():
                a = str(row["alias"]).strip()
                c = str(row["trick_canon"]).strip()
                if a and c:
                    alias_map[a.lower()] = c
                    tricks.add(c)  # ensure canonical form is in lexicon

    sorted_tricks = sorted(tricks, key=lambda s: (-len(s), s.lower()))
    return sorted_tricks, alias_map


def compile_trick_patterns(tricks: list[str]) -> list[tuple[str, re.Pattern]]:
    """Sort longest-first; each pattern is word-boundary anchored."""
    compiled = []
    for trick in tricks:
        pat = re.compile(
            rf"(?<![A-Za-z0-9]){re.escape(trick)}(?![A-Za-z0-9])",
            re.IGNORECASE,
        )
        compiled.append((trick, pat))
    return compiled


# ─────────────────────────────────────────────
# Regex constants for classification
# ─────────────────────────────────────────────

PLACEMENT_LINE_RE = re.compile(
    r"""^\s*
    (?P<place>\d{1,3})                              # placement number
    (?:[.\)]|(?:st|nd|rd|th)[.:\s]|\s*-\s*)\s*     # separator: "." ")" "st:" "nd " "1-" "1 - " etc.
    (?P<name>[A-Za-zÀ-ÿ0-9''.\-\/ ]{2,60}?)        # name — non-greedy, stops before comma/paren
    (?:\s*[,\(][^-–—:]*)?                           # optional city/country/parens — consumed silently
    (?:\s*[-–—:]\s*(?P<tail>.*))?                   # optional tail after dash/colon
    \s*$
    """,
    re.VERBOSE,
)

# Fallback for bare "1 Name ..." format (no punctuation after number).
# Only matches 2-word names (First Last) to avoid absorbing trick tokens.
BARE_NUMBERED_RE = re.compile(
    r"""^\s*
    (?P<place>\d{1,3})\s+
    (?P<name>[A-ZÀ-Ö][A-Za-zÀ-ÿ''\-]+\s+[A-Za-zÀ-ÿ''\-]{2,})
    (?=\s|$)
    """,
    re.VERBOSE,
)

# Detect "Name - score" or "Name: score" patterns
NAME_SCORE_RE = re.compile(
    r"""(?P<name>[A-Z][A-Za-zÀ-ÿ''.\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ''.\-]+){0,3})
        \s*[-–—:]\s*
        (?P<score>\d{1,3}(?:\.\d{1,3})?)
    """,
    re.VERBOSE,
)

SCORE_ONLY_RE = re.compile(r"\b(?P<score>\d{1,3}(?:\.\d{1,3})?)\b")
LIKELY_NAME_RE = re.compile(r"[A-Z][A-Za-zÀ-ÿ''.\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ''.\-]+){0,3}")

# ALL-CAPS line (after stripping punctuation) → likely a header
_ALL_CAPS_RE = re.compile(r"^[A-Z0-9\s\-:./()&,!?'\"]+$")
# Horizontal rule / separator lines
_RULE_RE = re.compile(r"^[-=*#_]{4,}$")
# URL detector
_URL_RE = re.compile(r"https?://|www\.")

# Doubles separators for name splitting
_DOUBLES_SEP_RE = re.compile(
    r"\s+(?:and|&|\+|/)\s+",
    re.IGNORECASE,
)


# ─────────────────────────────────────────────
# Stage A: Line classification
# ─────────────────────────────────────────────

def classify_line(
    line: str,
    compiled_tricks: list[tuple[str, re.Pattern]],
) -> str:
    """
    Returns one of:
      result_trick  — placement line containing ≥1 trick lexicon hit
      result_score  — placement line with numeric score + score-context keyword
      result_plain  — placement line, no tricks, no direct score
      trick_chain   — non-placement line with ≥1 lexicon hit
      header        — ALL-CAPS line or separator rule
      skip          — blank, URL, or unclassifiable
    """
    stripped = line.strip()
    if not stripped:
        return "skip"
    if _URL_RE.search(stripped):
        return "skip"
    if _RULE_RE.match(stripped):
        return "header"

    # strip punctuation for caps check, but keep letters/digits/spaces
    caps_check = re.sub(r"[^A-Z0-9\s]", "", stripped.upper())
    if caps_check and _ALL_CAPS_RE.match(stripped) and len(stripped) > 2:
        return "header"

    has_trick = any(pat.search(line) for _, pat in compiled_tricks)
    pm = _match_placement_line(line)

    if pm:
        if has_trick:
            return "result_trick"
        tail = (pm.groupdict().get("tail") or "") if pm else ""
        if SCORE_ONLY_RE.search(tail) and _looks_like_score_context(line):
            return "result_score"
        return "result_plain"

    if has_trick:
        return "trick_chain"

    return "skip"


def _looks_like_score_context(line: str) -> bool:
    lower = line.lower()
    keywords = [
        "score", "points", "final", "average", "technical", "artistic",
        "presentation", "execution", "routine", "freestyle", "shred", "sick 3",
    ]
    return any(k in lower for k in keywords) or bool(NAME_SCORE_RE.search(line))


# ─────────────────────────────────────────────
# Stage B: Span-masked trick extraction
# ─────────────────────────────────────────────

def extract_tricks_with_masking(
    line: str,
    compiled_tricks: list[tuple[str, re.Pattern]],
    alias_map: dict[str, str],
    masked_by_longer: Counter,
) -> list[dict]:
    """
    Match tricks longest-first with span masking.

    Returns list of dicts with keys:
      trick_canon, trick_raw, span_start, span_end
    """
    if not line:
        return []

    # Use a boolean mask over character positions
    mask = [False] * len(line)
    results: list[dict] = []
    lower = line.lower()

    for canon_trick, pat in compiled_tricks:
        if canon_trick.lower() in GENERIC_NON_TRICK_TERMS:
            continue

        for m in pat.finditer(line):
            start, end = m.start(), m.end()

            # Check if any position in this span is already masked
            if any(mask[start:end]):
                # This match is fully or partially covered by a longer match → count it
                masked_by_longer[alias_map.get(canon_trick.lower(), canon_trick)] += 1
                continue

            # Mark this span as consumed
            for i in range(start, end):
                mask[i] = True

            raw = m.group(0)
            canonical = alias_map.get(canon_trick.lower(), canon_trick)
            results.append({
                "trick_canon": canonical,
                "trick_raw": raw,
                "span_start": start,
                "span_end": end,
            })

    return results


# ─────────────────────────────────────────────
# Stage C: Score classification
# ─────────────────────────────────────────────

def classify_score(
    name_raw: str,
    score_raw: str,
    line: str,
    line_class: str,
) -> str:
    """
    Returns one of:
      freestyle_judging   — decimal score < 30 (e.g. 9.8, 18.5)
      consecutive_count   — integer > 100 with "consecutive" / "kicks" context
      distance_count      — line mentions pass/distance/meter
      golf_score          — golf context or low integer < 30 without decimal
      raw_integer         — anything remaining integer
      reject              — name looks like a division word or line class is invalid
    """
    if line_class in ("header", "skip"):
        return "reject"

    # Reject if name is a division word (all caps, known non-name)
    name_upper = (name_raw or "").strip().upper()
    name_tokens = re.split(r"\s+", name_upper)
    if all(t in DIVISION_WORDS for t in name_tokens if t):
        return "reject"

    # Reject short all-caps names that look like abbreviations / labels
    if name_upper == (name_raw or "").strip() and len(name_tokens) <= 2:
        # name_raw is all caps
        if name_raw and name_raw == name_raw.upper() and not any(c.islower() for c in name_raw):
            return "reject"

    lower = line.lower()

    try:
        val = float(score_raw)
    except (ValueError, TypeError):
        return "reject"

    if "." in str(score_raw):
        if val < 30:
            return "freestyle_judging"
        return "raw_integer"  # decimal > 30 is unusual but not clearly categorizable

    val_int = int(val)

    if val_int > 100 and ("consecutive" in lower or "kicks" in lower):
        return "consecutive_count"
    if "pass" in lower or "distance" in lower or "meter" in lower or "metre" in lower:
        return "distance_count"
    if "golf" in lower:
        return "golf_score"
    if val_int < 30:
        return "golf_score"
    return "raw_integer"


# ─────────────────────────────────────────────
# Person extraction helpers
# ─────────────────────────────────────────────

def _match_placement_line(line: str):
    """
    Try PLACEMENT_LINE_RE first; fall back to BARE_NUMBERED_RE.
    Returns the match object (with a 'name' group) or None.
    """
    m = PLACEMENT_LINE_RE.match(line)
    if m:
        return m
    return BARE_NUMBERED_RE.match(line)


def _extract_names_from_placement_line(line: str) -> tuple[str | None, str | None]:
    """
    Returns (name1, name2) for a placement line.
    name2 is non-None only for doubles.
    """
    pm = _match_placement_line(line)
    if not pm:
        return None, None

    name_field = presentable_name(pm.group("name"))

    # Check for doubles separator in name_field
    parts = _DOUBLES_SEP_RE.split(name_field, maxsplit=1)
    if len(parts) == 2:
        p1 = presentable_name(parts[0])
        p2 = presentable_name(parts[1])
        return p1, p2

    return name_field, None


def looks_like_person_name(s: str) -> bool:
    """
    Returns True if s looks like a person name (at least 2 alphabetic tokens).

    Tolerates trailing numeric suffixes like scores ("Arkadiusz Dudzinski 44.9")
    by requiring that at least 2 tokens start with a letter, not that ALL tokens do.
    """
    s = presentable_name(s)
    if not s or len(s) < 3:
        return False
    tokens = s.split()
    alpha_tokens = [t for t in tokens if t and t[0].isalpha()]
    if len(alpha_tokens) < 1:
        return False
    if len(tokens) == 1:
        return True  # single-word names (single-name players) accepted
    return len(alpha_tokens) >= 2


# ─────────────────────────────────────────────
# Stage D + E + F wired into main event loop
# ─────────────────────────────────────────────

def _make_trick_row_base(
    event_id, year, event_name, line_no, line, line_class,
    tm: dict,
    pm: PersonMatch,
    attribution_confidence: str,
    pm2: PersonMatch | None,
    team_flag: bool,
    context_snippet: str,
) -> dict:
    return {
        "event_id": event_id,
        "year": year,
        "event_name": event_name,
        "line_no": line_no,
        "line_raw": line,
        "line_class": line_class,
        "trick_raw": tm["trick_raw"],
        "trick_canon": tm["trick_canon"],
        "trick_category": "",  # filled by 07b
        "person_id": pm.person_id,
        "person_canon": pm.person_canon,
        "match_type": pm.match_type,
        "attribution_confidence": attribution_confidence,
        "person_id_2": pm2.person_id if pm2 else None,
        "person_canon_2": pm2.person_canon if pm2 else None,
        "team_flag": team_flag,
        "context_snippet": context_snippet,
    }


def mine_event(
    event_id,
    year,
    event_name,
    text: str,
    compiled_tricks: list[tuple[str, re.Pattern]],
    alias_map: dict[str, str],
    exact_name_index: dict[str, tuple[str, str]],
    collisions: dict[str, list[str]],
    # mutable accumulators
    trick_rows: list,
    score_rows: list,
    sequence_rows: list,
    unresolved_counter: Counter,
    masked_by_longer: Counter,
    # stats
    stats: dict,
) -> None:
    lines = [norm_space(x) for x in text.replace("\r\n", "\n").replace("\r", "\n").split("\n") if norm_space(x)]
    stats["lines_processed"] += len(lines)

    # Rolling context window: deque of last 2 resolved persons from result lines
    recent_placements: deque[RecentPlacement] = deque(maxlen=2)
    chain_id_counter = 0

    for line_no, line in enumerate(lines, start=1):
        line_class = classify_line(line, compiled_tricks)

        if line_class == "skip":
            stats["lines_skipped"] += 1
            continue
        if line_class == "header":
            stats["lines_skipped"] += 1
            continue

        # ── Score extraction ──────────────────────────────────────────────
        if line_class in ("result_score", "result_trick", "result_plain"):
            pm_line = _match_placement_line(line)
            if pm_line and pm_line.groupdict().get("tail"):
                tail = pm_line.group("tail")
                score_match = SCORE_ONLY_RE.search(tail)
                if score_match and _looks_like_score_context(line):
                    name_raw = presentable_name(pm_line.group("name"))
                    score_raw = score_match.group("score")
                    score_type = classify_score(name_raw, score_raw, line, line_class)
                    pm = safe_match_person(name_raw, exact_name_index, collisions)
                    filter_reason = "score_classifier_reject" if score_type == "reject" else ""
                    score_rows.append({
                        "event_id": event_id,
                        "year": year,
                        "event_name": event_name,
                        "line_no": line_no,
                        "line_raw": line,
                        "line_class": line_class,
                        "name_raw": name_raw,
                        "person_id": pm.person_id,
                        "person_canon": pm.person_canon,
                        "match_type": pm.match_type,
                        "score_raw": score_raw,
                        "score_value": pd.to_numeric(score_raw, errors="coerce"),
                        "score_type": score_type,
                        "extract_method": "placement_line_tail_score",
                        "filter_reason": filter_reason,
                    })
                    if score_type == "reject":
                        stats["scores_rejected"] += 1

            # Also check NAME_SCORE_RE (inline name–score pattern)
            for m in NAME_SCORE_RE.finditer(line):
                name_raw = presentable_name(m.group("name"))
                score_raw = m.group("score")
                score_type = classify_score(name_raw, score_raw, line, line_class)
                pm = safe_match_person(name_raw, exact_name_index, collisions)
                filter_reason = "score_classifier_reject" if score_type == "reject" else ""
                score_rows.append({
                    "event_id": event_id,
                    "year": year,
                    "event_name": event_name,
                    "line_no": line_no,
                    "line_raw": line,
                    "line_class": line_class,
                    "name_raw": name_raw,
                    "person_id": pm.person_id,
                    "person_canon": pm.person_canon,
                    "match_type": pm.match_type,
                    "score_raw": score_raw,
                    "score_value": pd.to_numeric(score_raw, errors="coerce"),
                    "score_type": score_type,
                    "extract_method": "name_score_inline",
                    "filter_reason": filter_reason,
                })
                if score_type == "reject":
                    stats["scores_rejected"] += 1
                if pm.match_type == "unresolved" and score_type != "reject":
                    unresolved_counter[name_raw] += 1

        # ── Trick extraction ──────────────────────────────────────────────
        if line_class in ("result_trick", "trick_chain"):
            trick_hits = extract_tricks_with_masking(line, compiled_tricks, alias_map, masked_by_longer)

            if not trick_hits:
                continue

            # Person attribution
            name1, name2 = _extract_names_from_placement_line(line)
            team_flag = name2 is not None
            attribution_confidence: str

            if name1 and looks_like_person_name(name1):
                pm1 = safe_match_person(name1, exact_name_index, collisions)
                attribution_confidence = "direct"
                if pm1.match_type == "unresolved":
                    unresolved_counter[name1] += 1
                pm2 = None
                if team_flag and looks_like_person_name(name2):
                    pm2 = safe_match_person(name2, exact_name_index, collisions)
                    if pm2.match_type == "unresolved":
                        unresolved_counter[name2] += 1
            elif line_class == "trick_chain" and recent_placements:
                # Context-window fallback
                rp = recent_placements[-1]
                pm1 = PersonMatch(rp.person_id, rp.person_canon, rp.match_type, rp.name_raw)
                pm2 = None
                team_flag = False
                attribution_confidence = "context_window"
            else:
                pm1 = PersonMatch(None, None, "none", None)
                pm2 = None
                attribution_confidence = "none"

            # Update rolling context window if this line has a direct name
            if attribution_confidence == "direct" and pm1.person_id:
                recent_placements.append(
                    RecentPlacement(pm1.person_id, pm1.person_canon, pm1.match_type, name1)
                )
            elif line_class == "result_plain" and name1 and looks_like_person_name(name1):
                pm_ctx = safe_match_person(name1, exact_name_index, collisions)
                if pm_ctx.person_id:
                    recent_placements.append(
                        RecentPlacement(pm_ctx.person_id, pm_ctx.person_canon, pm_ctx.match_type, name1)
                    )

            for tm in trick_hits:
                context_before = line[max(0, tm["span_start"] - 30):tm["span_start"]]
                context_after = line[tm["span_end"]:tm["span_end"] + 30]
                context_snippet = f"{context_before}[{tm['trick_raw']}]{context_after}"

                trick_rows.append(
                    _make_trick_row_base(
                        event_id, year, event_name, line_no, line, line_class,
                        tm, pm1, attribution_confidence, pm2, team_flag, context_snippet,
                    )
                )

            # ── Trick sequence extraction (Stage F) ──────────────────────
            # Split line on chain separators to get ordered trick components.
            # Runs on both trick_chain AND result_trick: improved classification
            # now promotes lines like "1. Name (Trick1>Trick2>Trick3)" to
            # result_trick, but they still contain multi-trick chains.
            if line_class in ("trick_chain", "result_trick"):
                chain_parts = CHAIN_SEP_RE.split(line)
                # Retain only parts that have a trick hit
                ordered_tricks: list[str] = []
                for part in chain_parts:
                    part = part.strip()
                    for tm_entry in trick_hits:
                        if tm_entry["trick_raw"].lower() in part.lower():
                            ordered_tricks.append(tm_entry["trick_canon"])
                            break

                if len(ordered_tricks) > 1:
                    chain_id_counter += 1
                    chain_id = f"{event_id}_{line_no}"
                    person_id_seq = pm1.person_id
                    person_canon_seq = pm1.person_canon
                    for seq_idx, trick_c in enumerate(ordered_tricks):
                        sequence_rows.append({
                            "event_id": event_id,
                            "year": year,
                            "person_id": person_id_seq,
                            "person_canon": person_canon_seq,
                            "attribution_confidence": attribution_confidence,
                            "chain_id": chain_id,
                            "sequence_index": seq_idx,
                            "trick_canon": trick_c,
                        })

        elif line_class == "result_plain":
            # Update context window even for plain lines (person but no trick)
            name1, _ = _extract_names_from_placement_line(line)
            if name1 and looks_like_person_name(name1):
                pm_ctx = safe_match_person(name1, exact_name_index, collisions)
                if pm_ctx.person_id:
                    recent_placements.append(
                        RecentPlacement(pm_ctx.person_id, pm_ctx.person_canon, pm_ctx.match_type, name1)
                    )


# ─────────────────────────────────────────────
# Column helpers
# ─────────────────────────────────────────────

def choose_col(df: pd.DataFrame, candidates: list[str]) -> Optional[str]:
    for c in candidates:
        if c in df.columns:
            return c
    return None


def choose_text_col(df: pd.DataFrame) -> str:
    for c in ["results_block_raw", "results_text", "raw_results", "results_raw", "event_text", "body_text"]:
        if c in df.columns:
            return c
    raise ValueError("Could not find text column in events CSV.")


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="Mine tricks/scores from raw footbag text (v2 with span masking, line classification, context window).")
    ap.add_argument("--events", required=True, help="CSV with event-level raw text")
    ap.add_argument("--persons", required=True, help="Persons_Truth CSV")
    ap.add_argument("--out-dir", required=True, help="Output directory")
    ap.add_argument("--trick-lexicon", help="Optional CSV of additional trick names")
    ap.add_argument("--trick-aliases", help="Optional CSV of alias→trick_canon mappings (inputs/noise/trick_aliases.csv)")
    ap.add_argument("--person-aliases", help="Optional CSV of alias→person_canon mappings (inputs/noise/person_aliases.csv)")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    events_df = pd.read_csv(args.events)
    persons_df = pd.read_csv(args.persons)

    text_col = choose_text_col(events_df)
    event_id_col = choose_col(events_df, ["event_id", "event_key", "legacy_event_id"])
    year_col = choose_col(events_df, ["year"])
    event_name_col = choose_col(events_df, ["event_name", "name"])

    person_alias_path = Path(args.person_aliases) if args.person_aliases else None
    exact_name_index, collisions = build_person_index(persons_df, person_alias_path)

    alias_path = Path(args.trick_aliases) if args.trick_aliases else None
    tricks, alias_map = load_trick_lexicon(
        Path(args.trick_lexicon) if args.trick_lexicon else None,
        alias_path,
    )
    compiled_tricks = compile_trick_patterns(tricks)

    trick_rows: list[dict] = []
    score_rows: list[dict] = []
    sequence_rows: list[dict] = []
    unresolved_counter: Counter = Counter()
    masked_by_longer: Counter = Counter()

    stats = {
        "events_processed": 0,
        "lines_processed": 0,
        "lines_skipped": 0,
        "scores_rejected": 0,
    }

    for _, row in events_df.iterrows():
        raw_text = row.get(text_col)
        if pd.isna(raw_text) or not str(raw_text).strip():
            continue

        stats["events_processed"] += 1
        event_id = row.get(event_id_col) if event_id_col else None
        year = row.get(year_col) if year_col else None
        event_name = row.get(event_name_col) if event_name_col else None

        mine_event(
            event_id=event_id,
            year=year,
            event_name=event_name,
            text=str(raw_text),
            compiled_tricks=compiled_tricks,
            alias_map=alias_map,
            exact_name_index=exact_name_index,
            collisions=collisions,
            trick_rows=trick_rows,
            score_rows=score_rows,
            sequence_rows=sequence_rows,
            unresolved_counter=unresolved_counter,
            masked_by_longer=masked_by_longer,
            stats=stats,
        )

    # ── Write outputs ─────────────────────────────────────────────────────

    trick_df = pd.DataFrame(trick_rows)
    score_df = pd.DataFrame(score_rows)
    sequence_df = pd.DataFrame(sequence_rows)

    unresolved_trick_lines = pd.DataFrame(
        [{"name_raw": k, "count": v} for k, v in unresolved_counter.most_common()],
        columns=["name_raw", "count"],
    )

    # Mask collisions CSV
    # Build example compounds for each suppressed trick
    mask_collision_rows = []
    for trick_c, suppressed_count in masked_by_longer.most_common():
        mask_collision_rows.append({
            "trick_canon": trick_c,
            "suppressed_count": suppressed_count,
        })
    mask_collision_df = pd.DataFrame(
        mask_collision_rows,
        columns=["trick_canon", "suppressed_count"],
    )

    # Score type breakdown
    score_type_breakdown: dict[str, int] = {}
    if not score_df.empty and "score_type" in score_df.columns:
        score_type_breakdown = score_df["score_type"].value_counts().to_dict()

    summary = {
        "events_processed": stats["events_processed"],
        "lines_processed": stats["lines_processed"],
        "lines_skipped_by_classifier": stats["lines_skipped"],
        "trick_mentions": len(trick_df),
        "trick_mentions_resolved": int(trick_df["person_id"].notna().sum()) if not trick_df.empty else 0,
        "trick_mentions_direct": int((trick_df["attribution_confidence"] == "direct").sum()) if not trick_df.empty else 0,
        "trick_mentions_context_window": int((trick_df["attribution_confidence"] == "context_window").sum()) if not trick_df.empty else 0,
        "trick_mentions_team_line": int((trick_df["team_flag"] == True).sum()) if not trick_df.empty else 0,
        "tricks_masked_by_longer_match": int(mask_collision_df["suppressed_count"].sum()) if not mask_collision_df.empty else 0,
        "score_mentions": len(score_df),
        "scores_rejected": stats["scores_rejected"],
        "score_type_breakdown": score_type_breakdown,
        "trick_sequences": len(sequence_df),
        "unique_unresolved_names": len(unresolved_trick_lines),
        "trick_lexicon_size": len(tricks),
    }

    trick_path = out_dir / "noise_trick_mentions_v2.csv"
    score_path = out_dir / "noise_score_mentions_v2.csv"
    sequence_path = out_dir / "noise_trick_sequences.csv"
    unresolved_path = out_dir / "noise_unresolved_trick_lines.csv"
    mask_path = out_dir / "noise_mask_collisions.csv"
    summary_path = out_dir / "noise_summary_v2.json"

    trick_df.to_csv(trick_path, index=False, quoting=csv.QUOTE_MINIMAL)
    score_df.to_csv(score_path, index=False, quoting=csv.QUOTE_MINIMAL)
    sequence_df.to_csv(sequence_path, index=False, quoting=csv.QUOTE_MINIMAL)
    unresolved_trick_lines.to_csv(unresolved_path, index=False, quoting=csv.QUOTE_MINIMAL)
    mask_collision_df.to_csv(mask_path, index=False, quoting=csv.QUOTE_MINIMAL)
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print("Wrote:")
    for p in [trick_path, score_path, sequence_path, unresolved_path, mask_path, summary_path]:
        print(f"  {p}")
    print("\nSummary:")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
