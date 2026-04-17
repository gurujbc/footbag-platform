#!/usr/bin/env python3
r"""
pipeline/platform/export_canonical_platform.py

Filter and transform out/canonical/*.csv → event_results/canonical_input/
in the schema expected by scripts 07 and 08.

Processing order
----------------
 1.  Load data (incl. Person_Display_Names mapping and HOF)
 2.  Coverage filter — drop 'sparse' disciplines; cascade to events, results,
                       participants for dropped (event_key, discipline_key) pairs.
 3.  Participant sentinel display_names → "Unknown"
 3a. Participant display_name artifact cleanup — strip trailing prize-amount
                             suffixes ($N); drop rows whose display_name matches
                             a known non-person pattern (IL \d+, address strings,
                             multi-?? unknowns, prizes/ranking artifacts).
 3b. Display-name mapping — resolve unmatched participant rows via
                             Person_Display_Names_v1.csv; inject person_id and
                             normalise display_name to person_canon.
 4.  Persons schema transform — rename fbhof_* → hof_*; drop player_ids
                                 (member_id is kept)
 4b. Class-B person injection — add person rows for mapping entries whose
                                  effective_person_id is not yet in persons.
 5.  Blocklist removal — drop person rows whose name is a sentinel or known
                          non-person artifact; null their participant person_ids
 5b. Person-likeness gate — drop person rows with encoding corruption,
                             embedded ?, bad characters; prevents junk from
                             reaching canonical output
 6.  Name cleanup: strip "aka …" suffixes
 7.  Name cleanup: title-case fully-uppercase names (preserves initials)
 8.  Name sync: apply PT v52 person_canon override (authoritative)
 9.  Blank name safety drop
10.  Compute used_pids from current participants
11.  Referential closure — keep persons where:
         person_id in used_pids   (participant references it)
         OR person_id in PT v52   (identified person, may have no results yet)
12.  Duplicate dedup — one row per person_name; keep most-referenced UUID;
                        remap participant rows to canonical UUID
13.  Final referential-closure assert — hard-fail if any dangling reference exists
14.  Sort persons alphabetically by person_name
15.  Write canonical_input/

Run:
    python pipeline/platform/export_canonical_platform.py
"""

import csv
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT         = Path(__file__).resolve().parents[2]
CANONICAL    = ROOT / "out" / "canonical"
CANONICAL_IN = ROOT / "event_results" / "canonical_input"
LOCK_DIR     = ROOT / "inputs" / "identity_lock"
HOF_CSV      = ROOT / "inputs" / "hof.csv"
DISPLAY_NAMES_CSV    = LOCK_DIR / "Person_Display_Names_v1.csv"
MEMBER_ID_SUPPLEMENT = LOCK_DIR / "member_id_supplement.csv"

csv.field_size_limit(10 * 1024 * 1024)

# display_names in participants that are pipeline sentinels, not real persons
_SENTINEL_DISPLAY: set[str] = {
    "__UNKNOWN_PARTNER__", "__NON_PERSON__",
    "[UNKNOWN PARTNER]", "[UNKNOWN]",
}

# person_name values that are never real people and must be removed from persons.csv;
# any participant referencing such a person_id gets person_id="" (unresolved, not orphan)
_PERSONS_BLOCKLIST: set[str] = {
    "__NON_PERSON__",
    "Unknown",
    "Czech Republic",      # country artifact
    # Encoding corruption (mojibake) — real people with garbled names;
    # corrected aliases in overrides/person_aliases.csv merge these into the right person
    "Marcin Ka\u00b3czor",         # → Marcin Kalczor
    "Pawe\u00b3 Ro\u00bfek",      # → Pawel Rozek
    "Robin P\u00b8chel",           # → Robin Puchel
    "Szymon Ka\u00b3wak",          # → Szymon Kalwak
    "Tomasz Kocio\u00b3kowski",    # → Tomasz Kociolkowski
    "Tom\u00e1\u00b9 Tu\u00e8ek",  # → Tomas Tucek
    # Incomplete names — unresolvable first-name-only with "?"
    "Axel ?",
    "Christian ?",
    "Oliver ?",
    "Pablo ?",
    "Paty ?",
    "R\u00e9mi ?",
    "Stefan ?",
    "Yan ?",
    # Junk with embedded scores/noise
    "Arkadiusz Dudzi\u00f1ski ? 208,13",
    "Augustin Tiffou ? Predator",
    "Marcin Bujko ? 243,87",
    "Ren Rhr ? Whirr",
    "Team S. Thomas Sustrac ? Robinson Sustrac",
    # Multi-person / team entries (not individual persons)
    "Anthony Intemann / Greg Nice Neumann",
    "Homola + Hal\u00e1sz",
    "Jazz + Juz",
    "Kiss + Gy\u00e1ni",
    "Szolosi + Horv\u00e1th",
    "Michi+mr. Germany GER",
    "Thomsenf und die 4. Dimension+",
    # Multi-? unknowns
    "Erik ???",
    "Erik ?????",
    "Reid ??",
    # Trailing junk
    "Patrick Keehan*",
    # Czech mojibake (no clean version in PT)
    "Vojt\u00ecch Kr\u00f9ta",
    "V\u00e1\u0161ka Kouda",
    "V\u00e1 ka Kouda",
    # Team/club/event names / nicknames
    "Virginia Shaolin Foot Clan",
    "Windy City Cup Champions",
    "Big One",
    "PA Coalition of Kickers",
    "Clemens Girl Friend",
    "DC All Stars",
    # Trick names not caught by keyword patterns
    "Beta Fog",
    "PS Whirl",
    "Pixie Legover",
    "Pixie Same",
    "Paradon to Paradox",
    "Mobius >",
}

