#!/usr/bin/env python3
"""
pipeline/historical/export_historical_csvs.py

Export canonical relational CSVs from pipeline outputs.

Inputs (all in out/):
  stage2_canonical_events.csv   — event metadata + team structure in placements_json
  Placements_ByPerson.csv       — identity-locked placements (not directly used;
                                   person_id is resolved via PT token lookup instead)
  Coverage_ByEventDivision.csv  — coverage flags per (event, division)
  Persons_Truth.csv             — canonical person records

Outputs (in ~/projects/footbag-platform/legacy_data/event_results/canonical_input/):
  events.csv                    — one row per event
  event_disciplines.csv         — one row per discipline within an event
  event_results.csv             — one row per placement slot (deduped across ties)
  event_result_participants.csv — one row per participant in a placement slot
  persons.csv                   — canonical person export (extended: stats, honors, freestyle)

Natural keys:
  events:              event_key
  event_disciplines:   (event_key, discipline_key)
  event_results:       (event_key, discipline_key, placement)
  event_result_participants: (event_key, discipline_key, placement, participant_order)

Notes on ties:
  When multiple players/teams share a placement number, they all map to the same
  event_results row. participant_order increments sequentially across ALL participants
  at that placement slot regardless of team_type (e.g., two tied singles players →
  orders 1,2; two tied doubles teams → orders 1,2,3,4).

Notes on unresolved persons:
  Participants without a person_id in Persons_Truth appear with person_id="" and
  display_name set to the raw name from stage2.
"""
import csv
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT      = Path(__file__).resolve().parents[2]
OUT       = ROOT / "out"
CANONICAL = OUT / "canonical"
OVERRIDES = ROOT / "overrides"

csv.field_size_limit(10_000_000)


# ── Event identity overrides (loaded from overrides/) ─────────────────────────

def _load_event_equivalence() -> tuple[set[str], dict[str, str]]:
    """
    Read overrides/event_equivalence.csv.

    The event_id and canonical_event_id columns use canonical event_key notation
    (e.g. "1980_worlds_oregon_city"), NOT stage2 legacy numeric IDs.
    Both operations are therefore applied post-slug (after event_key_map is built).

    Returns:
      drop_keys    — canonical event_keys to drop from the output (supersede losers)
      key_renames  — old canonical event_key → new canonical event_key (supersede winners)

    action=merge and action=hold are no-ops here (handled in 05p5 / not yet).
    """
    path = OVERRIDES / "event_equivalence.csv"
    drop_keys:   set[str]       = set()
    key_renames: dict[str, str] = {}
    if not path.exists():
        return drop_keys, key_renames
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            action        = (row.get("action") or "").strip().lower()
            event_key     = (row.get("event_id") or "").strip()
            canonical_key = (row.get("canonical_event_id") or "").strip()
            if not event_key or action in ("", "hold", "merge"):
                continue
            if action == "supersede":
                # This row is the loser — drop it from canonical output
                drop_keys.add(event_key)
            elif action == "canonical" and canonical_key:
                # This row is the winner — rename it to the canonical key
                key_renames[event_key] = canonical_key
    return drop_keys, key_renames


def _load_event_renames() -> dict[str, str]:
    """
    Read overrides/event_rename.csv.
    Returns old_event_key → new_event_key mapping applied after slug generation.
    """
    path = OVERRIDES / "event_rename.csv"
    renames: dict[str, str] = {}
    if not path.exists():
        return renames
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            old = (row.get("event_id")     or "").strip()
            new = (row.get("new_event_id") or "").strip()
            if old and new and old != new:
                renames[old] = new
    return renames


_EQUIV_DROP_KEYS, _EQUIV_KEY_RENAMES = _load_event_equivalence()
_POST_SLUG_RENAMES                    = _load_event_renames()

if _EQUIV_DROP_KEYS:
    print(f"  Event equivalence: {len(_EQUIV_DROP_KEYS)} supersede-loser(s) will be dropped")
if _EQUIV_KEY_RENAMES:
    print(f"  Event equivalence: {len(_EQUIV_KEY_RENAMES)} supersede-winner key rename(s) loaded")
if _POST_SLUG_RENAMES:
    print(f"  Event renames:     {len(_POST_SLUG_RENAMES)} post-slug rename(s) loaded")


# ── Helpers ───────────────────────────────────────────────────────────────────

def clean_display_str(s: str) -> str:
    """Strip invisible/garbage Unicode from display strings.

    - U+00AD (soft hyphen): zero-width formatting char from HTML &shy; — strip silently.
    - U+FFFD (replacement char): appears when source had &shy; that was mis-decoded.
      When followed by an uppercase letter (e.g. Rou\ufffdTines), lowercase that letter
      so "RouTines" → "Routines".
    """
    # U+FFFD followed by uppercase → lowercase that letter
    s = re.sub(r"\ufffd([A-Z])", lambda m: m.group(1).lower(), s)
    # Strip any remaining U+FFFD or U+00AD
    s = s.replace("\ufffd", "").replace("\u00ad", "")
    return s


def slugify(text: str) -> str:
    """Lowercase, ASCII-safe slug. Collapses non-alphanumeric runs to underscores."""
    s = text.lower().strip()
    # Replace common separators and punctuation with space first
    s = re.sub(r"['\u2019\u2018\u201c\u201d]", "", s)        # strip apostrophes/quotes
    s = re.sub(r"[^a-z0-9]+", "_", s)                         # non-alphanum → _
    s = re.sub(r"_+", "_", s).strip("_")                      # collapse & trim
    return s[:80]


def infer_team_type(division_canon: str) -> str:
    dl = division_canon.lower()
    if re.search(r"\bdoubles?\b|\bpairs?\b|\bdoble\b|\bdobles\b|\bdouble\b", dl):
        return "doubles"
    if re.search(r"\bteam\b", dl):
        return "team"
    return "singles"


_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}


def parse_date_range(s: str) -> tuple[str, str]:
    """
    Parse stage2 date strings into ISO start_date and end_date.

    Handles:
      "July 31-August 6, 2011"   → ("2011-07-31", "2011-08-06")
      "August 3-9, 2019"         → ("2019-08-03", "2019-08-09")
      "March 15, 2008"           → ("2008-03-15", "2008-03-15")
    Returns ("", "") if unparseable.
    """
    s = s.strip()
    # Month D-Month D, YYYY
    m = re.match(r"(\w+)\s+(\d+)\s*-\s*(\w+)\s+(\d+),\s*(\d{4})", s)
    if m:
        m1, d1, m2, d2, y = m.groups()
        mo1 = _MONTHS.get(m1.lower())
        mo2 = _MONTHS.get(m2.lower())
        if mo1 and mo2:
            return f"{y}-{mo1:02d}-{int(d1):02d}", f"{y}-{mo2:02d}-{int(d2):02d}"
    # Month D-D, YYYY
    m = re.match(r"(\w+)\s+(\d+)\s*-\s*(\d+),\s*(\d{4})", s)
    if m:
        mn, d1, d2, y = m.groups()
        mo = _MONTHS.get(mn.lower())
        if mo:
            return f"{y}-{mo:02d}-{int(d1):02d}", f"{y}-{mo:02d}-{int(d2):02d}"
    # Month D, YYYY  (single day)
    m = re.match(r"(\w+)\s+(\d+),\s*(\d{4})", s)
    if m:
        mn, d, y = m.groups()
        mo = _MONTHS.get(mn.lower())
        if mo:
            iso = f"{y}-{mo:02d}-{int(d):02d}"
            return iso, iso
    return "", ""


# Regions that are NOT countries — map to (canonical_country, canonical_region)
_REGION_NOT_COUNTRY: dict[str, tuple[str, str]] = {
    "basque country": ("Spain", "Basque Country"),
    "euskadi":        ("Spain", "Basque Country"),
    "pais vasco":     ("Spain", "Basque Country"),
    "catalonia":      ("Spain", "Catalonia"),
    "cataluña":       ("Spain", "Catalonia"),
    "scotland":       ("United Kingdom", "Scotland"),
    "wales":          ("United Kingdom", "Wales"),
    "england":        ("United Kingdom", "England"),
    "northern ireland": ("United Kingdom", "Northern Ireland"),
}


