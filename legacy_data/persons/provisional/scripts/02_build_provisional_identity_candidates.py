# legacy_data/persons/provisional/scripts/02_build_provisional_identity_candidates.py

from pathlib import Path
import pandas as pd
import hashlib

ROOT = Path(__file__).resolve().parents[4]
IN = ROOT / "legacy_data/persons/provisional/out/provisional_persons_master.csv"
OUT = ROOT / "legacy_data/persons/provisional/out/provisional_identity_candidates.csv"


def make_id(key):
    # mirror_member_id may be numeric from CSV; normalize to str for hashing.
    if pd.isna(key) or key == "":
        key_str = ""
    else:
        key_str = str(key)
    return "prov_identity::" + hashlib.sha1(key_str.encode("utf-8")).hexdigest()[:12]


def main():
    df = pd.read_csv(IN).fillna("")

    df["key"] = df.apply(
        lambda r: r["mirror_member_id"] if r["mirror_member_id"] else r["person_name_norm"],
        axis=1,
    )

    df["provisional_identity_id"] = df["key"].apply(make_id)

    grouped = df.groupby("provisional_identity_id")

    rows = []
    for pid, g in grouped:
        rows.append({
            "provisional_identity_id": pid,
            "canonical_candidate_name": g.iloc[0]["person_name"],
            "canonical_candidate_name_norm": g.iloc[0]["person_name_norm"],
            "source_types": "|".join(sorted(set(g["source_type"]))),
            "staged_row_count": len(g),
            "membership_row_count": (g["source_type"] == "MEMBERSHIP").sum(),
            "club_row_count": (g["source_type"] == "CLUB").sum(),
            "mirror_member_id_count": (g["mirror_member_id"] != "").sum(),
            "confidence": "medium",
            "promotion_status": "STAGED",
        })

    pd.DataFrame(rows).to_csv(OUT, index=False)
    print(f"Wrote {len(rows)} identities")


if __name__ == "__main__":
    main()
