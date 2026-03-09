import pandas as pd
from pathlib import Path

seed_dir = Path("legacy_data/event_results/seed/mvfp")

events = pd.read_csv(seed_dir / "seed_events.csv")
disc = pd.read_csv(seed_dir / "seed_event_disciplines.csv")
results = pd.read_csv(seed_dir / "seed_event_results.csv")
parts = pd.read_csv(seed_dir / "seed_event_result_participants.csv")

print("\nSEED EVENTS")
print(events[["event_key","status","start_date","end_date"]].to_string(index=False))

print("\nCOUNTS")
print("events:", len(events))
print("disciplines:", len(disc))
print("results:", len(results))
print("participants:", len(parts))

print("\nMULTI-DISCIPLINE EVENTS")
print(disc.groupby("event_key").size().sort_values(ascending=False).head().to_string())

print("\nMULTI-PARTICIPANT RESULT SLOTS")
x = parts.groupby(["event_key","discipline_key","placement"]).size().reset_index(name="n")
print(x[x["n"] > 1].head(20).to_string(index=False))
