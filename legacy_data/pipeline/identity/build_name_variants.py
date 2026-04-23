#!/usr/bin/env python3
"""
Build `legacy_data/inputs/name_variants.csv` from existing identity sources.

The output is a reviewable, deterministic seed of known name-equivalence
pairs. It is consumed downstream by:

  - scripts/load_name_variants_seed.py   (draft loader → DB `name_variants`)
  - pipeline/qc/check_name_variants.py   (structural QC; not yet wired)

See `docs/MIGRATION_PLAN.md §7` (registration-time auto-link) and
`database/schema.sql name_variants` for the consuming contract.

## Sources (priority order)

1. `inputs/identity_lock/Person_Display_Names_v1.csv` — curated PT51
   display-name map (display_name → effective_person_id → canonical).
   Treated as HIGH confidence across the board.
2. `inputs/bap_data_updated.csv` — BAP honor-name list. Emitted only
   where the BAP `name` matches a canonical person by normalized form
   AND the two differ visually (diacritic / spelling).
3. `out/canonical/persons.csv` — for every canonical name bearing a
   diacritic, synthesize the ASCII-folded variant. Source tag
   `manual`; HIGH confidence.
4. `overrides/person_aliases.csv` — structural variants from the
   alias registry. See filters below.

Canonical names come from `persons.csv.person_name` (diacritics
preserved) via `person_id` lookup. Display-names from
`Person_Display_Names_v1.csv` fall back to its own `person_canon`
column only when the pid is not present in current persons.csv.

## Filters

- Variant and canonical must each have ≥2 name tokens.
- Variant surname must plausibly belong to the same family as canonical
  surname (exact match, ≤2-char edit with ≥70% letter-set overlap, or
  prefix/suffix containment).
- Drop mojibake and pipeline-cleanup noise characters: ? ¿ � ¹ ~ ` " *
  # $ % ^ & | \\ < > { } [ ] and quoted inner tokens ('Red' etc.).
- Drop variants with digit tokens (event-line artifacts).
- Drop pure case-only and pure whitespace-only differences
  (the application-side normalizer handles those).
- Drop pure diacritic strips from `alias` source — the `manual` pass
  owns that shape.
- **Collision guard**: drop any variant whose normalized form matches a
  *different* canonical person. This catches deferred Bucket-2 cases
  (e.g. Alex Zeke Ibardaloza vs Alex Ibardaloza, Andreas Grandi Peier
  vs Andreas Peier) so domain-ambiguous pairs do not seed the
  registration auto-link.
- **Alias MEDIUM gate**: keep only *structural* variants — token-order
  swap, initial spacing (A.J. vs AJ), hyphen/space toggle in surname,
  single-token middle-name drop. Pure letter-typo substitutions are
  excluded; runtime Levenshtein will handle those.

## Confidence classification

- HIGH: variant and canonical match after aggressive normalization
  (diacritics, punctuation, case, whitespace), or same token set in
  different order.
- MEDIUM: any other structural variant retained by the filters above.

## Output schema

CSV columns: `variant_name, canonical_name, confidence, source`.

- Values are display-friendly (mixed case, diacritics preserved on
  canonical). The DB-side normalization (NFKC + lower + collapse +
  trim) is the loader's job, not this file's.
- Confidence ∈ {high, medium}.
- Source ∈ {alias, display_name, bap, manual}.
- Deduped on `(aggressively-normalized variant, canonical)`.
- Sorted by `(lower canonical, lower variant, source, confidence)`.
- UTF-8, LF line endings.

## When to re-run

Re-run any time an upstream source changes:

- `overrides/person_aliases.csv` is edited
- `inputs/identity_lock/Person_Display_Names_v1.csv` is extended
- `inputs/bap_data_updated.csv` is refreshed
- `out/canonical/persons.csv` changes (e.g. after a canonical_only run)

The output is deterministic for a given set of inputs. Treat the CSV
diff as a review artifact when upstream data changes. The
`scripts/load_name_variants_seed.py` loader is **not** wired into
`run_pipeline.sh` yet; regeneration does not affect the DB.

Usage (from `legacy_data/` with the venv active):

    python pipeline/identity/build_name_variants.py
"""

from __future__ import annotations

import argparse
import csv
import sys
import unicodedata
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
LEGACY_ROOT = SCRIPT_DIR.parents[1]  # identity/ → pipeline/ → legacy_data/

