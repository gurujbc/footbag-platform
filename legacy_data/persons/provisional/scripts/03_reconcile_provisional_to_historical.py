# legacy_data/persons/provisional/scripts/03_reconcile_provisional_to_historical.py

from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[4]

PROV = ROOT / "legacy_data/persons/provisional/out/provisional_identity_candidates.csv"
PERSONS = ROOT / "legacy_data/event_results/canonical_input/persons.csv"

OUT = ROOT / "legacy_data/persons/provisional/out/provisional_to_historical_matches.csv"


def split_name(name):
    parts = name.split()
    if len(parts) < 2:
        return "", ""
    return parts[0], parts[-1]


def main():
    prov = pd.read_csv(PROV).fillna("")
    hist = pd.read_csv(PERSONS).fillna("")

    # normalize
    hist["norm"] = hist.iloc[:, 1].str.lower().str.strip()
    hist["first"], hist["last"] = zip(*hist["norm"].apply(split_name))

    rows = []

    for _, r in prov.iterrows():
        name_norm = r["canonical_candidate_name_norm"]
        first, last = split_name(name_norm)

        # ---- PASS 1: exact ----
        exact = hist[hist["norm"] == name_norm]

        if len(exact) == 1:
            m = exact.iloc[0]
            status = "EXACT_HISTORICAL_MATCH"

        else:
            # ---- PASS 2: same last name ----
            last_matches = hist[hist["last"] == last]

            if len(last_matches) > 1:
                # ---- PASS 3: same first + last ----
                first_last = last_matches[last_matches["first"] == first]

                if len(first_last) == 1:
                    m = first_last.iloc[0]
                    status = "WEAK_HISTORICAL_MATCH"

                elif len(first_last) > 1:
                    m = first_last.iloc[0]
                    status = "HISTORICAL_CONFLICT"

                else:
                    m = None
                    status = "NO_HISTORICAL_MATCH"

            else:
                m = None
                status = "NO_HISTORICAL_MATCH"

        rows.append({
            "provisional_identity_id": r["provisional_identity_id"],
            "canonical_candidate_name": r["canonical_candidate_name"],
            "canonical_candidate_name_norm": name_norm,
            "match_status": status,
            "matched_historical_person_id": "" if m is None else m.iloc[0],
            "matched_historical_person_name": "" if m is None else m.iloc[1],
        })

    out = pd.DataFrame(rows)
    out.to_csv(OUT, index=False)

    print(out["match_status"].value_counts())


if __name__ == "__main__":
    main()