def parse_location(location: str) -> tuple[str, str, str]:
    """
    Best-effort parse of a raw location string into (city, region, country).

    Handles:
      "City, Region, Country"      → ("City", "Region", "Country")
      "Region, Country"            → ("", "Region", "Country")
      "City, Country"              → ("City", "", "Country")   (when last part is known country-like)
      "Country"                    → ("", "", "Country")

    Post-processing:
      Any part that matches _REGION_NOT_COUNTRY is replaced with the canonical
      country, and the region is set to the canonical region name.
      e.g. "Bizkaia, Basque Country" → city="Bizkaia", region="Basque Country", country="Spain"
    """
    if not location:
        return "", "", ""
    # Some locations have multi-part oddities like "Salem, OR / Harrisburg, PA, USA"
    # Just take the first segment before "/" if present
    location = location.split("/")[0].strip()
    parts = [p.strip() for p in location.split(",") if p.strip()]
    if len(parts) >= 3:
        city, region, country = parts[0], parts[1], parts[-1]
    elif len(parts) == 2:
        city, region, country = parts[0], "", parts[1]
    elif len(parts) == 1:
        city, region, country = "", "", parts[0]
    else:
        return "", "", ""

    # Normalise: if country is actually a sub-national region, fix it
    country_lc = country.lower().strip()
    if country_lc in _REGION_NOT_COUNTRY:
        canonical_country, canonical_region = _REGION_NOT_COUNTRY[country_lc]
        # preserve any existing region from the string; fall back to canonical region
        region = region or canonical_region
        if not region:
            region = canonical_region
        country = canonical_country

    # Also check if city itself is a known region-not-country (e.g. "Country, Spain")
    city_lc = city.lower().strip()
    if city_lc in _REGION_NOT_COUNTRY and not region:
        canonical_country, canonical_region = _REGION_NOT_COUNTRY[city_lc]
        region = canonical_region
        city = ""

    return city, region, country


def derive_status(placements_count: int, coverage_flags: list[str]) -> str:
    """
    "no_results"  — event has no placements in our dataset
    "completed"   — event ran; we have results (coverage may vary)
    """
    if placements_count == 0:
        return "no_results"
    return "completed"


def write_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"  Wrote {path.name} ({len(rows):,} rows)")


# ── Name normalization for PT lookup ──────────────────────────────────────────
# Strip diacritics including Polish ł (not NFD-decomposable), Norwegian ø, etc.
_TRANSLITERATE = str.maketrans("łŁøØđĐðÞŋ", "lLoOdDdTn")

def _norm_name(s: str) -> str:
    """Normalize a player name for PT lookup.
    Handles: U+FFFD replacement chars (mojibake), transliteration (ł→l etc.),
    NFD diacritic stripping, lowercase."""
    # Strip U+FFFD replacement characters (corrupt encoding artifact from mirror)
    # so "Fran\uFFFDois" → "Franois" which matches the alias key.
    s = s.replace("\ufffd", "").replace("\u00ad", "")
    s = s.translate(_TRANSLITERATE)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower().strip())

# ── Load Persons_Truth — build resolution indexes ─────────────────────────────
#
# Source: inputs/identity_lock/Persons_Truth_Final_v*.csv (latest version).
# The previous out/Persons_Truth.csv producer (04_build_analytics.py) is deprecated
# and no longer runs in the rebuild stage; the identity-lock file is the same data
# (04 historically just cp'd it on first run) and is the authoritative source in
# the new pipeline. A single pass builds both pt_rows and the closure-check set
# (_pt51_person_ids), which used to be loaded separately further below.

_pt51_lock_files = sorted(
    (ROOT / "inputs" / "identity_lock").glob("Persons_Truth_Final_v*.csv")
)
if not _pt51_lock_files:
    raise FileNotFoundError(
        "No Persons_Truth_Final_v*.csv found in inputs/identity_lock/ — "
        "cannot build person resolution indexes."
    )
_pt_source = _pt51_lock_files[-1]