DEFAULT_PERSONS_CSV = LEGACY_ROOT / "out" / "canonical" / "persons.csv"
DEFAULT_ALIASES_CSV = LEGACY_ROOT / "overrides" / "person_aliases.csv"
DEFAULT_DISPLAY_CSV = LEGACY_ROOT / "inputs" / "identity_lock" / "Person_Display_Names_v1.csv"
DEFAULT_BAP_CSV     = LEGACY_ROOT / "inputs" / "bap_data_updated.csv"
DEFAULT_OUT_CSV     = LEGACY_ROOT / "inputs" / "name_variants.csv"

OUTPUT_FIELDS = ["variant_name", "canonical_name", "confidence", "source"]


# ---------------------------------------------------------------------------
# String utilities

def strip_diacritics(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")


def norm_ws(s: str) -> str:
    return " ".join(s.strip().split())


def normalize_case(s: str) -> str:
    """Title-case only when the input is entirely upper or entirely lower.
    Preserves mixed case (O'Brien, McCarthy, de la Cruz) as-is."""
    letters = [c for c in s if c.isalpha()]
    if not letters:
        return s
    if all(c.isupper() for c in letters) or all(c.islower() for c in letters):
        out = []
        prev_alpha = False
        for c in s:
            if c.isalpha():
                out.append(c.upper() if not prev_alpha else c.lower())
                prev_alpha = True
            else:
                out.append(c)
                prev_alpha = False
        return "".join(out)
    return s


def norm_key(s: str) -> str:
    """Aggressive normalization for dedup / collision detection:
    strip diacritics, lowercase, strip punctuation, collapse whitespace."""
    s = strip_diacritics(s).lower()
    chars: list[str] = []
    for ch in s:
        chars.append(ch if ch.isalnum() or ch == " " else " ")
    return " ".join("".join(chars).split())


def tokens(s: str) -> list[str]:
    return norm_key(s).split()


# ---------------------------------------------------------------------------
# Variant-quality predicates

_NOISE_CHARS = set("?¿�¹~`\"*#$%^&|\\<>{}[]")


def _is_clean_variant(s: str) -> bool:
    """Reject OCR/mojibake variants and pipeline-cleanup markers."""
    if any(ch in _NOISE_CHARS for ch in s):
        return False
    if "'" in s:
        for tok in s.split():
            if tok.startswith("'") and tok.endswith("'"):
                return False
    if s.strip(" -.,") != s:
        return False
    if any(tok in ("-", "--", "---") for tok in s.split()):
        return False
    return True


def _has_digit_token(s: str) -> bool:
    return any(any(ch.isdigit() for ch in tok) for tok in s.split())


def surname_family_ok(variant: str, canonical: str) -> bool:
    """Variant surname must plausibly belong to the same family as canonical."""
    v_tok, c_tok = tokens(variant), tokens(canonical)
    if not v_tok or not c_tok:
        return False
    v_last, c_last = v_tok[-1], c_tok[-1]
    if v_last == c_last:
        return True
    if abs(len(v_last) - len(c_last)) <= 2:
        shared = set(v_last) & set(c_last)
        smaller = min(len(set(v_last)), len(set(c_last)))
        if smaller and len(shared) / smaller >= 0.7:
            return True
    if v_last.startswith(c_last) or c_last.startswith(v_last):
        return True
    if len(v_last) >= 4 and len(c_last) >= 4 and (v_last in c_last or c_last in v_last):
        return True
    return False


def classify_confidence(variant: str, canonical: str) -> str:
    """HIGH for diacritic/punct/case/order-only differences; MEDIUM otherwise."""
    if norm_key(variant) == norm_key(canonical):
        return "high"
    v_tok, c_tok = tokens(variant), tokens(canonical)
    if v_tok and c_tok and v_tok == c_tok:
        return "high"
    if v_tok and c_tok and set(v_tok) == set(c_tok) and len(v_tok) == len(c_tok):
        return "high"
    return "medium"


def _is_structural_variant(alias: str, canonical: str) -> bool:
    """
    Structural = edit a Levenshtein-based matcher would miss at runtime:
      - token-order swap (Last First vs First Last)
      - initial form change (A.J. vs AJ, P. T. vs P.T.)
      - hyphen/space toggle in surname (Freeman Genz vs Freeman-Genz)
      - parenthetical or apostrophe middle-name removal
    Returns False for pure letter-typo substitutions.
    """
    v_tok, c_tok = tokens(alias), tokens(canonical)
    if not v_tok or not c_tok:
        return False
    if sorted(v_tok) == sorted(c_tok) and v_tok != c_tok:
        return True

    def _merge_initials(toks: list[str]) -> list[str]:
        out: list[str] = []
        buf = ""
        for t in toks:
            t2 = t.replace(".", "")
            if len(t2) == 1 and t2.isalpha():
                buf += t2
            else:
                if buf:
                    out.append(buf)
                    buf = ""
                out.append(t2)
        if buf:
            out.append(buf)
        return out

    if _merge_initials(v_tok) == _merge_initials(c_tok):
        return True

    def _collapse_hyphens(s: str) -> str:
        return norm_key(s.replace("-", " "))

    if _collapse_hyphens(alias) == _collapse_hyphens(canonical):
        return True

    set_v, set_c = set(v_tok), set(c_tok)
    if set_v < set_c or set_c < set_v:
        diff = (set_v | set_c) - (set_v & set_c)
        if len(diff) == 1 and len(set_v & set_c) >= 2:
            return True
    return False


# ---------------------------------------------------------------------------
# Loaders

def load_persons(persons_csv: Path) -> dict[str, str]:
    """person_id -> canonical person_name (diacritics preserved)."""
    idx: dict[str, str] = {}
    with open(persons_csv, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            pid = (r.get("person_id") or "").strip()
            name = norm_ws(r.get("person_name") or "")
            if pid and name:
                idx[pid] = name
    return idx


def load_persons_by_nname(persons: dict[str, str]) -> dict[str, str]:
    """normalized_name -> canonical person_name (first writer wins)."""
    idx: dict[str, str] = {}
    for _pid, name in persons.items():
        idx.setdefault(norm_key(name), name)
    return idx


def _collides_with_other_canonical(variant: str, canonical: str,
                                   persons_by_nname: dict[str, str]) -> bool:
    other = persons_by_nname.get(norm_key(variant))
    return other is not None and other != canonical


# ---------------------------------------------------------------------------
# Emitters

def emit_from_display(display_csv: Path,
                      persons: dict[str, str],
                      persons_by_nname: dict[str, str],
                      seen: set) -> list[dict]:
    rows: list[dict] = []
    with open(display_csv, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            display = norm_ws(r.get("display_name") or "")
            pid     = (r.get("effective_person_id") or "").strip()
            if not display or not pid:
                continue
            canonical = persons.get(pid)
            if not canonical:
                canonical = norm_ws(r.get("person_canon") or "")
                if not canonical:
                    continue
            if len(tokens(display)) < 2 or len(tokens(canonical)) < 2:
                continue
            if display == canonical:
                continue
            if _has_digit_token(canonical) or _has_digit_token(display):
                continue
            if _collides_with_other_canonical(display, canonical, persons_by_nname):
                continue
            variant_final = normalize_case(display)
            if variant_final == canonical:
                # Post-normalization self-pair (e.g. all-caps variant whose pid
                # is missing from persons.csv and falls back to person_canon
                # that matches the case-normalized variant). Nothing to learn.
                continue
            key = (norm_key(display), canonical)
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                "variant_name":   variant_final,
                "canonical_name": canonical,
                "confidence":     "high",
                "source":         "display_name",
            })
    return rows


def emit_from_bap(bap_csv: Path,
                  persons_by_nname: dict[str, str],
                  seen: set) -> list[dict]:
    """Keep BAP rows whose name resolves to a canonical person *and* differs visually."""
    rows: list[dict] = []
    with open(bap_csv, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            bap_name = norm_ws(r.get("name") or "")
            if not bap_name or len(tokens(bap_name)) < 2:
                continue
            canonical = persons_by_nname.get(norm_key(bap_name))
            if not canonical:
                continue
            if bap_name == canonical:
                continue
            variant_final = normalize_case(bap_name)
            if variant_final == canonical:
                continue
            key = (norm_key(bap_name), canonical)
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                "variant_name":   variant_final,
                "canonical_name": canonical,
                "confidence":     classify_confidence(bap_name, canonical),
                "source":         "bap",
            })
    return rows


