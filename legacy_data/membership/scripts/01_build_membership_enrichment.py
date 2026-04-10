#!/usr/bin/env python3
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import pandas as pd

BASE_DIR = Path(__file__).resolve().parents[1]
INPUT_DIR = BASE_DIR / "inputs"
OUT_DIR = BASE_DIR / "out"

MEMBERSHIP_INPUT = INPUT_DIR / "membership_input_normalized.csv"
PERSONS_INPUT = Path(__file__).resolve().parents[3] / "legacy_data" / "event_results" / "canonical_input" / "persons.csv"

KNOWN_FIRST_NAME_VARIANTS = {
    "dave": {"david"},
    "david": {"dave"},
    "mike": {"michael"},
    "michael": {"mike"},
    "matt": {"matthew"},
    "matthew": {"matt"},
    "alex": {"alexander", "alexandre"},
    "jon": {"john", "jonathan"},
    "john": {"jon"},
    "jim": {"james"},
    "james": {"jim"},
    "bill": {"william"},
    "william": {"bill"},
    "chris": {"christopher"},
    "christopher": {"chris"},
    "steve": {"steven", "stephen"},
    "steven": {"steve"},
    "stephen": {"steve"},
    "andy": {"andrew"},
    "andrew": {"andy"},
    "seb": {"sebastian", "sebastien"},
    "sebastian": {"seb"},
    "sebastien": {"seb"},
    "ben": {"benjamin"},
    "benjamin": {"ben"},
    "charlie": {"charles"},
    "charles": {"charlie"},
    "theo": {"theodore"},
    "theodore": {"theo"},
    "nic": {"nicholas", "nick"},
    "nick": {"nicholas", "nic"},
    "doug": {"douglas"},
    "douglas": {"doug"},
    "joey": {"joseph"},
    "joseph": {"joey"},
    "kenny": {"ken", "kenneth"},
    "ken": {"kenny", "kenneth"},
    "kenneth": {"ken", "kenny"},
    "billy": {"bill", "william"},
    "bill": {"billy"},
}


def require_columns(df: pd.DataFrame, required: set[str], label: str) -> None:
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"{label} missing required columns: {sorted(missing)}")


def normalize_persons(df: pd.DataFrame) -> pd.DataFrame:
    source_col = None
    for candidate in ["person_canon", "person_name", "name"]:
        if candidate in df.columns:
            source_col = candidate
            break

    if source_col is None:
        raise ValueError(
            f"persons.csv must contain one of "
            f"['person_canon', 'person_name', 'name']; found {list(df.columns)}"
        )

    out_rows = []
    for _, row in df.iterrows():
        person_name = str(row[source_col]).strip().lower()
        person_name = " ".join(person_name.replace("-", " ").split())
        tokens = person_name.split()

        first = tokens[0] if tokens else ""
        last = tokens[-1] if tokens else ""
        first_initial = first[:1] if first else ""

        rec = row.to_dict()
        rec["person_name_raw"] = row[source_col]
        rec["person_name_norm"] = person_name
        rec["person_first_name_norm"] = first
        rec["person_surname_core"] = last
        rec["person_first_initial"] = first_initial
        out_rows.append(rec)

    return pd.DataFrame(out_rows)


def build_indexes(persons: pd.DataFrame) -> dict[str, dict[str, list[dict]]]:
    exact_name = defaultdict(list)
    surname = defaultdict(list)
    first_initial_surname = defaultdict(list)

    for _, row in persons.iterrows():
        rec = row.to_dict()

        norm_name = rec.get("person_name_norm", "")
        if norm_name:
            exact_name[norm_name].append(rec)

        surname_key = rec.get("person_surname_core", "")
        if surname_key:
            surname[surname_key].append(rec)

        initial_key = f"{rec.get('person_first_initial', '')}|{surname_key}"
        first_initial_surname[initial_key].append(rec)

    return {
        "exact_name": exact_name,
        "surname": surname,
        "first_initial_surname": first_initial_surname,
    }


def candidate_row(person: dict, rule: str, score: int) -> dict:
    return {
        "person_id": person.get("person_id", ""),
        "person_name_raw": person.get("person_name_raw", ""),
        "ifpa_member_id": person.get("ifpa_member_id", ""),
        "rule": rule,
        "score": score,
    }


