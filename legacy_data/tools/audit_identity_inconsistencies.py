#!/usr/bin/env python3
"""
audit_identity_inconsistencies.py

Narrow, read-only identity inconsistency audit. Prints a review-oriented
stdout report covering six high-precision residual signals only. No
fuzzy matching, no phonetic heuristics, no speculative merge candidates.

Signals:
  1. Conflicting alias rows          — same normalized alias → >=2 distinct pids
  2. Self-pointing alias + conflict  — row X whose display name = alias text,
                                       targeted pid has person_canon = alias,
                                       AND another row targets a different pid
  3. Live duplicate PT rows          — same normalized person_canon across
                                       two PT rows, BOTH with live placements
                                       in canonical/persons.csv
  4. Live + orphan-stub same-name    — PT stub (source starts "patch_v53:")
                                       with normalized canon matching a live
                                       PT row (has canonical placements)
  5. Remaining hardcoded overrides   — _HONOR_OVERRIDES + _PIN_OVERRIDE_FIRST
                                       entries in export_historical_csvs.py;
                                       each is a hint of a possible residual
                                       split worth human review
  6. Honor on stub                   — canonical persons.csv rows with
                                       bap_member=1 or hof_member=1 AND
                                       placement_count=0 (honor landed on a
                                       person with no placement record); plus
                                       honor source names with no canonical
                                       resolution at all

Usage (from legacy_data/):
    .venv/bin/python tools/audit_identity_inconsistencies.py

Exits 0 if zero findings, 1 otherwise. Output is stdout-only.
"""

from __future__ import annotations

import csv
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # legacy_data/
LOCK_DIR = ROOT / "inputs" / "identity_lock"
OVERRIDES = ROOT / "overrides"
OUT_CANONICAL = ROOT / "out" / "canonical"
INPUTS = ROOT / "inputs"

ALIAS_FILE = OVERRIDES / "person_aliases.csv"
CANONICAL_PERSONS = OUT_CANONICAL / "persons.csv"
EXPORT_PY = ROOT / "pipeline" / "historical" / "export_historical_csvs.py"

BAP_FILE = INPUTS / "bap_data_updated.csv"
HOF_FILE = INPUTS / "hof.csv"
FBHOF_FILE = INPUTS / "fbhof_data_updated.csv"

_TRANSLITERATE = str.maketrans("łŁøØđĐðÞŋ", "lLoOdDdTn")


def norm(s: str) -> str:
    if not s:
        return ""
    s = s.replace("�", "").replace("­", "")
    s = s.translate(_TRANSLITERATE)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower().strip())


def latest_pt() -> Path:
    files = sorted(LOCK_DIR.glob("Persons_Truth_Final_v*.csv"),
                   key=lambda p: int(re.search(r"v(\d+)", p.stem).group(1)))
    if not files:
        raise SystemExit("No Persons_Truth_Final_v*.csv found")
    return files[-1]


def load_pt() -> tuple[list[dict], Path]:
    f = latest_pt()
    with open(f, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh)), f


def load_aliases() -> list[dict]:
    if not ALIAS_FILE.exists():
        return []
    with open(ALIAS_FILE, newline="", encoding="utf-8") as fh:
        rows = []
        for lineno, row in enumerate(csv.DictReader(fh), start=2):  # start=2 accounts for header
            row["_lineno"] = lineno
            rows.append(row)
        return rows


