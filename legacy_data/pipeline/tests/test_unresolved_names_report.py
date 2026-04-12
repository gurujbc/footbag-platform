"""
tests/test_unresolved_names_report.py

Unit tests for the unresolved names report builder.

Run from legacy_data/:
    .venv/bin/python -m pytest pipeline/tests/test_unresolved_names_report.py -v

Covers:
  - classify_name          pattern classification
  - _is_excluded           placeholder / system marker detection
  - _norm_name             normalization (mirrors pipeline)
  - build_candidates       candidate collection and ranking
  - _suggest_match         conservative suggestion logic
  - write_csv              CSV output stability
"""

import sys
import csv
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from report_top_unresolved_names import (
    NameCandidate,
    _is_excluded,
    _norm_name,
    _suggest_match,
    classify_name,
    write_csv,
)


# ---------------------------------------------------------------------------
# classify_name
# ---------------------------------------------------------------------------

class TestClassifyName:

    def test_full_name_unresolved(self):
        assert classify_name("Max Smith Jr.") == "full_name_unresolved"
        assert classify_name("Ken Eldrick") == "full_name_unresolved"
        assert classify_name("Billy Hayne") == "full_name_unresolved"

    def test_initial_dot_lastname(self):
        assert classify_name("T. Lewis") == "initial_dot_lastname"
        assert classify_name("B. Dubuis") == "initial_dot_lastname"
        assert classify_name("J. Tikhomirova") == "initial_dot_lastname"

    def test_uppercase_initials(self):
        assert classify_name("PT") == "uppercase_initials"
        assert classify_name("FL") == "uppercase_initials"
        assert classify_name("JPD") == "uppercase_initials"

    def test_single_token(self):
        assert classify_name("Xander") == "single_token"
        assert classify_name("__NON_PERSON__") == "excluded"

    def test_slash_unsplit(self):
        assert classify_name("Anthony / Greg") == "slash_unsplit"

    def test_placeholder_excluded(self):
        assert classify_name("[UNKNOWN PARTNER]") == "excluded"
        assert classify_name("__UNKNOWN_PARTNER__") == "excluded"
        assert classify_name("__NON_PERSON__") == "excluded"
        assert classify_name("") == "excluded"


# ---------------------------------------------------------------------------
# _is_excluded
# ---------------------------------------------------------------------------

class TestIsExcluded:

    def test_placeholders_excluded(self):
        assert _is_excluded("[UNKNOWN PARTNER]") is True
        assert _is_excluded("__UNKNOWN_PARTNER__") is True
        assert _is_excluded("__NON_PERSON__") is True
        assert _is_excluded("") is True
        assert _is_excluded("(unknown)") is True

    def test_real_names_not_excluded(self):
        assert _is_excluded("Max Smith Jr.") is False
        assert _is_excluded("T. Lewis") is False
        assert _is_excluded("PT") is False

    def test_case_insensitive(self):
        assert _is_excluded("[Unknown Partner]") is True
        assert _is_excluded("__UNKNOWN_partner__") is True


# ---------------------------------------------------------------------------
# _norm_name
# ---------------------------------------------------------------------------

class TestNormName:

    def test_basic_normalization(self):
        assert _norm_name("Alice Smith") == "alice smith"

    def test_diacritics_stripped(self):
        assert _norm_name("François") == "francois"
        assert _norm_name("André Lemaire") == "andre lemaire"

    def test_transliteration(self):
        assert _norm_name("Łukasz") == "lukasz"
        assert _norm_name("Øyvind") == "oyvind"

    def test_whitespace_collapsed(self):
        assert _norm_name("  Alice   Smith  ") == "alice smith"

    def test_mojibake_stripped(self):
        assert _norm_name("Fran\ufffdois") == "franois"


# ---------------------------------------------------------------------------
# _suggest_match (conservative suggestions)
# ---------------------------------------------------------------------------

