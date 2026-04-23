
# Skill: cleanup-alias-pattern-c

## When to Use
Invoke when:
- Duplicate persons detected by QC
- Stale alias rows exist in person_aliases.csv
- Alias target pids no longer exist
- Diacritic / normalization duplicates appear

---

## Goal
Fix alias data safely without introducing new inconsistencies.

---

## Categories

1. Recoverable stale
- alias → dead pid
- person_canon matches live person
→ retarget safely

2. Unrecoverable
- corrupted encoding ( , ?)
→ manual review or leave

3. Self-loops
- alias == canon == target
→ optional cleanup only

---

## Workflow

1. Identify failing cases
```bash
python3 legacy_data/pipeline/qc/check_alias_duplicate_persons.py
4. Apply minimal safe fixes
- retarget only exact canonical matches
- do not guess ambiguous mappings

5. Rebuild identity pipeline
→ use `rebuild-identity-pipeline`

6. Confirm QC returns 0 violations
