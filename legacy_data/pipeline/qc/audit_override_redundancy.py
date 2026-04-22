#!/usr/bin/env python3
"""
Audit: _HONOR_OVERRIDES redundancy.

Walks the hardcoded `_HONOR_OVERRIDES` dict in
`pipeline/historical/export_historical_csvs.py` and classifies each entry
against what AliasResolver alone (alias-file lookup + canonical-name
fallback) would return for the same raw_name.

Classifications:
    redundant     — AliasResolver returns the same canonical person. The
                    override is not adding value; could be removed once the
                    honor code path is refactored to consult AliasResolver.
    contradictory — AliasResolver returns a different canonical person.
                    The override silently overrules alias-file intent.
    required      — AliasResolver cannot resolve raw_name, but the
                    hardcoded target exists as a canonical person. The
                    override is doing unique identity work.
    suspicious    — AliasResolver cannot resolve raw_name, AND the
                    hardcoded target also does not exist in canonical.
                    The override points at a name no canonical person
                    carries — dead or stale data.

This is audit-only. Not wired into run_qc.py. Does not modify data or
pipeline behavior.

Normalization: uses `pipeline.identity.alias_resolver.normalize_name` —
does not introduce a second normalizer.

Artifact: legacy_data/out/qc_override_redundancy.csv
    raw_name, hardcoded_target, classification, alias_target,
    hardcoded_in_canonical, source_file, source_line, detail
"""

from __future__ import annotations

import argparse
import ast
import csv
import sys
from collections import Counter
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
LEGACY_ROOT = SCRIPT_DIR.parents[1]

sys.path.insert(0, str(LEGACY_ROOT))
from pipeline.identity.alias_resolver import load_default_resolver, normalize_name  # noqa: E402

DEFAULT_SOURCE = LEGACY_ROOT / "pipeline" / "historical" / "export_historical_csvs.py"
DEFAULT_PERSONS = LEGACY_ROOT / "out" / "canonical" / "persons.csv"
DEFAULT_OUT = LEGACY_ROOT / "out" / "qc_override_redundancy.csv"

OVERRIDE_DICT_NAMES = {"_HONOR_OVERRIDES"}

ARTIFACT_COLUMNS = [
    "raw_name", "hardcoded_target", "classification",
    "alias_target", "hardcoded_in_canonical",
    "source_file", "source_line", "detail",
]


def parse_override_dicts(source_path: Path) -> list[tuple[str, str, str, int]]:
    """[(dict_name, raw_key, hardcoded_value, lineno), ...]"""
    src = source_path.read_text()
    tree = ast.parse(src, filename=str(source_path))
    out: list[tuple[str, str, str, int]] = []
    for node in ast.walk(tree):
        dict_node = None
        names: set[str] = set()
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Dict):
            dict_node = node.value
            names = {t.id for t in node.targets if isinstance(t, ast.Name)}
        elif isinstance(node, ast.AnnAssign) and isinstance(node.value, ast.Dict) \
                and isinstance(node.target, ast.Name):
            dict_node = node.value
            names = {node.target.id}
        if dict_node is None or not (names & OVERRIDE_DICT_NAMES):
            continue
        dict_name = next(iter(names & OVERRIDE_DICT_NAMES))
        for k, v in zip(dict_node.keys, dict_node.values):
            if (isinstance(k, ast.Constant) and isinstance(v, ast.Constant)
                    and isinstance(k.value, str) and isinstance(v.value, str)):
                out.append((dict_name, k.value, v.value, k.lineno))
    return out


