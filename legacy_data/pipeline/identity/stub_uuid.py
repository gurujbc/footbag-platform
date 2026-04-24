"""
Stable UUID5 minting for auto-assigned (stub) person identifiers.

Scaffolding only (not wired up yet). Today multiple UUID5 namespaces and
input-normalization regimes coexist across the pipeline:

  - pipeline/02_canonicalize_results.py        namespace 11111111-... , ws+lowercase
  - pipeline/02p6_structural_cleanup.py        namespace 11111111-... , different ws+lowercase
  - event_results/scripts/07_build_mvfp_seed_full.py
                                               namespace a1b2c3d4-... , shared normalize_name
                                               (correct — the Apr 21 platform fix)

The plan is to consolidate callers onto this module in a follow-up PR, so
every stage mints the same UUID5 for the same display name. That migration
requires an identity-lock version bump (existing stub person_ids will
change for any caller that currently uses a different namespace or
normalization), so it is intentionally deferred. The release workbook flow
(canonical CSVs → pipeline/platform/export_canonical_platform.py →
event_results/canonical_input/*.csv → build_workbook_release.py →
out/Footbag_Results_Release.xlsx) inherits whichever namespace the
producing stage used.

Public API:
    PERSON_NS                              — UUID5 namespace constant
    stub_person_uuid(display_name) -> str  — stable UUID5 string
"""

from __future__ import annotations

import uuid

from pipeline.identity.alias_resolver import normalize_name


# Matches the namespace adopted by 07_build_mvfp_seed_full.py and by
# tools/patch_pt_v53_add_unresolved_persons.py in footbag-platform.
# Do NOT change this constant — identity-lock files depend on it.
PERSON_NS = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")


def stub_person_uuid(display_name: str) -> str:
    """Return a stable UUID5 derived from a normalised display name.

    Diacritic / casing / hyphen / apostrophe variants of the same name
    collapse to a single stub UUID — preventing cases like "Jyri Ryyppo"
    vs "Jyri Ryyppö" producing two distinct stub person rows.
    """
    return str(uuid.uuid5(PERSON_NS, normalize_name(display_name)))
