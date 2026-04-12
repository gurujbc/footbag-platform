#!/usr/bin/env python3
"""
event_comparison_viewerV13.py

Side-by-side QC comparison: raw mirror text vs identity-locked canonical results.

V13 changes over V12
---------------------
• Data sources updated to current legacy_data pipeline outputs:
  - STAGE2_CSV    → out/stage2_canonical_events.csv   (was FOOTBAG_DATA/out/merged_stage2.csv)
  - PF_CSV        → out/Placements_Flat.csv            (was FOOTBAG_DATA/out/canonical_pf.csv)
  - QUARANTINE_CSV → inputs/review_quarantine_events.csv (same name, new root)
  - CANON_EVENTS  → out/canonical/events.csv           (same name, new root)
  - OUT_HTML      → out/event_comparison_viewer_v13.html
• Join key: stage2_canonical_events.csv uses event_id (numeric legacy ID).
  Placements_Flat.csv also uses numeric event_id for mirror events.
  No event_key slug field in stage2 — join is direct on numeric ID.
• build_events() no longer attempts event_key → numeric mapping; event_id is
  the primary key throughout.
• Discipline fixes awareness: loads inputs/canonical_discipline_fixes.csv and
  marks events that have known discipline anomalies with a wrench badge.
  These appear under the "⚙ Has Fixes" filter for easy source verification.
• Pre-1997 canonical-only events appended but de-emphasized (blue dot, no
  detailed comparison possible).
• Slug→numeric mapping loaded from canonical/events.csv for the fixes join.
• --fixes flag: override path to canonical_discipline_fixes.csv.

Match classification (unchanged from V12)
------------------------------------------
EXACT      — equal after trivial normalization (whitespace, punct)
NORM       — equal after accent-strip + hyphen-normalize (harmless diff)
SUSPICIOUS — with one of:
               TRUNCATED        mirror collapsed to ≤1 token vs multi-token canon
               TOKEN_LOSS       mirror dropped tokens (fewer but not 1)
               PARTICIPANT_COUNT singles vs doubles count mismatch
               SURNAME_MISMATCH surname roots genuinely differ
               NAME_DISTANCE    full-name Levenshtein ratio > 0.3
               EXTRA_TOKENS     mirror has significantly more tokens
               MISSING_NAME     one side has empty name after normalization

Division pairing (unchanged from V12)
--------------------------------------
1. Structural headers (Classification/Standings) → overlap-based best match
2. Exact normalized match (after word-level + full-string synonym expansion)
3. Overlap-verified substring match:
   - gender-consistency guard (F/M/neutral)
   - overlap threshold >= 30%
   - hard reject if overlap = 0 AND both sides large AND very different sizes
4. A canonical division is NEVER paired more than once (already_matched guard).
5. Unpaired → appended under "— UNMATCHED CANONICAL DIVISIONS —"
"""

import argparse
import csv, json, re, sys, unicodedata
from collections import defaultdict
from pathlib import Path

csv.field_size_limit(sys.maxsize)

ROOT             = Path(__file__).resolve().parent.parent   # legacy_data/
OUT              = ROOT / "out"
STAGE2_CSV       = OUT / "stage2_canonical_events.csv"
PF_CSV           = OUT / "Placements_Flat.csv"
QUARANTINE_CSV   = ROOT / "inputs" / "review_quarantine_events.csv"
CANON_EVENTS     = OUT / "canonical" / "events.csv"
FIXES_CSV        = ROOT / "inputs" / "canonical_discipline_fixes.csv"
OUT_HTML         = OUT / "event_comparison_viewer_v13.html"


# ── String utilities ───────────────────────────────────────────────────────────

def _strip_accents(s: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', s)
                   if unicodedata.category(c) != 'Mn')


def _norm_trivial(s: str) -> str:
    """Lowercase + collapse whitespace + strip punctuation."""
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', ' ', s)).strip().lower()


def _norm_name(s: str) -> str:
    """
    Full name normalization for comparison:
    - Strip uppercase country codes (FRA), (USA) BEFORE lowercasing
    - Strip accents
    - Normalize hyphens/underscores → space
    """
    s = re.sub(r'\s*\b[A-Z]{2,4}\b\s*$', '', s)      # trailing bare code: "FRA"
    s = re.sub(r'\s*\([A-Z]{2,4}\)\s*', ' ', s)       # parenthesized: "(FRA)"
    s = _strip_accents(s)
    s = re.sub(r'[-_]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip().lower()
    return s


def _strip_annotations(s: str) -> str:
    """
    Strip trailing annotation noise from mirror name for comparison purposes only.
    Does NOT alter display text — called only inside classify_row_type.
    """
    s = re.sub(r'\s*\([A-Z]{2,4}\)\s*$', '', s)        # (FRA) at end
    for _ in range(3):
        s2 = re.sub(r'\s*\([A-Za-z][^)]{0,33}\)\s*$', '', s)
        if s2 == s:
            break
        s = s2
    s = re.sub(r'\s+\d+[\d\s./,]+$', '', s)            # trailing digit score
    s = re.sub(r'\s*\(\d[^)]*\)\s*$', '', s)           # parenthesized score
    return s.strip()


def _levenshtein(a: str, b: str) -> int:
    if len(a) > len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        curr = [i + 1]
        for j, cb in enumerate(b):
            curr.append(min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (ca != cb)))
        prev = curr
    return prev[-1]


# ── Mirror parsing ─────────────────────────────────────────────────────────────

_PLACE_LINE_RE = re.compile(r'^\s*\d+\s*[.):\-T]?\s*(?:st|nd|rd|th)?\s*\S')
_PLACE_NUM_RE  = re.compile(r'^\s*(\d+)\s*[.):\-T]?\s*(?:st|nd|rd|th)?\s+(.*)', re.I)