def exact_pass(member: dict, idx: dict) -> list[dict]:
    return [
        candidate_row(p, "exact_full_name", 100)
        for p in idx["exact_name"].get(member["name_norm"], [])
    ]


def variant_pass(member: dict, idx: dict) -> list[dict]:
    surname = member["surname_core"]
    first = member["first_name_norm"]
    variants = KNOWN_FIRST_NAME_VARIANTS.get(first, set())

    candidates = []
    for p in idx["surname"].get(surname, []):
        pf = p.get("person_first_name_norm", "")
        if pf in variants:
            candidates.append(candidate_row(p, "known_variant", 75))
    return candidates


def same_first_same_surname_pass(member: dict, idx: dict) -> list[dict]:
    surname = member["surname_core"]
    first = member["first_name_norm"]

    candidates = []
    for p in idx["surname"].get(surname, []):
        pf = p.get("person_first_name_norm", "")
        if pf == first:
            candidates.append(candidate_row(p, "same_first_same_surname", 65))
    return candidates


def dedupe_candidates(cands: list[dict]) -> list[dict]:
    best_by_person = {}
    for c in cands:
        pid = c["person_id"] or c["person_name_raw"]
        if pid not in best_by_person or c["score"] > best_by_person[pid]["score"]:
            best_by_person[pid] = c
    return list(best_by_person.values())


def choose_best(cands: list[dict]) -> tuple[str, dict | None, int]:
    if not cands:
        return "NO_MATCH", None, 0

    cands = sorted(cands, key=lambda x: (-x["score"], x["person_name_raw"]))
    top = cands[0]
    same_top = [c for c in cands if c["score"] == top["score"]]

    if len(same_top) > 1:
        return "CONFLICT", top, len(same_top)

    if top["score"] >= 100:
        return "MATCHED_STRONG", top, 1
    if top["score"] >= 75:
        return "MATCHED_VARIANT", top, 1
    if top["score"] >= 65:
        return "MATCHED_WEAK", top, 1

    return "NO_MATCH", None, 0


def tier_rank(t: str) -> int:
    order = {
        "provisional_lifetime": 3,
        "provisional_annual_active": 2,
        "provisional_expired": 1,
        "provisional_unknown": 0,
    }
    return order.get(str(t), 0)


def build_identity_rollup(best_df: pd.DataFrame) -> pd.DataFrame:
    df = best_df.copy()
    df["tier_rank"] = df["provisional_tier"].map(tier_rank)
    df["match_score_num"] = pd.to_numeric(df["match_score"], errors="coerce").fillna(0)

    df = df.sort_values(
        by=["member_name_norm", "tier_rank", "match_score_num", "expiration"],
        ascending=[True, False, False, False],
        kind="stable"
    )

    rolled = df.groupby("member_name_norm", as_index=False).first()
    return rolled


def build_membership_linked_persons(rollup: pd.DataFrame) -> pd.DataFrame:
    linked = rollup[rollup["match_status"].isin(["MATCHED_STRONG", "MATCHED_VARIANT"])].copy()

    out = linked[[
        "matched_person_id",
        "matched_person_name",
        "member_name_raw",
        "member_name_norm",
        "status",
        "expiration",
        "provisional_tier",
        "match_status",
        "match_rule",
        "match_score",
    ]].copy()

    out.rename(columns={
        "matched_person_id": "person_id",
        "matched_person_name": "person_canon",
        "member_name_raw": "membership_name_raw",
        "member_name_norm": "membership_name_norm",
        "status": "membership_status",
        "expiration": "membership_expiration",
        "provisional_tier": "membership_tier_provisional",
    }, inplace=True)

    out["source"] = "membership_enrichment"
    return out


