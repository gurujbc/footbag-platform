---
name: doc-sync
description: Check proposed MVFP Events + Results work for code and documentation drift, then recommend only the smallest high-value companion doc updates.
---

# Doc Sync

## Use when
- You changed behavior, routes, identifiers, boundaries, or architecture notes.
- You suspect current code and docs no longer match.
- The human asks whether a companion doc update is needed.

## Read first
- `PROJECT_SUMMARY_CONCISE.md`
- the most relevant local doc for the touched area
- the touched code files

## Workflow
1. Compare the proposed or completed change against the current authoritative docs for the same scope.
2. Identify only real drift, not style differences.
3. Escalate to the human for explicit confirmation when mismatch affects:
   - user-visible behavior
   - routes or route semantics
   - identifiers such as `eventKey`
   - service or database boundaries
   - architecture or scope
   - any drift from current docs and current code or decisions.
4. Suggest the smallest documentation edits needed to match current code or agreed design, make sure that all edits are in the correct place in the docs, so do a context-aware full-doc scan for every edit to ensure correct placement, and the change doesn't break anything else. Show all required edits as a group for any given issue, and propose the suite of changes to human with context, and surgical precise before and after text for every edit proposed.
5. Only edit the document if approved by human, and then surgically change only the precise text as agreed and nothing else. Often the human will want to edit the doc personally, so do not edit project docs without explicit human approval.
   - Approval can be any short affirmative: "yes", "y", "go", "ok", "do it", "approved", or just pressing Enter. Do not require the human to type a specific word.

## Output shape
- **Match:** docs already align, or no doc update needed.
- **Small sync suggested:** list the exact file and the specific note to update.
- **Human decision needed:** explain the mismatch and why it changes behavior or boundaries, or why it indicates a gap, bug, drift or new decision.

## Do not
- propose large rewrite plans by default
- restate the whole docs suite
- treat stale GitHub snapshots as newer than local or uploaded project files
- invent scope beyond the current MVFP public Events + Results slice