print(f"Loading Persons_Truth from {_pt_source.name}...")
token_to_person: dict[str, str] = {}   # player_token_uuid → effective_person_id
names_to_person: dict[str, str] = {}   # _norm_name(player_name_seen) → effective_person_id
pt_rows: list[dict] = []
_pt51_person_ids: set[str] = set()
with open(_pt_source, newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        pt_rows.append(row)
        pid = row["effective_person_id"]
        if pid.strip():
            _pt51_person_ids.add(pid.strip())
        for tok in row["player_ids_seen"].split(" | "):
            tok = tok.strip()
            if tok:
                token_to_person[tok] = pid
        # Always index the canonical name itself (player_names_seen may not include it)
        _canon = row.get("person_canon", "").strip()
        if _canon:
            names_to_person[_norm_name(_canon)] = pid
        for name in re.split(r"\s*\|\s*", row["player_names_seen"]):
            name = name.strip()
            if name:
                names_to_person[_norm_name(name)] = pid
        # Also index aliases_presentable so alias forms resolve without a PT rebuild.
        for alias in re.split(r"\s*\|\s*", row.get("aliases_presentable", "")):
            alias = alias.strip()
            if alias and len(alias) > 3:
                names_to_person.setdefault(_norm_name(alias), pid)

print(f"  {len(pt_rows):,} persons, {len(token_to_person):,} tokens, {len(names_to_person):,} names indexed (pre-aliases)")
print(f"  PT lock loaded: {len(_pt51_person_ids):,} person_ids ({_pt_source.name})")

# player_ids_seen lookup (for persons.csv export)
pt_player_ids: dict[str, str] = {}    # effective_person_id → pipe-sep player_ids_seen
for row in pt_rows:
    pt_player_ids[row["effective_person_id"]] = row["player_ids_seen"]

# Valid PT person_id set — used by _clean_pid to reject player-level UUIDs not in PT
_pt_person_ids: set[str] = {r["effective_person_id"] for r in pt_rows}

# ── Load person_aliases.csv — extend resolution index ─────────────────────────
# Stale IDs (pre-merge) are recovered by matching _norm_name(person_canon) against PT.
_pt_by_norm_canon: dict[str, str] = {_norm_name(r["person_canon"]): r["effective_person_id"]
                                      for r in pt_rows}
_aliases_csv = Path(__file__).parent.parent.parent / "overrides" / "person_aliases.csv"
_aliases_loaded = _aliases_stale_recovered = _aliases_stale_lost = 0
if _aliases_csv.exists():
    with open(_aliases_csv, newline="", encoding="utf-8") as _f:
        for _row in csv.DictReader(_f):
            _alias = _row.get("alias", "").strip()
            _pid   = _row.get("person_id", "").strip()
            _canon = _row.get("person_canon", "").strip()
            if not _alias:
                continue
            # Recover stale IDs: if person_id not in PT, look up by canon
            if _pid not in _pt_person_ids:
                _pid = _pt_by_norm_canon.get(_norm_name(_canon), "")
                if _pid:
                    _aliases_stale_recovered += 1
                else:
                    _aliases_stale_lost += 1
                    continue
            names_to_person.setdefault(_norm_name(_alias), _pid)
            _aliases_loaded += 1
    print(f"  person_aliases.csv: {_aliases_loaded} loaded, "
          f"{_aliases_stale_recovered} stale-recovered, {_aliases_stale_lost} lost")
    print(f"  {len(names_to_person):,} total names in resolution index")

# ── Load member_id assignments ─────────────────────────────────────────────────

print("Loading member_id_assignments.csv...")
_member_id_csv = ROOT / "out" / "member_id_enrichment" / "member_id_assignments.csv"
member_id_map: dict[str, str] = {}   # effective_person_id → footbag.org member_id
if _member_id_csv.exists():
    with open(_member_id_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            pid = row.get("effective_person_id", "").strip()
            mid = row.get("member_id", "").strip()
            if pid and mid:
                member_id_map[pid] = mid
    print(f"  {len(member_id_map):,} persons with member_id")
else:
    print(f"  (member_id_assignments.csv not found — skipping)")


_TRAILING_PAREN = re.compile(r"\s*\([^)]+\)\s*$")

def resolve_person_id(player_id: str | None, player_name: str) -> str:
    """
    Three-level resolution:
      1. player_id (UUID5 token) → PT player_ids_seen  (exact, fast)
      2. norm(player_name)       → PT player_names_seen  (catches alias variants)
      2b. strip trailing (Country/State) suffix and retry
      3. "" — genuinely unresolved (noise, handles, city names, etc.)
    """
    if player_id and player_id in token_to_person:
        return token_to_person[player_id]
    if player_name:
        n = _norm_name(player_name)
        if n in names_to_person:
            return names_to_person[n]
        # Strip trailing parenthetical (e.g. "Name (Poland)" → "Name")
        stripped = _TRAILING_PAREN.sub("", player_name).strip()
        if stripped != player_name:
            n2 = _norm_name(stripped)
            if n2 in names_to_person:
                return names_to_person[n2]
    return ""


# ── Load Coverage ─────────────────────────────────────────────────────────────
#
# Source: out/Placements_ByPerson.csv (produced by 02p5_player_token_cleanup.py,
# which propagates the coverage_flag column unchanged from the identity-lock file
# inputs/identity_lock/Placements_ByPerson_v*.csv). The previous standalone
# Coverage_ByEventDivision.csv producer (04_build_analytics.py) is deprecated and
# no longer runs in the rebuild stage.

print("Loading coverage flags from Placements_ByPerson.csv...")
coverage: dict[tuple[str, str], str] = {}  # (event_id, division_canon) → coverage_flag
with open(OUT / "Placements_ByPerson.csv", newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        flag = (row.get("coverage_flag") or "").strip()
        if not flag:
            continue
        key = (row.get("event_id", ""), row.get("division_canon", ""))
        coverage[key] = flag
print(f"  {len(coverage):,} (event, division) coverage flags")


# ── Load events_normalized for curated location / metadata overrides ──────────
# Keyed by legacy_event_id. New events not yet in this file fall back to
# parse_location() automatically — no manual step required for new data.

print("Loading events_normalized.csv...")
_norm_csv = ROOT / "inputs" / "events_normalized.csv"
events_normalized: dict[str, dict] = {}   # legacy_event_id → row
if _norm_csv.exists():
    with open(_norm_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            eid = row.get("legacy_event_id", "").strip()
            if eid:
                events_normalized[eid] = row
    print(f"  {len(events_normalized):,} events with normalized location/metadata")
else:
    print(f"  (events_normalized.csv not found — all locations will be auto-parsed)")


# ── Load Stage2 ───────────────────────────────────────────────────────────────

print("Loading stage2_canonical_events.csv...")
with open(OUT / "stage2_canonical_events.csv", newline="", encoding="utf-8") as f:
    stage2_rows = list(csv.DictReader(f))
print(f"  {len(stage2_rows):,} events")

DROP_EVENT_IDS = {
    "9921901",
}

EVENT_NAME_OVERRIDES = {
    "2001982005": "World Footbag Championships",
}

stage2_rows = [r for r in stage2_rows if str(r["event_id"]) not in DROP_EVENT_IDS]


# ── Generate canonical event_key slugs (event_<year>_<series_or_name>[_<place>]) ──

# Optional exact overrides by legacy event_id
# Use this for one-off cases where you want to pin the final canonical event_key.
EVENT_KEY_OVERRIDES_BY_ID = {
    # "941418343": "event_1999_worlds_palo_alto",
    # "1487797845": "event_2012_eurochamp_prague",
}

# Optional recurring-series overrides by normalized event-name pattern.
# These let you force stable canonical short names for known recurring events.
EVENT_SERIES_OVERRIDES = [
    # (regex_pattern, canonical_series_slug, place_policy)
    # place_policy ∈ {"always_city", "never", "series_only", "maybe_city"}

    (r"\bworld footbag championships?\b", "worlds", "always_city"),
    (r"\bifpa worlds?\b", "worlds", "always_city"),
    (r"\bu\.?s\.?\s*open\b", "usopen", "always_city"),
    (r"\beuropean championships?\b", "eurochamp", "always_city"),
    (r"\beuro(p|pean)?\b", "eurochamp", "always_city"),

    (r"\bfuntastic\b", "funtastic", "never"),
    (r"\bbeaver open\b", "beaver_open", "never"),
    (r"\bheart of footbag\b", "heartoffootbag", "never"),
    (r"\btexas state\b", "texas_state", "maybe_city"),
    (r"\bfall (jam|party|classic)\b", "falljam", "maybe_city"),
    (r"\bspring (jam|classic)\b", "springjam", "maybe_city"),
    (r"\bfootbag (jam|open)\b", "footbagjam", "maybe_city"),
    (r"\brussian series\b", "russian", "maybe_city"),
    (r"\bfall footbag party\b|\bfall party\b", "fallparty", "maybe_city"),
    (r"\bbasque\b", "basque", "maybe_city"),

    (r"\beastern? region(als?)?\b", "eastregion", "series_only"),
    (r"\bwestern? region(als?)?\b", "westregion", "series_only"),
    (r"\bmountain region(als?)?\b", "mountainregion", "series_only"),

    (r"\bfinnish\b", "finnish", "maybe_city"),
    (r"\bemerald city\b", "emeraldcity", "never"),
    (r"\blake erie\b", "lakeerie", "never"),
    (r"\bakisphere\b", "akisphere", "never"),
    (r"\bjfk\b", "jfk", "maybe_city"),
]

def normalize_country(country: str) -> str:
    c = slugify(country).replace("_", "")
    mapping = {
        "unitedstates": "usa",
        "usa": "usa",
        "us": "usa",
        "unitedkingdom": "uk",
        "greatbritain": "uk",
    }
    return mapping.get(c, c or "")


def clean_place_token(city: str) -> str:
    """Shortest stable place token for slug use."""
    normalized = unicodedata.normalize("NFKD", city or "").encode("ascii", "ignore").decode()
    token = slugify(normalized)
    # keep only first token for hashtag-style brevity unless city is multiword and needed
    # common cases like "new_york" or "san_francisco" should remain intact
    return token


def _contains_any(text: str, patterns: list[str]) -> bool:
    return any(re.search(p, text) for p in patterns)


def canonical_series_slug(event_name: str) -> tuple[str, str]:
    """
    Return (series_slug, place_policy)

    place_policy:
      - "always_city"  -> include host city
      - "never"        -> omit place
      - "series_only"  -> omit place (regional series)
      - "maybe_city"   -> include city only if needed for uniqueness
    """
    n = (event_name or "").lower().strip()
    n = re.sub(r"\b(singles|doubles|ffa|anniversary|sm|in)\b", "", n)
    n = re.sub(r"\s+", " ", n).strip()

    # 0) explicit recurring-series overrides first
    for pattern, slug, policy in EVENT_SERIES_OVERRIDES:
        if re.search(pattern, n):
            return slug, policy

    # 1) default recurring majors / stable named events / fallback

    # recurring global majors
    if _contains_any(n, [
        r"\bworld\b", r"\bworlds\b", r"\bworld championship\b", r"\bworld championships\b",
        r"\bifpa world\b", r"\bworld footbag championships?\b"
    ]):
        return "worlds", "always_city"

    if _contains_any(n, [
        r"\bu\.?s\.?\s*open\b", r"\bus open\b"
    ]):
        return "usopen", "always_city"

    if _contains_any(n, [
        r"\beuropean championship\b", r"\beuropean championships\b",
        r"\beuros\b", r"\beuros?\b", r"\beuropean open\b"
    ]):
        return "eurochamp", "always_city"

    # stable named recurring events
    stable_named = [
        (["funtastic"], "funtastic", "never"),
        (["beaver open", "beaver"], "beaver_open", "never"),
        (["heart of footbag"], "heartoffootbag", "never"),
        (["emerald city", "emeraldcity"], "emeraldcity", "never"),
        (["lake erie", "lakeerie"], "lakeerie", "never"),
        (["akisphere"], "akisphere", "never"),
        (["jfk"], "jfk", "never"),
        (["finnish open", "finnish championship", "finnish championships"], "finnish", "maybe_city"),
    ]
    for variants, slug, policy in stable_named:
        if any(v in n for v in variants):
            return slug, policy

    # regional series
    if _contains_any(n, [r"\beast(ern)? region", r"\beast regionals?\b", r"\beast coast\b"]):
        return "eastregion", "series_only"
    if _contains_any(n, [r"\bwest(ern)? region", r"\bwest regionals?\b", r"\bwestern regionals?\b"]):
        return "westregion", "series_only"
    if _contains_any(n, [r"\bmountain region", r"\bmountain regionals?\b", r"\bmountainregional\b"]):
        return "mountainregion", "series_only"

    # fallback: cleaned short event name
    return fallback_short_event_name(event_name), "maybe_city"


def fallback_short_event_name(event_name: str) -> str:
    """
    Shortest stable cleaned name for non-recurring or not-yet-mapped events.
    Removes edition numbers, sponsor names, governing-body prefixes, filler words.
    """
    n = (event_name or "").lower().strip()

    # strip common boilerplate
    n = re.sub(r"\b\d+(st|nd|rd|th)\b", " ", n)         # edition numbers
    n = re.sub(r"\b\d{4}\b", " ", n)                    # embedded years
    n = re.sub(r"\bifpa\b", " ", n)
    n = re.sub(r"\bworld footbag association\b", " ", n)
    n = re.sub(r"\bwfa\b", " ", n)
    n = re.sub(r"\binc\b|\bllc\b", " ", n)
    n = re.sub(r"^\s*(?:\d+[a-z]{0,2}\b[\s\-_:/]*)+", " ", n)  # numeric-leading tokens
    n = re.sub(r"\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b", " ", n)
    n = re.sub(r"\bstage\b", " ", n)
    n = re.sub(r"\bseries\b", " ", n)
    n = re.sub(
        r"\b(united states|u\.?s\.?a?\.?|usa|us|canada|united kingdom|u\.?k\.?|uk)\b\s*$",
        " ",
        n,
    )  # dangling country codes

    # strip sponsor / filler / generic competition words
    stop = {
        "the", "and", "of", "footbag", "freestyle", "net",
        "championship", "championships", "open", "classic",
        "cup", "tournament", "jam", "festival", "annual",
        "international", "regional", "regionals", "presented",
        "sponsored", "by"
    }

    words = [w for w in slugify(n).split("_") if w]
    useful = [w for w in words if w not in stop]

    if not useful:
        return "event"

    # keep short, hashtag-like
    return "_".join(useful[:3])


def make_candidate_event_key(eid: str, year: str, event_name: str, city: str, country: str) -> str:
    # exact pinned override wins first
    if str(eid) in EVENT_KEY_OVERRIDES_BY_ID:
        return EVENT_KEY_OVERRIDES_BY_ID[str(eid)]

    year_slug = str(year or "unknown")[:4]
    series_slug, place_policy = canonical_series_slug(event_name)
    place_slug = clean_place_token(city)

    base = f"{year_slug}_{series_slug}"

    if place_policy == "always_city":
        return f"{base}_{place_slug}" if place_slug else base

    if place_policy in {"never", "series_only"}:
        return base

    # maybe_city handled later during collision resolution
    return base


# pass 1: generate base candidates
candidate_to_eids: dict[str, list[str]] = defaultdict(list)
event_meta_for_key: dict[str, tuple[str, str, str, str, str]] = {}  # (year, name, city, country, date)
candidate_map: dict[str, str] = {}

for row in stage2_rows:
    eid = str(row["event_id"])
    year = row["year"] or "unknown"
    city, _region, country = parse_location(row.get("location", "") or "")
    event_name = EVENT_NAME_OVERRIDES.get(eid, row.get("event_name", "") or "")
    date = str(row.get("date", "") or "")

    candidate = make_candidate_event_key(eid, year, event_name, city, country)
    candidate_map[eid] = candidate
    candidate_to_eids[candidate].append(eid)
    event_meta_for_key[eid] = (str(year), event_name, city, country, date)


# pass 2: resolve collisions
event_key_map: dict[str, str] = {}

for candidate, eids in candidate_to_eids.items():
    if len(eids) == 1:
        event_key_map[eids[0]] = candidate
        continue

    # only maybe_city events should get a city added here
    with_city = {}
    city_counts = Counter()

    for eid in eids:
        year, event_name, city, country, _date = event_meta_for_key[eid]
        series_slug, place_policy = canonical_series_slug(event_name)
        place_slug = clean_place_token(city)

        # default: keep candidate as-is
        city_key = candidate

        # only maybe_city events should get a city added here
        if place_policy == "maybe_city" and place_slug:
            if not candidate.endswith(f"_{place_slug}"):
                city_key = f"{candidate}_{place_slug}"

        with_city[eid] = city_key
        city_counts[city_key] += 1

    unresolved = []
    for eid in eids:
        ck = with_city[eid]
        if city_counts[ck] == 1:
            event_key_map[eid] = ck
        else:
            unresolved.append(eid)

    # final fallback: assign deterministic ordinal suffixes (_2, _3, …)
    # instead of appending the raw legacy_event_id.
    # Group the remaining unresolved eids by their city_key, then sort each
    # group deterministically: (date_str, event_name_lower, eid) so that
    # assignment is stable across rebuilds without exposing legacy IDs.
    unresolved_by_ck: dict[str, list[str]] = defaultdict(list)
    for eid in unresolved:
        unresolved_by_ck[with_city[eid]].append(eid)

    for ck, ck_eids in unresolved_by_ck.items():
        ck_eids_sorted = sorted(
            ck_eids,
            key=lambda e: (
                event_meta_for_key[e][4] or event_meta_for_key[e][0],  # date else year
                event_meta_for_key[e][1].lower(),                       # event_name
                e,                                                       # eid tie-break
            ),
        )
        for idx, eid in enumerate(ck_eids_sorted):
            # first event keeps the base key; subsequent events get _2, _3, …
            event_key_map[eid] = ck if idx == 0 else f"{ck}_{idx + 1}"

collisions = sum(1 for eids in candidate_to_eids.values() if len(eids) > 1)
ordinal_fallbacks = sum(
    1 for eid, key in event_key_map.items()
    if key.rsplit("_", 1)[-1].isdigit() and not str(eid).endswith(key.rsplit("_", 1)[-1])
)
if collisions:
    print(f"  NOTE: {collisions} event-key collision group(s) resolved with city and/or ordinal suffix (_2, _3, …)")
    print(f"  NOTE: {ordinal_fallbacks} event(s) received an ordinal suffix")

# ── Apply post-slug overrides (supersede + rename) ────────────────────────────
# Both operate on canonical event_keys generated above.
# Runs after collision resolution so ordinal suffixes are already assigned.
#
# Order:
#   1. Supersede drops:   remove loser event_ids from event_key_map entirely.
#   2. Supersede renames: rename winner keys (e.g. _2 → base key).
#   3. Explicit renames:  apply event_rename.csv corrections.
#
# A final collision check ensures no two event_ids share the same event_key.

# Step 1 — drop supersede losers
_dropped_eids = [eid for eid, k in event_key_map.items() if k in _EQUIV_DROP_KEYS]
for _eid in _dropped_eids:
    del event_key_map[_eid]
if _dropped_eids:
    print(f"  NOTE: {len(_dropped_eids)} supersede-loser event(s) dropped from output")
    stage2_rows = [r for r in stage2_rows if str(r["event_id"]) not in
                   {str(_eid) for _eid in _dropped_eids}]

# Step 2 — rename supersede winners
_winner_renames = 0
for _eid in list(event_key_map):
    _old = event_key_map[_eid]
    if _old in _EQUIV_KEY_RENAMES:
        event_key_map[_eid] = _EQUIV_KEY_RENAMES[_old]
        _winner_renames += 1
if _winner_renames:
    print(f"  NOTE: {_winner_renames} supersede-winner key(s) renamed via event_equivalence.csv")

# Step 3 — apply event_rename.csv
_renamed_count = 0
for _eid in list(event_key_map):
    _old = event_key_map[_eid]
    if _old in _POST_SLUG_RENAMES:
        event_key_map[_eid] = _POST_SLUG_RENAMES[_old]
        _renamed_count += 1
if _renamed_count:
    print(f"  NOTE: {_renamed_count} event key(s) renamed via event_rename.csv")

# Final collision check — all three steps combined must not create duplicates
_final_keys   = list(event_key_map.values())
_final_dupes  = [k for k, n in Counter(_final_keys).items() if n > 1]
if _final_dupes:
    print("FATAL: post-slug overrides produced duplicate event_key values:")
    for _dk in _final_dupes:
        _culprits = [_e for _e, _k in event_key_map.items() if _k == _dk]
        print(f"  {_dk!r} → stage2 ids: {_culprits}")
    raise SystemExit(1)

# ── Sanity audit for generated event_key values ───────────────────────────────

def sanity_bucket(event_key: str) -> str:
    if "_worlds_" in event_key or event_key.endswith("_worlds"):
        return "worlds"
    if "_usopen_" in event_key or event_key.endswith("_usopen"):
        return "usopen"
    if "_eurochamp_" in event_key or event_key.endswith("_eurochamp"):
        return "eurochamp"
    if "_funtastic" in event_key:
        return "funtastic"
    if "_beaver_open" in event_key:
        return "beaver_open"
    if "_heartoffootbag" in event_key:
        return "heartoffootbag"
    if "_eastregion" in event_key:
        return "eastregion"
    if "_westregion" in event_key:
        return "westregion"
    if "_mountainregion" in event_key:
        return "mountainregion"
    return "other"

print("  Event-key sanity audit:")

# show a few representative examples by bucket
bucketed = defaultdict(list)
for eid, ek in event_key_map.items():
    bucketed[sanity_bucket(ek)].append((eid, ek))

for bucket in [
    "worlds", "usopen", "eurochamp",
    "funtastic", "beaver_open", "heartoffootbag",
    "eastregion", "westregion", "mountainregion",
    "other"
]:
    items = bucketed.get(bucket, [])
    if not items:
        continue
    print(f"    {bucket}: {len(items)}")
    for eid, ek in sorted(items)[:5]:
        print(f"      {eid} -> {ek}")

# lightweight warnings
bad_prefix = [ek for ek in event_key_map.values() if not re.fullmatch(r"\d{4}_[a-z0-9_]+", ek)]
if bad_prefix:
    print(f"  WARN: {len(bad_prefix)} event_key values do not match expected pattern <year>_<slug>[_<place>]")
    for ek in bad_prefix[:10]:
        print(f"    bad pattern: {ek}")

too_long = [ek for ek in event_key_map.values() if len(ek) > 48]
if too_long:
    print(f"  WARN: {len(too_long)} event_key values exceed 48 chars (consider adding overrides)")
    for ek in too_long[:10]:
        print(f"    long: {ek}")

legacy_suffix = [ek for ek in event_key_map.values() if re.search(r"_\d{6,}$", ek)]
if legacy_suffix:
    print(f"  NOTE: {len(legacy_suffix)} event_key values required legacy_event_id suffix fallback")
    for ek in legacy_suffix[:10]:
        print(f"    fallback: {ek}")

print("  Recurring-series spot check:")
for eid, ek in sorted(event_key_map.items()):
    if any(tag in ek for tag in ["_worlds", "_usopen", "_eurochamp", "_eastregion", "_westregion", "_mountainregion", "_finnish"]):
        print(f"    {eid} -> {ek}")


# ── Load PBP — authoritative source for participant/discipline data ────────────
# Replaces reading placements_json from stage2. PBP is the identity-locked gold
# standard: canonical person names, __NON_PERSON__ markers, all manual patches.
# stage2 is used only for event metadata (name, date) and event_key generation.

print("Loading Placements_ByPerson.csv (authoritative participant source)...")

# event_id → country for person stats; prefer curated events_normalized location
_eid_country: dict[str, str] = {}
for _r in stage2_rows:
    _n     = events_normalized.get(_r["event_id"])
    _cntry = (_n.get("country", "") if _n else "") or ""
    if not _cntry:
        _, _, _cntry = parse_location(_r.get("location", "") or "")
    if _cntry:
        _eid_country[_r["event_id"]] = _cntry

pbp_by_event: dict[str, list[dict]] = defaultdict(list)
_pbp_stats:   dict[str, dict]       = {}

with open(OUT / "Placements_ByPerson.csv", newline="", encoding="utf-8") as _f:
    for _row in csv.DictReader(_f):
        _eid = _row["event_id"]
        pbp_by_event[_eid].append(_row)
        _pid = (_row.get("person_id") or "").strip()
        if _pid and _pid != "__NON_PERSON__":
            _yr    = _row.get("year", "")
            _cntry = _eid_country.get(_eid, "")
            if _pid not in _pbp_stats:
                _pbp_stats[_pid] = {
                    "years": set(), "event_ids": set(),
                    "placement_count": 0, "countries": Counter(),
                }
            _s = _pbp_stats[_pid]
            _s["placement_count"] += 1
            _s["event_ids"].add(_eid)
            if _yr:
                try:   _s["years"].add(int(_yr))
                except ValueError: pass
            if _cntry:
                _s["countries"][_cntry] += 1

_pbp_total = sum(len(v) for v in pbp_by_event.values())
print(f"  {_pbp_total:,} placement rows, {len(pbp_by_event):,} events covered")

# person-level country overrides (nationality corrections where event-location heuristic is wrong)
_COUNTRY_OVERRIDES_PATH = ROOT / "inputs" / "person_country_overrides.csv"
_person_country_overrides: dict[str, str] = {}
if _COUNTRY_OVERRIDES_PATH.exists():
    with open(_COUNTRY_OVERRIDES_PATH, newline="", encoding="utf-8") as _f:
        for _r in csv.DictReader(_f):
            _person_country_overrides[_r["person_id"].strip()] = _r["country"].strip()
    print(f"  Loaded {len(_person_country_overrides)} person country override(s)")


# ── Build output rows ─────────────────────────────────────────────────────────

events_out:       list[dict] = []
disciplines_out:  list[dict] = []
results_out:      list[dict] = []
participants_out: list[dict] = []

# Sort events by year, then event_name for stable output
sorted_rows = sorted(
    stage2_rows,
    key=lambda r: (r["year"] or "0000", r["event_name"] or "")
)

for row in sorted_rows:
    eid        = str(row["event_id"])
    event_key  = event_key_map[eid]
    year       = row["year"] or ""
    event_name = EVENT_NAME_OVERRIDES.get(eid, row.get("event_name", "") or "")
    start_date, end_date = parse_date_range(row.get("date", "") or "")

    # Location: curated events_normalized → fall back to stage2 parse
    _norm = events_normalized.get(eid)
    if _norm:
        city       = _norm.get("city", "")    or ""
        region     = _norm.get("region", "")  or ""
        country    = _norm.get("country", "") or ""
        host_club  = _norm.get("host_club", "") or row.get("host_club", "") or ""
        event_type = _norm.get("event_type", "") or row.get("event_type", "") or ""
        if not start_date:
            start_date = _norm.get("start_date", "") or ""
            end_date   = _norm.get("end_date",   "") or ""
    else:
        location   = row.get("location", "") or ""
        city, region, country = parse_location(location)
        host_club  = row.get("host_club", "") or ""
        event_type = row.get("event_type", "") or ""

    # ── PBP rows for this event (authoritative: names, IDs, structure) ────────
    event_pbp = pbp_by_event.get(eid, [])

    # When PBP has no rows for this event (e.g. pre-mirror magazine events),
    # fall back to stage2 placements_json so their results appear in canonical CSVs.
    stage2_placements: list[dict] = []
    if not event_pbp:
        import json as _json
        _pj_raw = row.get("placements_json") or "[]"
        try:
            stage2_placements = _json.loads(_pj_raw)
        except Exception:
            stage2_placements = []

    # Ordered unique divisions from PBP (or stage2 fallback).
    # team_type uses majority vote: a division is "doubles" only when MORE THAN
    # half its rows have competitor_type="team".  A single stray team row in a
    # circle-contest or shred event must not flip the whole division to doubles.
    seen_divs: list[str]       = []
    div_meta:  dict[str, dict] = {}
    _div_type_counts: dict[str, Counter] = defaultdict(Counter)

    if event_pbp:
        for pbp_row in event_pbp:
            div = pbp_row.get("division_canon") or ""
            if not div:
                continue
            if div not in seen_divs:
                seen_divs.append(div)
                div_meta[div] = {
                    "div_cat":  pbp_row.get("division_category", "") or "",
                    "team_type": "singles",
                    "cov_flag":  pbp_row.get("coverage_flag", "") or "",
                }
            ct = pbp_row.get("competitor_type", "player") or "player"
            _div_type_counts[div][ct] += 1
        # Apply majority vote
        for div in seen_divs:
            tc = _div_type_counts[div]
            if tc.get("team", 0) > tc.get("player", 0):
                div_meta[div]["team_type"] = "doubles"
    else:
        for s2p in stage2_placements:
            div = s2p.get("division_canon") or ""
            if not div:
                continue
            if div not in seen_divs:
                seen_divs.append(div)
                div_meta[div] = {
                    "div_cat":  s2p.get("division_category", "") or "",
                    "team_type": "singles",
                    "cov_flag":  "partial",  # pre-mirror curated: real data, completeness not guaranteed
                }
            ct = s2p.get("competitor_type", "") or "player"
            _div_type_counts[div][ct] += 1
        for div in seen_divs:
            tc = _div_type_counts[div]
            if tc.get("team", 0) > tc.get("player", 0):
                div_meta[div]["team_type"] = "doubles"

    # ── events.csv ────────────────────────────────────────────────────────────
    events_out.append({
        "event_key":       event_key,
        "legacy_event_id": eid,
        "year":            year,
        "event_name":      event_name,
        "event_slug":      slugify(event_name) if event_name else "",
        "start_date":      start_date,
        "end_date":        end_date,
        "city":            city,
        "region":          region,
        "country":         country,
        "host_club":       host_club,
        "event_type":      event_type,
        "status":          derive_status(len(event_pbp) or len(stage2_placements), []),
        "notes":           _norm.get("notes", "") if _norm else "",
        "source":          row.get("source_layer", "mirror"),
    })

    # Discipline-key slugs — collision-safe within each event
    disc_slug_seen:  dict[str, int] = {}
    div_to_disc_key: dict[str, str] = {}
    for div in seen_divs:
        base_slug = slugify(div)
        if base_slug in disc_slug_seen:
            disc_slug_seen[base_slug] += 1
            disc_key = f"{base_slug}_{disc_slug_seen[base_slug]}"
        else:
            disc_slug_seen[base_slug] = 1
            disc_key = base_slug
        div_to_disc_key[div] = disc_key

    # ── event_disciplines.csv ─────────────────────────────────────────────────
    for sort_order, div in enumerate(seen_divs, start=1):
        meta = div_meta[div]
        disciplines_out.append({
            "event_key":           event_key,
            "discipline_key":      div_to_disc_key[div],
            "discipline_name":     clean_display_str(div),
            "discipline_category": meta["div_cat"],
            "team_type":           meta["team_type"],
            "sort_order":          sort_order,
            "coverage_flag":       meta["cov_flag"],
            "notes":               "",
        })

    # ── event_results + event_result_participants ─────────────────────────────
    # participant_order:
    #   Sequential across all participants at a given (event, discipline, placement)
    #   slot for both singles and doubles. This ensures the composite key
    #   (event_key, discipline_key, placement, participant_order) is always unique.
    #   - Singles tie: two players tied at 1st get orders 1, 2 (placement=1 for both)
    #   - Doubles tie: two tied teams → players get orders 1, 2, 3, 4
    #     (team_person_key groups partners; consumers group by tpk to reconstruct teams)
    # Dedup: skip rows where the same (disc_key, place, person_name) has already
    #        been emitted — PBP occasionally has resolved+unresolved duplicates.
    emitted_results:   set[tuple[str, str, str]]       = set()
    placement_counter: dict[tuple[str, str, str], int] = defaultdict(int)
    seen_participants: set[tuple[str, str, str, str]]  = set()

    _UUID_RE = re.compile(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I
    )

    def _clean_pid(pid: str, name: str) -> str:
        """Return a valid PT person_id UUID, or "" if not in PT / unresolvable.

        Rejects player-level UUIDs that were never mapped to a PT effective_person_id
        (i.e. participants that 02p5 could not resolve).  Falls back to name-based
        PT resolution so alias variants (e.g. "Kenny Shults" → PT "Kenneth Shults")
        are still captured here.
        """
        if pid == "__NON_PERSON__":
            return ""
        if not pid:
            # PBP row with empty person_id — try to resolve via current
            # PT + person_aliases index before giving up.
            return resolve_person_id(None, name) or ""
        if _UUID_RE.match(pid):
            if pid in _pt_person_ids or pid in _pt51_person_ids:
                return pid          # directly in PT or PT v51 lock — use as-is
            # Valid UUID but not a PT person_id (unresolved player token from 02p5).
            # Try to recover via name lookup before giving up.
            return resolve_person_id(None, name) or ""
        # Malformed (pipe-separated composite key, truncated |? token, etc.)
        # Try to re-resolve from the canonical name via PT.
        return resolve_person_id(None, name) or ""

    # Iterate over PBP rows (authoritative) or stage2 placements (fallback)
    _placement_source = event_pbp if event_pbp else stage2_placements
    for _src_row in _placement_source:
        if event_pbp:
            div = _src_row.get("division_canon") or ""
        else:
            div = _src_row.get("division_canon") or ""
        if not div:
            continue
        disc_key = div_to_disc_key.get(div, "")
        if not disc_key:
            continue
        place = str(_src_row.get("place", "")).strip()
        if not place or place == "0":
            continue

        is_doubles  = div_meta.get(div, {}).get("team_type") == "doubles"
        # Doubles: one result row per placement slot (teams share it).
        # Singles: computed per-participant after dedup (each tied player gets own row).
        result_key  = (event_key, disc_key, place)

        if event_pbp:
            person_id   = _src_row.get("person_id", "") or ""
            person_name = _src_row.get("person_canon", "") or ""
            tpk         = _src_row.get("team_person_key", "") or ""
            tdm         = _src_row.get("team_display_name", "") or ""
            # Expand __NON_PERSON__ team aggregate rows.
            # PBP stores unresolved doubles teams as one row:
            #   person_canon="__NON_PERSON__", team_display_name="Name1 / Name2"
            # Expand into individual participant entries by splitting on " / ".
            if person_name == "__NON_PERSON__":
                if tdm:
                    members = [clean_display_str(m.strip())
                               for m in tdm.split(" / ") if m.strip()]
                else:
                    members = [person_name]   # preserve as __NON_PERSON__ placeholder
                entries = [(m, resolve_person_id(None, m) or "", "") for m in members]
            else:
                entries = [(person_name, _clean_pid(person_id, person_name), tpk)]
        else:
            # Stage2 fallback: resolve person_ids from PT by player name/token
            p1 = (_src_row.get("player1_name") or "").strip()
            p2 = (_src_row.get("player2_name") or "").strip()
            p1_token = (_src_row.get("player1_id") or "").strip()
            p2_token = (_src_row.get("player2_id") or "").strip()
            if p1 and p2:
                entries = [
                    (p1, resolve_person_id(p1_token, p1) or "", ""),
                    (p2, resolve_person_id(p2_token, p2) or "", ""),
                ]
            elif p1:
                entries = [(p1, resolve_person_id(p1_token, p1) or "", "")]
            else:
                continue

        # event_results.csv + event_result_participants.csv
        #
        # All disciplines: participants at the same placement share ONE result row.
        # participant_order counts all individual participants sequentially
        # (doubles: 1,2 = first team; 3,4 = second tied team; etc.
        #  singles: normally 1; ties produce 1,2 which is structurally valid for
        #  legitimate ties but indicates contamination if OSR players bleed into
        #  a different singles division).

        # event_result_participants.csv — one row per resolved individual
        for (m_name, m_pid, m_tpk) in entries:
            # Dedup by person_id when resolved (catches same person entered under
            # different name spellings, e.g. team row "Chris Siebert" + player row
            # "Chris Seibert" both resolving to the same PT person_id).
            # Fall back to display_name for unresolved entries (empty person_id).
            dedup_val = m_pid if m_pid else m_name
            dedup_key = (event_key, disc_key, place, dedup_val)
            if dedup_key in seen_participants:
                continue
            seen_participants.add(dedup_key)

            if result_key not in emitted_results:
                results_out.append({
                    "event_key":      event_key,
                    "discipline_key": disc_key,
                    "placement":      place,
                    "score_text":     "",
                    "notes":          "",
                    "source":         "",
                })
                emitted_results.add(result_key)

            placement_counter[result_key] += 1
            participant_order = str(placement_counter[result_key])

            participants_out.append({
                "event_key":         event_key,
                "discipline_key":    disc_key,
                "placement":         place,
                "participant_order": participant_order,
                "display_name":      clean_display_str(m_name),
                "person_id":         m_pid,
                "team_person_key":   m_tpk,
                "notes":             "",
            })


# ── Compute person stats from participants_out (self-consistent with ERP) ─────
# Count from the canonical participants table itself rather than from the
# intermediate PBP load, so persons.csv stats always match event_result_participants.
_part_event_count:  dict[str, set]  = defaultdict(set)
_part_place_count:  dict[str, int]  = defaultdict(int)
for _pr in participants_out:
    _pid = _pr.get("person_id", "").strip()
    _nm  = _pr.get("display_name", "")
    if not _pid or _nm == "__UNKNOWN_PARTNER__":
        continue
    _part_event_count[_pid].add(_pr["event_key"])
    _part_place_count[_pid] += 1

# ── persons.csv — extended ────────────────────────────────────────────────────
print(f"  {len(_part_place_count):,} persons with placements (from participants_out)")

# BAP / FBHOF matching helpers (mirrors build_final_workbook_v12 logic)
def _honor_norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())

_HONOR_OVERRIDES: dict[str, str] = {
    "ken shults":               "Kenneth Shults",
    "kenny shults":             "Kenneth Shults",
    "vasek klouda":             "Václav Klouda",
    "vaclav (vasek) klouda":    "Václav Klouda",
    "tina aberli":              "Tina Aeberli",
    "eli piltz":                "Eliott Piltz Galán",
    "eliott piltz galan":       "Eliott Piltz Galán",
    "evanne lamarch":           "Evanne Lemarche",
    "evanne lamarche":          "Evanne Lemarche",
    "arek dzudzinski":          "Arkadiusz Dudzinski",
    "martin cote":              "Martin Côté",
    "sebastien duchesne":       "Sébastien Duchesne",
    "sebastien duschesne":      "Sébastien Duchesne",
    "lon smith":                "Lon Skyler Smith",
    "lon skyler smith":         "Lon Skyler Smith",
    "ales zelinka":             "Aleš Zelinka",
    "jere vainikka":            "Jere Väinikkä",
    "tuomas karki":             "Tuomas Kärki",
    "rafal kaleta":             "Rafał Kaleta",
    "pawel nowak":              "Paweł Nowak",
    "jakub mosciszewski":       "Jakub Mościszewski",
    "dominik simku":            "Dominik Šimků",
    "honza weber":              "Jan Weber",
    "genevieve bousquet":       "Geneviève Bousquet",
    "becca english-ross":       "Becca English",
    "pt lovern":                "P.T. Lovern",
    "p.t. lovern":              "P.T. Lovern",
    "kendall kic":              "Kendall KIC",
    "wiktor debski":            "Wiktor Dębski",
    "florian gotze":            "Florian Götze",
    "chantelle laurent":        "Chantelle Laurent",
}

# Build norm → person_id lookup from PT
_norm_to_pid: dict[str, str] = {}
_norm_to_canon: dict[str, str] = {}
for _r in pt_rows:
    _pc  = _r["person_canon"]
    _pid = _r["effective_person_id"]
    _k   = _honor_norm(_pc)
    _norm_to_pid[_k]   = _pid
    _norm_to_canon[_k] = _pc
    _nk = _r.get("norm_key", "").strip()
    if _nk:
        _norm_to_pid[_nk]   = _pid
        _norm_to_canon[_nk] = _pc

def _resolve_honor(raw_name: str) -> str | None:
    """Returns person_id or None."""
    key = _honor_norm(raw_name)
    canon = _HONOR_OVERRIDES.get(key.replace("", "").strip()) or _HONOR_OVERRIDES.get(raw_name.lower().strip())
    if not canon:
        # Try direct key lookup
        if key in _norm_to_canon:
            canon = _norm_to_canon[key]
    if canon:
        return _norm_to_pid.get(_honor_norm(canon))
    return None

# Rebuild using override-first approach
def _match_honor(raw_name: str) -> str | None:
    key = _honor_norm(raw_name)
    override_canon = _HONOR_OVERRIDES.get(raw_name.lower().strip())
    if override_canon:
        return _norm_to_pid.get(_honor_norm(override_canon))
    if key in _norm_to_pid:
        return _norm_to_pid[key]
    return None

# Load BAP
print("Loading BAP data...")
_bap_by_pid: dict[str, dict] = {}
_bap_csv = ROOT / "inputs" / "bap_data_updated.csv"
if _bap_csv.exists():
    with open(_bap_csv, newline="", encoding="utf-8") as _f:
        for _i, _row in enumerate(csv.DictReader(_f), start=1):
            _raw = _row.get("name", "").strip()
            _yr  = _row.get("year_inducted", "").strip()
            _nick = _row.get("nickname", "").strip()
            _pid = _match_honor(_raw)
            if _pid:
                _bap_by_pid[_pid] = {
                    "bap_member": 1,
                    "bap_nickname": _nick,
                    "bap_induction_year": _yr,
                }
print(f"  {len(_bap_by_pid):,} BAP members matched")

# Load FBHOF — from inputs/hof.csv (has induction_year + explicit person_id mapping)
print("Loading FBHOF data...")
_fbhof_by_pid: dict[str, dict] = {}
_fbhof_csv = ROOT / "inputs" / "hof.csv"
if _fbhof_csv.exists():
    with open(_fbhof_csv, newline="", encoding="utf-8") as _f:
        for _row in csv.DictReader(_f):
            _raw   = _row.get("full_name", "").strip()
            _yr    = _row.get("induction_year", "").strip()
            _pid_direct = _row.get("person_id", "").strip()
            # Prefer the explicit person_id column; fall back to name matching
            _pid = _pid_direct or _match_honor(_raw)
            if _pid:
                _fbhof_by_pid[_pid] = {
                    "fbhof_member": 1,
                    "fbhof_induction_year": _yr if _yr else "",
                }
print(f"  {len(_fbhof_by_pid):,} FBHOF members matched")

# Load freestyle difficulty profiles
print("Loading freestyle analytics...")
_difficulty_by_pid: dict[str, dict] = {}
_diff_csv = OUT / "noise_aggregates" / "player_difficulty_profiles.csv"
if _diff_csv.exists():
    with open(_diff_csv, newline="", encoding="utf-8") as _f:
        for _row in csv.DictReader(_f):
            _pid = _row.get("person_id", "").strip()
            if _pid:
                _difficulty_by_pid[_pid] = _row

_diversity_by_pid: dict[str, dict] = {}
_div_csv = OUT / "noise_aggregates" / "player_diversity_profiles.csv"
if _div_csv.exists():
    with open(_div_csv, newline="", encoding="utf-8") as _f:
        for _row in csv.DictReader(_f):
            _pid = _row.get("person_id", "").strip()
            if _pid:
                _diversity_by_pid[_pid] = _row
print(f"  {len(_difficulty_by_pid):,} difficulty profiles, {len(_diversity_by_pid):,} diversity profiles")

# Build persons_out
persons_out: list[dict] = []
for row in sorted(pt_rows, key=lambda r: r["person_canon"]):
    pid   = row["effective_person_id"]
    # Country derived from PBP stats (unchanged — only used for display)
    stats = _pbp_stats.get(pid, {})
    countries = stats.get("countries", Counter())
    top_country = _person_country_overrides.get(pid) or (countries.most_common(1)[0][0] if countries else "")
    _years_set = stats.get("years", set())
    first_year = str(min(_years_set)) if _years_set else ""
    last_year  = str(max(_years_set)) if _years_set else ""

    diff  = _difficulty_by_pid.get(pid, {})
    divrs = _diversity_by_pid.get(pid, {})
    bap   = _bap_by_pid.get(pid, {})
    fbhof = _fbhof_by_pid.get(pid, {})

    top_tricks = [t.strip() for t in divrs.get("top_tricks", "").split("|") if t.strip()]

    persons_out.append({
        "person_id":                  pid,
        "person_name":                row["person_canon"],
        "member_id":                  member_id_map.get(pid, ""),
        "player_ids":                 pt_player_ids.get(pid, ""),
        "country":                    top_country,
        "first_year":                 first_year,
        "last_year":                  last_year,
        # event_count and placement_count from canonical participants table (self-consistent)
        "event_count":                len(_part_event_count.get(pid, set())),
        "placement_count":            _part_place_count.get(pid, 0),
        "bap_member":                 bap.get("bap_member", 0),
        "bap_nickname":               bap.get("bap_nickname", ""),
        "bap_induction_year":         bap.get("bap_induction_year", ""),
        "fbhof_member":               fbhof.get("fbhof_member", 0),
        "fbhof_induction_year":       fbhof.get("fbhof_induction_year", ""),
        "freestyle_sequences":        diff.get("chains_total", ""),
        "freestyle_max_add":          diff.get("max_sequence_add", ""),
        "freestyle_unique_tricks":    divrs.get("unique_tricks", ""),
        "freestyle_diversity_ratio":  divrs.get("diversity_ratio", ""),
        "signature_trick_1":          top_tricks[0] if len(top_tricks) > 0 else "",
        "signature_trick_2":          top_tricks[1] if len(top_tricks) > 1 else "",
        "signature_trick_3":          top_tricks[2] if len(top_tricks) > 2 else "",
    })


# ── Write outputs ─────────────────────────────────────────────────────────────

print(f"\nWriting canonical CSVs to {CANONICAL} ...")
CANONICAL.mkdir(parents=True, exist_ok=True)

write_csv(
    CANONICAL / "events.csv",
    ["event_key", "legacy_event_id", "year", "event_name", "event_slug",
     "start_date", "end_date", "city", "region", "country",
     "host_club", "event_type", "status", "notes", "source"],
    events_out,
)
write_csv(
    CANONICAL / "event_disciplines.csv",
    ["event_key", "discipline_key", "discipline_name", "discipline_category",
     "team_type", "sort_order", "coverage_flag", "notes"],
    disciplines_out,
)
write_csv(
    CANONICAL / "event_results.csv",
    ["event_key", "discipline_key", "placement", "score_text", "notes", "source"],
    results_out,
)
write_csv(
    CANONICAL / "event_result_participants.csv",
    ["event_key", "discipline_key", "placement", "participant_order",
     "display_name", "person_id", "team_person_key", "notes"],
    participants_out,
)
write_csv(
    CANONICAL / "persons.csv",
    [
        "person_id", "person_name", "member_id", "player_ids",
        "country", "first_year", "last_year", "event_count", "placement_count",
        "bap_member", "bap_nickname", "bap_induction_year",
        "fbhof_member", "fbhof_induction_year",
        "freestyle_sequences", "freestyle_max_add",
        "freestyle_unique_tricks", "freestyle_diversity_ratio",
        "signature_trick_1", "signature_trick_2", "signature_trick_3",
    ],
    persons_out,
)

# ── Referential closure: backfill persons missing from persons.csv ─────────────
# Persons can be absent from persons.csv when their player_ids are not present in
# Placements_Flat (stage 04 drops them from out/Persons_Truth.csv), yet their
# effective_person_id was still written into event_result_participants.csv via the
# PBP/stage2 resolution path.  Find any such gap and fill from PT v51.

_persons_written = {r["person_id"] for r in persons_out}
_participant_pids = {
    r["person_id"].strip()
    for r in participants_out
    if r.get("person_id", "").strip() and r["person_id"].strip() != "__NON_PERSON__"
}
_missing_pids = _participant_pids - _persons_written

if _missing_pids:
    # Locate the latest Persons_Truth_Final_v*.csv in inputs/identity_lock/
    _lock_dir = ROOT / "inputs" / "identity_lock"
    _pt_files = sorted(_lock_dir.glob("Persons_Truth_Final_v*.csv"))
    if not _pt_files:
        raise FileNotFoundError(
            f"Referential closure backfill failed: no Persons_Truth_Final_v*.csv "
            f"found in {_lock_dir}"
        )
    _pt51_path = _pt_files[-1]  # highest version by sort order
    print(f"  Referential closure: {len(_missing_pids)} person_ids in participants "
          f"not in persons.csv — backfilling from {_pt51_path.name} ...")

    _pt51_by_id: dict[str, dict] = {}
    with open(_pt51_path, newline="", encoding="utf-8") as _f:
        for _row in csv.DictReader(_f):
            _eid = _row.get("effective_person_id", "").strip()
            if _eid:
                _pt51_by_id[_eid] = _row

    _persons_csv_fields = [
        "person_id", "person_name", "member_id", "player_ids",
        "country", "first_year", "last_year", "event_count", "placement_count",
        "bap_member", "bap_nickname", "bap_induction_year",
        "fbhof_member", "fbhof_induction_year",
        "freestyle_sequences", "freestyle_max_add",
        "freestyle_unique_tricks", "freestyle_diversity_ratio",
        "signature_trick_1", "signature_trick_2", "signature_trick_3",
    ]
    _backfill_rows: list[dict] = []
    _unresolved: list[str] = []
    for _pid in sorted(_missing_pids):
        if _pid not in _pt51_by_id:
            _unresolved.append(_pid)
            continue
        _pt_row = _pt51_by_id[_pid]
        _hof = _fbhof_by_pid.get(_pid, {})
        _backfill_rows.append({
            "person_id":            _pid,
            "person_name":          _pt_row.get("person_canon", "").strip(),
            "fbhof_member":         _hof.get("fbhof_member", 0),
            "fbhof_induction_year": _hof.get("fbhof_induction_year", ""),
            **{k: "" for k in _persons_csv_fields
               if k not in ("person_id", "person_name", "fbhof_member", "fbhof_induction_year")},
        })

    if _unresolved:
        raise RuntimeError(
            f"Referential closure backfill failed: {len(_unresolved)} person_id(s) "
            f"in event_result_participants.csv cannot be found in {_pt51_path.name}:\n"
            + "\n".join(f"  {p}" for p in _unresolved)
        )

    # Append backfill rows to persons.csv
    _persons_csv_path = CANONICAL / "persons.csv"
    with open(_persons_csv_path, "a", newline="", encoding="utf-8") as _f:
        _w = csv.DictWriter(_f, fieldnames=_persons_csv_fields, extrasaction="ignore")
        _w.writerows(_backfill_rows)

    print(f"  Backfilled {len(_backfill_rows)} missing persons from {_pt51_path.name}")
else:
    print("  Referential closure: persons.csv covers all participant person_ids")

# ── Summary ───────────────────────────────────────────────────────────────────

print(f"""
Done.
  events:               {len(events_out):>7,}
  event_disciplines:    {len(disciplines_out):>7,}
  event_results:        {len(results_out):>7,}
  event_result_participants: {len(participants_out):>7,}
  persons:              {len(persons_out):>7,}
""")

# ── Integrity checks ──────────────────────────────────────────────────────────

# Unique keys
result_keys    = [(r["event_key"], r["discipline_key"], r["placement"]) for r in results_out]
part_keys      = [(r["event_key"], r["discipline_key"], r["placement"], r["participant_order"]) for r in participants_out]
disc_keys      = [(r["event_key"], r["discipline_key"]) for r in disciplines_out]

errors = 0
if len(result_keys) != len(set(result_keys)):
    dups = len(result_keys) - len(set(result_keys))
    print(f"ERROR: {dups} duplicate (event, discipline, placement) keys in event_results.csv")
    errors += 1
else:
    print("✓  event_results:    all (event_key, discipline_key, placement) keys unique")

# Participant key uniqueness: all participant keys should be unique (participant_order
# is now sequential for all disciplines including singles ties).
all_part_dups = len(part_keys) - len(set(part_keys))
if all_part_dups:
    print(f"ERROR: {all_part_dups} duplicate (event, discipline, placement, participant_order) keys")
    errors += 1
else:
    print("✓  event_result_participants: all (event_key, discipline_key, placement, participant_order) keys unique")

if len(disc_keys) != len(set(disc_keys)):
    dups = len(disc_keys) - len(set(disc_keys))
    print(f"ERROR: {dups} duplicate (event_key, discipline_key) keys in event_disciplines.csv")
    errors += 1
else:
    print("✓  event_disciplines: all (event_key, discipline_key) keys unique")

event_keys_set = {r["event_key"] for r in events_out}
orphan_discs   = [r for r in disciplines_out if r["event_key"] not in event_keys_set]
if orphan_discs:
    print(f"ERROR: {len(orphan_discs)} discipline rows with no matching event")
    errors += 1
else:
    print("✓  referential integrity: all discipline event_keys present in events")

if errors:
    import sys
    sys.exit(1)
