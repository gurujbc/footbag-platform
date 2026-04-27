# Pre-1985 Worlds source-precedence rules — PROPOSED

Status: **PROPOSED** — not approved, not enforced. These rules guide the
human adjudication of `event_equivalence_pre1985_worlds_adjudication.csv`.
Final rules will be promoted from this draft once the maintainer signs off
per-rule.

## Scope

Applies only to the four event-key merges declared in `event_equivalence.csv`
under the 2026-04-25 pre-1985 Worlds block:

```
1982_nhsa_national → 1982_worlds_oregon_city
1983_nhsa_national → 1983_worlds_boulder_nhsa
1983_national      → 1983_worlds_boulder_wfa
1984_national      → 1984_worlds_golden_wfa
```

Source documents in scope:

- `inputs/curated/events/structured/authoritative-results-1980-1985.txt` — original
  research compilation (the source for the four surviving event_keys).
- `inputs/curated/events/structured/worlds-gemini-82-84.txt` — Gemini-AI-assisted
  cross-source compilation (the source for the four doomed event_keys).
- External: magazine archive (Footbag World newsletter, NHSA/WFA bulletins),
  freestyle club programs, BAP/HOF biographies, world-record archives.

## Rules

1. **Sources agree → accept the shared result.**
   When both sources record identical participants at the same
   `(discipline_key, placement)` slot, the result is auto-ready and requires
   no review. The merged record carries `chosen_source=both`.

2. **Single-source coverage → accept provisionally.**
   When a discipline or placement is recorded by only one source (no overlap
   in the other), accept that source's claim provisionally with
   `chosen_source=<source_file>`. Re-classify to `confirmed` if a third
   source corroborates.

3. **Mens net + golf conflicts → prefer authoritative-results-1980-1985.txt
   unless contradicted by an external scan.**
   The authoritative document is the older, footbag.org-native compilation
   for these disciplines and tracks closer to original NHSA/WFA bulletin
   records. `chosen_source=authoritative-results-1980-1985.txt`,
   `decision_notes=mens_net_default_precedence`. Override to gemini if a
   magazine scan supports gemini's claim.

4. **Womens + mixed conflicts → never auto-resolve. Require external evidence.**
   Both compiled sources have known coverage gaps and inconsistencies on
   women's and mixed-doubles disciplines (12 + 7 = 19 of the current 19
   conflicts fall in this bucket). Resolution requires a magazine scan,
   newsletter excerpt, or participant memory. Until external evidence
   lands, `decision_status=pending` and the merge stays declarative-only.

5. **Magazine / FBW / NHSA / WFA event-specific scan → outranks both compiled
   text sources.**
   When a primary source (event program, contemporaneous newsletter article,
   official bulletin) covers a contested slot, it overrides both
   authoritative and gemini. Record the citation in
   `source_evidence_needed` → cited URL or scan path.

6. **Never resolve conflicts by placement offset.**
   Bumping doomed-event placements (e.g. p1 → p101) to avoid duplicate
   collisions is **not** an adjudication. It is a data-integrity hack that
   loses the "two sources, same slot" semantic. The adjudication worksheet
   is the only legitimate place to record source-conflict state.

7. **Never merge duplicate event_keys until conflicts are resolved or
   preserved in an explicit adjudication table.**
   The presence of an entry in `event_equivalence.csv` with `action=merge`
   declares intent. Actual canonical merge happens only after the
   adjudication worksheet has `decision_status` ∈ {`auto_ready`, `resolved`}
   for every conflicting slot.

8. **Preserve original source claims in the adjudication worksheet.**
   `survivor_participants` and `doomed_participants` columns are
   write-once, source-of-truth. Never mutate them — they are the audit
   trail for the merge decision. New evidence creates a new column or
   note, never a rewrite of the source columns.

## Out of scope

- Result-level dedup logic (decided post-adjudication).
- Actual canonical CSV mutation (deferred until per-slot decisions land).
- Re-investigation of 1980 and 1981 event-key separations (already
  confirmed clean — see `project_event_key_coordination` memory).
- Re-investigation of 1985–1986 (already merged in 2026-04-23 patch pass).
- FBW/Golden track separation (confirmed distinct circuit, never merge).
- IFAB/Oregon City/Portland/San Francisco/Memphis/San Dimas separation
  (confirmed distinct events with dedicated magazine sources).

## How adjudication proceeds

1. Open `event_equivalence_pre1985_worlds_adjudication.csv` in a spreadsheet.
2. Filter `decision_status = pending`.
3. For each row, follow the rule above that matches the discipline family
   and conflict shape.
4. Fill in `chosen_source`, `chosen_participants`, set `decision_status`
   to `resolved`, add `decision_notes` citing the rule + any external
   evidence found.
5. When all rows for a single (survivor, doomed) pair reach
   `auto_ready` or `resolved`, that pair is ready for canonical merge.
6. Canonical merge implementation is a separate, future task — not part
   of adjudication.