_CONTEXT_PATTERNS = [
    re.compile(r'\b(competed|players|pools?|rounds?|semi[\s-]?finals?|brackets?|schedules?)\b', re.I),
    re.compile(r'\b(score|vs\.?|versus|won|beat|def\.?|lost|defeated|eliminated)\b', re.I),
    re.compile(r'\b(sponsored?|registration|donate|prizes?|awards?|presented)\b', re.I),
    re.compile(r'\d+\s*/\s*\d+'),
    re.compile(r'\d+\s*[-–]\s*\d+\b'),
    re.compile(r'\b\d{1,2}\s*:\s*\d{1,2}\b'),
    re.compile(r'\b(very|quite|really|extremely|rather)\s+\w+', re.I),
    re.compile(r'\b(friendly|balanced|exciting|intense|close|tight)\b', re.I),
    re.compile(r'\b(match(es)?|game(s)?)\s+(were?|was|is|had|between|with|against)\b', re.I),
    re.compile(r'\b(the\s+\w+\s+(was|were|had|is|are|has))\b', re.I),
    re.compile(r'\b(congratulations?|thanks?|thank\s+you)\b', re.I),
    re.compile(r'\b(organized?|organised?|hosted?|presented?\s+by)\b', re.I),
]


def _is_context_line(s: str) -> bool:
    if len(s) > 100:
        return True
    fn_words = re.findall(r'\b(the|and|was|were|is|it|to|of|in|a|an|for|on|at|with|by|this|that|or|but|not|from)\b', s.lower())
    if len(fn_words) >= 3 and len(s) > 30:
        return True
    return any(p.search(s) for p in _CONTEXT_PATTERNS)


def _extract_place(line: str):
    m = _PLACE_NUM_RE.match(line.strip())
    if m:
        return int(m.group(1)), m.group(2).strip()
    return None, line.strip()


def _parse_raw_into_blocks(text: str):
    if not text:
        return []
    blocks = []
    cur_header = None
    cur_lines: list[str] = []
    cur_ctx = False

    for raw in text.splitlines():
        s = raw.strip()
        if not s:
            continue
        if _PLACE_LINE_RE.match(s):
            cur_lines.append(s)
        else:
            if cur_header is not None or cur_lines:
                blocks.append((cur_header, cur_lines, cur_ctx))
            cur_header = s
            cur_lines = []
            cur_ctx = _is_context_line(s)

    if cur_header is not None or cur_lines:
        blocks.append((cur_header, cur_lines, cur_ctx))

    return blocks


# ── Division normalization ─────────────────────────────────────────────────────

_WORD_SUBS: dict[str, str] = {
    'dobles':       'doubles',
    'doble':        'doubles',
    'individual':   'singles',
    'resultados':   '',
    'resultado':    '',
    'abierto':      'open',
    'simple':       'singles',
    'mixte':        'mixed',
    'ouvert':       'open',
    'hommes':       'open',
    'femmes':       'women',
    'einzel':       'singles',
    'doppel':       'doubles',
    'herren':       'open',
    'damen':        'women',
    'singolo':      'singles',
    'doppio':       'doubles',
    'aperto':       'open',
}

_DIV_SYNONYMS: dict[str, str] = {
    'classification':               'open singles net',
    'open classification':          'open singles net',
    'singles result':               'open singles net',
    'singles results':              'open singles net',
    'open individual':              'open singles net',
    'open singles':                 'open singles net',
    'open doubles':                 'open doubles net',
    'doubles mixed':                'mixed doubles',
    'singles mixed':                'mixed singles',
    'singles open':                 'open singles net',
    'doubles open':                 'open doubles net',
}