_PERSONS_DROP: set[str] = {"player_ids"}   # member_id is kept
_PERSONS_RENAME: dict[str, str] = {
    "fbhof_member":         "hof_member",
    "fbhof_induction_year": "hof_induction_year",
}

_AKA_RE = re.compile(r"\s+aka\b.*$", re.IGNORECASE)

# Strip trailing prize-amount suffixes from display_names: "$25", "$350", "$$$"
_PRIZE_SUFFIX_RE = re.compile(r"\s*\$[\d,.$]+\s*$")

# display_name patterns that are clearly not person names; drop participant row
# (person_id nulled, display_name set to "Unknown" so result entry is preserved)
_JUNK_DISPLAY_PATTERNS: list[re.Pattern] = [
    re.compile(r"^IL\s+\d+$"),                      # scoreboard codes: IL 49, IL 63
    re.compile(r"[^,]+,\s*\w+\s+[A-Za-z]{2}$"),     # address-like: Rame, Wichita Ks
    re.compile(r"\bprizes\b", re.IGNORECASE),        # prize-category artifacts
    re.compile(r"\?{2,}"),                           # multi-? unknowns: Erik ???, Reid ??
    re.compile(r"\s+\d+\.\s+[A-Z]"),                # Finnish ranking artifacts: Name N. Name
]


# ── Helpers ────────────────────────────────────────────────────────────────────

def load_csv(path: Path) -> tuple[list[str], list[dict]]:
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        return list(reader.fieldnames), rows


