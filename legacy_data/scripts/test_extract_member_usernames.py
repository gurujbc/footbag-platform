#!/usr/bin/env python3
"""Structural tests for extract_member_usernames aggregation logic.

Synthetic in-memory rows only. No mirror or seed-CSV dependency.
Run directly: `python3 legacy_data/scripts/test_extract_member_usernames.py`.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from extract_member_usernames import aggregate_pairs, detect_alias_duplicates


def _row(mid: str, alias: str, club: str = "C1") -> dict:
    return {"legacy_club_key": club, "mirror_member_id": mid, "alias": alias}


def test_basic_pair():
    rows = [_row("100", "alpha")]
    assert aggregate_pairs(rows) == {"100": "alpha"}


def test_duplicate_pair_in_two_clubs_is_dedup():
    rows = [_row("100", "alpha", "C1"), _row("100", "alpha", "C2")]
    assert aggregate_pairs(rows) == {"100": "alpha"}


def test_blank_alias_ignored():
    rows = [_row("100", ""), _row("101", "bravo")]
    assert aggregate_pairs(rows) == {"101": "bravo"}


def test_blank_member_id_ignored():
    rows = [_row("", "ghost"), _row("101", "bravo")]
    assert aggregate_pairs(rows) == {"101": "bravo"}


def test_whitespace_stripped():
    rows = [{"mirror_member_id": "  100  ", "alias": "  alpha  "}]
    assert aggregate_pairs(rows) == {"100": "alpha"}


def test_member_id_with_two_aliases_raises():
    rows = [_row("100", "alpha"), _row("100", "beta")]
    raised = False
    try:
        aggregate_pairs(rows)
    except ValueError as e:
        raised = True
        assert "100" in str(e)
        assert "alpha" in str(e) or "beta" in str(e)
    assert raised, "expected ValueError for conflicting aliases on one member_id"


def test_alias_collision_detected_post_aggregation():
    mapping = {"100": "shared", "200": "shared", "300": "unique"}
    dups = detect_alias_duplicates(mapping)
    assert dups == {"shared": ["100", "200"]} or dups == {"shared": ["200", "100"]}


def test_no_alias_collisions_returns_empty():
    mapping = {"100": "a", "200": "b", "300": "c"}
    assert detect_alias_duplicates(mapping) == {}


def test_empty_input_yields_empty_map():
    assert aggregate_pairs([]) == {}
    assert detect_alias_duplicates({}) == {}


def main() -> int:
    failed = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {name}: {e}")
            continue
        print(f"  OK   {name}")
    if failed:
        print(f"{failed} test(s) failed", file=sys.stderr)
        return 1
    print("All structural tests passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
