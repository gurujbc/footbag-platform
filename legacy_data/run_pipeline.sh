#!/usr/bin/env bash
# =============================================================================
# run_pipeline.sh v2
#
# The run_v0_backbone() function below is preserved VERBATIM from
# run_pipeline.sh_V0 `complete` mode. Script paths, arguments, and execution
# order are identical to V0. Phases C–F are appended after the backbone's
# canonical QC gate and DB load complete.
#
# Modes:
#   full            — V0 backbone → preflight → phases C–F
#   canonical_only  — V0 backbone only
#   enrichment_only — preflight → phases C–F (requires canonical outputs)
#
# Run from: legacy_data/
# Assumes:  venv already active
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$SCRIPT_DIR"

for candidate in "${VENV_DIR:-}" .venv footbag_venv venv; do
  if [ -n "$candidate" ] && [ -f "$candidate/bin/activate" ]; then
    . "$candidate/bin/activate"
    break
  fi
done

MODE="${1:-full}"

# =============================================================================
# PREFLIGHT
# =============================================================================
run_preflight() {
    echo ""
    echo "── Preflight checks ───────────────────────────────────────────────────"

    local missing=()

    [[ -f "event_results/canonical_input/persons.csv"          ]] || missing+=("event_results/canonical_input/persons.csv")
    [[ -f "membership/inputs/membership_input_normalized.csv"  ]] || missing+=("membership/inputs/membership_input_normalized.csv")
    [[ -f "seed/clubs.csv"                                     ]] || missing+=("seed/clubs.csv")
    [[ -f "seed/club_members.csv"                              ]] || missing+=("seed/club_members.csv")

    if [[ ${#missing[@]} -gt 0 ]]; then
        echo "  ERROR: preflight failed — missing required files:" >&2
        for f in "${missing[@]}"; do
            echo "    MISSING: $f" >&2
        done
        echo "" >&2
        echo "  Run canonical_only first (and mirror extraction for clubs)." >&2
        exit 1
    fi

    echo "  Preflight passed"
    echo "───────────────────────────────────────────────────────────────────────"
    echo ""
}

# =============================================================================
# V0 BACKBONE — verbatim from run_pipeline.sh_V0 `complete` mode
# Do NOT change script paths, arguments, or order.
# =============================================================================
run_v0_backbone() {
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
    echo "║  V0 BACKBONE DONE                                    ║"
    echo "╚══════════════════════════════════════════════════════╝"
}

# =============================================================================
# PHASE C — Membership enrichment
# Reads:    membership/inputs/membership_input_normalized.csv
#           event_results/canonical_input/persons.csv
# Produces: membership/out/
# =============================================================================
run_phase_c() {
    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  PHASE C: MEMBERSHIP ENRICHMENT                      ║"
    echo "╚══════════════════════════════════════════════════════╝"
    python membership/scripts/01_build_membership_enrichment.py
    echo ""
}

# =============================================================================
# PHASE D — Clubs inference pipeline
# Reads:    seed/clubs.csv, seed/club_members.csv
#           membership/out/, event_results/canonical_input/persons.csv
# Produces: clubs/out/
# =============================================================================
run_phase_d() {
    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  PHASE D: CLUBS PIPELINE                             ║"
    echo "╚══════════════════════════════════════════════════════╝"
    python clubs/scripts/01_build_club_person_universe.py
    python clubs/scripts/02_build_legacy_club_candidates.py
    python clubs/scripts/03_build_legacy_person_club_affiliations.py
    python clubs/scripts/04_build_club_bootstrap_leaders.py
    python clubs/scripts/05_build_club_only_persons.py
    echo ""
}

# =============================================================================
# PHASE E — Provisional persons
# Reads:    membership/out/membership_only_persons.csv
#           clubs/out/club_only_persons.csv
# Produces: persons/provisional/out/
# =============================================================================
run_phase_e() {
    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  PHASE E: PROVISIONAL PERSONS                        ║"
    echo "╚══════════════════════════════════════════════════════╝"
    python persons/provisional/scripts/01_build_provisional_persons_master.py
    python persons/provisional/scripts/02_build_provisional_identity_candidates.py
    python persons/provisional/scripts/03_reconcile_provisional_to_historical.py
    python persons/provisional/scripts/04_promote_provisional_to_historical_candidates.py
    echo ""
}

# =============================================================================
# PHASE F — Persons master
# Reads:    event_results/canonical_input/persons.csv
#           persons/provisional/out/
# Produces: persons/out/persons_master.csv
# =============================================================================
run_phase_f() {
    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  PHASE F: PERSONS MASTER                             ║"
    echo "╚══════════════════════════════════════════════════════╝"
    python persons/scripts/05_build_persons_master.py
    echo ""
}

# =============================================================================
# Main
# =============================================================================
case "$MODE" in
    full)
        run_v0_backbone
        run_preflight
        run_phase_c
        run_phase_d
        run_phase_e
        run_phase_f
        echo ""
        echo "╔══════════════════════════════════════════════════════╗"
        echo "║  FULL PIPELINE DONE                                  ║"
        echo "╚══════════════════════════════════════════════════════╝"
        ;;

    canonical_only)
        run_v0_backbone
        ;;

    enrichment_only)
        run_preflight
        run_phase_c
        run_phase_d
        run_phase_e
        run_phase_f
        echo ""
        echo "╔══════════════════════════════════════════════════════╗"
        echo "║  ENRICHMENT PIPELINE DONE                            ║"
        echo "╚══════════════════════════════════════════════════════╝"
        ;;

    *)
        echo "Usage: $0 {full|canonical_only|enrichment_only}" >&2
        exit 1
        ;;
esac