def write_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def load_pt51() -> dict[str, str]:
    """Return {effective_person_id: person_canon} from the latest PT v52 lock file."""
    files = sorted(LOCK_DIR.glob("Persons_Truth_Final_v*.csv"))
    if not files:
        return {}
    result: dict[str, str] = {}
    with open(files[-1], newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            eid   = row.get("effective_person_id", "").strip()
            canon = row.get("person_canon", "").strip()
            if eid and canon:
                result[eid] = canon
    print(f"  PT v52 index: {len(result):,} persons ({files[-1].name})")
    return result


def load_pt51_legacyids() -> dict[str, str]:
    """Return {effective_person_id: member_id} for PT v52 persons that carry a legacyid.

    Normalises float-formatted IDs ("77534.0" → "77534").
    Used to backfill member_id and to retain persons with an IFPA profile link
    even when they have no surviving participant rows.
    """
    files = sorted(LOCK_DIR.glob("Persons_Truth_Final_v*.csv"))
    if not files:
        return {}
    result: dict[str, str] = {}
    with open(files[-1], newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            eid = row.get("effective_person_id", "").strip()
            lid = row.get("legacyid", "").strip()
            if eid and lid:
                try:
                    lid = str(int(float(lid)))
                except ValueError:
                    pass
                result[eid] = lid
    print(f"  PT v52 legacy member IDs: {len(result):,} persons with legacyid")
    return result


def load_display_name_mapping() -> dict[str, tuple[str, str]]:
    """Return {display_name: (effective_person_id, person_canon)} from Person_Display_Names_v1.csv."""
    if not DISPLAY_NAMES_CSV.exists():
        return {}
    result: dict[str, tuple[str, str]] = {}
    with open(DISPLAY_NAMES_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            dn    = row.get("display_name", "").strip()
            eid   = row.get("effective_person_id", "").strip()
            canon = row.get("person_canon", "").strip()
            if dn and eid and canon:
                result[dn] = (eid, canon)
    print(f"  Display-name mapping: {len(result):,} entries ({DISPLAY_NAMES_CSV.name})")
    return result


def load_hof() -> dict[str, dict]:
    """Return {full_name: row} from hof.csv."""
    if not HOF_CSV.exists():
        return {}
    with open(HOF_CSV, newline="", encoding="utf-8") as f:
        return {row["full_name"].strip(): row for row in csv.DictReader(f)}


def strip_aka(name: str) -> str:
    """'Arthur Ledain aka Tutur' → 'Arthur Ledain'"""
    return _AKA_RE.sub("", name).strip()


def maybe_title_case(name: str) -> str:
    """Title-case names where every alpha token of length > 3 is uppercase.

    Preserves initials like 'AJ', 'DJ', 'JB', 'P.T.', 'RNH'.
    Targets: 'JUAN BERNARDO PALACIOS' → 'Juan Bernardo Palacios'
    Leaves alone: 'AJ Shultz', 'DJ Dourney', 'JF Lemieux', 'Greg RNH'
    """
    tokens = name.split()
    long_alpha = [t for t in tokens if t.isalpha() and len(t) > 3]
    if long_alpha and all(t.isupper() for t in long_alpha):
        return name.title()
    return name


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    print("export_canonical_platform: out/canonical/ → canonical_input/\n")

    # ── 1. Load ────────────────────────────────────────────────────────────────
    pt51             = load_pt51()
    pt51_ids: set[str] = set(pt51.keys())
    pt51_legacyids   = load_pt51_legacyids()
    dn_map      = load_display_name_mapping()   # {display_name: (eid, canon)}
    hof         = load_hof()                    # {full_name: hof_row}

    ev_fields,   events       = load_csv(CANONICAL / "events.csv")
    disc_fields, disciplines  = load_csv(CANONICAL / "event_disciplines.csv")
    res_fields,  results      = load_csv(CANONICAL / "event_results.csv")
    part_fields, participants = load_csv(CANONICAL / "event_result_participants.csv")
    pers_fields, persons      = load_csv(CANONICAL / "persons.csv")

    print(f"Input:")
    print(f"  events:       {len(events):>7,}")
    print(f"  disciplines:  {len(disciplines):>7,}")
    print(f"  results:      {len(results):>7,}")
    print(f"  participants: {len(participants):>7,}")
    print(f"  persons:      {len(persons):>7,}")

    # ── 2. Coverage filter ─────────────────────────────────────────────────────
    included_disc_keys: set[tuple[str, str]] = {
        (r["event_key"], r["discipline_key"])
        for r in disciplines
        if r.get("coverage_flag", "").strip().lower() != "sparse"
    }
    n_sparse_disc   = len(disciplines) - len(included_disc_keys)
    disciplines  = [r for r in disciplines  if (r["event_key"], r["discipline_key"]) in included_disc_keys]
    results      = [r for r in results      if (r["event_key"], r["discipline_key"]) in included_disc_keys]
    participants = [r for r in participants if (r["event_key"], r["discipline_key"]) in included_disc_keys]
    included_event_keys = {r["event_key"] for r in disciplines}
    n_events_dropped = len(events) - sum(1 for e in events if e["event_key"] in included_event_keys)
    events = [r for r in events if r["event_key"] in included_event_keys]
    print(f"\nCoverage filter: -{n_sparse_disc} sparse disciplines, -{n_events_dropped} empty events"
          f"  → {len(events)} events, {len(disciplines)} disciplines, "
          f"{len(results)} results, {len(participants)} participants")

    # ── 3. Participant sentinel display_names → "Unknown" ──────────────────────
    n_sentinel_disp = sum(
        1 for r in participants
        if r.get("display_name", "").strip() in _SENTINEL_DISPLAY
    )
    for r in participants:
        if r.get("display_name", "").strip() in _SENTINEL_DISPLAY:
            r["display_name"] = "Unknown"
    if n_sentinel_disp:
        print(f"Participant sentinels → 'Unknown': {n_sentinel_disp}")

    # ── 3a. Display-name artifact cleanup ────────────────────────────────────
    n_prize_stripped = 0
    n_junk_dropped   = 0
    for r in participants:
        dn = r.get("display_name", "").strip()
        if not dn or dn == "Unknown":
            continue
        # Strip trailing prize-amount suffixes before any other check
        cleaned = _PRIZE_SUFFIX_RE.sub("", dn).strip()
        if cleaned != dn:
            r["display_name"] = cleaned
            n_prize_stripped += 1
            dn = cleaned
        # Drop rows matching known non-person patterns
        if any(pat.search(dn) for pat in _JUNK_DISPLAY_PATTERNS):
            r["display_name"] = "Unknown"
            r["person_id"]    = ""
            n_junk_dropped += 1
    if n_prize_stripped:
        print(f"Display-name prize-suffix strip: {n_prize_stripped} row(s) cleaned")
    if n_junk_dropped:
        print(f"Display-name junk drop: {n_junk_dropped} row(s) → 'Unknown'")

    # ── 3b. Display-name mapping ───────────────────────────────────────────────
    # For participant rows with person_id="" whose display_name appears in the
    # supplemental mapping, inject the effective_person_id and normalise the
    # display_name to the canonical form.  Rows with an existing person_id are
    # never touched.
    n_dn_mapped = 0
    for r in participants:
        if r.get("person_id", "").strip():
            continue                          # already resolved — leave alone
        dn = r.get("display_name", "").strip()
        if dn in dn_map:
            eid, canon = dn_map[dn]
            r["person_id"]    = eid
            r["display_name"] = canon
            n_dn_mapped += 1
    if n_dn_mapped:
        print(f"Display-name mapping: {n_dn_mapped} participant row(s) resolved")

    # ── 4. Persons schema transform ────────────────────────────────────────────
    out_pers_fields = [
        _PERSONS_RENAME.get(c, c)
        for c in pers_fields
        if c not in _PERSONS_DROP
    ]
    new_persons: list[dict] = []
    for p in persons:
        out_row: dict = {}
        for col in pers_fields:
            if col in _PERSONS_DROP:
                continue
            out_row[_PERSONS_RENAME.get(col, col)] = p.get(col, "")
        new_persons.append(out_row)
    persons = new_persons

    # ── 4b. Class-B person injection ──────────────────────────────────────────
    # For mapping entries whose effective_person_id does not yet appear in
    # persons, create a minimal person row.  Only the unique set of eids
    # referenced by participants (after step 3b) that are absent from persons
    # is injected — no spurious rows are created.
    existing_pids: set[str] = {p["person_id"] for p in persons}
    # Collect the unique (eid, canon) pairs needed from the mapping
    needed: dict[str, str] = {}   # eid → canon
    for eid, canon in dn_map.values():
        if eid not in existing_pids:
            needed[eid] = canon

    # Only inject rows for eids that participants actually reference
    participant_new_pids: set[str] = {
        r["person_id"].strip()
        for r in participants
        if r.get("person_id", "").strip() in needed
    }

    n_new_persons = 0
    for eid in sorted(participant_new_pids):
        canon = needed[eid]
        new_row: dict = {col: "" for col in out_pers_fields}
        new_row["person_id"]   = eid
        new_row["person_name"] = canon
        # Populate HOF fields if the canonical name appears in hof.csv
        hof_row = hof.get(canon, {})
        if hof_row:
            new_row["hof_member"]         = "True"
            new_row["hof_induction_year"] = hof_row.get("induction_year", "")
        persons.append(new_row)
        n_new_persons += 1
    if n_new_persons:
        print(f"Class-B person injection: {n_new_persons} new person row(s) added")

    # ── 4c. Identity-mapped person guarantee ──────────────────────────────────
    # Ensure every effective_person_id in the mapping file has a persons row,
    # even when all of that player's appearances fall in sparse-filtered
    # disciplines and no participant row survived step 2.
    # Deduplication by eid: one canonical row per eid (multiple display_names
    # may map to the same eid).
    dn_map_ids: set[str] = {eid for eid, _canon in dn_map.values()}
    existing_pids_now: set[str] = {p["person_id"] for p in persons}
    # Collect unique eid → canon from the mapping for any still-missing eids
    still_needed: dict[str, str] = {}
    for _dn, (eid, canon) in dn_map.items():
        if eid not in existing_pids_now and eid not in still_needed:
            still_needed[eid] = canon

    n_guaranteed = 0
    for eid in sorted(still_needed):
        canon = still_needed[eid]
        new_row = {col: "" for col in out_pers_fields}
        new_row["person_id"]   = eid
        new_row["person_name"] = canon
        hof_row = hof.get(canon, {})
        if hof_row:
            new_row["hof_member"]         = "True"
            new_row["hof_induction_year"] = hof_row.get("induction_year", "")
        persons.append(new_row)
        n_guaranteed += 1
    if n_guaranteed:
        print(f"Identity-mapped person guarantee: {n_guaranteed} row(s) added "
              f"(no surviving participant rows after coverage filter)")

    # ── 5. Blocklist removal: drop sentinel/artifact person rows ───────────────
    blocked_pids: set[str] = {
        p["person_id"]
        for p in persons
        if p.get("person_name", "").strip() in _PERSONS_BLOCKLIST
    }
    if blocked_pids:
        # Null participant references to blocked person_ids
        n_nulled = 0
        for r in participants:
            if r.get("person_id", "").strip() in blocked_pids:
                r["person_id"] = ""
                n_nulled += 1
        persons = [p for p in persons if p["person_id"] not in blocked_pids]
        print(f"Blocklist: removed {len(blocked_pids)} person row(s), "
              f"nulled {n_nulled} participant reference(s)")
        for pid in sorted(blocked_pids):
            print(f"  dropped person_id={pid[:24]}...")

    # ── 5a. Alias-based person merge ────────────────────────────────────────────
    # person_aliases.csv maps variant names to canonical person_ids. The identity
    # lock may not have resolved these, so we remap here: if a person's name
    # matches an alias and their person_id differs from the alias target, remap
    # the participant references and drop the duplicate person row.
    import unicodedata as _unicodedata
    def _norm_alias(name: str) -> str:
        nfkd = _unicodedata.normalize("NFKD", name)
        stripped = "".join(c for c in nfkd if not _unicodedata.combining(c))
        return re.sub(r"\s+", " ", stripped.lower().strip())

    _alias_csv = ROOT / "overrides" / "person_aliases.csv"
    _alias_remap: dict[str, str] = {}  # norm(alias) → target person_id
    _alias_remap_rows: list[dict] = []  # full rows for canon name lookup
    if _alias_csv.exists():
        with open(_alias_csv, newline="", encoding="utf-8") as _f:
            for _row in csv.DictReader(_f):
                _a = _row.get("alias", "").strip()
                _tpid = _row.get("person_id", "").strip()
                if _a and _tpid:
                    _alias_remap[_norm_alias(_a)] = _tpid
                    _alias_remap_rows.append(_row)

    # Build pid remap: person_id → target_person_id for persons whose name is an alias.
    # Also build a name→pid index for the current persons list so we can resolve
    # aliases whose target_pid doesn't exist (the target was itself aliased).
    _current_pids: set[str] = {p["person_id"] for p in persons if p.get("person_id", "").strip()}
    _name_to_pid: dict[str, str] = {}
    for p in persons:
        _name_to_pid[_norm_alias(p.get("person_name", ""))] = p["person_id"]

    _pid_remap: dict[str, str] = {}
    for p in persons:
        pname = p.get("person_name", "").strip()
        pid = p.get("person_id", "").strip()
        normed = _norm_alias(pname)
        if normed in _alias_remap:
            target = _alias_remap[normed]
            # If the target pid doesn't exist in persons, look up the target's
            # person_canon by name — the target may have been loaded under a
            # different pid (e.g. Calab Abraham → Caleb Abraham).
            if target not in _current_pids:
                # Find the alias row's person_canon and look it up by name
                # (scan alias CSV again for the canon name)
                for _row2 in _alias_remap_rows:
                    if _norm_alias(_row2.get("alias", "")) == normed:
                        canon_name = _row2.get("person_canon", "").strip()
                        resolved = _name_to_pid.get(_norm_alias(canon_name))
                        if resolved:
                            target = resolved
                        break
            if pid and target and pid != target and target in _current_pids:
                _pid_remap[pid] = target

    if _pid_remap:
        # Resolve transitive chains: if A→B and B→C, make A→C
        def _resolve_chain(pid: str) -> str:
            visited: set[str] = set()
            cur = pid
            while cur in _pid_remap and cur not in visited:
                visited.add(cur)
                cur = _pid_remap[cur]
            return cur
        _pid_remap = {k: _resolve_chain(k) for k in _pid_remap}

        # Remap participant person_ids
        n_remapped_parts = 0
        for r in participants:
            rpid = r.get("person_id", "").strip()
            if rpid in _pid_remap:
                r["person_id"] = _pid_remap[rpid]
                n_remapped_parts += 1
        # Drop remapped person rows (their participants now point to the canonical person)
        persons = [p for p in persons if p["person_id"] not in _pid_remap]
        print(f"Alias merge: remapped {len(_pid_remap)} person(s), "
              f"{n_remapped_parts} participant reference(s)")

    # ── 5b. Person-likeness gate: catch encoding corruption and junk names ─────
    # Encoding artifacts (Windows-1250 mojibake)
    _RE_QC_MOJIBAKE = re.compile(r"[¶¦±¼¿¸¹º³]")
    # Question mark embedded inside a word (encoding corruption)
    _RE_QC_EMBED_Q = re.compile(r"\w\?|\?\w")
    # Standalone question marks (incomplete/unresolved)
    _RE_QC_STANDALONE_Q = re.compile(r"(?:^|\s)\?{1,5}(?:\s|$)")
    # Characters that should not appear in canonical display names
    _RE_QC_BAD_CHARS = re.compile(r"[+=\\|/]")
    # Scoreboard codes: "IL 49", "IL 63"
    _RE_QC_SCOREBOARD = re.compile(r"^[A-Z]{2}\s+\d+$")
    # Embedded dollar amounts: "Name $25", "$350"
    _RE_QC_PRIZE = re.compile(r"\$\d+")
    # Match results: "Name 11-0 Over Name"
    _RE_QC_MATCH_RESULT = re.compile(r"\d+-\d+\s+over\b", re.IGNORECASE)
    # 3+ digit number tokens (IFPA IDs, scores, not person names)
    _RE_QC_BIG_NUMBER = re.compile(r"\b\d{3,}\b")
    # Non-person keywords (narrative, teams, tricks, event names)
    _RE_QC_NON_PERSON = re.compile(
        r"\b(Connection|Dimension|Footbag|Spikehammer|head-to-head|"
        r"being determined|Freestyler|round robin|results|"
        r"Champions|Cup\b.*\bChampions|Foot Clan|"
        r"whirlygig|whirlwind|spinning|blender|smear|"
        r"clipper|torque|butterfly|mirage|legbeater|ducking|"
        r"eggbeater|ripwalk|hopover|dropless|scorpion|matador|"
        r"symposium|swirl|drifter|vortex|superfly|"
        r"atomic|blurry|whirl|flux|dimwalk|nemesis|bedwetter|"
        r"pixie|rooted|sailing|diving|ripped|warrior|"
        r"paradon|steping|pdx|mullet|"
        r"Big Add Posse|Aerial Zone|Annual Mountain|Be Announced|"
        r"depending|highest.placed|two footbags)\b",
        re.IGNORECASE,
    )
    # Arrow/colon notation — trick sequences: "Move>Move", "Name : Move"
    _RE_QC_TRICK_NOTATION = re.compile(r"[>]|\s:\s")
    # Long compound token (>20 chars) — German joke names, junk
    _RE_QC_LONG_TOKEN = re.compile(r"\S{21,}")
    # Name with comma followed by location (city/state/country)
    # Catches "Name, Montréal" and "Name, Wichita KS" but not "Last, First"
    _RE_QC_COMMA_LOCATION = re.compile(
        r",\s*(?:Montr|Wichita|Austin|Shawinigan|Massachuss|Arizona|"
        r"Texas|Bridgewater|NJ|VA\b|KS\b)",
        re.IGNORECASE,
    )
    # Pure location entries: "City, ST" or "ST, Region, State"
    _RE_QC_LOCATION_ONLY = re.compile(
        r'^"?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*"?,\s+[A-Z][A-Za-z\s]+$'
    )
    # Entries that are entirely uppercase (> 3 chars, has space) — junk artifacts
    # Excludes single-initial entries like "A GRAVEL" (handled as abbreviated)
    _RE_QC_ALL_CAPS_JUNK = re.compile(
        r"^[A-Z]{2,}[\s-]+[A-Z]{2,}(?:[\s-]+[A-Z]{2,})*$"
    )
    # Trailing asterisk (junk markers)
    _RE_QC_TRAILING_JUNK = re.compile(r"[*]+$")
    # Single-initial abbreviated: "J Smith", "A GRAVEL", "A. Dukes" — one uppercase letter (optionally with period) + space + name
    _RE_QC_ABBREVIATED = re.compile(r"^[A-Z]\.?\s+\S")
    # Incomplete last name: "Yassin B", "Alex G" — first + single uppercase letter
    _RE_QC_INCOMPLETE_LAST = re.compile(r"^\S+\s+[A-Z]$")
    # Pure initials: "F. D."
    _RE_QC_INITIALS_ONLY = re.compile(r"^[A-Z]\.\s+[A-Z]\.$")
    # Prize suffix: "Name-prizes", "Name prize", "Name $N"
    _RE_QC_PRIZE_SUFFIX = re.compile(r"-prizes\b|\bprize\b", re.IGNORECASE)

    def _is_person_like(name: str) -> bool:
        s = name.strip()
        if not s:
            return False
        if _RE_QC_MOJIBAKE.search(s):
            return False
        if _RE_QC_EMBED_Q.search(s):
            return False
        if _RE_QC_STANDALONE_Q.search(s):
            return False
        if _RE_QC_BAD_CHARS.search(s):
            return False
        if _RE_QC_SCOREBOARD.match(s):
            return False
        if _RE_QC_PRIZE.search(s):
            return False
        if _RE_QC_MATCH_RESULT.search(s):
            return False
        if _RE_QC_BIG_NUMBER.search(s):
            return False
        if _RE_QC_NON_PERSON.search(s):
            return False
        # Commas never appear in canonical person names
        if "," in s:
            return False
        if _RE_QC_ALL_CAPS_JUNK.match(s):
            return False
        if _RE_QC_TRAILING_JUNK.search(s) and len(s.split()) >= 2:
            return False
        # Single-word names (no space)
        if " " not in s and "." not in s:
            return False
        # Single-initial abbreviated first name
        if _RE_QC_ABBREVIATED.match(s):
            return False
        # Incomplete single-character last name
        if _RE_QC_INCOMPLETE_LAST.match(s):
            return False
        # Pure initials only
        if _RE_QC_INITIALS_ONLY.match(s):
            return False
        # Prize suffix artifact
        if _RE_QC_PRIZE_SUFFIX.search(s):
            return False
        # Arrow/colon trick notation
        if _RE_QC_TRICK_NOTATION.search(s):
            return False
        # Long compound token (German joke names, junk)
        if _RE_QC_LONG_TOKEN.search(s):
            return False
        # Starts with lowercase — narrative fragment, not a person name
        if s[0].islower():
            return False
        # Contains "The" as a word — narrative or embedded nickname, not canonical
        if re.search(r"\bThe\b", s):
            return False
        # Contains quoted nickname — "Name \"the X\" Name" — alias should resolve these
        if '"' in s:
            return False
        # "VA or VT" style — contains " or " which is narrative
        if " or " in s.lower():
            return False
        return True

    qc_blocked_pids: set[str] = {
        p["person_id"]
        for p in persons
        if not _is_person_like(p.get("person_name", ""))
    }
    if qc_blocked_pids:
        n_nulled_qc = 0
        for r in participants:
            if r.get("person_id", "").strip() in qc_blocked_pids:
                r["person_id"] = ""
                n_nulled_qc += 1
        dropped_names = [p["person_name"] for p in persons if p["person_id"] in qc_blocked_pids]
        persons = [p for p in persons if p["person_id"] not in qc_blocked_pids]
        print(f"Person-likeness gate: removed {len(qc_blocked_pids)} non-person-like row(s), "
              f"nulled {n_nulled_qc} participant reference(s)")
        for dn in sorted(dropped_names):
            print(f"  dropped: {dn}")

    # ── 6. Name cleanup: strip "aka …" suffixes ────────────────────────────────
    n_aka = 0
    for p in persons:
        cleaned = strip_aka(p["person_name"])
        if cleaned != p["person_name"]:
            p["person_name"] = cleaned
            n_aka += 1
    if n_aka:
        print(f"Aka suffixes stripped: {n_aka}")

    # ── 7. Name cleanup: title-case fully-uppercase names ─────────────────────
    n_titled = 0
    for p in persons:
        cased = maybe_title_case(p["person_name"])
        if cased != p["person_name"]:
            p["person_name"] = cased
            n_titled += 1
    if n_titled:
        print(f"Title-cased: {n_titled}")

    # ── 8. Name sync: PT v52 person_canon override ────────────────────────────
    n_name_sync = 0
    for p in persons:
        pid = p.get("person_id", "").strip()
        if pid in pt51:
            canon = pt51[pid]
            if p["person_name"] != canon:
                p["person_name"] = canon
                n_name_sync += 1
    if n_name_sync:
        print(f"PT v52 name sync: {n_name_sync}")

    # ── 8b. Member-ID backfill from PT v52 legacyid ──────────────────────────
    # Persons whose member_id is blank but whose PT v52 entry carries a legacyid
    # get their member_id populated here so the platform can link to the IFPA
    # member profile.  This also makes them eligible for retention in step 11.
    n_mid_backfill = 0
    for p in persons:
        pid = p.get("person_id", "").strip()
        if not p.get("member_id", "").strip() and pid in pt51_legacyids:
            p["member_id"] = pt51_legacyids[pid]
            n_mid_backfill += 1
    if n_mid_backfill:
        print(f"Member-ID backfill from PT v52: {n_mid_backfill}")

    # ── 8c. Member-ID backfill from supplemental CSV ─────────────────────────
    # Supplemental authoritative member_ids verified against live footbag.org
    # profile pages for HOF/BAP members absent from PT v52 legacyid index.
    # Source: inputs/identity_lock/member_id_supplement.csv
    # Only fills blank member_id — never overwrites an existing value.
    if MEMBER_ID_SUPPLEMENT.exists():
        mid_supplement: dict[str, str] = {}
        with open(MEMBER_ID_SUPPLEMENT, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                pid = row.get("person_id", "").strip()
                mid = row.get("member_id", "").strip()
                if pid and mid:
                    mid_supplement[pid] = mid
        n_supp_backfill = 0
        for p in persons:
            pid = p.get("person_id", "").strip()
            if not p.get("member_id", "").strip() and pid in mid_supplement:
                p["member_id"] = mid_supplement[pid]
                n_supp_backfill += 1
        if n_supp_backfill:
            print(f"Member-ID backfill from supplement: {n_supp_backfill}")

    # ── 9. Blank name safety drop ─────────────────────────────────────────────
    n_before = len(persons)
    persons = [p for p in persons if p.get("person_name", "").strip()]
    if len(persons) < n_before:
        print(f"Blank name safety drop: {n_before - len(persons)}")

    # ── 10. Compute used_pids ─────────────────────────────────────────────────
    used_pids: set[str] = {
        r["person_id"].strip()
        for r in participants
        if r.get("person_id", "").strip()
    }

    # ── 11. Referential closure ───────────────────────────────────────────────
    # Keep persons where:
    #   (a) person_id is referenced by at least one participant row, OR
    #   (b) person_id is guaranteed by the display-name mapping (PDN v1 —
    #       identified player whose results are all sparse-filtered), OR
    #   (c) person has a member_id after step 8b backfill
    #       (PT v52 person with an IFPA profile link, worth retaining even with
    #       no surviving participant rows), OR
    #   (d) person is a BAP or HOF member.
    #
    # PT v52 membership alone (without any of the above) is no longer sufficient
    # to retain a person: anonymous PT v52 entries with no events and no profile
    # link add no value to the platform.
    n_before = len(persons)
    persons = [
        p for p in persons
        if p["person_id"] in used_pids
        or p["person_id"] in dn_map_ids
        or p.get("member_id", "").strip()
        or p.get("bap_member", "").strip() in ("1", "True", "true")
        or p.get("hof_member", "").strip() in ("1", "True", "true")
    ]
    n_closure_dropped = n_before - len(persons)
    if n_closure_dropped:
        print(f"Referential closure: dropped {n_closure_dropped} PT51 persons with no "
              f"participant rows, no member_id, no BAP/HOF")

    # ── 12. Duplicate dedup ───────────────────────────────────────────────────
    # For persons sharing the same person_name, keep the UUID with the most
    # participant references; remap the others.
    by_name: dict[str, list[str]] = defaultdict(list)
    for p in persons:
        by_name[p["person_name"]].append(p["person_id"])

    pid_ref_count = Counter(
        r["person_id"].strip()
        for r in participants
        if r.get("person_id", "").strip()
    )

    remap: dict[str, str] = {}
    for name, pids in by_name.items():
        if len(pids) <= 1:
            continue
        canonical_pid = max(pids, key=lambda p: (pid_ref_count.get(p, 0), p))
        for pid in pids:
            if pid != canonical_pid:
                remap[pid] = canonical_pid

    if remap:
        for r in participants:
            old = r.get("person_id", "").strip()
            if old in remap:
                r["person_id"] = remap[old]
        persons = [p for p in persons if p["person_id"] not in remap]
        print(f"Duplicate persons resolved: {len(remap)} removed")
        for old_pid, new_pid in sorted(remap.items()):
            name = next((p["person_name"] for p in persons if p["person_id"] == new_pid), "?")
            print(f"  {repr(name)}: {old_pid[:24]}... → {new_pid[:24]}...")

    # ── 13. Final referential-closure assert ──────────────────────────────────
    final_person_ids = {p["person_id"] for p in persons}
    dangling = [
        r for r in participants
        if r.get("person_id", "").strip()
        and r["person_id"].strip() not in final_person_ids
    ]
    if dangling:
        print(f"\nERROR: {len(dangling)} participant row(s) reference unknown person_ids:", file=sys.stderr)
        for r in dangling[:10]:
            print(f"  {r['event_key']} / {r['discipline_key']} / p{r['placement']} "
                  f"— person_id={r['person_id']}", file=sys.stderr)
        sys.exit(1)

    # ── 14. Sort persons alphabetically ───────────────────────────────────────
    persons.sort(key=lambda p: (p.get("person_name", "").lower(), p.get("person_id", "")))

    # ── 15. Write ──────────────────────────────────────────────────────────────
    write_csv(CANONICAL_IN / "events.csv",                    ev_fields,       events)
    write_csv(CANONICAL_IN / "event_disciplines.csv",         disc_fields,     disciplines)
    write_csv(CANONICAL_IN / "event_results.csv",             res_fields,      results)
    write_csv(CANONICAL_IN / "event_result_participants.csv", part_fields,     participants)
    write_csv(CANONICAL_IN / "persons.csv",                   out_pers_fields, persons)

    n_still_unresolved = sum(
        1 for r in participants if not r.get("person_id", "").strip()
    )
    print(f"\nOutput → {CANONICAL_IN}:")
    print(f"  events:       {len(events):>7,}")
    print(f"  disciplines:  {len(disciplines):>7,}")
    print(f"  results:      {len(results):>7,}")
    print(f"  participants: {len(participants):>7,}")
    print(f"  persons:      {len(persons):>7,}")
    print(f"\n  Referential closure: OK — no dangling person_id references")
    print(f"  Participants still unresolved (person_id=\"\"): {n_still_unresolved:,}")
    print("\nDone.")


if __name__ == "__main__":
    main()
