"""
tests/test_generate_alias_candidates.py

Unit tests for the alias candidate generation and apply-reviewed tool.

Run from legacy_data/:
    .venv/bin/python -m pytest pipeline/tests/test_generate_alias_candidates.py -v

Covers:
  - suggest_match          conservative suggestion rules
  - generate_candidates    CSV generation from worklist
  - apply_reviewed         reviewed → person_aliases.csv emission
  - idempotency            re-running apply does not duplicate
  - safety                 no-pid rows skipped, duplicates blocked
"""

import sys
import csv
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from generate_alias_candidates import (
    CANDIDATE_HEADER,
    _norm_name,
    apply_reviewed,
    generate_candidates,
    suggest_match,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _norm_to_person():
    return {
        "andre lemaire": ("pid-andre", "André Lemaire"),
        "max smith": ("pid-max", "Max Smith"),
        "tina lewis": ("pid-tina", "Tina Lewis"),
        "mark daniels": ("pid-mark", "Mark Daniels"),
        "oskari forsten": ("pid-oskari", "Oskari Forstén"),
    }


def _last_to_persons():
    d = defaultdict(list)
    d["lemaire"].append(("pid-andre", "André Lemaire"))
    d["smith"].append(("pid-max", "Max Smith"))
    d["lewis"].append(("pid-tina", "Tina Lewis"))
    d["daniels"].append(("pid-mark", "Mark Daniels"))
    d["forsten"].append(("pid-oskari", "Oskari Forstén"))
    return d


def _write_worklist(path: Path, rows: list[dict]) -> None:
    """Write a minimal worklist CSV."""
    header = [
        "raw_name", "normalized_name", "category", "count",
        "first_year", "last_year", "sample_events", "sample_disciplines",
        "suggested_person_id", "suggested_person_name",
        "suggestion_method", "suggestion_confidence",
        "operator_decision", "operator_notes",
    ]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header)
        writer.writeheader()
        for r in rows:
            writer.writerow({k: r.get(k, "") for k in header})


def _write_candidates(path: Path, rows: list[dict]) -> None:
    """Write a candidates CSV for apply-reviewed testing."""
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CANDIDATE_HEADER)
        writer.writeheader()
        for r in rows:
            writer.writerow({k: r.get(k, "") for k in CANDIDATE_HEADER})


