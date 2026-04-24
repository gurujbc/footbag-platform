"""
Person-likeness gate — strict rules for deciding whether a display_name
should ever become a canonical person row.

Scaffolding only (not wired up yet). Today two copies of this logic live in:

  - event_results/scripts/07_build_mvfp_seed_full.py::_is_person_like
  - pipeline/platform/export_canonical_platform.py::_is_person_like (step 5b)

The two have diverged over time, which hides regressions. The plan is to
consolidate both strict copies onto this module in a follow-up PR. The
release workbook flow (canonical CSVs → export_canonical_platform.py →
event_results/canonical_input/*.csv → build_workbook_release.py →
out/Footbag_Results_Release.xlsx) reuses the export-stage gate.

Public API:
    is_person_like(name) -> bool
"""

from __future__ import annotations

import re


_PL_MOJIBAKE     = re.compile(r"[¶¦±¼¿¸¹º³]")
_PL_EMBED_Q      = re.compile(r"\w\?|\?\w")
_PL_STANDALONE_Q = re.compile(r"(?:^|\s)\?{1,5}(?:\s|$)")
_PL_BAD_CHARS    = re.compile(r"[+=\\|/]")
_PL_SCOREBOARD   = re.compile(r"^[A-Z]{2}\s+\d+$")
_PL_PRIZE        = re.compile(r"\$\d+")
_PL_MATCH_RESULT = re.compile(r"\d+-\d+\s+over\b", re.IGNORECASE)
_PL_BIG_NUMBER   = re.compile(r"\b\d{3,}\b")
_PL_NON_PERSON   = re.compile(
    r"\b(Connection|Dimension|Footbag|Spikehammer|head-to-head|"
    r"being determined|Freestyler|round robin|results|"
    r"Champions|Foot Clan|"
    r"whirlygig|whirlwind|spinning|blender|smear|"
    r"clipper|torque|butterfly|mirage|legbeater|ducking|"
    r"eggbeater|ripwalk|hopover|dropless|scorpion|matador|"
    r"symposium|swirl|drifter|vortex|superfly|"
    r"atomic|blurry|whirl|flux|dimwalk|nemesis|bedwetter|"
    r"pixie|rooted|sailing|diving|ripped|warrior|"
    r"paradon|steping|pdx|mullet|"
    r"Big Add Posse|Aerial Zone|Annual Mountain|Be Announced|"
    r"depending|highest.placed|two footbags)\b",
    re.IGNORECASE,
)
_PL_ALL_CAPS      = re.compile(r"^[A-Z]{2,}[\s-]+[A-Z]{2,}(?:[\s-]+[A-Z]{2,})*$")
_PL_TRAILING_JUNK = re.compile(r"[*]+$")
_PL_ABBREVIATED   = re.compile(r"^[A-Z]\.?\s+\S")
_PL_INCOMPLETE    = re.compile(r"^\S+\s+[A-Z]$")
_PL_INITIALS      = re.compile(r"^[A-Z]\.\s+[A-Z]\.$")
_PL_PRIZE_SUFFIX  = re.compile(r"-prizes\b|\bprize\b", re.IGNORECASE)
_PL_TRICK_ARROW   = re.compile(r"[>]|\s:\s")
_PL_LONG_TOKEN    = re.compile(r"\S{21,}")


def is_person_like(name: str) -> bool:
    """Return False if name is clearly not a canonical person name."""
    s = name.strip()
    if not s:
        return False
    if _PL_MOJIBAKE.search(s):     return False
    if _PL_EMBED_Q.search(s):      return False
    if _PL_STANDALONE_Q.search(s): return False
    if _PL_BAD_CHARS.search(s):    return False
    if _PL_SCOREBOARD.match(s):    return False
    if _PL_PRIZE.search(s):        return False
    if _PL_MATCH_RESULT.search(s): return False
    if _PL_BIG_NUMBER.search(s):   return False
    if _PL_NON_PERSON.search(s):   return False
    if "," in s:                   return False
    if _PL_ALL_CAPS.match(s):      return False
    if _PL_TRAILING_JUNK.search(s) and len(s.split()) >= 2: return False
    if " " not in s and "." not in s: return False
    if _PL_ABBREVIATED.match(s):   return False
    if _PL_INCOMPLETE.match(s):    return False
    if _PL_INITIALS.match(s):      return False
    if _PL_PRIZE_SUFFIX.search(s): return False
    if _PL_TRICK_ARROW.search(s):  return False
    if _PL_LONG_TOKEN.search(s):   return False
    if s[0].islower():             return False
    if re.search(r"\bThe\b", s):   return False
    if '"' in s:                   return False
    if " or " in s.lower():        return False
    return True