def load_canonical_nname_index(persons_csv: Path) -> dict[str, tuple[str, str]]:
    """normalize_name(person_name) -> (pid, person_name). First-writer wins."""
    idx: dict[str, tuple[str, str]] = {}
    if not persons_csv.exists():
        return idx
    with open(persons_csv, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            pid = (r.get("person_id") or "").strip()
            name = (r.get("person_name") or r.get("person_canon") or "").strip()
            if pid and name:
                idx.setdefault(normalize_name(name), (pid, name))
    return idx


def classify(raw_key, hardcoded, resolver, canon_idx) -> tuple[str, str, bool, str]:
    alias_pid = resolver.resolve(raw_key)
    alias_canon = resolver.canonical_name(alias_pid) if alias_pid else ""
    hc_norm = normalize_name(hardcoded)
    hc_hit = canon_idx.get(hc_norm)

    if alias_pid is not None and alias_canon:
        if normalize_name(alias_canon) == hc_norm:
            return (
                "redundant", alias_canon, hc_hit is not None,
                f"AliasResolver resolves '{raw_key}' to '{alias_canon}' (pid {alias_pid}); "
                f"matches hardcoded target — override adds no unique value"
            )
        return (
            "contradictory", alias_canon, hc_hit is not None,
            f"AliasResolver resolves '{raw_key}' to '{alias_canon}' (pid {alias_pid}); "
            f"hardcoded override maps to '{hardcoded}' — disagreement"
        )
    # alias_pid is None
    if hc_hit is not None:
        hc_pid, hc_canon_name = hc_hit
        return (
            "required", "", True,
            f"AliasResolver returns no match for '{raw_key}'; override routes to "
            f"canonical '{hc_canon_name}' (pid {hc_pid}) — override is the only path"
        )
    return (
        "suspicious", "", False,
        f"AliasResolver returns no match for '{raw_key}'; hardcoded target "
        f"'{hardcoded}' also not found in canonical persons — override points at nothing"
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Audit _HONOR_OVERRIDES for redundancy.")
    ap.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    ap.add_argument("--persons-csv", type=Path, default=DEFAULT_PERSONS)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    if not args.source.exists():
        print(f"ERROR: source not found: {args.source}", file=sys.stderr)
        return 2

    entries = parse_override_dicts(args.source)
    if not entries:
        print(f"No override dicts found (looked for: {sorted(OVERRIDE_DICT_NAMES)})")
        return 0

    resolver = load_default_resolver(aliases_csv=None, canonical_persons_csv=args.persons_csv)
    canon_idx = load_canonical_nname_index(args.persons_csv)

    rows: list[dict] = []
    source_rel = args.source.relative_to(LEGACY_ROOT) if args.source.is_absolute() else args.source
    for dict_name, raw_key, hardcoded, lineno in entries:
        classification, alias_canon, hc_in_canonical, detail = classify(
            raw_key, hardcoded, resolver, canon_idx
        )
        rows.append({
            "raw_name": raw_key,
            "hardcoded_target": hardcoded,
            "classification": classification,
            "alias_target": alias_canon,
            "hardcoded_in_canonical": "yes" if hc_in_canonical else "no",
            "source_file": str(source_rel),
            "source_line": lineno,
            "detail": detail,
        })

    # Write artifact
    args.out.parent.mkdir(parents=True, exist_ok=True)
    order = {"contradictory": 0, "suspicious": 1, "redundant": 2, "required": 3}
    rows_sorted = sorted(rows, key=lambda r: (order.get(r["classification"], 9), r["source_line"]))
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=ARTIFACT_COLUMNS)
        w.writeheader()
        for r in rows_sorted:
            w.writerow({k: r[k] for k in ARTIFACT_COLUMNS})

    # Console summary
    counts = Counter(r["classification"] for r in rows)
    print(f"\n=== _HONOR_OVERRIDES redundancy audit ===")
    print(f"source:   {args.source}")
    print(f"artifact: {args.out}")
    print(f"total entries: {len(rows)}")
    for cls in ("contradictory", "suspicious", "required", "redundant"):
        print(f"  {cls:13} {counts.get(cls, 0)}")

    for cls in ("contradictory", "suspicious"):
        if counts.get(cls, 0):
            print(f"\n--- {cls.upper()} ({counts[cls]}) ---")
            for r in rows_sorted:
                if r["classification"] == cls:
                    print(f"  L{r['source_line']}  '{r['raw_name']}' → "
                          f"hardcoded='{r['hardcoded_target']}'  alias='{r['alias_target']}'")

    if counts.get("redundant", 0):
        print(f"\n--- REDUNDANT sample (first 5 of {counts['redundant']}) ---")
        shown = 0
        for r in rows_sorted:
            if r["classification"] == "redundant" and shown < 5:
                print(f"  L{r['source_line']}  '{r['raw_name']}' → '{r['hardcoded_target']}'")
                shown += 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