def _write_aliases(path: Path, rows: list[dict]) -> None:
    """Write a person_aliases.csv."""
    fields = ["alias", "person_id", "person_canon", "status", "notes"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for r in rows:
            writer.writerow({k: r.get(k, "") for k in fields})


def _read_csv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


# ---------------------------------------------------------------------------
# suggest_match
# ---------------------------------------------------------------------------

class TestSuggestMatch:

    def test_exact_norm_match(self):
        pid, canon, method, conf = suggest_match(
            "Andre Lemaire", "andre lemaire", "full_name_unresolved",
            _norm_to_person(), _last_to_persons(), set(),
        )
        assert pid == "pid-andre"
        assert canon == "André Lemaire"
        assert method == "exact_norm_match"
        assert conf == "high"

    def test_diacritic_match_via_normalization(self):
        """Förster → forster matches Forster → forster."""
        n2p = {"thomas forster": ("pid-tf", "Thomas Forster")}
        pid, canon, method, conf = suggest_match(
            "Thomas Förster", "thomas forster", "full_name_unresolved",
            n2p, defaultdict(list), set(),
        )
        assert pid == "pid-tf"
        assert conf == "high"

    def test_suffix_stripped(self):
        pid, canon, method, conf = suggest_match(
            "Max Smith Jr.", "max smith jr.", "full_name_unresolved",
            _norm_to_person(), _last_to_persons(), set(),
        )
        assert pid == "pid-max"
        assert method == "suffix_stripped"
        assert conf == "medium"

    def test_initial_lastname_unique(self):
        pid, canon, method, conf = suggest_match(
            "T. Lewis", "t. lewis", "initial_dot_lastname",
            _norm_to_person(), _last_to_persons(), set(),
        )
        assert pid == "pid-tina"
        assert method == "initial_lastname"
        assert conf == "low"

    def test_initial_lastname_ambiguous(self):
        last_to = defaultdict(list)
        last_to["lewis"].append(("pid-tina", "Tina Lewis"))
        last_to["lewis"].append(("pid-terry", "Terry Lewis"))
        pid, _, method, conf = suggest_match(
            "T. Lewis", "t. lewis", "initial_dot_lastname",
            _norm_to_person(), last_to, set(),
        )
        # Both start with "t" → ambiguous
        assert pid == ""
        assert conf == ""

    def test_initial_lastname_wrong_category_skipped(self):
        """initial_lastname only fires for initial_dot_lastname category."""
        pid, _, method, conf = suggest_match(
            "T. Lewis", "t. lewis", "full_name_unresolved",  # wrong category
            _norm_to_person(), _last_to_persons(), set(),
        )
        # Not caught by exact or suffix → no match
        assert pid == ""

    def test_already_aliased_skipped(self):
        existing = {_norm_name("Andre Lemaire")}
        pid, _, method, conf = suggest_match(
            "Andre Lemaire", "andre lemaire", "full_name_unresolved",
            _norm_to_person(), _last_to_persons(), existing,
        )
        assert method == "already_aliased"
        assert pid == ""

    def test_no_match(self):
        pid, _, method, conf = suggest_match(
            "Xander Zorn", "xander zorn", "full_name_unresolved",
            _norm_to_person(), _last_to_persons(), set(),
        )
        assert pid == ""
        assert conf == ""


# ---------------------------------------------------------------------------
# generate_candidates (integration-style with temp files)
# ---------------------------------------------------------------------------

class TestGenerateCandidates:

    def test_generates_csv_with_correct_header(self, tmp_path: Path):
        _write_worklist(tmp_path / "worklist.csv", [
            {"raw_name": "Andre Lemaire", "normalized_name": "andre lemaire",
             "category": "full_name_unresolved", "count": "5"},
        ])
        out = tmp_path / "candidates.csv"

        # Monkey-patch module-level paths
        import generate_alias_candidates as mod
        orig_persons = mod.PERSONS_CSV
        orig_aliases = mod.ALIASES_CSV
        mod.PERSONS_CSV = tmp_path / "nonexistent.csv"
        mod.ALIASES_CSV = tmp_path / "nonexistent2.csv"
        try:
            generate_candidates(
                worklist_csv=tmp_path / "worklist.csv",
                output_csv=out, limit=50, pattern=None, only_high=False,
            )
        finally:
            mod.PERSONS_CSV = orig_persons
            mod.ALIASES_CSV = orig_aliases

        rows = _read_csv(out)
        assert len(rows) == 1
        assert rows[0]["raw_name"] == "Andre Lemaire"
        assert rows[0]["operator_decision"] == ""
        assert rows[0]["operator_person_id"] == ""

    def test_limit_respected(self, tmp_path: Path):
        worklist_rows = [
            {"raw_name": f"Person {i}", "normalized_name": f"person {i}",
             "category": "full_name_unresolved", "count": str(10 - i)}
            for i in range(10)
        ]
        _write_worklist(tmp_path / "worklist.csv", worklist_rows)
        out = tmp_path / "candidates.csv"

        import generate_alias_candidates as mod
        orig_p, orig_a = mod.PERSONS_CSV, mod.ALIASES_CSV
        mod.PERSONS_CSV = tmp_path / "none.csv"
        mod.ALIASES_CSV = tmp_path / "none2.csv"
        try:
            generate_candidates(
                worklist_csv=tmp_path / "worklist.csv",
                output_csv=out, limit=3, pattern=None, only_high=False,
            )
        finally:
            mod.PERSONS_CSV, mod.ALIASES_CSV = orig_p, orig_a

        rows = _read_csv(out)
        assert len(rows) == 3

    def test_pattern_filter(self, tmp_path: Path):
        _write_worklist(tmp_path / "worklist.csv", [
            {"raw_name": "Andre Lemaire", "normalized_name": "andre lemaire",
             "category": "full_name_unresolved", "count": "5"},
            {"raw_name": "T. Lewis", "normalized_name": "t. lewis",
             "category": "initial_dot_lastname", "count": "3"},
        ])
        out = tmp_path / "candidates.csv"

        import generate_alias_candidates as mod
        orig_p, orig_a = mod.PERSONS_CSV, mod.ALIASES_CSV
        mod.PERSONS_CSV = tmp_path / "none.csv"
        mod.ALIASES_CSV = tmp_path / "none2.csv"
        try:
            generate_candidates(
                worklist_csv=tmp_path / "worklist.csv",
                output_csv=out, limit=50, pattern="initial_dot_lastname",
                only_high=False,
            )
        finally:
            mod.PERSONS_CSV, mod.ALIASES_CSV = orig_p, orig_a

        rows = _read_csv(out)
        assert len(rows) == 1
        assert rows[0]["category"] == "initial_dot_lastname"


# ---------------------------------------------------------------------------
# apply_reviewed
# ---------------------------------------------------------------------------

class TestApplyReviewed:

    def test_approved_rows_appended(self, tmp_path: Path):
        _write_aliases(tmp_path / "aliases.csv", [
            {"alias": "Existing Alias", "person_id": "pid-existing",
             "person_canon": "Existing Person", "status": "verified", "notes": ""},
        ])
        _write_candidates(tmp_path / "candidates.csv", [
            {"raw_name": "Andre Lemaire", "suggested_person_id": "pid-andre",
             "suggested_canonical_name": "André Lemaire",
             "suggestion_method": "exact_norm_match",
             "operator_decision": "approve"},
        ])

        apply_reviewed(
            input_csv=tmp_path / "candidates.csv",
            output_csv=tmp_path / "aliases.csv",
        )

        rows = _read_csv(tmp_path / "aliases.csv")
        assert len(rows) == 2
        new_row = [r for r in rows if r["alias"] == "Andre Lemaire"][0]
        assert new_row["person_id"] == "pid-andre"
        assert new_row["person_canon"] == "André Lemaire"
        assert new_row["status"] == "verified"

    def test_rejected_rows_ignored(self, tmp_path: Path):
        _write_aliases(tmp_path / "aliases.csv", [])
        _write_candidates(tmp_path / "candidates.csv", [
            {"raw_name": "Rejected Name", "suggested_person_id": "pid-x",
             "suggested_canonical_name": "X",
             "operator_decision": "reject"},
        ])

        apply_reviewed(
            input_csv=tmp_path / "candidates.csv",
            output_csv=tmp_path / "aliases.csv",
        )

        rows = _read_csv(tmp_path / "aliases.csv")
        assert len(rows) == 0

    def test_deferred_rows_ignored(self, tmp_path: Path):
        _write_aliases(tmp_path / "aliases.csv", [])
        _write_candidates(tmp_path / "candidates.csv", [
            {"raw_name": "Deferred Name", "suggested_person_id": "pid-x",
             "suggested_canonical_name": "X",
             "operator_decision": "defer"},
        ])

        apply_reviewed(
            input_csv=tmp_path / "candidates.csv",
            output_csv=tmp_path / "aliases.csv",
        )

        rows = _read_csv(tmp_path / "aliases.csv")
        assert len(rows) == 0

    def test_operator_person_id_overrides_suggestion(self, tmp_path: Path):
        _write_aliases(tmp_path / "aliases.csv", [])
        _write_candidates(tmp_path / "candidates.csv", [
            {"raw_name": "Test Name", "suggested_person_id": "pid-suggested",
             "suggested_canonical_name": "Suggested Person",
             "operator_decision": "approve",
             "operator_person_id": "pid-override"},
        ])

        apply_reviewed(
            input_csv=tmp_path / "candidates.csv",
            output_csv=tmp_path / "aliases.csv",
        )

        rows = _read_csv(tmp_path / "aliases.csv")
        assert rows[0]["person_id"] == "pid-override"

    def test_no_pid_skipped_with_warning(self, tmp_path: Path, capsys):
        _write_aliases(tmp_path / "aliases.csv", [])
        _write_candidates(tmp_path / "candidates.csv", [
            {"raw_name": "No PID Name",
             "suggested_person_id": "",
             "operator_decision": "approve",
             "operator_person_id": ""},
        ])

        apply_reviewed(
            input_csv=tmp_path / "candidates.csv",
            output_csv=tmp_path / "aliases.csv",
        )

        rows = _read_csv(tmp_path / "aliases.csv")
        assert len(rows) == 0
        captured = capsys.readouterr()
        assert "WARNING" in captured.out
        assert "No PID Name" in captured.out

    def test_duplicate_alias_skipped(self, tmp_path: Path):
        _write_aliases(tmp_path / "aliases.csv", [
            {"alias": "Andre Lemaire", "person_id": "pid-andre",
             "person_canon": "André Lemaire", "status": "verified", "notes": ""},
        ])
        _write_candidates(tmp_path / "candidates.csv", [
            {"raw_name": "Andre Lemaire", "suggested_person_id": "pid-andre",
             "suggested_canonical_name": "André Lemaire",
             "operator_decision": "approve"},
        ])

        apply_reviewed(
            input_csv=tmp_path / "candidates.csv",
            output_csv=tmp_path / "aliases.csv",
        )

        rows = _read_csv(tmp_path / "aliases.csv")
        # Should still have exactly 1 row, not 2
        assert len(rows) == 1

    def test_idempotent_on_rerun(self, tmp_path: Path):
        """Running apply twice with same input produces same output."""
        _write_aliases(tmp_path / "aliases.csv", [])
        _write_candidates(tmp_path / "candidates.csv", [
            {"raw_name": "Andre Lemaire", "suggested_person_id": "pid-andre",
             "suggested_canonical_name": "André Lemaire",
             "suggestion_method": "exact_norm_match",
             "operator_decision": "approve"},
        ])

        apply_reviewed(
            input_csv=tmp_path / "candidates.csv",
            output_csv=tmp_path / "aliases.csv",
        )
        first_rows = _read_csv(tmp_path / "aliases.csv")

        apply_reviewed(
            input_csv=tmp_path / "candidates.csv",
            output_csv=tmp_path / "aliases.csv",
        )
        second_rows = _read_csv(tmp_path / "aliases.csv")

        assert len(first_rows) == len(second_rows) == 1

    def test_output_sorted_by_alias(self, tmp_path: Path):
        _write_aliases(tmp_path / "aliases.csv", [
            {"alias": "Zara Zane", "person_id": "pid-z",
             "person_canon": "Zara Zane", "status": "verified", "notes": ""},
        ])
        _write_candidates(tmp_path / "candidates.csv", [
            {"raw_name": "Alice Smith", "suggested_person_id": "pid-a",
             "suggested_canonical_name": "Alice Smith",
             "operator_decision": "approve"},
        ])

        apply_reviewed(
            input_csv=tmp_path / "candidates.csv",
            output_csv=tmp_path / "aliases.csv",
        )

        rows = _read_csv(tmp_path / "aliases.csv")
        assert rows[0]["alias"] == "Alice Smith"
        assert rows[1]["alias"] == "Zara Zane"

    def test_notes_include_method(self, tmp_path: Path):
        _write_aliases(tmp_path / "aliases.csv", [])
        _write_candidates(tmp_path / "candidates.csv", [
            {"raw_name": "Test", "suggested_person_id": "pid-t",
             "suggested_canonical_name": "Test Person",
             "suggestion_method": "exact_norm_match",
             "operator_decision": "approve",
             "operator_notes": "confirmed manually"},
        ])

        apply_reviewed(
            input_csv=tmp_path / "candidates.csv",
            output_csv=tmp_path / "aliases.csv",
        )

        rows = _read_csv(tmp_path / "aliases.csv")
        assert "via:exact_norm_match" in rows[0]["notes"]
        assert "confirmed manually" in rows[0]["notes"]
