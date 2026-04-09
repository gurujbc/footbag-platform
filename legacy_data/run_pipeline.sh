#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

for candidate in "${VENV_DIR:-}" .venv footbag_venv venv; do
  if [ -n "$candidate" ] && [ -f "$candidate/bin/activate" ]; then
    . "$candidate/bin/activate"
    break
  fi
done

case "$1" in
  rebuild)
    python pipeline/adapters/mirror_results_adapter.py --mirror mirror_footbag_org
    python pipeline/adapters/curated_events_adapter.py
    python pipeline/01c_merge_stage1.py
    python pipeline/02_canonicalize_results.py
    python pipeline/02p5_player_token_cleanup.py \
      --identity_lock_persons_csv inputs/identity_lock/Persons_Truth_Final_v52.csv \
      --identity_lock_placements_csv inputs/identity_lock/Placements_ByPerson_v97.csv
    python pipeline/02p6_structural_cleanup.py
    ;;
  release)
    python pipeline/historical/export_historical_csvs.py
    python pipeline/05p5_remediate_canonical.py
    python pipeline/platform/export_canonical_platform.py
    ;;
  qc)
    python pipeline/qc/run_qc.py
    ;;
  complete)
    # ── Full soup-to-nuts pipeline ────────────────────────────────────────────
    # Run from: legacy_data/   (i.e.  cd ~/projects/footbag-platform/legacy_data && ./run_pipeline.sh complete)
    # Stages:
    #   1. rebuild      mirror + curated → stage2 canonical events
    #   2. release      export canonical CSVs + platform export
    #   3. supplement   02p5b class-B injection into Placements_Flat (workbook completeness)
    #   4. qc           hard failure → exit 1 (pipeline stops here on any hard failure)
    #   5. workbook     build_workbook_release.py → out/Footbag_Results_Release.xlsx
    #   6. seed         07_build_mvfp_seed_full.py → event_results/seed/mvfp_full/
    #   7. db           08_load_mvfp_seed_full_to_sqlite.py → database/footbag.db

    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  FOOTBAG COMPLETE PIPELINE                           ║"
    echo "╚══════════════════════════════════════════════════════╝"
    echo ""

    echo "── [1/7] REBUILD ──────────────────────────────────────"
    python pipeline/adapters/mirror_results_adapter.py --mirror mirror_footbag_org
    python pipeline/adapters/curated_events_adapter.py
    python pipeline/01c_merge_stage1.py
    python pipeline/02_canonicalize_results.py
    python pipeline/02p5_player_token_cleanup.py \
      --identity_lock_persons_csv inputs/identity_lock/Persons_Truth_Final_v52.csv \
      --identity_lock_placements_csv inputs/identity_lock/Placements_ByPerson_v97.csv
    python pipeline/02p6_structural_cleanup.py
    echo ""

    echo "── [2/7] RELEASE ──────────────────────────────────────"
    python pipeline/historical/export_historical_csvs.py
    python pipeline/05p5_remediate_canonical.py
    python pipeline/platform/export_canonical_platform.py
    echo ""

    echo "── [3/7] SUPPLEMENT CLASS B (Placements_Flat) ─────────"
    python pipeline/02p5b_supplement_class_b.py
    echo ""

    echo "── [4/7] QC GATE ──────────────────────────────────────"
    python pipeline/qc/run_qc.py
    echo ""

    echo "── [5/7] WORKBOOK ─────────────────────────────────────"
    python pipeline/build_workbook_release.py
    echo ""

    echo "── [6/7] SEED BUILD ───────────────────────────────────"
    python event_results/scripts/07_build_mvfp_seed_full.py
    echo ""

    echo "── [7/7] DB LOAD ──────────────────────────────────────"
    python event_results/scripts/08_load_mvfp_seed_full_to_sqlite.py \
      --db "${REPO_ROOT}/database/footbag.db" \
      --seed-dir "event_results/seed/mvfp_full"
    echo ""

    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  COMPLETE PIPELINE DONE                              ║"
    echo "╚══════════════════════════════════════════════════════╝"
    ;;
  *)
    echo "usage: $0 {rebuild|release|qc|complete}"
    echo ""
    echo "  rebuild   parse mirror + curated → stage2 canonical events"
    echo "  release   export canonical CSVs + platform export"
    echo "  qc        validate out/canonical/ (must PASS before commit)"
    echo "  complete  full soup-to-nuts: rebuild → release → qc → workbook → seed → db"
    ;;
esac
