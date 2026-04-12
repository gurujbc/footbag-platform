"""
tests/test_reshape_logic.py

Unit tests for the reshape_doubles_to_singles heuristic in discipline_repair.py.

Run from legacy_data/:
    .venv/bin/python -m pytest pipeline/tests/test_reshape_logic.py -v

Covers:
  - select_competitor: person_id preference, placeholder exclusion,
    ghost partner exclusion, quality score tiebreak, ambiguity detection
  - reshape_discipline: resolution threshold, duplicate person_id check,
    can_apply gate
  - Patterns mirroring the real 2004 JFK dataset
"""

import sys
from pathlib import Path

# Allow importing discipline_repair from parent directory
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from discipline_repair import (
    ANALYSIS_THRESHOLD,
    REPAIR_THRESHOLD,
    has_embedded_ordinal,
    is_duplicate_name,
    is_ghost_partner_row,
    is_placeholder,
    reshape_discipline,
    select_competitor,
)


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _p(event_key="evt", discipline_key="disc", placement=1,
       participant_order=1, display_name="", person_id="", notes=""):
    """Minimal participant row dict."""
    return {
        "event_key": event_key,
        "discipline_key": discipline_key,
        "placement": str(placement),
        "participant_order": str(participant_order),
        "display_name": display_name,
        "person_id": person_id,
        "notes": notes,
    }


def _ghost(placement=1, participant_order=2):
    """Ghost partner row as inserted by Fix 5."""
    return _p(placement=placement, participant_order=participant_order,
              display_name="__UNKNOWN_PARTNER__", notes="auto:ghost_partner")


# ---------------------------------------------------------------------------
# Classifiers
# ---------------------------------------------------------------------------

class TestClassifiers:
    def test_placeholder_names(self):
        assert is_placeholder("__UNKNOWN_PARTNER__")
        assert is_placeholder("[UNKNOWN PARTNER]")
        assert is_placeholder("")
        assert not is_placeholder("Alice Smith")

    def test_ghost_partner_row(self):
        assert is_ghost_partner_row(_ghost())
        # Must have BOTH the name AND the notes marker
        assert not is_ghost_partner_row(_p(display_name="__UNKNOWN_PARTNER__"))
        assert not is_ghost_partner_row(_p(display_name="Alice", notes="auto:ghost_partner"))

    def test_embedded_ordinal_detection(self):
        assert has_embedded_ordinal("Tuomas Kärki 1. Tuomas Kärki")
        assert has_embedded_ordinal("Jukka Peltola 2. Oskari Forsten")
        assert not has_embedded_ordinal("Alice Smith")
        assert not has_embedded_ordinal("Smith 2")         # no dot-space-upper pattern

    def test_duplicate_name_detection(self):
        assert is_duplicate_name("Tuomas Kärki 1. Tuomas Kärki")
        assert not is_duplicate_name("Jukka Peltola 2. Oskari Forsten")  # different names
        assert not is_duplicate_name("Alice Smith")


# ---------------------------------------------------------------------------
# select_competitor
# ---------------------------------------------------------------------------