def _norm_div_partial(s: str) -> str:
    s = _strip_accents((s or '').lower())
    s = re.sub(r"women's|womens\b", 'women', s)
    s = re.sub(r"\bmen's|mens\b",   'men',   s)
    s = re.sub(r"[^\w\s]", ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    tokens = []
    for tok in s.split():
        replacement = _WORD_SUBS.get(tok)
        if replacement is None:
            tokens.append(tok)
        elif replacement:
            tokens.append(replacement)
    return ' '.join(tokens)


def _norm_div(s: str) -> str:
    return _DIV_SYNONYMS.get(_norm_div_partial(s), _norm_div_partial(s))


_STRUCTURAL_HEADERS: set[str] = {
    'classification', 'general classification', 'overall classification',
    'final classification', 'standings', 'final standings', 'ranking',
    'overall ranking', 'final ranking', 'results', 'final results',
    'overall results', 'overall', 'final',
}


def _find_div_by_overlap(h_gender: str, mirror_lines: list,
                         pf_by_div: dict, skip: set):
    if not mirror_lines:
        return None, None
    best_div, best_overlap = None, -1.0
    for dk, rows in pf_by_div.items():
        if dk in skip:
            continue
        k_gender = _gender_tag(dk)
        if h_gender and k_gender and h_gender != k_gender:
            continue
        ov = _name_overlap_score(mirror_lines, rows)
        if ov > best_overlap:
            best_overlap = ov
            best_div = dk
    if best_div is not None and best_overlap >= 0.15:
        return best_div, pf_by_div[best_div]
    return None, None


def _gender_tag(s: str) -> str:
    sl = s.lower()
    if re.search(r'\bwom[ae]n\b|\bladie?s\b|\bfemale\b|\bgirl\b|\bfemmes?\b|\bdamen\b', sl):
        return 'F'
    if re.search(r'\bgents?\b|\bgentlemen\b|\bmen\b|\bboys?\b|\bmale\b|\bherren\b', sl):
        return 'M'
    return ''


def _name_overlap_score(mirror_lines: list, pf_rows: list) -> float:
    if not mirror_lines or not pf_rows:
        return 0.5
    mirror_blob  = _norm_name(' '.join(mirror_lines))
    mirror_words = {w for w in mirror_blob.split() if len(w) >= 4}
    canon_names = []
    for r in pf_rows:
        pc = r.get('person_canon', '')
        td = r.get('team_display_name', '')
        name = td if pc == '__NON_PERSON__' else pc
        if name:
            canon_names.append(_norm_name(name))
    if not canon_names:
        return 0.5
    hits = sum(
        1 for cn in canon_names
        if any(w in mirror_words for w in cn.split() if len(w) >= 4)
    )
    return hits / len(canon_names)


def _find_div(header: str, mirror_lines: list, pf_by_div: dict,
              already_matched: set = None):
    if not header:
        return None, None

    skip     = already_matched or set()
    h_pre    = _norm_div_partial(header)
    h_gender = _gender_tag(header)

    if h_pre in _STRUCTURAL_HEADERS:
        return _find_div_by_overlap(h_gender, mirror_lines, pf_by_div, skip)

    nh = _DIV_SYNONYMS.get(h_pre, h_pre)

    for dk in pf_by_div:
        if dk in skip:
            continue
        if _norm_div(dk) == nh:
            return dk, pf_by_div[dk]

    candidates: list[tuple] = []
    for dk in pf_by_div:
        if dk in skip:
            continue
        nk       = _norm_div(dk)
        k_gender = _gender_tag(dk)
        if not nk:
            continue
        if h_gender and k_gender and h_gender != k_gender:
            continue
        if nk in nh or nh in nk:
            candidates.append((dk, len(nk), k_gender))

    if not candidates:
        return None, None

    if h_gender:
        gendered = [c for c in candidates if c[2] == h_gender]
        pool     = gendered if gendered else [c for c in candidates if not c[2]]
        if not pool:
            pool = candidates
    else:
        pool = candidates

    pool.sort(key=lambda x: x[1], reverse=True)

    for dk, _, _ in pool:
        rows = pf_by_div[dk]
        if len(rows) <= 3 or not mirror_lines:
            return dk, rows
        overlap = _name_overlap_score(mirror_lines, rows)
        if (overlap == 0.0
                and len(mirror_lines) > 5
                and len(rows) > 5
                and abs(len(mirror_lines) - len(rows)) / max(len(mirror_lines), len(rows)) > 0.6):
            continue
        return dk, rows

    dk, _, _ = pool[0]
    return dk, pf_by_div[dk]


# ── Canonical display ──────────────────────────────────────────────────────────

def _display(row: dict) -> str:
    pc = row.get('person_canon', '')
    td = row.get('team_display_name', '')
    if pc == '__NON_PERSON__':
        return td or ''
    return pc or td or ''


# ── Match classification ───────────────────────────────────────────────────────

def _looks_like_name(s: str) -> bool:
    s = s.strip()
    if not s:
        return False
    if not re.match(r'[A-Za-z\u00C0-\u024F]', s):
        return False
    digits = sum(1 for c in s if c.isdigit())
    return digits <= len(s) * 0.3


def _split_names(s: str) -> list[str]:
    for sep in (' / ', ' & ', ' + ', ' and '):
        if sep in s:
            parts = [p.strip() for p in s.split(sep, 1)]
            if all(_looks_like_name(p) for p in parts if p):
                return [p for p in parts if p]
    return [s.strip()] if s.strip() else []


def _surname(name: str) -> str:
    name  = re.sub(r'\s*\([^)]*\)\s*$', '', name).strip()
    parts = _norm_name(name).split()
    return parts[-1] if parts else ''


REASON_TRUNCATED         = 'TRUNCATED'
REASON_TOKEN_LOSS        = 'TOKEN_LOSS'
REASON_PARTICIPANT_COUNT = 'PARTICIPANT_COUNT'
REASON_SURNAME_MISMATCH  = 'SURNAME_MISMATCH'
REASON_NAME_DISTANCE     = 'NAME_DISTANCE'
REASON_EXTRA_TOKENS      = 'EXTRA_TOKENS'
REASON_MISSING_NAME      = 'MISSING_NAME'


def classify_row_type(mirror_line: str, canon_text: str) -> tuple[str, str]:
    _, m_name = _extract_place(mirror_line)
    c_name    = re.sub(r'^\d+[.)]\s*', '', canon_text).strip()

    if not m_name or not c_name:
        return 'suspicious', REASON_MISSING_NAME

    m_clean = _strip_annotations(m_name) or m_name

    if _norm_trivial(m_clean) == _norm_trivial(c_name):
        return 'exact', ''

    mn = _norm_name(m_clean)
    cn = _norm_name(c_name)
    if mn == cn:
        return 'norm', ''

    m_names = _split_names(m_clean)
    c_names = _split_names(c_name)

    if len(m_names) != len(c_names) and (len(m_names) > 1 or len(c_names) > 1):
        return 'suspicious', REASON_PARTICIPANT_COUNT

    for mn_str, cn_str in zip(
        [_norm_name(n) for n in m_names],
        [_norm_name(n) for n in c_names],
    ):
        m_toks = mn_str.split()
        c_toks = cn_str.split()
        if m_toks and c_toks:
            ratio = min(len(m_toks), len(c_toks)) / max(len(m_toks), len(c_toks))
            if ratio < 0.5:
                if len(m_toks) > len(c_toks):
                    return 'suspicious', REASON_EXTRA_TOKENS
                elif len(m_toks) <= 1 and len(c_toks) > 1:
                    return 'suspicious', REASON_TRUNCATED
                else:
                    return 'suspicious', REASON_TOKEN_LOSS

    if m_names and c_names:
        m_sn = _surname(m_names[0])
        c_sn = _surname(c_names[0])
        if m_sn and c_sn and len(m_sn) > 2 and len(c_sn) > 2:
            if m_sn not in c_sn and c_sn not in m_sn:
                lev     = _levenshtein(m_sn, c_sn)
                max_len = max(len(m_sn), len(c_sn))
                if lev / max_len > 0.4:
                    return 'suspicious', REASON_SURNAME_MISMATCH

    lev     = _levenshtein(mn, cn)
    max_len = max(len(mn), len(cn), 1)
    if lev / max_len > 0.3:
        return 'suspicious', REASON_NAME_DISTANCE

    return 'norm', ''


# ── Placements_Flat maps ───────────────────────────────────────────────────────

def _build_pf_maps(pf_rows: list):
    pf_by_div: dict[str, list] = defaultdict(list)
    for r in pf_rows:
        pf_by_div[r['division_canon']].append(r)

    pf_place_display: dict[tuple, str] = {}
    pf_place_order:   dict[str, list]  = {}

    for div, rows in pf_by_div.items():
        seen: dict[int, str] = {}
        for r in rows:
            place = int(r['place'])
            disp  = _display(r)
            if disp and place not in seen:
                seen[place] = disp
        for place, disp in sorted(seen.items()):
            pf_place_display[(div, place)] = disp
        pf_place_order[div] = sorted(seen.keys())

    return dict(pf_by_div), pf_place_display, pf_place_order


# ── Alignment ─────────────────────────────────────────────────────────────────

def build_aligned_rows(results_raw: str, pf_rows: list) -> tuple[list, dict]:
    pf_by_div, pf_place_display, pf_place_order = _build_pf_maps(pf_rows)

    mirror_blocks = _parse_raw_into_blocks(results_raw)
    rows:         list[dict] = []
    matched_divs: set[str]   = set()
    qc:           dict       = defaultdict(int)

    for mirror_header, mirror_lines, is_context in mirror_blocks:
        pf_div_key = None

        if not is_context:
            pf_div_key, _ = _find_div(mirror_header, mirror_lines, pf_by_div,
                                      already_matched=matched_divs)

        if pf_div_key:
            matched_divs.add(pf_div_key)

        left_hdr  = mirror_header or ''
        right_hdr = pf_div_key or ''
        row_type  = 'context' if is_context else 'header'
        if left_hdr or right_hdr:
            rows.append({'l': left_hdr, 'r': right_hdr, 't': row_type, 'reason': ''})

        mirror_place_map: dict[int, str] = {}
        non_place_lines:  list[str]      = []
        for line in mirror_lines:
            pnum, _ = _extract_place(line)
            if pnum is not None and pnum not in mirror_place_map:
                mirror_place_map[pnum] = line.strip()
            else:
                non_place_lines.append(line.strip())

        canon_place_map: dict[int, str] = {}
        if pf_div_key:
            for place in pf_place_order.get(pf_div_key, []):
                disp = pf_place_display.get((pf_div_key, place), '')
                if disp:
                    canon_place_map[place] = f"{place}. {disp}"

        for place in sorted(set(mirror_place_map) | set(canon_place_map)):
            m = mirror_place_map.get(place, '')
            c = canon_place_map.get(place, '')
            if m and c:
                t, reason = classify_row_type(m, c)
                if reason == REASON_SURNAME_MISMATCH:
                    qc['suspicious_surname'] += 1
            elif m:
                t, reason = 'missing_right', ''
            else:
                t, reason = 'missing_left', ''
            rows.append({'l': m, 'r': c, 't': t, 'reason': reason})
            qc[t] += 1

        for line in non_place_lines:
            rows.append({'l': line, 'r': '', 't': 'missing_right', 'reason': ''})
            qc['missing_right'] += 1

    unmatched = sorted(div for div in pf_by_div if div not in matched_divs)
    if unmatched:
        rows.append({
            'l': '', 'r': '— UNMATCHED CANONICAL DIVISIONS —',
            't': 'section_marker', 'reason': '',
        })
        for div in unmatched:
            rows.append({'l': '', 'r': div, 't': 'header', 'reason': ''})
            for place in pf_place_order.get(div, []):
                disp = pf_place_display.get((div, place), '')
                if disp:
                    rows.append({
                        'l': '', 'r': f"{place}. {disp}",
                        't': 'missing_left', 'reason': '',
                    })
                    qc['missing_left'] += 1
        qc['unmatched_divs'] = len(unmatched)

    summary = {
        'exact':              qc.get('exact',             0),
        'norm':               qc.get('norm',              0),
        'suspicious':         qc.get('suspicious',        0),
        'suspicious_surname': qc.get('suspicious_surname', 0),
        'missing_left':       qc.get('missing_left',      0),
        'missing_right':      qc.get('missing_right',     0),
        'unmatched_divs':     qc.get('unmatched_divs',    0),
    }
    return rows, summary


# ── Data loading ───────────────────────────────────────────────────────────────

def load_quarantine():
    """Returns {numeric_event_id: reason}."""
    q = {}
    if QUARANTINE_CSV.exists():
        with open(QUARANTINE_CSV, newline='', encoding='utf-8') as f:
            for r in csv.DictReader(f):
                q[r['event_id']] = r.get('reason', '')
    return q


def load_pf():
    """Return PF rows indexed by event_id (numeric for mirror events)."""
    pf: dict[str, list] = defaultdict(list)
    if not PF_CSV.exists():
        print(f"WARNING: {PF_CSV} not found — canonical column will be empty.")
        return pf
    with open(PF_CSV, newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            pf[r['event_id']].append(r)
    return pf


def load_slug_to_numeric():
    """
    Returns {event_key_slug: legacy_event_id} from canonical/events.csv.
    Used to join canonical_discipline_fixes.csv (slug keys) with stage2 (numeric IDs).
    """
    mapping: dict[str, str] = {}
    if not CANON_EVENTS.exists():
        return mapping
    with open(CANON_EVENTS, newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            slug    = r.get('event_key', '').strip()
            numeric = r.get('legacy_event_id', '').strip()
            if slug and numeric:
                mapping[slug] = numeric
    return mapping


def load_fixes(slug_to_numeric: dict):
    """
    Returns {numeric_event_id: [fix_dict, ...]} for all events in
    canonical_discipline_fixes.csv (active or not).
    """
    fixes: dict[str, list] = defaultdict(list)
    if not FIXES_CSV.exists():
        return fixes
    with open(FIXES_CSV, newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            slug    = r.get('event_key', '').strip()
            numeric = slug_to_numeric.get(slug, '')
            key     = numeric or slug   # fall back to slug if no numeric mapping
            fixes[key].append({
                'event_key':      slug,
                'discipline_key': r.get('discipline_key', ''),
                'fix_type':       r.get('fix_type', ''),
                'original_name':  r.get('original_name', ''),
                'confidence':     r.get('confidence', ''),
                'rationale':      r.get('rationale', ''),
                'active':         r.get('active', '0').strip(),
            })
    return fixes


def _qc_status(qc: dict) -> str:
    if (qc.get('suspicious_surname', 0) > 0
            or qc['suspicious'] > 2
            or qc['unmatched_divs'] > 0):
        return 'red'
    if qc['suspicious'] > 0:
        return 'red'
    if qc['missing_right'] + qc['missing_left'] > 0:
        return 'yellow'
    return 'green'


def build_events(quarantine, pf, fixes):
    events = []
    seen_ids = set()

    if not STAGE2_CSV.exists():
        print(f"ERROR: {STAGE2_CSV} not found.")
        return events

    with open(STAGE2_CSV, newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            event_id = r['event_id']           # numeric legacy ID
            year     = r.get('year', '')
            name     = r.get('event_name', '')

            raw_text        = r.get('results_raw', '')
            pf_rows         = pf.get(event_id, [])
            aligned, qc_sum = build_aligned_rows(raw_text, pf_rows)

            event_fixes = fixes.get(event_id, [])

            events.append({
                'id':    event_id,
                'year':  year,
                'name':  name,
                'q':     quarantine.get(event_id, ''),
                'rows':  aligned,
                'qc':    qc_sum,
                'qs':    _qc_status(qc_sum),
                'fixes': event_fixes,
            })
            seen_ids.add(event_id)

    # Pre-1997 canonical-only events (no mirror text — shown as blue dots, no comparison)
    if CANON_EVENTS.exists():
        with open(CANON_EVENTS, newline='', encoding='utf-8') as f:
            for r in csv.DictReader(f):
                numeric = r.get('legacy_event_id', '').strip()
                slug    = r.get('event_key', '').strip()
                key     = numeric if numeric else slug
                if not key or key in seen_ids:
                    continue
                pf_rows = pf.get(key, []) or pf.get(slug, [])
                aligned, qc_sum = build_aligned_rows('', pf_rows)
                event_fixes = fixes.get(key, []) or fixes.get(slug, [])
                events.append({
                    'id':    slug or numeric,
                    'year':  r.get('year', ''),
                    'name':  r.get('event_name', ''),
                    'q':     '',
                    'rows':  aligned,
                    'qc':    qc_sum,
                    'qs':    'canonical_only',
                    'fixes': event_fixes,
                })

    return sorted(events, key=lambda x: (x['year'], x['name']), reverse=True)


# ── HTML template ──────────────────────────────────────────────────────────────

HTML_TEMPLATE = r"""<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Footbag Event Comparison V13 — Mirror vs Canonical</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: sans-serif;
      height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
      overflow: hidden;
      background: #1a1a1a;
    }

    /* ── Header bar ── */
    #hdr {
      background: #1F3864;
      color: white;
      padding: 7px 14px;
      display: flex;
      gap: 14px;
      align-items: center;
      flex-shrink: 0;
    }
    #hdr strong { font-size: 13px; }
    #search {
      padding: 4px 8px; border: none; border-radius: 3px;
      width: 220px; font-size: 12px;
    }
    #ev-count { font-size: 11px; opacity: 0.65; }
    #nav { display: flex; gap: 6px; align-items: center; margin-left: auto; }
    #nav button {
      padding: 3px 10px; cursor: pointer;
      background: #2d4f7c; color: white;
      border: 1px solid #4a6ea0; border-radius: 3px;
      font-size: 14px; line-height: 1;
    }
    #nav button:hover:not(:disabled) { background: #3a6090; }
    #nav button:disabled { opacity: 0.35; cursor: default; }
    #nav-pos { font-size: 11px; opacity: 0.75; min-width: 70px; text-align: center; }

    /* ── 2-column body ── */
    #body {
      display: grid;
      grid-template-columns: 260px minmax(420px, 1fr);
      overflow: hidden;
    }

    /* ── Event list ── */
    #list {
      overflow-y: scroll;
      background: #252526;
      border-right: 1px solid #3a3a3a;
    }
    .ev-item {
      padding: 7px 10px; cursor: pointer;
      border-bottom: 1px solid #333;
      font-size: 11px; color: #bbb; line-height: 1.4;
      display: flex; align-items: flex-start; gap: 5px;
    }
    .ev-item:hover  { background: #2a3a4a; }
    .ev-item.active { background: #1a3a5c; color: white; font-weight: bold; }
    .ev-q-flag      { color: #f59e0b; font-size: 9px; display: block; }
    .ev-fix-flag    { color: #a78bfa; font-size: 9px; display: block; }
    .ev-year        { opacity: 0.55; font-size: 10px; margin-right: 1px; flex-shrink: 0; }
    .ev-name        { flex: 1; }
    .qc-dot {
      width: 7px; height: 7px; border-radius: 50%;
      flex-shrink: 0; margin-top: 3px;
    }
    .qc-dot.red            { background: #e55; }
    .qc-dot.yellow         { background: #f59e0b; }
    .qc-dot.green          { background: #4c4; }
    .qc-dot.canonical_only { background: #7c9eda; border: 1px solid #4a7abf; }

    /* ── Filters ── */
    .hdr-filter {
      padding: 4px 6px; border: none; border-radius: 3px;
      font-size: 11px; background: #fff; cursor: pointer;
    }

    /* ── Comparison pane ── */
    #cmp-pane {
      overflow: hidden; display: flex;
      flex-direction: column; background: #fff;
    }
    #cmp-title {
      padding: 5px 10px 2px; background: #f0f4f8;
      font-size: 12px; font-weight: bold; color: #1a3a5c;
      flex-shrink: 0;
    }
    #cmp-eventkey {
      padding: 1px 10px 5px; background: #f0f4f8;
      font-size: 10px; font-family: monospace; color: #5a7a9c;
      border-bottom: 1px solid #d0d8e0; flex-shrink: 0;
    }

    /* Fixes bar */
    #fixes-bar {
      padding: 5px 10px; background: #f5f0ff;
      border-bottom: 1px solid #d8cff0;
      font-size: 10px; color: #4a1770;
      display: none; flex-shrink: 0;
    }
    #fixes-bar.visible { display: block; }
    .fix-entry {
      padding: 2px 0;
    }
    .fix-active-0 { color: #9060c0; font-style: italic; }
    .fix-active-1 { color: #2d6a2d; font-weight: bold; }
    .fix-label {
      display: inline-block; padding: 0px 5px; border-radius: 3px;
      font-size: 9px; font-weight: bold; margin-right: 4px;
      background: #7c3aed; color: white;
    }
    .fix-label.active { background: #16a34a; }

    /* QC summary bar */
    #qc-bar {
      padding: 4px 10px; background: #f7f9fb;
      border-bottom: 1px solid #d8e0e8;
      display: flex; flex-wrap: wrap; gap: 6px;
      flex-shrink: 0; min-height: 28px; align-items: center;
    }
    .qc-chip {
      padding: 1px 7px; border-radius: 10px;
      font-size: 10px; font-weight: bold;
      font-family: 'Courier New', Courier, monospace;
      white-space: nowrap;
    }
    .qc-chip.exact      { background: #d4edda; color: #1a5c2a; }
    .qc-chip.norm       { background: #d1ecf1; color: #0c5460; }
    .qc-chip.suspicious { background: #fff3cd; color: #856404; border: 1px solid #ffc107; }
    .qc-chip.missing    { background: #f8d7da; color: #721c24; }
    .qc-chip.unmatched  { background: #e2d9f3; color: #4a1770; }
    .qc-chip.clean      { background: #d4edda; color: #1a5c2a; font-style: italic; }

    /* Legend */
    #legend {
      padding: 3px 10px; background: #f0f4f8;
      border-bottom: 1px solid #d0d8e0;
      display: flex; gap: 10px; flex-wrap: wrap;
      font-size: 9px; color: #555; flex-shrink: 0;
    }
    .leg { display: flex; align-items: center; gap: 3px; }
    .leg-box { width: 10px; height: 10px; border: 1px solid #ccc; display: inline-block; }

    #cmp-col-headers {
      display: grid; grid-template-columns: 1fr 1fr;
      background: #1F3864; color: white;
      font-size: 11px; font-weight: bold; flex-shrink: 0;
    }
    #cmp-col-headers div { padding: 5px 10px; }
    #cmp-col-headers div:first-child { border-right: 1px solid #4a6080; }
    #cmp-scroll { flex: 1; overflow-y: scroll; overflow-x: hidden; }

    /* ── Aligned rows ── */
    .cmp-grid { display: grid; grid-template-columns: 1fr 1fr; }
    .cmp-cell {
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px; line-height: 1.55;
      white-space: pre-wrap; padding: 1px 10px;
      border-bottom: 1px solid #f0f0f0;
      min-height: 1.55em; word-break: break-word;
    }
    .cmp-cell.left { border-right: 1px solid #dde3e8; }

    .cmp-cell[data-t="header"] {
      background: #eef2f7; font-weight: bold;
      color: #1a3a5c; padding-top: 4px; padding-bottom: 4px;
      border-bottom: 1px solid #c8d4e0;
    }
    .cmp-cell[data-t="context"] {
      background: #fafafa; color: #999;
      font-style: italic; font-size: 10px;
    }
    .cmp-cell[data-t="section_marker"] {
      background: #fffbea; font-style: italic; color: #8a5f00;
    }
    .cmp-cell[data-t="norm"] { background: #f2fffe; }

    .cmp-cell[data-t="suspicious"]       { background: #fff8e6; }
    .cmp-cell.right[data-t="suspicious"] {
      background: #fff3cd; border-left: 2px solid #ffc107;
    }

    .cmp-cell.right[data-t="missing_right"] { background: #fff0f0; }
    .cmp-cell.right[data-t="missing_left"]  { background: #eaf0ff; }
    .cmp-cell.left[data-t="missing_left"]   { background: #fafafa; }

    /* ── Reason tags ── */
    .reason-tag {
      display: inline-block; margin-left: 6px;
      padding: 0px 5px; border-radius: 3px;
      font-size: 9px; font-weight: bold; font-style: normal;
      vertical-align: middle; letter-spacing: 0.3px;
    }
    .reason-tag.TRUNCATED         { background: #fd7e14; color: #fff; }
    .reason-tag.TOKEN_LOSS        { background: #20c997; color: #fff; }
    .reason-tag.SURNAME_MISMATCH  { background: #dc3545; color: #fff; }
    .reason-tag.PARTICIPANT_COUNT { background: #6f42c1; color: #fff; }
    .reason-tag.NAME_DISTANCE     { background: #e0a800; color: #000; }
    .reason-tag.EXTRA_TOKENS      { background: #17a2b8; color: #fff; }
    .reason-tag.MISSING_NAME      { background: #6c757d; color: #fff; }
  </style>
</head>
<body>
  <div id="hdr">
    <strong>Footbag Event Comparison V13 — Mirror vs Canonical</strong>
    <input type="text" id="search" placeholder="Search events…" oninput="filterList()">
    <select id="qc-filter" class="hdr-filter" onchange="filterList()">
      <option value="">All QC</option>
      <option value="red">⚠ Suspicious/Unmatched</option>
      <option value="yellow">↕ Gaps only</option>
      <option value="green">✓ Clean</option>
      <option value="has_fixes">⚙ Has Discipline Fixes</option>
    </select>
    <span id="ev-count"></span>
    <div id="nav">
      <button id="btn-prev" onclick="stepEvent(-1)" title="Previous (↑)">↑</button>
      <span id="nav-pos">—</span>
      <button id="btn-next" onclick="stepEvent(1)"  title="Next (↓)">↓</button>
    </div>
  </div>

  <div id="body">
    <div id="list"></div>

    <div id="cmp-pane">
      <div id="cmp-title">Select an event from the list</div>
      <div id="cmp-eventkey"></div>
      <div id="fixes-bar" id="fixes-bar"></div>
      <div id="qc-bar"></div>
      <div id="legend">
        <span class="leg"><span class="leg-box" style="background:#fff"></span>exact</span>
        <span class="leg"><span class="leg-box" style="background:#f2fffe"></span>norm</span>
        <span class="leg"><span class="leg-box" style="background:#fff3cd;border-color:#ffc107"></span>suspicious</span>
        <span class="leg"><span class="leg-box" style="background:#fff0f0"></span>missing in canonical</span>
        <span class="leg"><span class="leg-box" style="background:#eaf0ff"></span>missing in mirror</span>
        <span class="leg">
          <span class="reason-tag SURNAME_MISMATCH">SM</span>
          <span class="reason-tag TRUNCATED">TR</span>
          <span class="reason-tag TOKEN_LOSS">TL</span>
          <span class="reason-tag PARTICIPANT_COUNT">PC</span>
          <span class="reason-tag NAME_DISTANCE">ND</span>
          reason tags
        </span>
      </div>
      <div id="cmp-col-headers">
        <div>① Mirror / Raw Source Text</div>
        <div>② Canonical (Identity-Locked)</div>
      </div>
      <div id="cmp-scroll">
        <div class="cmp-grid" id="cmp-grid"></div>
      </div>
    </div>

  </div>

  <script>
    const EVENTS = %EVENTS_JSON%;
    let filtered = EVENTS, currentIndex = 0;

    function esc(s) {
      return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function renderList(items) {
      const el = document.getElementById('list');
      el.innerHTML = items.map(ev => {
        const dotCls = ev.qs || 'green';
        const hasFixes = ev.fixes && ev.fixes.length > 0;
        return `<div class="ev-item${ev.q?' ev-q':''}" id="ev-${ev.id}" onclick="selectEvent('${ev.id}')">
          <span class="qc-dot ${dotCls}"></span>
          <span class="ev-name">
            <span class="ev-year">${esc(ev.year)}</span>${esc(ev.name)}
            ${ev.q ? `<br><span class="ev-q-flag">⚑ quarantined</span>` : ''}
            ${hasFixes ? `<br><span class="ev-fix-flag">⚙ discipline fix</span>` : ''}
          </span>
        </div>`;
      }).join('');
      document.getElementById('ev-count').textContent = `${items.length} events`;
    }

    function renderFixesBar(fixes) {
      const bar = document.getElementById('fixes-bar');
      if (!fixes || fixes.length === 0) {
        bar.classList.remove('visible');
        bar.innerHTML = '';
        return;
      }
      bar.classList.add('visible');
      bar.innerHTML = fixes.map(f => {
        const isActive = f.active === '1';
        const labelCls = isActive ? 'fix-label active' : 'fix-label';
        const rowCls   = isActive ? 'fix-entry fix-active-1' : 'fix-entry fix-active-0';
        const status   = isActive ? 'ACTIVE' : 'inactive';
        return `<div class="${rowCls}">
          <span class="${labelCls}">${esc(f.fix_type)}</span>
          <strong>${esc(f.discipline_key)}</strong>
          [${status}] ${esc(f.confidence)}
          — ${esc(f.rationale ? f.rationale.substring(0, 120) + (f.rationale.length > 120 ? '…' : '') : '')}
        </div>`;
      }).join('');
    }

    function renderQcBar(qc) {
      if (!qc) { document.getElementById('qc-bar').innerHTML = ''; return; }
      const chips = [];
      if (qc.exact > 0)
        chips.push(`<span class="qc-chip exact">✓ ${qc.exact} exact</span>`);
      if (qc.norm > 0)
        chips.push(`<span class="qc-chip norm">≈ ${qc.norm} norm</span>`);
      if (qc.suspicious > 0) {
        let label = `⚠ ${qc.suspicious} suspicious`;
        if (qc.suspicious_surname > 0) label += ` (${qc.suspicious_surname} surname)`;
        chips.push(`<span class="qc-chip suspicious">${label}</span>`);
      }
      const miss = qc.missing_right + qc.missing_left;
      if (miss > 0)
        chips.push(`<span class="qc-chip missing">✗ ${miss} missing (←${qc.missing_left} →${qc.missing_right})</span>`);
      if (qc.unmatched_divs > 0)
        chips.push(`<span class="qc-chip unmatched">⊘ ${qc.unmatched_divs} unmatched div${qc.unmatched_divs>1?'s':''}</span>`);
      if (chips.length === 0)
        chips.push('<span class="qc-chip clean">all clear</span>');
      document.getElementById('qc-bar').innerHTML = chips.join('');
    }

    function updateNav() {
      document.getElementById('nav-pos').textContent =
        filtered.length ? `${currentIndex+1} / ${filtered.length}` : '—';
      document.getElementById('btn-prev').disabled = currentIndex <= 0;
      document.getElementById('btn-next').disabled = currentIndex >= filtered.length - 1;
    }

    function stepEvent(delta) {
      const next = currentIndex + delta;
      if (next < 0 || next >= filtered.length) return;
      currentIndex = next;
      selectEvent(filtered[currentIndex].id);
    }

    function filterList() {
      const q  = document.getElementById('search').value.toLowerCase();
      const qs = document.getElementById('qc-filter').value;
      filtered = EVENTS.filter(e => {
        if (q  && !(e.year+' '+e.name+' '+e.id).toLowerCase().includes(q)) return false;
        if (qs === 'has_fixes') {
          if (!e.fixes || e.fixes.length === 0) return false;
        } else if (qs) {
          if (e.qs !== qs) return false;
        }
        return true;
      });
      currentIndex = 0;
      renderList(filtered);
      if (filtered.length) selectEvent(filtered[0].id);
      else { updateNav(); renderQcBar(null); renderFixesBar(null); }
    }

    function selectEvent(id) {
      const ev = EVENTS.find(e => e.id === id);
      if (!ev) return;
      const idx = filtered.findIndex(e => e.id === id);
      if (idx !== -1) currentIndex = idx;

      document.querySelectorAll('.ev-item').forEach(el => el.classList.remove('active'));
      const li = document.getElementById('ev-' + id);
      if (li) { li.classList.add('active'); li.scrollIntoView({block:'nearest'}); }

      updateNav();
      renderFixesBar(ev.fixes);
      renderQcBar(ev.qc);

      document.getElementById('cmp-title').textContent =
        ev.year + ' ' + ev.name + (ev.q ? '  ⚑ QUARANTINED: ' + ev.q : '');
      document.getElementById('cmp-eventkey').textContent = ev.id;

      const grid = document.getElementById('cmp-grid');
      const rows = ev.rows || [];
      if (!rows.length) {
        const msg = ev.qs === 'canonical_only'
          ? '<em style="color:#7c9eda">Pre-1997 canonical event — no mirror source to compare</em>'
          : '<em style="color:#999">No source data</em>';
        grid.innerHTML =
          `<div class="cmp-cell left" data-t="header">${msg}</div>` +
          '<div class="cmp-cell right" data-t="header"><em style="color:#999">No canonical data</em></div>';
      } else {
        const parts = [];
        for (const r of rows) {
          parts.push(`<div class="cmp-cell left" data-t="${r.t}">${esc(r.l)}</div>`);
          let right = esc(r.r);
          if (r.reason) {
            right += `<span class="reason-tag ${r.reason}">${r.reason.replace('_',' ')}</span>`;
          }
          parts.push(`<div class="cmp-cell right" data-t="${r.t}">${right}</div>`);
        }
        grid.innerHTML = parts.join('');
      }
      document.getElementById('cmp-scroll').scrollTop = 0;
    }

    document.addEventListener('keydown', e => {
      if (document.activeElement === document.getElementById('search')) return;
      if (e.key==='ArrowDown'||e.key==='j') { e.preventDefault(); stepEvent(1); }
      if (e.key==='ArrowUp'  ||e.key==='k') { e.preventDefault(); stepEvent(-1); }
    });

    renderList(EVENTS);
    if (EVENTS.length) selectEvent(EVENTS[0].id);
  </script>
</body>
</html>
"""


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("Loading slug→numeric mapping…")
    slug_to_numeric = load_slug_to_numeric()
    print(f"  {len(slug_to_numeric)} events in canonical/events.csv")

    print("Loading discipline fixes…")
    fixes = load_fixes(slug_to_numeric)
    print(f"  {sum(len(v) for v in fixes.values())} fix entries across {len(fixes)} events")

    print("Loading quarantine…")
    quarantine = load_quarantine()

    print("Loading Placements_Flat…")
    pf = load_pf()

    print("Building aligned rows…")
    events = build_events(quarantine, pf, fixes)

    total_exact     = sum(e['qc'].get('exact',             0) for e in events)
    total_norm      = sum(e['qc'].get('norm',              0) for e in events)
    total_susp      = sum(e['qc'].get('suspicious',        0) for e in events)
    total_susp_sn   = sum(e['qc'].get('suspicious_surname',0) for e in events)
    total_miss_l    = sum(e['qc'].get('missing_left',      0) for e in events)
    total_miss_r    = sum(e['qc'].get('missing_right',     0) for e in events)
    total_unmatched = sum(e['qc'].get('unmatched_divs',    0) for e in events)
    red_events      = sum(1 for e in events if e['qs'] == 'red')
    yellow_events   = sum(1 for e in events if e['qs'] == 'yellow')
    green_events    = sum(1 for e in events if e['qs'] == 'green')
    fix_events      = sum(1 for e in events if e['fixes'])

    print(f"  {len(events)} events  |  "
          f"exact:{total_exact}  norm:{total_norm}  "
          f"suspicious:{total_susp} (surname:{total_susp_sn})  "
          f"miss_left:{total_miss_l}  miss_right:{total_miss_r}")
    print(f"  Unmatched divisions: {total_unmatched}")
    print(f"  Status — red:{red_events}  yellow:{yellow_events}  green:{green_events}")
    print(f"  Events with discipline fixes: {fix_events}")

    html = HTML_TEMPLATE.replace('%EVENTS_JSON%', json.dumps(events, ensure_ascii=False))
    with open(OUT_HTML, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"Viewer written → {OUT_HTML}")


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--stage2', help='Override stage2 CSV path')
    ap.add_argument('--pf',     help='Override Placements_Flat CSV path')
    ap.add_argument('--fixes',  help='Override canonical_discipline_fixes.csv path')
    ap.add_argument('--output', help='Override HTML output path')
    args = ap.parse_args()
    if args.stage2: STAGE2_CSV = Path(args.stage2)
    if args.pf:     PF_CSV     = Path(args.pf)
    if args.fixes:  FIXES_CSV  = Path(args.fixes)
    if args.output: OUT_HTML   = Path(args.output)
    main()
