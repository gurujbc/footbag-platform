#!/usr/bin/env python3
"""
QC: name_variants seed validator.

Validates `legacy_data/inputs/name_variants.csv` for structural integrity
and DB-load compatibility. Not yet wired into `run_qc.py` — the loader
itself (`scripts/load_name_variants_seed.py`) is not yet wired either.

## Problem codes

    file_missing                 input CSV absent
    utf8_decode_error            file is not valid UTF-8
    missing_required_column      header missing one of the 4 required columns
    blank_variant                variant_name is blank
    blank_canonical              canonical_name is blank
    invalid_confidence           confidence not in {high, medium}
    invalid_source               source not in {alias, display_name, bap, manual}
    identical_after_normalization  NFKC+lower+trim collapse to same string (DB CHECK would fail)
    duplicate_row                same (normalized variant, canonical_name) appears twice
    collision_across_confidence  same normalized pair present as both high and medium (ambiguity)

All codes are reportable. This check does NOT yet classify them as
hard / warn — that severity assignment lives in `run_qc.py` and will be
added when the loader is wired.

## Artifact

    out/qc_name_variants.csv
        file_line, variant_name, canonical_name, confidence, source,
        problem_code, detail

## Exit codes

    0  no structural failures
    1  structural failures found
"""

from __future__ import annotations

import argparse
import csv
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
LEGACY_ROOT = SCRIPT_DIR.parents[1]

DEFAULT_INPUT = LEGACY_ROOT / "inputs" / "name_variants.csv"
DEFAULT_OUT   = LEGACY_ROOT / "out" / "qc_name_variants.csv"

REQUIRED_COLUMNS = ["variant_name", "canonical_name", "confidence", "source"]
VALID_CONFIDENCE = {"high", "medium"}
VALID_SOURCE     = {"alias", "display_name", "bap", "manual"}

ARTIFACT_COLUMNS = [
    "file_line", "variant_name", "canonical_name",
    "confidence", "source", "problem_code", "detail",
]


def db_normalize(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = s.lower().strip()
    return " ".join(s.split())


def emit(problems: list[dict], *, file_line: int, row: dict,
         code: str, detail: str) -> None:
    problems.append({
        "file_line":      file_line,
        "variant_name":   row.get("variant_name", ""),
        "canonical_name": row.get("canonical_name", ""),
        "confidence":     row.get("confidence", ""),
        "source":         row.get("source", ""),
        "problem_code":   code,
        "detail":         detail,
    })


def validate(input_path: Path) -> tuple[list[dict], Counter]:
    problems: list[dict] = []
    counts: Counter = Counter()

    if not input_path.exists():
        problems.append({
            "file_line": 0, "variant_name": "", "canonical_name": "",
            "confidence": "", "source": "",
            "problem_code": "file_missing",
            "detail": f"{input_path} not found",
        })
        return problems, counts

    try:
        raw = input_path.read_text(encoding="utf-8")
    except UnicodeDecodeError as e:
        problems.append({
            "file_line": 0, "variant_name": "", "canonical_name": "",
            "confidence": "", "source": "",
            "problem_code": "utf8_decode_error",
            "detail": str(e),
        })
        return problems, counts

    reader = csv.DictReader(raw.splitlines())
    missing = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
    for m in missing:
        problems.append({
            "file_line": 1, "variant_name": "", "canonical_name": "",
            "confidence": "", "source": "",
            "problem_code": "missing_required_column",
            "detail": f"header missing {m!r}; found {reader.fieldnames!r}",
        })
    if missing:
        return problems, counts

    seen_pairs: dict[tuple[str, str], tuple[int, str]] = {}
    pair_confidences: dict[tuple[str, str], set[str]] = defaultdict(set)

    for i, row in enumerate(reader, start=2):  # start=2 → header is line 1
        variant   = (row.get("variant_name") or "").strip()
        canonical = (row.get("canonical_name") or "").strip()
        conf      = (row.get("confidence") or "").strip().lower()
        src       = (row.get("source") or "").strip().lower()

        counts[(src, conf)] += 1

        if not variant:
            emit(problems, file_line=i, row=row, code="blank_variant",
                 detail="variant_name is empty")
        if not canonical:
            emit(problems, file_line=i, row=row, code="blank_canonical",
                 detail="canonical_name is empty")
        if conf not in VALID_CONFIDENCE:
            emit(problems, file_line=i, row=row, code="invalid_confidence",
                 detail=f"{conf!r} not in {sorted(VALID_CONFIDENCE)}")
        if src not in VALID_SOURCE:
            emit(problems, file_line=i, row=row, code="invalid_source",
                 detail=f"{src!r} not in {sorted(VALID_SOURCE)}")

        if not variant or not canonical:
            continue

        v_norm = db_normalize(variant)
        c_norm = db_normalize(canonical)
        if v_norm and c_norm and v_norm == c_norm:
            emit(problems, file_line=i, row=row,
                 code="identical_after_normalization",
                 detail=f"both collapse to {v_norm!r}; DB CHECK would reject")
            continue

        pair_key = (v_norm, canonical)
        if pair_key in seen_pairs:
            prev_line, prev_conf = seen_pairs[pair_key]
            emit(problems, file_line=i, row=row, code="duplicate_row",
                 detail=f"same pair as line {prev_line}")
        else:
            seen_pairs[pair_key] = (i, conf)
        pair_confidences[pair_key].add(conf)

    for pair, confs in pair_confidences.items():
        if "high" in confs and "medium" in confs:
            v_norm, canonical = pair
            problems.append({
                "file_line":      0,
                "variant_name":   "",
                "canonical_name": canonical,
                "confidence":     "",
                "source":         "",
                "problem_code":   "collision_across_confidence",
                "detail":         f"{v_norm!r} -> {canonical!r} present at both high and medium",
            })

    return problems, counts


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate name_variants.csv structure.")
    ap.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    ap.add_argument("--out",   type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    problems, counts = validate(args.input)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=ARTIFACT_COLUMNS, lineterminator="\n")
        w.writeheader()
        problems.sort(key=lambda p: (p["problem_code"], p["file_line"]))
        for p in problems:
            w.writerow(p)

    print(f"=== name_variants QC ===", file=sys.stderr)
    print(f"input:    {args.input}", file=sys.stderr)
    print(f"artifact: {args.out}", file=sys.stderr)
    print(f"problems: {len(problems)}", file=sys.stderr)

    if counts:
        print(f"\nby (source, confidence):", file=sys.stderr)
        for k in sorted(counts):
            print(f"  {k[0]:13s} {k[1]:7s} {counts[k]:5d}", file=sys.stderr)

    if problems:
        by_code = Counter(p["problem_code"] for p in problems)
        print(f"\nby problem_code:", file=sys.stderr)
        for code, n in sorted(by_code.items()):
            print(f"  {code:34s} {n}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