def emit_manual_diacritics(persons: dict[str, str],
                           persons_by_nname: dict[str, str],
                           seen: set) -> list[dict]:
    rows: list[dict] = []
    for _pid, name in persons.items():
        stripped = strip_diacritics(name)
        if stripped == name:
            continue
        if len(tokens(stripped)) < 2:
            continue
        if _has_digit_token(name):
            continue
        if _collides_with_other_canonical(stripped, name, persons_by_nname):
            continue
        key = (norm_key(stripped), name)
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "variant_name":   stripped,
            "canonical_name": name,
            "confidence":     "high",
            "source":         "manual",
        })
    return rows


def emit_from_aliases(aliases_csv: Path,
                      persons: dict[str, str],
                      persons_by_nname: dict[str, str],
                      seen: set) -> list[dict]:
    rows: list[dict] = []
    with open(aliases_csv, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            alias  = norm_ws(r.get("alias") or "")
            pid    = (r.get("person_id") or "").strip()
            status = (r.get("status") or "").strip()
            if not alias or not pid:
                continue
            if status and status != "verified":
                continue
            if not _is_clean_variant(alias):
                continue
            canonical = persons.get(pid)
            if not canonical:
                continue
            v_tok, c_tok = tokens(alias), tokens(canonical)
            if not (2 <= len(v_tok) <= 4) or len(c_tok) < 2:
                continue
            if alias.lower().strip() == canonical.lower().strip():
                continue
            if strip_diacritics(alias).lower() == strip_diacritics(canonical).lower():
                continue
            if not surname_family_ok(alias, canonical):
                continue
            if _has_digit_token(canonical) or _has_digit_token(alias):
                continue
            if _collides_with_other_canonical(alias, canonical, persons_by_nname):
                continue
            conf = classify_confidence(alias, canonical)
            if conf == "medium" and not _is_structural_variant(alias, canonical):
                continue
            variant_final = normalize_case(alias)
            if variant_final == canonical:
                continue
            key = (norm_key(alias), canonical)
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                "variant_name":   variant_final,
                "canonical_name": canonical,
                "confidence":     conf,
                "source":         "alias",
            })
    return rows


