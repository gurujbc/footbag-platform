# legacy_data/persons/provisional/scripts/04_promote_provisional_to_historical_candidates.py

from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[4]

IN = ROOT / "legacy_data/persons/provisional/out/provisional_to_historical_matches.csv"
OUT = ROOT / "legacy_data/persons/provisional/out/provisional_promoted_links.csv"


def classify(x):
    if x == "EXACT_HISTORICAL_MATCH":
        return "MATCHED_TO_HISTORICAL"
    if x in ["WEAK_HISTORICAL_MATCH", "HISTORICAL_CONFLICT"]:
        return "REVIEW_REQUIRED"
    return "STAGED"


def main():
    df = pd.read_csv(IN).fillna("")

    df["promotion_status"] = df["match_status"].apply(classify)

    df.to_csv(OUT, index=False)

    print(df["promotion_status"].value_counts())


if __name__ == "__main__":
    main()
