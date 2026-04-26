📄 Freestyle Glossary (v2.1 — patched + ready)
Overview

Freestyle footbag terminology spans multiple conceptual layers:

tricks (dictionary)
modifiers (construction)
aliases (naming evolution)
glossary terms (runs, style, vocabulary)
sequences (how tricks are used)

This glossary defines terminology only — not the canonical trick or modifier data.

Where this lives: glossary (editorial only)

1. ADD System & Run Quality

These terms describe the difficulty of a run, not individual tricks.

Term	Meaning
Tiltless	All tricks in the run are ≥ 2 ADD
Guiltless	All tricks in the run are ≥ 3 ADD
Tripless	All tricks are ≥ 4 ADD
Fearless	All tricks are ≥ 5 ADD
Beastly	All tricks are ≥ 6 ADD
Godly	All tricks are ≥ 7 ADD

Additional:

Term	Meaning
Genuine	Guiltless excluding BOP tricks
BOP	Butterfly, Osis, Paradox Mirage

These describe run quality, not tricks.
Where this lives: glossary (editorial only)

2. Core Freestyle Concepts
ADD (Additional Degree of Difficulty)

A scoring system assigning difficulty values to tricks based on their components.

Dexterity (Dex)

A motion where the foot circles around the bag.

Set

The action used to position the bag before a trick.

uptime — before peak
midtime — at peak
downtime — after peak
Stall / Delay

Controlling the bag on a surface.

X-Dex

A dexterity performed in a crossed-body position.

Red Husted clarification: contributes to higher ADD values (e.g., Atom Smasher = 4 ADD).
Where this lives: modifier system

3. Modifiers (Concept Overview)

Modifiers are structural components that change how a trick is executed.

Definitions below reflect community-standard usage.
Canonical wording and authority live in freestyle_trick_modifiers.
Red Husted-confirmed entries are noted explicitly.

Modifier	Meaning
Paradox	Opposite-side dex (+1 ADD, community standard)
Symposium	Dex before plant (community standard)
Atomic	Uptime dex (community standard)
Gyro	Spin + dex using the same foot that set the bag (Red confirmed)
Spinning	Rotation before execution (community standard)
Stepping	Same-side set (community standard)
Ducking	Bag passes over head (community standard)
Double	Two dexes (ADD context-dependent, community standard)
Pogo	Set style (0 ADD, Red confirmed)
Surging	Spinning + stepping (Red confirmed)

Some exist as both:

standalone tricks (Barrage)
modifier forms (barraging)

Where this lives: freestyle_trick_modifiers

4. Naming & Evolution (Alias Layer)

Freestyle naming evolves over time.

Examples only.
Canonical mappings live in freestyle_trick_aliases.

Older Name	Modern Name
Toe Blur	Quantum Mirage
Toe Ripwalk	Quantum Butterfly
Spyro	Inspin

Additional alias type:

Abbreviation	Expanded Name
PS Whirl	Paradox Symposium Whirl
Important clarification
Spyro is a trick, not a modifier concept (Red confirmed)

Where this lives: alias system

5. Runs, Combos, and Style

These describe how tricks are used.

Run

A continuous sequence of tricks.

Shuffle

Alternating sides rhythmically.

Link / Transition

Connection between tricks.

Connector Trick

A trick commonly used to maintain flow.

Example: whirl-family tricks often act as connectors.

Dropless

A run without drops.

Density

Average ADD per trick in a run.

Shred Circle

A group freestyle format where players take turns hitting runs.

Where this lives: glossary (editorial only)

6. Notation (Jobs System: current state)

A symbolic system describing trick structure.

Example:

(clipper) > whirl > butterfly

Current project state:

notation stored as text (freestyle_tricks.notation)
not yet parsed structurally

Where this lives: dictionary (data field), glossary (explanation)

7. Foundational (Core) Tricks

The system identifies key primitives that anchor freestyle:

clipper
mirage
legover
pickup
guay
illusion
whirl
butterfly
swirl
osis
pixie
fairy
around-the-world

Where this lives: freestyle_tricks (is_core = 1)

8. Source & Review Model

Not all data is equal.

Review levels:
curated
expert_reviewed
pending
scraped (initial ingestion state)
Source priority:
Red Husted (expert)
curated dictionary
footbag.org
scraped data
Disagreements exist

Example:

Atom Smasher: Red = 4 ADD, footbag.org = 3 ADD

System behavior:

preserves both
chooses canonical based on priority

Where this lives: data model + QC layer

9. Attribution

Concepts adapted from:

footbag.org
community terminology
expert input from Red Husted

All definitions rewritten and structured for clarity.

✅ Fixes applied
em dash removed ✔
modifier provenance clarified ✔
review taxonomy completed ✔
PS Whirl restored ✔
emojis removed ✔
🧭 Now the important part: structural decisions
1. Where should this live?

👉 Correct answer: BOTH, but with different roles

A. Source of truth (edit here)
docs/freestyle_glossary.md
B. Rendered page (future)
/freestyle/glossary

👉 Template pulls from doc or derived version

2. Sync strategy (VERY important)

You have 3 options — only one is correct long-term:

❌ Manual sync

You will forget → drift guaranteed

❌ Accept drift

Breaks trust in system

✅ Best: Hybrid (recommended)
glossary = editorial
DB = canonical
glossary explicitly defers:

“canonical definitions live in…”

👉 Which you already implemented

Optional future upgrade

Later you can:

auto-inject:
modifier list
core tricks
at build time

But do NOT do that now

🟢 Final recommendation

Do this:

docs/freestyle_glossary.md  ← replace or merge

Add header:

Last reviewed: 2026-04 (Red Husted input incorporated)
