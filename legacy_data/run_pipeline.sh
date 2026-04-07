#!/usr/bin/env bash
set -e

. .venv/bin/activate

case "$1" in
  rebuild)
    python pipeline/adapters/mirror_results_adapter.py --mirror mirror_footbag_org
    python pipeline/adapters/curated_events_adapter.py
    python pipeline/01c_merge_stage1.py
    python pipeline/02_canonicalize_results.py
###
    python pipeline/02p5_player_token_cleanup.py \
      --identity_lock_persons_csv inputs/identity_lock/Persons_Truth_Final_v51.csv \
      --identity_lock_placements_csv inputs/identity_lock/Placements_ByPerson_v96.csv
    python pipeline/02p6_structural_cleanup.py
    python pipeline/03_build_excel.py
    python pipeline/04_build_analytics.py
    ;;
  release)
    python pipeline/historical/export_historical_csvs.py
    python pipeline/05p5_remediate_canonical.py
    ;;
  qc)
    python pipeline/qc/run_qc.py
    ;;
  *)
    echo "usage: $0 {rebuild|release|qc}"
    ;;
esac