class TestSuggestMatch:

    def _norm_to_person(self):
        """Simple persons index."""
        return {
            "andre lemaire": ("pid-andre", "André Lemaire"),
            "max smith": ("pid-max", "Max Smith"),
            "tina lewis": ("pid-tina", "Tina Lewis"),
            "mark daniels": ("pid-mark", "Mark Daniels"),
        }

    def _last_to_persons(self):
        """Last name index."""
        from collections import defaultdict
        d = defaultdict(list)
        d["lemaire"].append(("pid-andre", "André Lemaire"))
        d["smith"].append(("pid-max", "Max Smith"))
        d["lewis"].append(("pid-tina", "Tina Lewis"))
        d["daniels"].append(("pid-mark", "Mark Daniels"))
        return d

    def test_exact_norm_match(self):
        c = NameCandidate(
            raw_name="Andre Lemaire", normalized="andre lemaire",
            category="full_name_unresolved",
        )
        _suggest_match(c, self._norm_to_person(), self._last_to_persons())
        assert c.suggested_person_id == "pid-andre"
        assert c.suggestion_confidence == "high"
        assert c.suggestion_method == "exact_norm_match"

    def test_suffix_stripped_match(self):
        c = NameCandidate(
            raw_name="Max Smith Jr.", normalized="max smith jr.",
            category="full_name_unresolved",
        )
        _suggest_match(c, self._norm_to_person(), self._last_to_persons())
        assert c.suggested_person_id == "pid-max"
        assert c.suggestion_confidence == "medium"
        assert c.suggestion_method == "suffix_stripped"

    def test_initial_lastname_unique(self):
        c = NameCandidate(
            raw_name="T. Lewis", normalized="t. lewis",
            category="initial_dot_lastname",
        )
        _suggest_match(c, self._norm_to_person(), self._last_to_persons())
        assert c.suggested_person_id == "pid-tina"
        assert c.suggestion_confidence == "low"
        assert c.suggestion_method == "initial_lastname_unique"

    def test_initial_lastname_ambiguous(self):
        """Two people with same last name and same initial → no suggestion."""
        from collections import defaultdict
        norm_to = {
            "tina lewis": ("pid-tina", "Tina Lewis"),
            "terry lewis": ("pid-terry", "Terry Lewis"),
        }
        last_to = defaultdict(list)
        last_to["lewis"].append(("pid-tina", "Tina Lewis"))
        last_to["lewis"].append(("pid-terry", "Terry Lewis"))

        c = NameCandidate(
            raw_name="T. Lewis", normalized="t. lewis",
            category="initial_dot_lastname",
        )
        _suggest_match(c, norm_to, last_to)
        # Both "Tina" and "Terry" start with "t" → ambiguous → no suggestion
        assert c.suggested_person_id == ""
        assert c.suggestion_confidence == ""

    def test_no_match(self):
        c = NameCandidate(
            raw_name="Xander Zorn", normalized="xander zorn",
            category="full_name_unresolved",
        )
        _suggest_match(c, self._norm_to_person(), self._last_to_persons())
        assert c.suggested_person_id == ""
        assert c.suggestion_confidence == ""


# ---------------------------------------------------------------------------
# NameCandidate properties
# ---------------------------------------------------------------------------

class TestNameCandidate:

    def test_year_range(self):
        c = NameCandidate(
            raw_name="Test", normalized="test", category="full_name_unresolved",
            years=[2001, 2005, 2003],
        )
        assert c.first_year == 2001
        assert c.last_year == 2005

    def test_empty_years(self):
        c = NameCandidate(
            raw_name="Test", normalized="test", category="full_name_unresolved",
        )
        assert c.first_year is None
        assert c.last_year is None

    def test_sample_events_deduped_and_limited(self):
        c = NameCandidate(
            raw_name="Test", normalized="test", category="full_name_unresolved",
            events=["evt1", "evt1", "evt2", "evt3", "evt4", "evt5", "evt6"],
        )
        sample = c.sample_events
        assert sample.count(";") <= 4  # at most 5 entries
        assert "evt1" in sample


# ---------------------------------------------------------------------------
# write_csv
# ---------------------------------------------------------------------------

class TestWriteCsv:

    def test_csv_header_and_row_count(self, tmp_path: Path):
        candidates = [
            NameCandidate(
                raw_name="Alice Smith", normalized="alice smith",
                category="full_name_unresolved", count=3,
                years=[2001], events=["evt1"], disciplines=["disc1"],
            ),
            NameCandidate(
                raw_name="Bob Jones", normalized="bob jones",
                category="full_name_unresolved", count=1,
                years=[2010], events=["evt2"], disciplines=["disc2"],
            ),
        ]
        out = tmp_path / "test_worklist.csv"
        write_csv(candidates, out, limit=None)

        with open(out, encoding="utf-8") as f:
            rows = list(csv.reader(f))
        assert rows[0][0] == "raw_name"
        assert rows[0][3] == "count"
        assert rows[0][12] == "operator_decision"
        assert rows[0][13] == "operator_notes"
        assert len(rows) == 3  # header + 2 data rows

    def test_csv_limit(self, tmp_path: Path):
        candidates = [
            NameCandidate(
                raw_name=f"Person {i}", normalized=f"person {i}",
                category="full_name_unresolved", count=i,
            )
            for i in range(10)
        ]
        out = tmp_path / "limited.csv"
        write_csv(candidates, out, limit=3)

        with open(out, encoding="utf-8") as f:
            rows = list(csv.reader(f))
        assert len(rows) == 4  # header + 3 data rows

    def test_csv_operator_fields_blank(self, tmp_path: Path):
        candidates = [
            NameCandidate(
                raw_name="Test", normalized="test",
                category="full_name_unresolved", count=1,
            ),
        ]
        out = tmp_path / "blank_ops.csv"
        write_csv(candidates, out, limit=None)

        with open(out, encoding="utf-8") as f:
            rows = list(csv.reader(f))
        # operator_decision and operator_notes should be empty
        assert rows[1][12] == ""
        assert rows[1][13] == ""
