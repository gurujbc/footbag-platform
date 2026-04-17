#!/usr/bin/env python3
"""
01c_merge_stage1.py

PIPELINE LANE: POST-1997 PRODUCTION (mirror-only in production)
  In the post-1997 production rebuild only out/stage1_raw_events_mirror.csv
  is present. Missing source files are skipped gracefully (logged in summary).
  OLD_RESULTS / FBW / magazine sources are PRE-1997 pipeline concerns and are
  not part of the production rebuild.

Deterministic, validated merge of Stage 1 raw events from multiple sources:
- out/stage1_raw_events_mirror.csv   (from pipeline/adapters/mirror_results_adapter.py) ← production
- out/stage1_raw_events_fbw.csv      (from 01b2_merge_FBW_Data.py)                      ← pre-1997 only
- out/stage1_raw_events_magazine.csv (from 01d_ingest_magazine_data.py)                 ← pre-1997 only
- out/stage1_raw_events_curated.csv  (from pipeline/adapters/curated_events_adapter.py) ← curated 1985-1997

Policy:
- Schema Uniformity: All input headers must match exactly.
- Collision Detection: event_id must be unique across all combined sources.
- Comprehensive Summary: Logs counts and metadata for every source into a JSON.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

@dataclass
class SourceStats:
    file_name: str
    row_count: int
    year_range: Optional[tuple] = None

@dataclass
class MergeSummary:
    timestamp_utc: str
    output_path: str
    merged_rows: int
    sources: List[SourceStats]
    cross_source_collisions: int
    collision_examples: List[str]
    notes: List[str] = field(default_factory=list)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="out/stage1_raw_events.csv")
    parser.add_argument("--summary", default="out/stage1_merge_summary.json")
    parser.add_argument("--event-id-col", default="event_id")
    args = parser.parse_args()

    # List of all source files to merge
    # Adding a new source is now as simple as adding to this list
    input_paths = [
        Path("out/stage1_raw_events_mirror.csv"),
        Path("out/stage1_raw_events_curated.csv"),
        # Pre-1997 legacy sources — no longer produced by the production pipeline.
        # Retained in list so they merge automatically if regenerated.
        Path("out/stage1_raw_events_fbw.csv"),
        Path("out/stage1_raw_events_magazine.csv"),
    ]

    all_rows: List[dict] = []
    source_metrics: List[SourceStats] = []
    canonical_header: Optional[List[str]] = None
    notes = []

    # 1. Load and Validate each source
    for path in input_paths:
        if not path.exists():
            notes.append(f"Source missing, skipping: {path}")
            continue

        with open(path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            headers = reader.fieldnames
            
            # Ensure schema consistency
            if canonical_header is None:
                canonical_header = headers
            elif headers != canonical_header:
                print(f"FATAL: Schema mismatch in {path}")
                print(f"Expected: {canonical_header}")
                print(f"Found:    {headers}")
                sys.exit(1)

            rows = list(reader)
            all_rows.extend(rows)

            # Calculate stats for this source
            years = [int(r['year']) for r in rows if r.get('year') and r['year'].isdigit()]
            year_range = (min(years), max(years)) if years else None
            
            source_metrics.append(SourceStats(
                file_name=path.name,
                row_count=len(rows),
                year_range=year_range
            ))
            print(f"Loaded {len(rows):4d} rows from {path.name}")

    if not all_rows:
        print("Error: No data loaded from any source.")
        sys.exit(1)

    # 2. Collision Detection (ID must be unique across all sources)
    id_counts = Counter(r[args.event_id_col] for r in all_rows)
    collisions = [eid for eid, count in id_counts.items() if count > 1]
    
    if collisions:
        print(f"FATAL: {len(collisions)} event_id collisions detected!")
        for eid in collisions[:5]:
            layers = [r.get("source_layer", "unknown") for r in all_rows if r[args.event_id_col] == eid]
            print(f"  Collision on ID '{eid}' across layers: {layers}")
        sys.exit(1)

    # 3. Write Merged Output
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=canonical_header)
        writer.writeheader()
        writer.writerows(all_rows)

    # 4. Generate & Save Summary
    summary = MergeSummary(
        timestamp_utc=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        output_path=str(out_path),
        merged_rows=len(all_rows),
        sources=source_metrics,
        cross_source_collisions=len(collisions),
        collision_examples=collisions[:10],
        notes=notes
    )

    # Custom serializer for the dataclass
    summary_path = Path(args.summary)
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, default=lambda o: o.__dict__, indent=2)

    print(f"\nSUCCESS: Merged {len(all_rows)} rows into {args.out}")

if __name__ == "__main__":
    main()
