# Skill: rebuild-identity-pipeline

## When to Use
Invoke when:
- Changing alias logic, identity resolution, or person generation
- Fixing duplicate persons or alias drift
- Verifying identity pipeline correctness end-to-end

Do NOT use for:
- Workbook-only changes
- Minor UI work
- Non-identity pipeline changes

---

## Goal
Rebuild the identity layer deterministically and validate:
- persons_master.csv
- canonical_input/persons.csv
- SQLite DB person tables
- duplicate-person QC

---

## Steps

```bash
# 1. Upstream identity chain
cd legacy_data

python3 membership/scripts/01_build_membership_enrichment.py
python3 clubs/scripts/01_build_club_person_universe.py
python3 clubs/scripts/05_build_club_only_persons.py
python3 persons/provisional/scripts/01_build_provisional_persons_master.py
python3 persons/provisional/scripts/02_build_provisional_identity_candidates.py
python3 persons/provisional/scripts/03_reconcile_provisional_to_historical.py
python3 persons/provisional/scripts/04_promote_provisional_to_historical_candidates.py
python3 persons/scripts/05_build_persons_master.py

# 2. Export platform canonical (critical for alias merge)
python3 pipeline/platform/export_canonical_platform.py

cd ..

# 3. Reset DB (destructive, expected)
bash scripts/reset-local-db.sh

# 4. Load enrichment (script 09)
python3 legacy_data/event_results/scripts/09_load_enrichment_to_sqlite.py \
  --db database/footbag.db \
  --persons-csv legacy_data/persons/out/persons_master.csv \
  --candidates-csv legacy_data/clubs/out/legacy_club_candidates.csv \
  --affiliations-csv legacy_data/clubs/out/legacy_person_club_affiliations.csv

# 5. Trick loaders
python3 legacy_data/event_results/scripts/17_load_trick_dictionary.py --db database/footbag.db
python3 legacy_data/event_results/scripts/19_load_red_additions.py --db database/footbag.db
python3 legacy_data/event_results/scripts/20_link_footbag_org_sources.py --db database/footbag.db

# 6. QC
python3 legacy_data/pipeline/qc/check_alias_duplicate_persons.py