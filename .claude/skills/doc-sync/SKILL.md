---
name: doc-sync
description: Detect documentation drift against current code and confirmed decisions, then propose only the smallest accurate doc updates. Never edit docs without explicit human approval.
---

# Doc Sync

## Purpose
Check whether current documentation still matches the current codebase and confirmed decisions.

Use this skill to identify real documentation drift and propose the smallest precise edits needed to restore alignment.

This skill is for maintenance and synchronization, not broad rewriting.

## Use when
- code behavior changed
- interfaces changed
- identifiers changed
- boundaries changed
- assumptions or contracts changed
- the human asks whether docs need to be updated
- you suspect code and docs no longer match

Do not use this skill for:
- formatting-only changes
- wording preferences that do not change meaning
- speculative architecture work
- broad documentation improvement passes unrelated to actual drift

## Source-of-truth order
When sources conflict, evaluate in this order:
1. explicit human decisions in the current task
2. current local repository code and configuration
3. current local project documentation

If code and docs disagree and intended behavior is unclear, do not guess. Escalate to the human.

## Read first
Before making any recommendation, read:
- `PROJECT_SUMMARY_CONCISE.md` if present
- the most relevant local documentation for the affected area
- the touched code files
- any configuration, schema, or code files needed to understand the change

## Workflow

### 1) Identify the actual change
Determine exactly what changed or is under review.

Focus on meaningful changes:
- behavior
- interfaces
- identifiers
- boundaries
- contracts
- assumptions

Ignore cosmetic refactors unless they create real drift.

### 2) Find the matching documentation
Locate the most relevant existing document or section for the affected topic.

Prefer updating the current authoritative location rather than inventing a new place.

Before proposing an edit, scan enough surrounding context to ensure:
- the change belongs in that section
- there is not already a better place for it
- the proposed edit will not contradict nearby text
- all related mentions in the same document are accounted for

### 3) Detect real drift
Drift exists only when the docs:
- contradict current code or confirmed decisions
- omit information needed to understand current behavior
- describe old behavior as if it were current
- use identifiers or boundaries that are no longer correct

Do not treat these as drift:
- style differences
- formatting differences
- wording differences that preserve meaning
- missing nice-to-have explanation when the docs are still accurate

### 4) Escalate when meaning changes
Always escalate to the human before any documentation edit:
- user-visible behavior
- interfaces or interface semantics
- identifiers
- data meaning or schema meaning
- service, system, ownership, or architectural boundaries
- feature scope
- any case where the correct source of truth is not fully clear

### 5) Propose the smallest correct fix
When a doc update is appropriate, propose only the minimum necessary changes.

Requirements:
- keep edits surgical with precise before and after text
- preserve surrounding structure unless a structural move is actually required
- group all edits needed for one issue together
- review the whole doc to include every place that must change for consistency
- do not propose to rewrite entire sections when a few lines will do

For each proposed edit, provide:
- file path
- section or location
- why the edit is required or recommended, plus important context
- precise before text
- precise after text

### 6) Human-in-the-loop requirement
Never edit documentation unless the human explicitly approves.

Valid approval:
- yes / y
- ok / go
- any other reasonable affirmation

Alsways provide the human with the option to approve all edits in the current session.
If a human answers no to a proposed edit, ask why, then carefully adjust accordingly.

Not valid approval:
- silence
- pressing Enter
- approval of a different earlier edit in the same session

If approval is missing or ambiguous, stop after presenting findings and proposed edits.

### 7) Apply only what was approved
If the human approves, make only the agreed documentation edits:
- change only the precise text approved
- do not make opportunistic cleanup edits
- do not rewrite adjacent text unless explicitly approved
- do not modify unrelated docs in the same pass
- Always verify all modified text when you think you are done with a file; look for layout, formatting, and numbered-heading bugs.

## Guardrails
Do not:
- propose broad rewrite plans by default
- restate the entire docs suite
- infer intent not supported by code or explicit human direction
- treat comments as authoritative if code behavior differs
- edit docs without explicit human approval
- mix confirmed drift with speculative improvements
- expand scope beyond the area actually under review

## Default stance
- prefer no change over unnecessary change
- prefer one precise edit over a rewrite
- prefer escalation to human over guesswork
- prefer human approval over autonomous editing