def load_canonical_persons() -> list[dict]:
    if not CANONICAL_PERSONS.exists():
        return []
    with open(CANONICAL_PERSONS, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def load_honor_overrides_from_source() -> tuple[set[str], dict[str, str]]:
    """Parse _PIN_OVERRIDE_FIRST + _HONOR_OVERRIDES literals from the
    export script. Avoids importing the module (which has side effects)."""
    text = EXPORT_PY.read_text(encoding="utf-8")

    pin_m = re.search(r'_PIN_OVERRIDE_FIRST\s*:\s*set\[str\]\s*=\s*(set\(\)|\{[^}]*\})',
                      text)
    pin_set: set[str] = set()
    if pin_m:
        body = pin_m.group(1)
        if body != "set()":
            pin_set = {m.group(1) for m in re.finditer(r'"([^"]+)"', body)}

    ho_m = re.search(r'_HONOR_OVERRIDES\s*:\s*dict\[str,\s*str\]\s*=\s*\{([^}]*)\}',
                     text, re.DOTALL)
    honor: dict[str, str] = {}
    if ho_m:
        for m in re.finditer(r'"([^"]+)"\s*:\s*"([^"]+)"', ho_m.group(1)):
            honor[m.group(1)] = m.group(2)

    return pin_set, honor


# ──────────────────────────────────────────────────────────────────────────────
# Signal 1 — conflicting alias rows
# ──────────────────────────────────────────────────────────────────────────────
def signal_1_alias_conflicts(aliases: list[dict]) -> list[dict]:
    by_alias: dict[str, list[dict]] = defaultdict(list)
    for r in aliases:
        a = (r.get("alias") or "").strip()
        pid = (r.get("person_id") or "").strip()
        if not a or not pid:
            continue
        by_alias[norm(a)].append(r)

    findings = []
    for na, rows in sorted(by_alias.items()):
        pids = {(r.get("person_id") or "").strip() for r in rows}
        if len(pids) >= 2:
            findings.append({
                "normalized_alias": na,
                "pids": sorted(pids),
                "row_linenos": [r["_lineno"] for r in rows],
                "row_texts": [f"{r.get('alias')} → {r.get('person_id')} ({r.get('person_canon')})"
                              for r in rows],
            })
    return findings


# ──────────────────────────────────────────────────────────────────────────────
# Signal 2 — self-pointing alias that conflicts with another target
# ──────────────────────────────────────────────────────────────────────────────
def signal_2_self_pointing_conflicts(aliases: list[dict], pt: list[dict]) -> list[dict]:
    pt_by_pid = {r["effective_person_id"]: r for r in pt}

    by_alias: dict[str, list[dict]] = defaultdict(list)
    for r in aliases:
        a = (r.get("alias") or "").strip()
        pid = (r.get("person_id") or "").strip()
        if not a or not pid:
            continue
        by_alias[norm(a)].append(r)

    findings = []
    for na, rows in by_alias.items():
        if len(rows) < 2:
            continue
        pids = {(r.get("person_id") or "").strip() for r in rows}
        if len(pids) < 2:
            continue
        # A row is "self-pointing" iff its target PT row has the same
        # normalized person_canon as the alias text itself.
        for r in rows:
            pid = (r.get("person_id") or "").strip()
            target = pt_by_pid.get(pid)
            if not target:
                continue
            if norm(target.get("person_canon", "")) == na:
                # Self-pointing row found; check there's another row with a DIFFERENT pid
                other_pids = pids - {pid}
                if other_pids:
                    findings.append({
                        "self_pointing_row": f"line {r['_lineno']}: {r.get('alias')} → {pid}",
                        "other_targets": sorted(other_pids),
                        "normalized_alias": na,
                    })
                    break
    return findings


# ──────────────────────────────────────────────────────────────────────────────
# Signal 3 — live duplicate PT rows
# ──────────────────────────────────────────────────────────────────────────────
def signal_3_live_duplicate_pt(pt: list[dict],
                               canonical_by_pid: dict[str, dict]) -> list[dict]:
    live_pids = {pid for pid, r in canonical_by_pid.items()
                 if _int(r.get("placement_count", "0")) > 0}

    by_canon: dict[str, list[dict]] = defaultdict(list)
    for r in pt:
        pid = r["effective_person_id"]
        if pid not in live_pids:
            continue
        n = norm(r.get("person_canon", ""))
        if not n:
            continue
        by_canon[n].append(r)

    findings = []
    for n, rows in sorted(by_canon.items()):
        if len(rows) >= 2:
            findings.append({
                "normalized_canon": n,
                "rows": [
                    {
                        "pid": r["effective_person_id"],
                        "person_canon": r.get("person_canon", ""),
                        "placements": _int(canonical_by_pid[r["effective_person_id"]].get("placement_count", "0")),
                    }
                    for r in rows
                ],
            })
    return findings


# ──────────────────────────────────────────────────────────────────────────────
# Signal 4 — live-row + orphan-stub same-name
# ──────────────────────────────────────────────────────────────────────────────
def signal_4_live_plus_stub(pt: list[dict],
                            canonical_by_pid: dict[str, dict]) -> list[dict]:
    """Orphan stubs: PT rows with source starting 'patch_v53:' AND no canonical
    placements. Live rows: PT rows in canonical persons.csv with
    placement_count > 0. Match on normalized person_canon."""

    stubs: list[dict] = []
    for r in pt:
        src = r.get("source", "") or ""
        pid = r["effective_person_id"]
        canon_row = canonical_by_pid.get(pid)
        # Stub = either no canonical presence, OR 0 placements, AND source is a patch_v53 stub
        if src.startswith("patch_v53:") and (
            canon_row is None or _int(canon_row.get("placement_count", "0")) == 0
        ):
            stubs.append(r)

    live_by_canon: dict[str, dict] = {}
    for r in pt:
        pid = r["effective_person_id"]
        cr = canonical_by_pid.get(pid)
        if cr and _int(cr.get("placement_count", "0")) > 0:
            n = norm(r.get("person_canon", ""))
            if n and n not in live_by_canon:
                live_by_canon[n] = r

    findings = []
    for stub in stubs:
        n = norm(stub.get("person_canon", ""))
        if not n:
            continue
        live = live_by_canon.get(n)
        if live and live["effective_person_id"] != stub["effective_person_id"]:
            findings.append({
                "stub_pid": stub["effective_person_id"],
                "stub_canon": stub.get("person_canon", ""),
                "live_pid": live["effective_person_id"],
                "live_canon": live.get("person_canon", ""),
                "live_placements": _int(canonical_by_pid[live["effective_person_id"]]
                                        .get("placement_count", "0")),
            })
    return findings


# ──────────────────────────────────────────────────────────────────────────────
# Signal 5 — remaining hardcoded overrides
# ──────────────────────────────────────────────────────────────────────────────
def signal_5_hardcoded_overrides() -> tuple[set[str], dict[str, str]]:
    return load_honor_overrides_from_source()


# ──────────────────────────────────────────────────────────────────────────────
# Signal 6 — honor landed on a stub, or honor source orphan
# ──────────────────────────────────────────────────────────────────────────────
def signal_6_honor_attribution(canonical: list[dict],
                                aliases: list[dict],
                                honor_overrides: dict[str, str]) -> dict[str, list]:
    """Only reports true honor-lookup failures.

    A source row is NOT an orphan if, via any of (direct canon match, alias
    bridge, hardcoded override → canon), it resolves to a canonical row
    that carries the expected honor flag. Rows that resolve but whose target
    lacks the flag are the actionable miss case."""

    result: dict[str, list] = {"honor_on_stub": [], "honor_lookup_failures": []}

    # out/canonical/persons.csv uses `fbhof_member` (not `hof_member` — that
    # column name lives in event_results/canonical_input/persons.csv only).
    hof_col = "fbhof_member" if "fbhof_member" in (canonical[0].keys() if canonical else {}) else "hof_member"
    hof_year_col = "fbhof_induction_year" if hof_col == "fbhof_member" else "hof_induction_year"

    canonical_by_norm_name: dict[str, dict] = {}
    canonical_by_pid: dict[str, dict] = {}
    for r in canonical:
        pid = r.get("person_id", "")
        n = norm(r.get("person_name", ""))
        if pid:
            canonical_by_pid[pid] = r
        if n and n not in canonical_by_norm_name:
            canonical_by_norm_name[n] = r
        # 6a — honored but no placements
        bap = _int(r.get("bap_member", "0"))
        hof = _int(r.get(hof_col, "0"))
        placements = _int(r.get("placement_count", "0"))
        if (bap or hof) and placements == 0:
            result["honor_on_stub"].append({
                "person_id": pid,
                "person_name": r.get("person_name", ""),
                "bap": bap,
                "bap_nickname": r.get("bap_nickname", ""),
                "bap_year": r.get("bap_induction_year", ""),
                "hof": hof,
                "hof_year": r.get(hof_year_col, ""),
            })

    # alias norm → pid
    alias_to_pid: dict[str, str] = {}
    for a in aliases:
        at = (a.get("alias") or "").strip()
        pid = (a.get("person_id") or "").strip()
        if not at or not pid:
            continue
        n = norm(at)
        # First-seen wins — if there are still conflicts (signal 1) we don't
        # want to mask them here, but we also don't need to emit them twice.
        alias_to_pid.setdefault(n, pid)

    def resolve(name: str) -> tuple[dict | None, str]:
        """Alias → direct → honor override, matching exporter's _match_honor
        semantics. Alias-first is critical: cases where the same raw name
        matches a canonical row directly AND aliases to a different pid
        (e.g. `Tu Vu` canon vs alias → `Tuan Vu`) must follow the alias."""
        n = norm(name)
        if not n:
            return None, "empty_name"

        # 1. alias bridge (primary — matches exporter)
        pid = alias_to_pid.get(n)
        if pid:
            r = canonical_by_pid.get(pid)
            if r is not None:
                return r, "alias"

        # 2. direct canon match
        r = canonical_by_norm_name.get(n)
        if r is not None:
            return r, "direct"

        # 3. hardcoded override
        ovr = honor_overrides.get(n)
        if ovr:
            r = canonical_by_norm_name.get(norm(ovr))
            if r is not None:
                return r, "override"

        return None, "unresolved"

    def check_source(path: Path, label: str, name_col: str) -> None:
        if not path.exists():
            return
        expected_flag = "bap_member" if label == "BAP" else hof_col
        with open(path, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                name = (row.get(name_col) or "").strip()
                if not name:
                    continue
                r, path_used = resolve(name)
                if r is None:
                    result["honor_lookup_failures"].append({
                        "source": label, "raw_name": name,
                        "kind": "unresolved — no direct/alias/override path",
                    })
                    continue
                if _int(r.get(expected_flag, "0")) == 0:
                    # Resolved, but target row lacks the honor flag.
                    result["honor_lookup_failures"].append({
                        "source": label, "raw_name": name,
                        "matched_pid": r.get("person_id", ""),
                        "matched_name": r.get("person_name", ""),
                        "resolution": path_used,
                        "kind": f"resolved_via_{path_used}_but_{expected_flag}_is_0",
                    })

    check_source(BAP_FILE, "BAP", "name")
    check_source(HOF_FILE, "HOF", "full_name")
    check_source(FBHOF_FILE, "FBHOF", "name")

    return result


# ──────────────────────────────────────────────────────────────────────────────
# helpers
# ──────────────────────────────────────────────────────────────────────────────
def _int(s: str | None) -> int:
    if not s:
        return 0
    try:
        return int(str(s).strip())
    except ValueError:
        return 0


def section(title: str, count: int) -> None:
    print(f"\n{'─' * 78}")
    print(f"{title}  ({count} finding{'' if count == 1 else 's'})")
    print(f"{'─' * 78}")


def main() -> int:
    pt, pt_path = load_pt()
    aliases = load_aliases()
    canonical = load_canonical_persons()
    canonical_by_pid = {r["person_id"]: r for r in canonical if r.get("person_id")}

    print(f"Identity inconsistency audit — read-only")
    print(f"  PT source:        {pt_path.name}  ({len(pt):,} rows)")
    print(f"  Aliases:          {ALIAS_FILE.name}  ({len(aliases):,} rows)")
    print(f"  Canonical:        {CANONICAL_PERSONS.relative_to(ROOT)}  ({len(canonical):,} rows)")
    print(f"  Override source:  {EXPORT_PY.relative_to(ROOT)}")

    total = 0

    # 1
    f1 = signal_1_alias_conflicts(aliases)
    section("Signal 1 — conflicting alias rows (same alias → ≥2 pids)", len(f1))
    for f in f1:
        print(f"  • '{f['normalized_alias']}'  pids={f['pids']}")
        for t in f["row_texts"]:
            print(f"      {t}")
    total += len(f1)

    # 2
    f2 = signal_2_self_pointing_conflicts(aliases, pt)
    section("Signal 2 — self-pointing alias row that conflicts with another target", len(f2))
    for f in f2:
        print(f"  • {f['self_pointing_row']}  (other targets: {f['other_targets']})")
    total += len(f2)

    # 3
    f3 = signal_3_live_duplicate_pt(pt, canonical_by_pid)
    section("Signal 3 — live duplicate PT rows (same canon, both with placements)", len(f3))
    for f in f3:
        print(f"  • normalized_canon='{f['normalized_canon']}'")
        for row in f["rows"]:
            print(f"      {row['pid']}  '{row['person_canon']}'  placements={row['placements']}")
    total += len(f3)

    # 4
    f4 = signal_4_live_plus_stub(pt, canonical_by_pid)
    section("Signal 4 — live PT row + orphan stub with same normalized canon", len(f4))
    for f in f4:
        print(f"  • stub  {f['stub_pid']}  '{f['stub_canon']}'")
        print(f"    live  {f['live_pid']}  '{f['live_canon']}'  placements={f['live_placements']}")
    total += len(f4)

    # 5
    pin, honor = signal_5_hardcoded_overrides()
    n5 = len(pin) + len(honor)
    section("Signal 5 — remaining hardcoded overrides (review each for residual splits)", n5)
    if pin:
        print(f"  _PIN_OVERRIDE_FIRST: {sorted(pin)}")
    for k, v in sorted(honor.items()):
        print(f"  _HONOR_OVERRIDES['{k}'] = '{v}'")
    total += n5

    # 6
    f6 = signal_6_honor_attribution(canonical, aliases, honor)
    stubs = f6["honor_on_stub"]
    failures = f6["honor_lookup_failures"]
    section("Signal 6a — canonical persons with honor flag but 0 placements", len(stubs))
    for f in stubs:
        tags = []
        if f["bap"]: tags.append(f"BAP {f['bap_nickname']!r} {f['bap_year']}")
        if f["hof"]: tags.append(f"HOF {f['hof_year']}")
        print(f"  • {f['person_id']}  '{f['person_name']}'  [{', '.join(tags)}]")
    total += len(stubs)

    section("Signal 6b — honor source names that fail to land (after direct/alias/override chain)",
            len(failures))
    by_kind: dict[str, list] = defaultdict(list)
    for o in failures:
        by_kind[o["kind"]].append(o)
    for kind, rows in sorted(by_kind.items()):
        print(f"  [{kind}]  ({len(rows)})")
        for o in rows:
            extra = ""
            if o.get("matched_pid"):
                extra = f"  → pid={o['matched_pid']} '{o.get('matched_name', '')}'"
            print(f"    {o['source']}: {o['raw_name']}{extra}")
    total += len(failures)

    print(f"\n{'═' * 78}")
    print(f"TOTAL findings: {total}")
    print(f"{'═' * 78}")
    return 0 if total == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
