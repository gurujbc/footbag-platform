"""
tests/test_investigation.py

Unit tests for the forensic helpers in investigate_discipline_anomaly.py.

Run from legacy_data/:
    .venv/bin/python -m pytest pipeline/tests/test_investigation.py -v

Covers:
  - normalize_name          artifact stripping for comparison
  - compare_names           identical vs. materially different
  - analyze_placement_structure  cluster detection, outlier flagging
  - collect_duplicate_persons    per-placement heuristic duplicates
  - collect_link_inconsistencies same-pid/same-name cross-row checks
  - generate_verdict             heuristic root-cause labeling
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from investigate_discipline_anomaly import (
    analyze_placement_structure,
    collect_duplicate_persons,
    collect_link_inconsistencies,
    compare_names,
    generate_verdict,
    normalize_name,
)


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _p(placement=1, participant_order=1, display_name="", person_id="", notes=""):
    return {
        "event_key": "evt",
        "discipline_key": "disc",
        "placement": str(placement),
        "participant_order": str(participant_order),
        "display_name": display_name,
        "person_id": person_id,
        "notes": notes,
    }


def _resolved(pl, name, pid=""):
    """Minimal resolved-tuple for collect_duplicate_persons."""
    winner = _p(placement=pl, display_name=name, person_id=pid)
    return (pl, winner, None, "test")


# ---------------------------------------------------------------------------
# normalize_name
# ---------------------------------------------------------------------------

class TestNormalizeName:

    def test_plain_name_unchanged(self):
        assert normalize_name("Alice Smith") == "Alice Smith"

    def test_strips_whitespace(self):
        assert normalize_name("  Alice Smith  ") == "Alice Smith"

    def test_removes_embedded_ordinal(self):
        assert normalize_name("Tuomas Kärki 1. Tuomas Kärki") == "Tuomas Kärki Tuomas Kärki"
        assert normalize_name("Jukka Peltola 2. Oskari Forsten") == "Jukka Peltola Oskari Forsten"

    def test_collapses_multiple_spaces(self):
        assert normalize_name("Alice   Smith") == "Alice Smith"

    def test_empty_string(self):
        assert normalize_name("") == ""


# ---------------------------------------------------------------------------
# compare_names
# ---------------------------------------------------------------------------

class TestCompareNames:

    def test_identical_names(self):
        result = compare_names("Teppo Harju", "Teppo Harju")
        assert result["materially_identical"] is True

    def test_different_names(self):
        result = compare_names("Alice Smith", "Bob Jones")
        assert result["materially_identical"] is False

    def test_artifact_vs_clean(self):
        # "Tuomas Kärki 1. Tuomas Kärki" normalizes to a string that still
        # differs from "Alice Smith" — the key question is whether two
        # appearances of the SAME person have the same normalized form.
        result = compare_names("Tuomas Kärki 1. Tuomas Kärki", "Tuomas Kärki Tuomas Kärki")
        # Both normalize to "Tuomas Kärki Tuomas Kärki"
        assert result["materially_identical"] is True

    def test_case_insensitive(self):
        result = compare_names("teppo harju", "TEPPO HARJU")
        assert result["materially_identical"] is True

    def test_result_structure(self):
        result = compare_names("Alice", "Bob")
        for key in ["raw_1", "raw_2", "normalized_1", "normalized_2", "materially_identical"]:
            assert key in result


# ---------------------------------------------------------------------------
# analyze_placement_structure
# ---------------------------------------------------------------------------

class TestAnalyzePlacementStructure:

    def test_empty(self):
        r = analyze_placement_structure([])
        assert r["hypothesis"] == "empty"
        assert r["n_clusters"] == 0

    def test_contiguous_sequence(self):
        r = analyze_placement_structure([1, 2, 3, 4, 5])
        assert r["hypothesis"] == "contiguous"
        assert r["n_clusters"] == 1
        assert r["outliers"] == []
        assert r["max_gap"] == 1

    def test_single_item(self):
        r = analyze_placement_structure([1])
        assert r["n_clusters"] == 1
        assert r["max_gap"] == 0

    def test_jfk_pattern(self):
        """[1,2,3,4,5,6,7,8,9,15] — main cluster + isolated outlier."""
        r = analyze_placement_structure([1, 2, 3, 4, 5, 6, 7, 8, 9, 15])
        assert r["hypothesis"] == "possible_merged_sets"
        assert r["n_clusters"] == 2
        assert r["max_gap"] == 6
        assert 15 in r["outliers"]
        # Main cluster should be 1–9
        main_cluster = [c for c in r["clusters"] if len(c) > 1][0]
        assert main_cluster == [1, 2, 3, 4, 5, 6, 7, 8, 9]

    def test_sparse_with_gaps(self):
        """Gaps that don't create separate clusters: e.g. tie-adjusted 1,2,3,5,8."""
        r = analyze_placement_structure([1, 2, 3, 5, 8])
        # Gaps of 2 and 3 — should not split into multiple clusters
        # (gap of 3 is exactly at the threshold; depends on > vs >=)
        # The implementation uses > _CLUSTER_GAP_THRESHOLD (which is 3),
        # so a gap of 3 keeps items in the same cluster.
        assert r["n_clusters"] == 1

    def test_two_well_separated_clusters(self):
        r = analyze_placement_structure([1, 2, 3, 10, 11, 12])
        assert r["hypothesis"] == "possible_merged_sets"
        assert r["n_clusters"] == 2

    def test_outlier_only_when_multiple_clusters(self):
        """A cluster of [15] is NOT an outlier when it's the only cluster."""
        r = analyze_placement_structure([15])
        assert r["outliers"] == []

    def test_deduplicates_placements(self):
        """Duplicate values should be collapsed."""
        r = analyze_placement_structure([1, 1, 2, 2, 3])
        assert r["sorted"] == [1, 2, 3]


