# Skill: pipeline-diagnostics

## When to Use
- QC failure investigation
- Unexpected row count changes
- Identity anomalies
- Canonical drift detection

## Workflow
1. Run QC
2. Inspect failing checks
3. Diff canonical outputs
4. Trace upstream stage
5. Isolate minimal repro

## Rules
- Never fix at output level
- Always fix at source (parser / override / identity)
- Prefer smallest possible change
