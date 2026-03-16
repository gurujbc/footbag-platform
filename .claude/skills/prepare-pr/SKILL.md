---
name: prepare-pr
description: Prepare a human-reviewable PR summary for the current work without creating commits, pushing, or mutating git history.
---

# Prepare PR

1. Inspect:
   - current diff
   - changed files
   - test/verification results
   - any follow-up docs or planning impacts

2. Produce:
   - concise summary
   - key files changed
   - risks and tradeoffs
   - verification performed
   - open questions
   - follow-up work, if any

3. Never:
   - commit
   - push
   - rewrite git history
   - claim tests or browser verification that did not happen