# ---------------------------------------------------------------------------
# collect_duplicate_persons
# ---------------------------------------------------------------------------

class TestCollectDuplicatePersons:

    def test_no_duplicates(self):
        resolved = [
            _resolved(1, "Alice", "pid-001"),
            _resolved(2, "Bob",   "pid-002"),
        ]
        result = collect_duplicate_persons(resolved)
        assert result == []

    def test_single_duplicate(self):
        resolved = [
            _resolved(1, "Alice", "pid-001"),
            _resolved(2, "Alice", "pid-001"),  # same pid at P2
        ]
        result = collect_duplicate_persons(resolved)
        assert len(result) == 1
        assert result[0]["pid"] == "pid-001"
        assert sorted(result[0]["placements"]) == [1, 2]
        assert result[0]["raw_names"] == ["Alice", "Alice"]

    def test_identical_raw_names_flagged(self):
        resolved = [
            _resolved(6,  "Teppo Harju", "pid-teppo"),
            _resolved(15, "Teppo Harju", "pid-teppo"),
        ]
        result = collect_duplicate_persons(resolved)
        assert len(result) == 1
        nc = result[0]["name_comparison"]
        assert nc["materially_identical"] is True

    def test_no_person_id_not_counted(self):
        resolved = [
            _resolved(1, "Alice", ""),   # no pid
            _resolved(2, "Alice", ""),   # no pid
        ]
        result = collect_duplicate_persons(resolved)
        assert result == []

    def test_winner_none_skipped(self):
        resolved = [(1, None, None, "unresolvable")]
        result = collect_duplicate_persons(resolved)
        assert result == []

    def test_three_placements_same_person(self):
        resolved = [
            _resolved(1, "Alice", "pid-x"),
            _resolved(3, "Alice", "pid-x"),
            _resolved(5, "Alice", "pid-x"),
        ]
        result = collect_duplicate_persons(resolved)
        assert len(result) == 1
        assert sorted(result[0]["placements"]) == [1, 3, 5]


# ---------------------------------------------------------------------------
# collect_link_inconsistencies
# ---------------------------------------------------------------------------

