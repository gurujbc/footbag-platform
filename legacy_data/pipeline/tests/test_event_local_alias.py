"""
tests/test_event_local_alias.py

Unit tests for conservative event-local alias expansion.

Run from legacy_data/:
    .venv/bin/python -m pytest pipeline/tests/test_event_local_alias.py -v

Covers:
  - build_event_name_index   index construction from participant dicts
  - expand_event_local_alias single-token expansion rules
  - expand_doubles_pair      pair expansion with confidence gating
  - ExpansionDiagnostics     accumulator tracking
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from event_local_alias import (
    MIN_PREFIX_LEN,
    EventNameIndex,
    ExpansionDiagnostics,
    PairExpansionResult,
    build_event_name_index,
    expand_doubles_pair,
    expand_event_local_alias,
)


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _part(display_name: str, person_id: str = "") -> dict:
    """Minimal participant dict."""
    return {"display_name": display_name, "person_id": person_id}


def _event_index() -> EventNameIndex:
    """Standard test index: 4 resolved persons for a fictional event."""
    return build_event_name_index([
        _part("Patti Schulze",     "pid-patti"),
        _part("Florence Lemaire",  "pid-florence"),
        _part("Pierre Thibault",   "pid-pierre"),
        _part("Luc Gagnon",        "pid-luc"),
    ])


# ---------------------------------------------------------------------------
# build_event_name_index
# ---------------------------------------------------------------------------

class TestBuildEventNameIndex:

    def test_first_names_indexed(self):
        idx = _event_index()
        assert "patti" in idx.first_name_index
        assert "florence" in idx.first_name_index
        assert "pierre" in idx.first_name_index
        assert "luc" in idx.first_name_index

    def test_last_names_indexed(self):
        idx = _event_index()
        assert "schulze" in idx.last_name_index
        assert "lemaire" in idx.last_name_index
        assert "thibault" in idx.last_name_index
        assert "gagnon" in idx.last_name_index

    def test_initials_indexed(self):
        idx = _event_index()
        assert "ps" in idx.initials_index
        assert "fl" in idx.initials_index
        assert "pt" in idx.initials_index
        assert "lg" in idx.initials_index

    def test_full_name_set(self):
        idx = _event_index()
        assert "patti schulze" in idx.full_name_set
        assert "florence lemaire" in idx.full_name_set

    def test_unresolved_persons_excluded(self):
        idx = build_event_name_index([
            _part("Patti Schulze", "pid-patti"),
            _part("Unknown Player", ""),       # no person_id
        ])
        assert "unknown" not in idx.first_name_index

    def test_single_word_names_skipped(self):
        """Single-word display names are not useful as expansion targets."""
        idx = build_event_name_index([
            _part("Pelé", "pid-pele"),
        ])
        assert len(idx.first_name_index) == 0
        assert len(idx.last_name_index) == 0

    def test_deduplicates_same_person_across_disciplines(self):
        idx = build_event_name_index([
            _part("Patti Schulze", "pid-patti"),
            _part("Patti Schulze", "pid-patti"),  # same person, doubles + singles
        ])
        assert len(idx.first_name_index["patti"]) == 1

    def test_empty_input(self):
        idx = build_event_name_index([])
        assert len(idx.first_name_index) == 0
        assert len(idx.full_name_set) == 0


# ---------------------------------------------------------------------------
# expand_event_local_alias — positive cases
# ---------------------------------------------------------------------------

class TestExpandPositive:

    def test_exact_first_name(self):
        idx = _event_index()
        r = expand_event_local_alias("Patti", idx)
        assert r.expanded == "Patti Schulze"
        assert r.method == "exact_first"
        assert r.is_full_name is False

    def test_exact_first_name_case_insensitive(self):
        idx = _event_index()
        r = expand_event_local_alias("patti", idx)
        assert r.expanded == "Patti Schulze"

    def test_exact_last_name(self):
        idx = _event_index()
        r = expand_event_local_alias("Gagnon", idx)
        assert r.expanded == "Luc Gagnon"
        assert r.method == "exact_last"

    def test_initials_match(self):
        idx = _event_index()
        r = expand_event_local_alias("PT", idx)
        assert r.expanded == "Pierre Thibault"
        assert r.method == "initials"

    def test_initials_case_insensitive(self):
        idx = _event_index()
        r = expand_event_local_alias("pt", idx)
        assert r.expanded == "Pierre Thibault"

    def test_prefix_match(self):
        idx = _event_index()
        r = expand_event_local_alias("Flo", idx)
        assert r.expanded == "Florence Lemaire"
        assert r.method == "prefix"

    def test_longer_prefix_also_works(self):
        idx = _event_index()
        r = expand_event_local_alias("Floren", idx)
        assert r.expanded == "Florence Lemaire"
        assert r.method == "prefix"

    def test_already_full_name_unchanged(self):
        idx = _event_index()
        r = expand_event_local_alias("Patti Schulze", idx)
        assert r.expanded == "Patti Schulze"
        assert r.method == "already_full"
        assert r.is_full_name is True


# ---------------------------------------------------------------------------
# expand_event_local_alias — negative cases
# ---------------------------------------------------------------------------

class TestExpandNegative:

    def test_ambiguous_first_name(self):
        """Two Pierres in the event → ambiguous, no expansion."""
        idx = build_event_name_index([
            _part("Pierre Thibault", "pid-pt"),
            _part("Pierre Dupont",   "pid-pd"),
        ])
        r = expand_event_local_alias("Pierre", idx)
        assert r.expanded is None
        assert r.method is None

    def test_ambiguous_initials(self):
        """Two people with same initials → ambiguous."""
        idx = build_event_name_index([
            _part("Pierre Thibault",  "pid-pt1"),
            _part("Patrick Thompson", "pid-pt2"),
        ])
        r = expand_event_local_alias("PT", idx)
        assert r.expanded is None

    def test_ambiguous_prefix(self):
        """Prefix matches multiple first names → ambiguous."""
        idx = build_event_name_index([
            _part("Florence Lemaire",  "pid-fl1"),
            _part("Florian Schmidt",   "pid-fl2"),
        ])
        r = expand_event_local_alias("Flo", idx)
        assert r.expanded is None

    def test_no_match(self):
        idx = _event_index()
        r = expand_event_local_alias("Xander", idx)
        assert r.expanded is None
        assert r.method is None
        assert r.is_full_name is False

    def test_empty_token(self):
        idx = _event_index()
        r = expand_event_local_alias("", idx)
        assert r.expanded is None

    def test_prefix_too_short(self):
        """Prefix must be >= MIN_PREFIX_LEN chars."""
        idx = _event_index()
        r = expand_event_local_alias("Fl", idx)
        # 2 chars < MIN_PREFIX_LEN (3) → no prefix match
        # "fl" IS in initials_index → check that path
        # "fl" as initials maps to Florence Lemaire (unique) → matches!
        assert r.expanded == "Florence Lemaire"
        assert r.method == "initials"

    def test_two_char_no_initials_match(self):
        """2-char token that is NOT in initials index → no match."""
        idx = _event_index()
        r = expand_event_local_alias("Xx", idx)
        assert r.expanded is None

    def test_single_char_no_match(self):
        idx = _event_index()
        r = expand_event_local_alias("P", idx)
        assert r.expanded is None


# ---------------------------------------------------------------------------
# expand_doubles_pair — confidence gating
# ---------------------------------------------------------------------------

class TestExpandDoublesPair:

    def test_both_tokens_expand_high_confidence(self):
        idx = _event_index()
        r = expand_doubles_pair("Patti", "Flo", idx)
        assert r.applied is True
        assert r.confidence == "high"
        assert r.left.expanded == "Patti Schulze"
        assert r.right.expanded == "Florence Lemaire"

    def test_both_already_full_high_confidence(self):
        idx = _event_index()
        r = expand_doubles_pair("Patti Schulze", "Florence Lemaire", idx)
        assert r.applied is True
        assert r.confidence == "high"
        assert r.left.method == "already_full"
        assert r.right.method == "already_full"

    def test_one_token_one_full_medium_confidence(self):
        idx = _event_index()
        r = expand_doubles_pair("Patti Schulze", "Flo", idx)
        assert r.applied is True
        assert r.confidence == "medium"
        assert r.left.is_full_name is True
        assert r.right.expanded == "Florence Lemaire"

    def test_one_token_one_full_reversed(self):
        idx = _event_index()
        r = expand_doubles_pair("PT", "Luc Gagnon", idx)
        assert r.applied is True
        assert r.confidence == "medium"
        assert r.left.expanded == "Pierre Thibault"

    def test_one_resolved_one_unresolved_low_confidence(self):
        idx = _event_index()
        r = expand_doubles_pair("Patti", "Xander", idx)
        assert r.applied is False
        assert r.confidence == "low"

    def test_both_unresolved_low_confidence(self):
        idx = _event_index()
        r = expand_doubles_pair("Xander", "Yolanda", idx)
        assert r.applied is False
        assert r.confidence == "low"

    def test_ambiguous_blocks_expansion(self):
        """Even if one side is clean, ambiguous other side blocks the pair."""
        idx = build_event_name_index([
            _part("Pierre Thibault",  "pid-pt1"),
            _part("Patrick Thompson", "pid-pt2"),
            _part("Luc Gagnon",       "pid-luc"),
        ])
        r = expand_doubles_pair("PT", "Luc", idx)
        # PT is ambiguous → left fails → confidence = low
        assert r.applied is False
        assert r.confidence == "low"

    def test_initials_pair_expands(self):
        idx = _event_index()
        r = expand_doubles_pair("PT", "LG", idx)
        assert r.applied is True
        assert r.confidence == "high"
        assert r.left.expanded == "Pierre Thibault"
        assert r.right.expanded == "Luc Gagnon"


# ---------------------------------------------------------------------------
# Diagnostics tracking
# ---------------------------------------------------------------------------

class TestDiagnostics:

    def test_successful_pair_counted(self):
        idx = _event_index()
        diag = ExpansionDiagnostics()
        expand_doubles_pair("Patti", "Flo", idx, diagnostics=diag)
        assert diag.pairs_attempted == 1
        assert diag.pairs_applied == 1
        assert diag.pairs_skipped == 0
        assert diag.success == 2  # both sides expanded

    def test_skipped_pair_counted(self):
        idx = _event_index()
        diag = ExpansionDiagnostics()
        expand_doubles_pair("Patti", "Xander", idx, diagnostics=diag)
        assert diag.pairs_attempted == 1
        assert diag.pairs_applied == 0
        assert diag.pairs_skipped == 1
        assert diag.success == 1     # Patti expanded
        assert diag.no_match == 1    # Xander not found

    def test_already_full_pair_counted(self):
        idx = _event_index()
        diag = ExpansionDiagnostics()
        expand_doubles_pair("Patti Schulze", "Florence Lemaire", idx, diagnostics=diag)
        assert diag.already_full == 2
        assert diag.success == 0     # no expansion needed

    def test_ambiguous_counted(self):
        idx = build_event_name_index([
            _part("Pierre Thibault",  "pid-pt1"),
            _part("Pierre Dupont",    "pid-pd"),   # same first name → ambiguous
        ])
        diag = ExpansionDiagnostics()
        expand_doubles_pair("Pierre", "Xander", idx, diagnostics=diag)
        assert diag.ambiguous == 1
        assert diag.no_match == 1

    def test_multiple_pairs_accumulate(self):
        idx = _event_index()
        diag = ExpansionDiagnostics()
        expand_doubles_pair("Patti", "Flo", idx, diagnostics=diag)
        expand_doubles_pair("PT", "Luc", idx, diagnostics=diag)
        assert diag.pairs_attempted == 2
        assert diag.pairs_applied == 2
        assert diag.success == 4


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestEdgeCases:

    def test_whitespace_in_token_stripped(self):
        idx = _event_index()
        r = expand_event_local_alias("  Patti  ", idx)
        assert r.expanded == "Patti Schulze"

    def test_three_word_name_indexed_correctly(self):
        idx = build_event_name_index([
            _part("Jean Pierre Dupont", "pid-jpd"),
        ])
        assert "jean" in idx.first_name_index
        assert "dupont" in idx.last_name_index
        # Initials: j + p + d
        assert "jpd" in idx.initials_index
        r = expand_event_local_alias("JPD", idx)
        assert r.expanded == "Jean Pierre Dupont"

    def test_exact_first_beats_prefix(self):
        """If 'Luc' is both an exact first name AND a prefix of 'Lucien',
        exact match takes priority (rule 2 before rule 5)."""
        idx = build_event_name_index([
            _part("Luc Gagnon",    "pid-luc"),
            _part("Lucien Fortin", "pid-lucien"),
        ])
        r = expand_event_local_alias("Luc", idx)
        # Exact first name match: "luc" → ["Luc Gagnon", ...]
        # But TWO people have first names starting with "luc"—
        # however, exact first-name match for "luc" returns only "Luc Gagnon"
        # because "lucien" != "luc" (exact match, not prefix)
        assert r.expanded == "Luc Gagnon"
        assert r.method == "exact_first"

    def test_min_prefix_len_constant(self):
        assert MIN_PREFIX_LEN == 3

    def test_prefix_match_excludes_exact_first(self):
        """Prefix matching skips tokens that ARE exact first names
        (those are caught by rule 2)."""
        idx = build_event_name_index([
            _part("Florence Lemaire", "pid-florence"),
        ])
        # "florence" exact first → caught by rule 2
        r = expand_event_local_alias("Florence", idx)
        assert r.method == "exact_first"
        # "flo" prefix → caught by rule 5
        r2 = expand_event_local_alias("Flo", idx)
        assert r2.method == "prefix"