# ---------------------------------------------------------------------------
# Main

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--persons-csv", type=Path, default=DEFAULT_PERSONS_CSV)
    ap.add_argument("--aliases-csv", type=Path, default=DEFAULT_ALIASES_CSV)
    ap.add_argument("--display-csv", type=Path, default=DEFAULT_DISPLAY_CSV)
    ap.add_argument("--bap-csv",     type=Path, default=DEFAULT_BAP_CSV)
    ap.add_argument("--out",         type=Path, default=DEFAULT_OUT_CSV)
    args = ap.parse_args()

    persons = load_persons(args.persons_csv)
    persons_by_nname = load_persons_by_nname(persons)
    print(f"Loaded {len(persons)} canonical persons", file=sys.stderr)

    seen: set[tuple[str, str]] = set()
    all_rows: list[dict] = []

    display_rows = emit_from_display(args.display_csv, persons, persons_by_nname, seen)
    all_rows.extend(display_rows)
    print(f"display_name: {len(display_rows):4d} rows", file=sys.stderr)

    bap_rows = emit_from_bap(args.bap_csv, persons_by_nname, seen)
    all_rows.extend(bap_rows)
    print(f"bap:          {len(bap_rows):4d} rows", file=sys.stderr)

    manual_rows = emit_manual_diacritics(persons, persons_by_nname, seen)
    all_rows.extend(manual_rows)
    print(f"manual:       {len(manual_rows):4d} rows", file=sys.stderr)

    alias_rows = emit_from_aliases(args.aliases_csv, persons, persons_by_nname, seen)
    all_rows.extend(alias_rows)
    print(f"alias:        {len(alias_rows):4d} rows", file=sys.stderr)

    print(f"TOTAL:        {len(all_rows):4d} rows", file=sys.stderr)

    # Deterministic order: primary (canonical), secondary (variant),
    # tertiary (source, confidence) to stabilise ties.
    all_rows.sort(key=lambda r: (
        r["canonical_name"].lower(),
        r["variant_name"].lower(),
        r["source"],
        r["confidence"],
    ))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=OUTPUT_FIELDS, lineterminator="\n")
        w.writeheader()
        for r in all_rows:
            w.writerow(r)

    print(f"Wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