class TestCollectLinkInconsistencies:

    def test_no_issues(self):
        parts = [
            _p(placement=1, display_name="Alice Smith", person_id="pid-001"),
            _p(placement=2, display_name="Bob Jones",   person_id="pid-002"),
        ]
        result = collect_link_inconsistencies(parts)
        assert result == []

    def test_same_pid_same_name_no_issue(self):
        """Same pid appearing at two placements with same name is not a link error."""
        parts = [
            _p(placement=1, display_name="Alice Smith", person_id="pid-001"),
            _p(placement=2, display_name="alice smith", person_id="pid-001"),  # case variant
        ]
        result = collect_link_inconsistencies(parts)
        # Normalized names are the same (after lowercasing) → no inconsistency
        assert not any(i["type"] == "same_pid_different_names" for i in result)

    def test_same_pid_different_names_flagged(self):
        parts = [
            _p(placement=1, display_name="Alice Smith", person_id="pid-001"),
            _p(placement=2, display_name="Bob Jones",   person_id="pid-001"),  # different name!
        ]
        result = collect_link_inconsistencies(parts)
        same_pid_issues = [i for i in result if i["type"] == "same_pid_different_names"]
        assert len(same_pid_issues) >= 1

    def test_placeholders_excluded(self):
        """Placeholder names should not contribute to link audit."""
        parts = [
            _p(placement=1, display_name="Alice Smith",     person_id="pid-001"),
            _p(placement=1, display_name="[UNKNOWN PARTNER]", person_id=""),
        ]
        result = collect_link_inconsistencies(parts)
        assert result == []


# ---------------------------------------------------------------------------
# generate_verdict
# ---------------------------------------------------------------------------

class TestGenerateVerdict:

    def _make_structure(self, hypothesis, n_clusters=1, max_gap=1,
                        outliers=None, clusters=None):
        return {
            "hypothesis": hypothesis,
            "n_clusters": n_clusters,
            "max_gap": max_gap,
            "outliers": outliers or [],
            "clusters": clusters or [[1, 2, 3]],
        }

    def test_inconclusive_when_no_signals(self):
        structure = self._make_structure("contiguous")
        code, _ = generate_verdict(structure, dup_persons=[], link_inconsistencies=[])
        assert code == "INCONCLUSIVE"

    def test_merged_sets_hypothesis(self):
        """JFK-like pattern: merged-sets structure + same person in main + outlier."""
        structure = self._make_structure(
            "possible_merged_sets", n_clusters=2, max_gap=6,
            outliers=[15], clusters=[[1, 2, 3, 4, 5, 6, 7, 8, 9], [15]],
        )
        dup = {
            "pid": "pid-teppo",
            "placements": [6, 15],
            "raw_names": ["Teppo Harju", "Teppo Harju"],
            "name_comparison": compare_names("Teppo Harju", "Teppo Harju"),
        }
        code, evidence = generate_verdict(structure, [dup], [])
        assert code == "LIKELY_MERGED_PLACEMENT_SETS"
        assert any("main cluster" in e.lower() or "merged" in e.lower()
                   for e in evidence)

    def test_merged_sets_requires_outlier_signal(self):
        """If duplicate is in main cluster only (no outlier), not merged-sets."""
        structure = self._make_structure("contiguous")
        dup = {
            "pid": "pid-x",
            "placements": [1, 2],   # both in main cluster, no outlier
            "raw_names": ["Alice", "Alice"],
            "name_comparison": compare_names("Alice", "Alice"),
        }
        code, _ = generate_verdict(structure, [dup], [])
        assert code == "LIKELY_DUPLICATE_CONFLATED_STRING"

    def test_bad_linkage_when_different_names_same_pid_in_cluster(self):
        structure = self._make_structure("contiguous")
        dup = {
            "pid": "pid-x",
            "placements": [1, 2],
            "raw_names": ["Alice Smith", "Bob Jones"],
            "name_comparison": compare_names("Alice Smith", "Bob Jones"),
        }
        code, evidence = generate_verdict(structure, [dup], [])
        assert code == "LIKELY_BAD_PERSON_LINKAGE"

    def test_merged_sets_with_identical_names_gets_bonus(self):
        """Identical names at main+outlier should score higher than different names."""
        structure = self._make_structure(
            "possible_merged_sets", n_clusters=2, max_gap=6,
            outliers=[15], clusters=[[1, 2, 3], [15]],
        )
        dup_identical = {
            "pid": "pid-x",
            "placements": [3, 15],
            "raw_names": ["Teppo Harju", "Teppo Harju"],
            "name_comparison": compare_names("Teppo Harju", "Teppo Harju"),
        }
        code, _ = generate_verdict(structure, [dup_identical], [])
        assert code == "LIKELY_MERGED_PLACEMENT_SETS"

    def test_result_has_evidence_list(self):
        structure = self._make_structure("possible_merged_sets", n_clusters=2,
                                         max_gap=6, outliers=[15])
        code, evidence = generate_verdict(structure, [], [])
        assert isinstance(evidence, list)
        assert len(evidence) >= 1