def build_membership_only_persons(rollup: pd.DataFrame) -> pd.DataFrame:
    new_people = rollup[rollup["match_status"] == "NO_MATCH"].copy()

    # Keep only active-style rows for downstream enrichment.
    new_people = new_people[new_people["provisional_tier"].isin([
        "provisional_lifetime",
        "provisional_annual_active",
    ])].copy()

    out = new_people[[
        "member_name_raw",
        "member_name_norm",
        "status",
        "expiration",
        "provisional_tier",
    ]].drop_duplicates().copy()

    out.rename(columns={
        "member_name_raw": "person_name",
        "member_name_norm": "person_name_norm",
        "status": "membership_status",
        "expiration": "membership_expiration",
        "provisional_tier": "membership_tier_provisional",
    }, inplace=True)

    out["source"] = "ifpa_membership"
    out["confidence"] = "high"
    out["person_type"] = "membership_only"
    return out


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    members = pd.read_csv(MEMBERSHIP_INPUT, dtype=str).fillna("")
    persons_raw = pd.read_csv(PERSONS_INPUT, dtype=str).fillna("")

    require_columns(
        members,
        {
            "source_row_id",
            "name_raw",
            "name_norm",
            "first_name_norm",
            "surname_core",
            "first_initial",
            "status",
            "expiration",
            "provisional_tier",
            "source_file",
            "source_page",
        },
        "membership_input_normalized.csv",
    )

    persons = normalize_persons(persons_raw)
    idx = build_indexes(persons)

    candidate_rows = []
    best_rows = []

    for _, member in members.iterrows():
        m = {
            "source_row_id": member["source_row_id"],
            "name_raw": member["name_raw"],
            "name_norm": member["name_norm"],
            "first_name_norm": member["first_name_norm"],
            "surname_core": member["surname_core"],
            "first_initial": member["first_initial"],
            "status": member["status"],
            "expiration": member["expiration"],
            "provisional_tier": member["provisional_tier"],
            "source_file": member["source_file"],
            "source_page": member["source_page"],
        }

        passes = [
            exact_pass(m, idx),
            variant_pass(m, idx),
            same_first_same_surname_pass(m, idx),
        ]

        all_cands: list[dict] = []
        for pass_cands in passes:
            if pass_cands:
                all_cands.extend(pass_cands)
                break

        all_cands = dedupe_candidates(all_cands)

        for c in all_cands:
            candidate_rows.append({
                "source_row_id": m["source_row_id"],
                "member_name_raw": m["name_raw"],
                "member_name_norm": m["name_norm"],
                "member_status": m["status"],
                "member_provisional_tier": m["provisional_tier"],
                **c,
            })

        match_status, best, candidate_count = choose_best(all_cands)

        best_rows.append({
            "source_row_id": m["source_row_id"],
            "source_file": m["source_file"],
            "source_page": m["source_page"],
            "member_name_raw": m["name_raw"],
            "member_name_norm": m["name_norm"],
            "status": m["status"],
            "expiration": m["expiration"],
            "provisional_tier": m["provisional_tier"],
            "match_status": match_status,
            "candidate_count": candidate_count,
            "matched_person_id": best["person_id"] if best else "",
            "matched_person_name": best["person_name_raw"] if best else "",
            "matched_ifpa_member_id": best["ifpa_member_id"] if best else "",
            "match_rule": best["rule"] if best else "",
            "match_score": best["score"] if best else "",
        })

    candidate_df = pd.DataFrame(candidate_rows)
    best_df = pd.DataFrame(best_rows)
    rollup_df = build_identity_rollup(best_df)
    linked_df = build_membership_linked_persons(rollup_df)
    membership_only_df = build_membership_only_persons(rollup_df)

    candidate_df.to_csv(OUT_DIR / "membership_person_candidates.csv", index=False)
    best_df.to_csv(OUT_DIR / "membership_best_matches.csv", index=False)
    rollup_df.to_csv(OUT_DIR / "membership_identity_rollup.csv", index=False)
    linked_df.to_csv(OUT_DIR / "membership_linked_persons.csv", index=False)
    membership_only_df.to_csv(OUT_DIR / "membership_only_persons.csv", index=False)

    summary = {
        "raw_membership_rows": int(len(best_df)),
        "unique_membership_identities": int(len(rollup_df)),
        "match_status_counts": rollup_df["match_status"].value_counts(dropna=False).to_dict(),
        "membership_only_persons": int(len(membership_only_df)),
        "linked_persons": int(len(linked_df)),
    }

    with open(OUT_DIR / "membership_summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, sort_keys=True)

    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