class TestSelectCompetitor:

    def test_no_rows_is_unresolvable(self):
        _, _, status, _ = select_competitor([])
        assert status == "unresolvable"

    def test_ghost_partner_only_is_unresolvable(self):
        _, _, status, _ = select_competitor([_ghost()])
        assert status == "unresolvable"

    def test_both_placeholders_is_unresolvable(self):
        r1 = _p(display_name="[UNKNOWN PARTNER]")
        r2 = _p(display_name="__UNKNOWN_PARTNER__")
        _, _, status, _ = select_competitor([r1, r2])
        assert status == "unresolvable"

    def test_single_clean_row_resolves(self):
        r = _p(display_name="Alice Smith", person_id="pid-001")
        winner, discarded, status, _ = select_competitor([r])
        assert status == "resolved"
        assert winner["display_name"] == "Alice Smith"
        assert discarded is None

    def test_person_id_wins_over_no_person_id(self):
        """The participant with a person_id should always be preferred."""
        no_pid  = _p(participant_order=1, display_name="Alice 1. Alice")
        has_pid = _p(participant_order=2, display_name="Bob Smith", person_id="pid-002")
        winner, discarded, status, _ = select_competitor([no_pid, has_pid])
        assert status == "resolved"
        assert winner["display_name"] == "Bob Smith"
        assert winner["person_id"] == "pid-002"

    def test_person_id_wins_regardless_of_order(self):
        """Same preference when person_id is in participant_order=1."""
        has_pid = _p(participant_order=1, display_name="Bob Smith", person_id="pid-001")
        no_pid  = _p(participant_order=2, display_name="[UNKNOWN PARTNER]")
        winner, _, status, _ = select_competitor([has_pid, no_pid])
        assert status == "resolved"
        assert winner["display_name"] == "Bob Smith"

    def test_placeholder_discarded_other_selected(self):
        clean = _p(participant_order=1, display_name="Alice Smith", person_id="pid-001")
        ph    = _p(participant_order=2, display_name="[UNKNOWN PARTNER]")
        winner, discarded, status, _ = select_competitor([clean, ph])
        assert status == "resolved"
        assert winner["display_name"] == "Alice Smith"
        assert discarded["display_name"] == "[UNKNOWN PARTNER]"

    def test_ghost_partner_discarded_other_selected(self):
        clean = _p(participant_order=1, display_name="Alice Smith", person_id="pid-001")
        ghost = _ghost(participant_order=2)
        winner, discarded, status, _ = select_competitor([clean, ghost])
        assert status == "resolved"
        assert winner["display_name"] == "Alice Smith"

    def test_both_have_person_id_ambiguous(self):
        """Two equally plausible competitors → ambiguous."""
        r1 = _p(participant_order=1, display_name="Alice Smith", person_id="pid-001")
        r2 = _p(participant_order=2, display_name="Bob Jones",  person_id="pid-002")
        _, _, status, reason = select_competitor([r1, r2])
        assert status == "ambiguous"
        assert "equal scores" in reason

    def test_artifact_name_loses_to_clean_name_both_no_pid(self):
        """Artifact string (embedded ordinal) should score lower than clean name."""
        artifact = _p(participant_order=1, display_name="Alice 1. Alice")
        clean    = _p(participant_order=2, display_name="Bob Smith")
        winner, _, status, _ = select_competitor([artifact, clean])
        # Bob is clean (no embedded ordinal), Alice has artifact → Bob wins on score
        assert status == "resolved"
        assert winner["display_name"] == "Bob Smith"


# ---------------------------------------------------------------------------
# reshape_discipline
# ---------------------------------------------------------------------------

