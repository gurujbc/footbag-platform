---
name: audit-implementation-plan
description: Audit and rewrite an AI-facing IMPLEMENTATION_PLAN.md (or similar AI-facing planning doc) into strict operational-only form. Use when asked to clean, prune, operationalize, or de-clutter an IP file. Output sections are limited to active work, current substitute mechanisms, external blockers, release-readiness criteria, and an optional deferred/parked section. Always pauses for approval before writing.
---

# Skill: Operational Implementation Plan Audit (IP Audit)

## Purpose

Audit and rewrite AI-facing implementation plan documents (e.g. `legacy_data/IMPLEMENTATION_PLAN.md`) into a **strict operational state**.

These documents are **not user-facing docs**. They are working control surfaces for AI and must remain:
- Minimal
- Accurate
- Actionable
- Free of historical clutter

---

## Core Principles

### 1. Operational-only content

The file must contain ONLY:

- Active work (prioritized)
- Current substitute mechanisms (with unblock conditions)
- External blockers
- Release-readiness criteria
- (Optional) Deferred/parked work (non-blocking visibility only)

---

### 2. Hard deletions (no tombstones)

Remove completely:
- Completed work ("Already done")
- Duplicate sections
- Stale deliverables
- Long-term ideas without execution path
- Low-priority or speculative items

Do NOT leave:
- "Already done" logs
- Historical notes
- Commentary about past states

---

### 3. No scope expansion

- Do NOT introduce new work unless required for structural clarity
- Do NOT invent tasks
- Do NOT reframe project direction
- Only reflect reality already implied by the system

---

### 4. Consolidation over duplication

If multiple sections overlap:
- Merge into a single prioritized list

Typical merges:
- "Still to do" + "Known gaps" → **Active work**
- "Release checklist" → **Release-readiness criteria**

---

### 5. Accurate system grounding

All content must reflect **actual system behavior**, not assumptions.

Examples:
- Gating logic must match code (not docs assumptions)
- Pipeline dependencies must reflect real execution order
- DB requirements must match schema reality

---

### 6. Deferred work handling

Deferred items are:

- NOT part of Active work
- NOT part of Release gating

If preserved, place in:

## Deferred / parked work (non-blocking)

Keep minimal. No expansion.

---

### 7. Style constraints

- No em dashes
- No emojis
- Concise, structured prose
- Prefer bullets over paragraphs
- Avoid narrative explanations

---

## Output Protocol

Always produce:

### 1. Plan
- Sections to delete
- Sections to merge
- Sections to rewrite
- Any structural changes

### 2. Proposed result
- Full rewritten file OR clean diff

### 3. Assumptions and risks
- Anything removed that may matter later
- Any ambiguity in interpretation
- Any misplaced-but-useful content

### 4. Pause for approval
Never apply changes without explicit approval.

---

## Heuristics

### Keep if:
- Blocks execution
- Enables release
- Reflects current system constraint
- Has a clear owner/action

### Delete if:
- Already done
- Hypothetical
- Redundant
- Historical
- Not tied to execution

---

## Anti-patterns to eliminate

- "Already done" sections
- Multiple overlapping task lists
- "Next sprint" speculation
- Hidden dependencies
- Vague "improve X later" items

---

## Example transformation

Before:
- Still to do
- Known gaps
- Deliverables remaining
- Already done

After:
- Active work (single list)
- Current substitute mechanisms
- External blockers
- Release-readiness criteria
- (Optional) Deferred work

---

## Invocation examples

"Audit IMPLEMENTATION_PLAN.md using the audit-implementation-plan skill"

"Clean this file into operational-only form. Apply IP audit rules."

---

## Notes

- This skill enforces **discipline over completeness**
- Missing ideas are acceptable; incorrect or stale items are not
- Git history is the source of truth for removed content
