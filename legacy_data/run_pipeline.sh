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
#   full            — V0 backbone → preflight → phases C–F → G (soup to nuts)
#   canonical_only  — V0 backbone only (mirror access required)
#   enrichment_only — preflight → phases C–F → G (requires canonical outputs)
#   csv_only        — DB load from existing CSVs → phases C–F → G
#                     (no mirror access required; seed and canonical_input must exist)
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
run_alias_registry_preflight() {
    echo ""
    echo "── Alias registry preflight ───────────────────────────────────────────"
    if ! python "${SCRIPT_DIR}/pipeline/qc/check_alias_registry.py" --mode preflight; then
        echo "  ERROR: alias registry preflight failed — see out/qc_alias_registry.csv" >&2
        exit 1
    fi
}

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
# PREFLIGHT (csv_only)
#
# Verifies all CSV artifacts that csv_only mode requires are already present.
# These are produced by a prior canonical_only run (and mirror extraction for
# clubs seed).  csv_only does NOT re-run QC or the workbook — it loads existing
# seed files into the DB then runs enrichment phases C–F and G.
#
# Required files:
#   event_results/canonical_input/   — 5 platform-export CSVs
#   event_results/seed/mvfp_full/    — 5 seed CSVs (built by script 07)
#   membership/inputs/               — membership normalized CSV
#   seed/                            — clubs + club_members CSVs
# =============================================================================
run_preflight_csv_only() {
    echo ""
    echo "── csv_only preflight ─────────────────────────────────────────────────"

    local missing=()

    # Canonical platform export (produced by export_canonical_platform.py)
    for f in events event_disciplines event_results event_result_participants persons; do
        [[ -f "event_results/canonical_input/${f}.csv" ]] \
            || missing+=("event_results/canonical_input/${f}.csv")
    done

    # Seed CSVs (produced by script 07)
    for f in seed_events seed_event_disciplines seed_event_results seed_event_result_participants seed_persons; do
        [[ -f "event_results/seed/mvfp_full/${f}.csv" ]] \
            || missing+=("event_results/seed/mvfp_full/${f}.csv")
    done

    # Membership input
    [[ -f "membership/inputs/membership_input_normalized.csv" ]] \
        || missing+=("membership/inputs/membership_input_normalized.csv")

    # Club seed inputs
    [[ -f "seed/clubs.csv"        ]] || missing+=("seed/clubs.csv")
    [[ -f "seed/club_members.csv" ]] || missing+=("seed/club_members.csv")

    if [[ ${#missing[@]} -gt 0 ]]; then
        echo "  ERROR: csv_only preflight failed — missing required files:" >&2
        for f in "${missing[@]}"; do
            echo "    MISSING: $f" >&2
        done
        echo "" >&2
        echo "  These files are produced by a full canonical_only run." >&2
        echo "  If you have mirror access, run:  ./run_pipeline.sh canonical_only" >&2
        echo "  Otherwise, obtain these CSVs from a collaborator." >&2
        exit 1
    fi

    echo "  csv_only preflight passed"
    echo "───────────────────────────────────────────────────────────────────────"
    echo ""
}

# =============================================================================
# PHASE B — Mirror extraction (clubs + club_members seed CSVs)
#
# Produces:
#   seed/clubs.csv         (consumed by load_clubs_seed.py + Phase D)
#   seed/club_members.csv  (consumed by load_club_members_seed.py + Phase D)
#
# Both extract scripts are idempotent: they skip when the output CSV is
# newer than the source mirror HTML. Safe to re-run on every pipeline
# invocation.
# =============================================================================
run_phase_b_mirror_extract() {
    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  PHASE B: MIRROR EXTRACTION                          ║"
    echo "╚══════════════════════════════════════════════════════╝"
    python scripts/extract_clubs.py
    python scripts/extract_club_members.py
    echo ""
}

# =============================================================================
# PHASE I — Clubs + club_members DB load (initial mirror-derived seed)
#
# Loads seed/clubs.csv and seed/club_members.csv into the platform DB.
# Idempotent (INSERT OR IGNORE patterns; collision-safe slug allocation).
#
# Writes:
#   clubs                            (new rows)
#   tags                             (one per club, is_standard=1)
#   legacy_club_candidates           (mirror-derived initial; later refreshed
#                                     by Phase G's DELETE+INSERT)
#   legacy_person_club_affiliations  (mirror-derived initial; later refreshed
#                                     by Phase G's DELETE+INSERT)
#
# Must run AFTER the V0 backbone (which loads canonical historical_persons
# that load_club_members_seed needs for name-match attempts) and BEFORE
# Phase H (which FKs club_bootstrap_leaders → clubs.id).
# =============================================================================
run_phase_clubs_seed_load() {
    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  PHASE I: CLUBS + CLUB_MEMBERS DB LOAD               ║"
    echo "╚══════════════════════════════════════════════════════╝"
    python scripts/load_clubs_seed.py --db "${REPO_ROOT}/database/footbag.db"
    python scripts/load_club_members_seed.py --db "${REPO_ROOT}/database/footbag.db"
    echo ""
}

# =============================================================================
# DB LOAD (canonical seed only — step 7 of V0 backbone, extracted for reuse)
# =============================================================================
run_db_load_canonical() {
    echo ""
    echo "── DB load: canonical seed ────────────────────────────────────────────"
    python event_results/scripts/08_load_mvfp_seed_full_to_sqlite.py \
        --db "${REPO_ROOT}/database/footbag.db" \
        --seed-dir "event_results/seed/mvfp_full"
    python event_results/scripts/10_load_freestyle_records_to_sqlite.py \
        --db "${REPO_ROOT}/database/footbag.db" \
        --records-csv inputs/curated/records/records_master.csv
    python event_results/scripts/11_load_consecutive_records_to_sqlite.py \
        --db "${REPO_ROOT}/database/footbag.db"
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
    local _id_persons="inputs/identity_lock/Persons_Truth_Final_v53.csv"
    local _id_placements="inputs/identity_lock/Placements_ByPerson_v97.csv"
    local _id_missing=()
    [[ -f "${_id_persons}"    ]] || _id_missing+=("${_id_persons}")
    [[ -f "${_id_placements}" ]] || _id_missing+=("${_id_placements}")
    if [[ ${#_id_missing[@]} -gt 0 ]]; then
        echo "ERROR: identity-lock CSV(s) not found:" >&2
        for _f in "${_id_missing[@]}"; do echo "  MISSING: ${_f}" >&2; done
        echo "Recommendation: see legacy_data/IMPLEMENTATION_PLAN.md (top of 'Still to do')." >&2
        exit 1
    fi
    python pipeline/adapters/mirror_results_adapter.py --mirror mirror_footbag_org
    python pipeline/adapters/curated_events_adapter.py
    python pipeline/01c_merge_stage1.py
    python pipeline/02_canonicalize_results.py
    python pipeline/02p5_player_token_cleanup.py \
        --identity_lock_persons_csv "${_id_persons}" \
        --identity_lock_placements_csv "${_id_placements}"
    python pipeline/02p6_structural_cleanup.py
    echo ""

    echo "── [2/7] RELEASE ──────────────────────────────────────"
    python pipeline/historical/export_historical_csvs.py
    python pipeline/05p5_remediate_canonical.py
    python pipeline/platform/export_canonical_platform.py
    echo ""

    # Regenerate inputs/name_variants.csv from canonical + identity-lock
    # sources. Deterministic + idempotent. Must run before the QC gate
    # so pipeline/qc/check_name_variants.py sees the fresh CSV.
    echo "── [2b] NAME VARIANTS (build) ─────────────────────────"
    python pipeline/identity/build_name_variants.py
    echo ""

    echo "── [3/7] SUPPLEMENT CLASS B (Placements_Flat) ─────────"
    python pipeline/02p5b_supplement_class_b.py
    echo ""

    echo "── [4/7] QC GATE ──────────────────────────────────────"
    python pipeline/qc/run_qc.py
    echo ""

    echo "── [4b] QC VIEWER ─────────────────────────────────────"
    python pipeline/event_comparison_viewerV13.py
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
    python event_results/scripts/10_load_freestyle_records_to_sqlite.py \
        --db "${REPO_ROOT}/database/footbag.db" \
        --records-csv inputs/curated/records/records_master.csv
    python event_results/scripts/11_load_consecutive_records_to_sqlite.py \
        --db "${REPO_ROOT}/database/footbag.db"
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
# PHASE G — Enrichment DB load
# Reads:    persons/out/persons_master.csv
#           clubs/out/legacy_club_candidates.csv
#           clubs/out/legacy_person_club_affiliations.csv
# Produces: historical_persons (PROVISIONAL), legacy_club_candidates,
#           legacy_person_club_affiliations rows in footbag.db
# Note:     club_bootstrap_leaders deferred — requires live clubs.id FK
# =============================================================================
run_phase_g() {
    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  PHASE G: ENRICHMENT DB LOAD                         ║"
    echo "╚══════════════════════════════════════════════════════╝"
    python event_results/scripts/09_load_enrichment_to_sqlite.py \
        --db "${REPO_ROOT}/database/footbag.db" \
        --persons-csv      persons/out/persons_master.csv \
        --candidates-csv   clubs/out/legacy_club_candidates.csv \
        --affiliations-csv clubs/out/legacy_person_club_affiliations.csv
    echo ""
}

# =============================================================================
# PHASE H — Club cutover + bootstrap leaders (IP items 3a + 3b)
# Step 1: 06_cutover_pre_populated_clubs.py — sets mapped_club_id on the
#         59 bootstrap-eligible candidates and ensures matching live clubs
#         rows exist (idempotent INSERT OR IGNORE fallback).
# Step 2: 07_load_bootstrap_leaders.py — loads club_bootstrap_leaders from
#         the CSV. Depends on Step 1 (FK club_id → clubs.id via mapped_club_id).
# Reads:  legacy_club_candidates, seed/clubs.csv, clubs/out/club_bootstrap_leaders.csv
# Writes: clubs (idempotent), legacy_club_candidates.mapped_club_id,
#         club_bootstrap_leaders (DELETE + INSERT).
# =============================================================================
run_phase_h() {
    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  PHASE H: CLUB CUTOVER + BOOTSTRAP LEADERS           ║"
    echo "╚══════════════════════════════════════════════════════╝"
    python clubs/scripts/06_cutover_pre_populated_clubs.py \
        --db "${REPO_ROOT}/database/footbag.db"
    python clubs/scripts/07_load_bootstrap_leaders.py \
        --db "${REPO_ROOT}/database/footbag.db"
    echo ""
}

# =============================================================================
# PHASE V — Name variants DB load (HIGH-confidence only)
# Reads:    inputs/name_variants.csv (generated by build step 2b)
# Produces: name_variants rows in footbag.db (source='mirror_mined')
# Note:     Loader enforces HIGH-only; MEDIUM rows go to a deferred
#           artifact for review and are not inserted.
# =============================================================================
run_phase_v() {
    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  PHASE V: NAME VARIANTS DB LOAD                      ║"
    echo "╚══════════════════════════════════════════════════════╝"
    python scripts/load_name_variants_seed.py \
        --db "${REPO_ROOT}/database/footbag.db" \
        --apply
    echo ""
}

# =============================================================================
# PHASE NET — Net enrichment layer
#
# Reads (read-only against canonical tables — never modifies them):
#   event_disciplines, event_result_entries, event_result_entry_participants,
#   events, historical_persons
#
# Writes (additive enrichment tables only):
#   net_discipline_group   — discipline name → canonical group mapping
#   net_team               — stable doubles team entities
#   net_team_member        — per-team member rows
#   net_team_appearance    — per-team × event_discipline placement cache
#   net_stat_policy        — evidence class policy registry
#   net_review_queue       — QC items and quarantine events
#
# Scripts run in order: 12 → 13 → 14
# Script 15 is NOT included (net_relative_performance deferred from phase 1).
#
# Requires: canonical DB already loaded (run canonical_only or csv_only first).
# =============================================================================
run_phase_net() {
    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  PHASE NET: NET ENRICHMENT LAYER                     ║"
    echo "╚══════════════════════════════════════════════════════╝"

    python event_results/scripts/12_build_net_discipline_groups.py \
        --db "${REPO_ROOT}/database/footbag.db"

    python event_results/scripts/13_build_net_teams.py \
        --db "${REPO_ROOT}/database/footbag.db"

    python event_results/scripts/14_import_net_review_queue.py \
        --db "${REPO_ROOT}/database/footbag.db"

    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  PHASE NET DONE                                      ║"
    echo "╚══════════════════════════════════════════════════════╝"
    echo ""
}

# =============================================================================
# Main
# =============================================================================
run_alias_registry_preflight

case "$MODE" in
    full)
        run_phase_b_mirror_extract
        run_v0_backbone
        run_phase_clubs_seed_load
        run_phase_net
        run_preflight
        run_phase_c
        run_phase_d
        run_phase_e
        run_phase_f
        run_phase_g
        run_phase_h
        run_phase_v
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
        run_phase_clubs_seed_load
        run_phase_c
        run_phase_d
        run_phase_e
        run_phase_f
        run_phase_g
        run_phase_h
        run_phase_v
        echo ""
        echo "╔══════════════════════════════════════════════════════╗"
        echo "║  ENRICHMENT PIPELINE DONE                            ║"
        echo "╚══════════════════════════════════════════════════════╝"
        ;;

    csv_only)
        # No mirror access required.  Loads existing seed → DB, then runs all
        # enrichment phases (C–F), enrichment DB load (G), club cutover (H),
        # and name_variants DB load (V).
        run_preflight_csv_only
        run_db_load_canonical
        run_phase_clubs_seed_load
        run_phase_c
        run_phase_d
        run_phase_e
        run_phase_f
        run_phase_g
        run_phase_h
        run_phase_v
        echo ""
        echo "╔══════════════════════════════════════════════════════╗"
        echo "║  CSV-ONLY PIPELINE DONE                              ║"
        echo "╚══════════════════════════════════════════════════════╝"
        ;;

    net_enrichment)
        # Runs net enrichment layer only (scripts 12→13→14).
        # Requires the canonical DB to already be loaded.
        run_phase_net
        ;;

    *)
        echo "Usage: $0 {full|canonical_only|enrichment_only|csv_only|net_enrichment}" >&2
        exit 1
        ;;
esac