class TestReshapeDiscipline:

    def _jfk_style_fixture(self, n=4) -> list[dict]:
        """
        Doubles-shaped fixture mimicking the 2004 JFK pattern:
          order=1 has artifact name, no person_id
          order=2 has clean name, unique person_id
        All placements are cleanly resolvable by person_id preference.
        """
        rows = []
        for i in range(1, n + 1):
            rows.append(_p(placement=i, participant_order=1,
                           display_name=f"Artifact {i}. Other"))
            rows.append(_p(placement=i, participant_order=2,
                           display_name=f"Clean Player {i}",
                           person_id=f"pid-{i:04d}"))
        return rows

    def test_clean_fixture_resolves_fully(self):
        rows = self._jfk_style_fixture(4)
        result = reshape_discipline(rows)
        assert result["resolution_rate"] == 1.0
        assert result["passes_threshold"] is True
        assert result["passes_duplicate_check"] is True
        assert result["can_apply"] is True
        assert len(result["resolved"]) == 4

    def test_clean_fixture_winners_are_correct(self):
        rows = self._jfk_style_fixture(4)
        result = reshape_discipline(rows)
        for pl, winner, discarded, _ in result["resolved"]:
            assert winner["display_name"] == f"Clean Player {pl}"
            assert winner["person_id"] == f"pid-{pl:04d}"
            assert discarded["display_name"] == f"Artifact {pl}. Other"

    def test_threshold_failure_blocks_apply(self):
        """If some placements are ambiguous, resolution rate may drop below threshold."""
        rows = []
        # 2 placements both-pid (ambiguous) + 8 clean placements
        for i in range(1, 9):
            rows.append(_p(placement=i, participant_order=1,
                           display_name=f"Artifact {i}. Other"))
            rows.append(_p(placement=i, participant_order=2,
                           display_name=f"Clean {i}", person_id=f"pid-{i:04d}"))
        # placement 9 and 10: both have person_ids → ambiguous
        rows.append(_p(placement=9, participant_order=1,
                       display_name="Alice", person_id="pid-9a"))
        rows.append(_p(placement=9, participant_order=2,
                       display_name="Bob",   person_id="pid-9b"))
        rows.append(_p(placement=10, participant_order=1,
                       display_name="Carol", person_id="pid-10a"))
        rows.append(_p(placement=10, participant_order=2,
                       display_name="Dave",  person_id="pid-10b"))

        result = reshape_discipline(rows, threshold=1.0)
        # 8 resolved, 2 ambiguous → 80% < 100% threshold
        assert result["resolution_rate"] == pytest.approx(8 / 10)
        assert result["passes_threshold"] is False
        assert result["can_apply"] is False
        assert len(result["ambiguous"]) == 2

    def test_duplicate_person_id_blocks_apply(self):
        """Same person_id in two winning placements → blocks repair."""
        rows = [
            _p(placement=1, participant_order=1, display_name="Artifact 1. X"),
            _p(placement=1, participant_order=2, display_name="Teppo Harju",
               person_id="pid-teppo"),
            _p(placement=2, participant_order=1, display_name="Artifact 2. Y"),
            _p(placement=2, participant_order=2, display_name="Teppo Harju",
               person_id="pid-teppo"),  # same person at P2!
        ]
        result = reshape_discipline(rows, threshold=1.0)
        assert result["resolution_rate"] == 1.0  # structurally resolves
        assert result["passes_threshold"] is True
        assert result["passes_duplicate_check"] is False
        assert result["can_apply"] is False
        assert len(result["duplicate_person_placements"]) == 1
        assert result["duplicate_person_placements"][0][0] == "pid-teppo"
        assert sorted(result["duplicate_person_placements"][0][1]) == [1, 2]

    def test_ghost_partner_as_discard_resolves(self):
        """Ghost partner slot is correctly treated as discard, not winner."""
        rows = [
            _p(placement=1, participant_order=1,
               display_name="Alice Smith", person_id="pid-alice"),
            _ghost(placement=1, participant_order=2),
        ]
        result = reshape_discipline(rows, threshold=1.0)
        assert result["can_apply"] is True
        pl, winner, discarded, _ = result["resolved"][0]
        assert winner["display_name"] == "Alice Smith"

    def test_all_placeholder_placement_is_unresolvable(self):
        """A placement where both slots are placeholders → unresolvable."""
        rows = [
            _p(placement=1, participant_order=1, display_name="[UNKNOWN PARTNER]"),
            _p(placement=1, participant_order=2, display_name="__UNKNOWN_PARTNER__"),
        ]
        result = reshape_discipline(rows, threshold=1.0)
        assert len(result["unresolvable"]) == 1
        assert result["resolution_rate"] == 0.0
        assert result["can_apply"] is False

    def test_2004_jfk_pattern(self):
        """
        Reproduce the actual 2004 JFK dataset structural pattern:
          - 10 placements (1-9 and 15)
          - order=2 has person_id for placements 1-9
          - order=1 has person_id for placement 15
          - Teppo Harju (pid-teppo) appears at BOTH placement 6 and 15
          Expected: structurally 10/10 resolved but duplicate check fails → can_apply=False
        """
        rows = []
        pid_map = {
            1: ("Olli Savoilainen",   "pid-olli"),
            2: ("Matti Pohjola",      "pid-matti"),
            3: ("Jukka Peltola",      "pid-jukka"),
            4: ("Janne Uusitalo",     "pid-janne"),
            5: ("Otso Konttinen",     "pid-otso"),
            6: ("Teppo Harju",        "pid-teppo"),   # ← appears again at 15
            7: ("Jaakko Lindstrom",   "pid-jaakko"),
            8: ("Janne Pesonen",      "pid-jannep"),
            9: ("Sakarias Liukko",    "pid-sakarias"),
        }
        artifact_map = {
            1: "Tuomas Kärki 1. Tuomas Kärki",
            2: "Jukka Peltola 2. Oskari Forsten",
            3: "Oskari Forsten 3. Jani Markkanen",
            4: "Jaakko Inkinen 4. Juha-Matti Rytilahti",
            5: "Jani Markkanen 5. Jyri Ilama",
            6: "Olli Savolainen 6. Jani Lirkki",
            7: "Aleksi Öhman 7. Jarno Terho",
            8: "Jani Lirkki 8. Tuukka Antikainen",
            9: "Tuukka Antikainen 9. Iisak Liukko",
        }
        for pl in range(1, 10):
            rows.append(_p(placement=pl, participant_order=1,
                           display_name=artifact_map[pl]))
            name, pid = pid_map[pl]
            rows.append(_p(placement=pl, participant_order=2,
                           display_name=name, person_id=pid))
        # Placement 15: order=1 has person_id (Teppo again), order=2 is unknown
        rows.append(_p(placement=15, participant_order=1,
                       display_name="Teppo Harju", person_id="pid-teppo"))
        rows.append(_p(placement=15, participant_order=2,
                       display_name="[UNKNOWN PARTNER]"))

        result = reshape_discipline(rows, threshold=1.0)

        # All 10 placements should select a winner (structurally resolvable)
        assert len(result["resolved"]) == 10
        assert result["resolution_rate"] == 1.0
        assert result["passes_threshold"] is True

        # But Teppo Harju appears at placements 6 and 15 → duplicate blocks repair
        assert result["passes_duplicate_check"] is False
        assert result["can_apply"] is False

        dup_pids = {pid: pls for pid, pls in result["duplicate_person_placements"]}
        assert "pid-teppo" in dup_pids
        assert sorted(dup_pids["pid-teppo"]) == [6, 15]

    def test_inactive_fix_not_in_scope_of_reshape(self):
        """
        inactive=False rows should never reach reshape_discipline.
        This test documents that the caller (Fix 0) is responsible for
        filtering inactive rows before calling reshape_discipline, and that
        reshape_discipline itself has no concept of 'active'.
        (The actual inactive-skip is tested via 05p5 integration.)
        """
        rows = self._jfk_style_fixture(2)
        # reshape_discipline does not know about 'active'; it processes all rows given.
        # Passing an empty list simulates what Fix 0 does for inactive rows.
        result = reshape_discipline([])
        assert result["total_placements"] == 0
        assert result["resolution_rate"] == 0.0
        # 0/0 does not meet a 1.0 threshold (no placements to confirm)
        assert result["can_apply"] is False

    def test_analysis_threshold_is_looser_than_repair(self):
        """ANALYSIS_THRESHOLD < REPAIR_THRESHOLD — documents the design intent."""
        assert ANALYSIS_THRESHOLD < REPAIR_THRESHOLD
        assert REPAIR_THRESHOLD == 1.0

    def test_reshape_result_structure(self):
        """All expected keys are present in the result dict."""
        result = reshape_discipline(self._jfk_style_fixture(2))
        for key in ["resolved", "ambiguous", "unresolvable",
                    "duplicate_person_placements",
                    "resolution_rate", "passes_threshold",
                    "passes_duplicate_check", "can_apply",
                    "total_placements"]:
            assert key in result, f"Missing key: {key}"
