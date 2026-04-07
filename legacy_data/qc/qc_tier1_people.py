# qc_tier1_people.py
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json
import re
import pandas as pd


@dataclass
class Issue:
    check_id: str
    severity: str   # "ERROR" | "WARN" | "INFO"
    field: str
    message: str
    example_value: str = ""
    context: dict | None = None


_RE_MOJIBAKE = re.compile(r"[¶¦±¼¿]|Mo¶|Fr±|Gwó¼d¼", re.UNICODE)
_RE_MULTI_PERSON = re.compile(r"\b(and|&|/|\+|vs\.?)\b", re.IGNORECASE)
_RE_TRAILING_JUNK = re.compile(r"[\*\-–—]+$")  # "Name*", "Name -"
_RE_OPEN_PAREN = re.compile(r"\([^)]*$")       # "Name (Phoenix" missing close paren


def looks_like_person(name: str) -> bool:
    s = (name or "").strip()
    if not s:
        return False
    if len(s.split()) < 2:
        return False
    low = s.lower()
    if low in {"na", "dnf", "()", "nd", "th"}:
        return False
    if any(x in low for x in ["club", "footbag", "position", "match", "ifpa", "footstar",
                               "competing", "kicks", "drops", "adds"]):
        return False
    if re.search(r'-[A-Z]+\)\s*$', s):   # "-CANADA)", "-USA)"
        return False
    if s.upper().startswith("RESULTS"):
        return False
    if re.search(r'\b\d{3,}\b', s):       # 3+ digit number token (IFPA/handicap IDs)
        return False
    if low.rstrip().endswith(" and") or low.rstrip().endswith(") and") or low.rstrip().endswith(") or"):
        return False
    # Filter entries starting with "[" or "?" (placeholders/corrupt entries)
    if s.startswith('[') or s.startswith('?'):
        return False
    # Filter trick lists (contain ">" or "->")
    if '>' in s:
        return False
    # Filter score table rows: single surname + 3 or more small numbers
    # e.g. "Widmer 1 3 1 1 1", "Böhm 2 1 4 3"
    words = s.split()
    if len(words) >= 4 and all(re.match(r'^\d{1,2}$', w) for w in words[1:]):
        return False
    # Filter narrative starters
    if re.match(r'^(annual\b|winners\s|thru\s)', low):
        return False
    # Filter location fragments: "PA -USA) 56", "AZ -USA) 64" etc.
    if re.search(r'-[A-Z]+\)\s+\d+\s*$', s):
        return False
    # Filter state+score tables: "IL 68 31 16", "IL 63 22 11", "IL 68" (2-letter abbrev + number(s))
    if re.match(r'^[A-Z]{2}\s+\d+', s) and '(' not in s:
        return False
    # Filter location fragments starting with state/region + ")" or ", STATE)"
    # e.g., "GA) 16 pts", "SC) 8 pts", "CO, USA) and Rick Reese"
    if re.match(r'^[A-Z]{2}\)', s) or re.match(r'^[A-Z]{2},\s+[A-Z]+\)', s):
        return False
    # Filter entries ending with " pts" or "pts." (score summaries)
    if re.search(r'\d+\s+pts\.?\s*$', low):
        return False
    # Filter entries with narrative: contains "didn't"/"didn´t" (e.g., "Müller Didn´t show up")
    if re.search(r"didn['\u00b4`]t", low):
        return False
    # Filter ordinal-prefixed entries: "2nd Ryan", "nd= Adrian Dick"
    if re.match(r'^(1st|2nd|3rd|\d+th|nd=|rd=|st=)\s', low):
        return False
    # Filter score table rows with 3+ trailing single-digit numbers even with asterisk:
    # e.g., "D. Chabannes* 2 1 4 1 1", "P. Marchianni** 3 3 3 4"
    tokens = s.split()
    if len(tokens) >= 4:
        numeric_tail = sum(1 for w in tokens[2:] if re.match(r'^\d{1,2}\*{0,2}$', w))
        if numeric_tail >= 3:
            return False
    # Filter location lists with 2+ commas (e.g., "BC, Arizona, Texas and the")
    if s.count(',') >= 2:
        return False
    # Filter "CA (3-peat)" — location with annotation in parens
    if re.match(r'^[A-Z]{2}\s+\(', s):
        return False
    # Filter pure-initial pairs like "F. D." (not a real full name)
    if re.match(r'^[A-Z]\.\s+[A-Z]\.$', s):
        return False
    # Filter entries starting with "Team " (team names, not individuals)
    if re.match(r'^team\s', low):
        return False
    # Filter entries starting with "USA)" (location fragment like "USA) and Greg Nelson")
    if s.startswith('USA)'):
        return False
    # Filter entries starting with lowercase (trick lists, Czech phrases, etc.)
    if s and s[0].islower():
        return False
    # Filter entries containing "results" keyword (not a person name)
    if 'results' in low:
        return False
    # Filter entries with standalone "?" word (unresolvable placeholders like "Rémi ?", "Marek ?")
    if any(w in {'?', '??', '???', '????', '?????'} for w in s.split()):
        return False
    # Filter "N victories" / "N victory" leaderboard annotations (should be cleaned before alias lookup)
    if re.search(r'\d+\s+victor(?:y|ies)\b', low):
        return False
    # Filter emoji flag sequences (name has unstripped country flag emoji)
    if re.search(r'[\U0001F1E0-\U0001F1FF]{2}', s):
        return False
    # Filter German tournament bracket terms (not player names)
    if re.search(r'\b(viertelfinale|halbfinale|finale)\b', low):
        return False
    # Filter entries ending with ordinal "N." rank suffix like "Barry Thorsen 3."
    if re.search(r'\s+\d+\.\s*$', s):
        return False
    # Filter entries that end with "--N" score/rank like "Shannon Anderson--74"
    if re.search(r'\s*--\d+\s*$', s):
        return False
    # Filter "Platz" (German for "place" - tournament position text)
    if 'platz' in low:
        return False
    # Filter score-table rows with decimal: "First Last 98 30 3.27" (3+ numeric tokens, last is decimal)
    if len(words) >= 5:
        tail = words[2:]
        if sum(1 for w in tail if re.match(r'^\d+(?:[.,]\d+)?$', w)) >= 3:
            return False
    # Filter "N Punkte" / "N points" / "N pkt" suffixes (German/English/Polish score annotations)
    if re.search(r'\d+\s+(?:punkte?|points?|pkt)\b', low):
        return False
    # Filter entries with "$$$" / "$$" (noise symbols not in person names)
    if '$$' in s:
        return False
    # Filter entries ending with "<3" emoji-like symbol
    if s.rstrip().endswith('<3'):
        return False
    # Filter narrative/admin entries containing "round robin"
    if 'round robin' in low:
        return False
    # Filter entries with "..." (truncated/incomplete entries)
    if '...' in s:
        return False
    # Filter backslash-separated doubles teams (need split, not alias)
    if ' \\ ' in s or '\\' in s and re.search(r'\w\\\w', s):
        return False
    # Filter entries with digit(s) between two apparent names: "Widen Aroni (Basque Country) 7 Joseph"
    if re.search(r'\)\s+\d+\s+[A-Z]', s):
        return False
    # Filter "First place v1/v2" admin entries
    if re.match(r'^first\s+place\b', low):
        return False
    # Filter location-only entries: "City, ST" patterns like "Bridgewater, NJ"
    if re.match(r'^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s+[A-Z]{2}\s*$', s):
        return False
    # Filter trick/junk entries ending with ")" but no opening "(" (truncated)
    if s.endswith(')') and '(' not in s:
        return False
    # Filter entries ending with "&" (incomplete entry, second name missing)
    if s.rstrip().endswith('&'):
        return False
    # Filter entries with "_" as a word (placeholder underscore for missing name)
    if '_' in s and any(w.strip('_') == '' for w in s.split()):
        return False
    # Filter "Name - lowercase Uppercase" (two people in one field, second person lowercase-starting)
    if re.match(r'^\S+\s+\S+\s+-\s+[a-z]\S+\s+[A-Z]', s):
        return False
    # Filter entries with "N.Name" ordinal stuck to second person (e.g. "Ryan Morris 3.Ben Baybak")
    if re.search(r'\s+\d+\.[A-Z]', s):
        return False
    # Filter "(Fin)N" or "(Country)Score" suffix without space (encoding/parse noise)
    if re.search(r'\([A-Z][a-z]{1,4}\)\d+', s):
        return False
    # Filter encoding-corrupted entries: "?" embedded inside a word (not standalone)
    # e.g. "Tomá? Tuček" (Czech š→?), "Marek ?andrik" (?→Š), "Vá?ka Kouda"
    if re.search(r'\w\?|\?\w', s):
        return False
    # Filter entries with "¸" or "¹" or "¿" encoding corruption characters
    if re.search(r'[¸¹º¿]', s):
        return False
    # Filter entries ending with "?" (trailing question mark, unresolved placeholder)
    if s.rstrip().endswith('?'):
        return False
    # Filter entries containing "over" (match result: "Steve Goldberg 11-0 over Ianek Regimbauld")
    if re.search(r'\d+-\d+\s+over\b', low):
        return False
    # Filter entries with asterisk used as separator: "Marc Weber* Bob Silva"
    if re.search(r'\w\*\s+[A-Z]', s):
        return False
    # Filter trick-description entries with trick-specific keywords after name
    if re.search(r'\b(whirl|swirl|blender|mirage|legbeater|butterfly|torque|paradox|symposium|clipper|ripwalk|hopover|gauntlet|matador|tripwalk|eggbeater|ducking|dropless|scorpion)\b', low):
        return False
    return True


def load_pf(pf_csv: Path) -> pd.DataFrame:
    df = pd.read_csv(pf_csv)
    # normalize empties
    for c in ["player1_name", "player2_name", "player1_person_id", "player2_person_id",
              "player1_person_canon", "player2_person_canon"]:
        if c in df.columns:
            df[c] = df[c].fillna("").astype(str)
    return df


def run_tier1_people_qc(pf: pd.DataFrame, top_n: int = 200) -> tuple[dict, list[Issue]]:
    issues: list[Issue] = []

    def scan_side(side: int) -> None:
        name = pf.get(f"player{side}_name", pd.Series([""] * len(pf)))
        pid  = pf.get(f"player{side}_person_id", pd.Series([""] * len(pf)))
        canon = pf.get(f"player{side}_person_canon", pd.Series([""] * len(pf)))

        # 1) looks-like-person but missing person_id
        mask_unmapped = name.map(looks_like_person) & (pid.str.strip() == "")
        if mask_unmapped.any():
            top = name[mask_unmapped].value_counts().head(top_n)
            for n, cnt in top.items():
                issues.append(Issue(
                    check_id="T1_UNMAPPED_PERSON_NAME",
                    severity="WARN",
                    field=f"player{side}_person_id",
                    message="Name looks like a person but has no person_id (candidate for Person_Aliases / cleanup).",
                    example_value=f"{n} (count={cnt})",
                ))

        # 2) canon missing when person_id present
        mask_canon_missing = (pid.str.strip() != "") & (canon.str.strip() == "")
        if mask_canon_missing.any():
            ex = name[mask_canon_missing].value_counts().head(20)
            for n, cnt in ex.items():
                issues.append(Issue(
                    check_id="T1_CANON_MISSING_WITH_PERSON_ID",
                    severity="ERROR",
                    field=f"player{side}_person_canon",
                    message="person_id present but person_canon is empty (should be deterministic).",
                    example_value=f"{n} (count={cnt})",
                ))

        # 3) mojibake remnants
        mask_moj = name.str.contains(_RE_MOJIBAKE, na=False)
        if mask_moj.any():
            ex = name[mask_moj].value_counts().head(50)
            for n, cnt in ex.items():
                issues.append(Issue(
                    check_id="T1_NAME_MOJIBAKE_REMAINS",
                    severity="WARN",
                    field=f"player{side}_name",
                    message="Name contains mojibake-like characters; should be repaired before aliasing.",
                    example_value=f"{n} (count={cnt})",
                ))

        # 4) multi-person strings in a single name field
        # Apply exclusions to avoid false positives on location fragments and truncated entries
        def _is_multi_false_positive(n: str) -> bool:
            lo = (n or "").strip().lower()
            s = (n or "").strip()
            # Starts with lowercase → not a person name (narrative, location fragment)
            if s and s[0].islower():
                return True
            # Ends with " and" or ") and" (truncated incomplete entry)
            if re.search(r'\s+and\s*$', lo):
                return True
            # Location fragment pattern: state/country code + ")" e.g. "AB) and", "SUI) and"
            if re.match(r'^[A-Z]{2,3}[,\s]+[A-Z]+\)', s) or re.match(r'^[A-Z]{2,3}\)', s):
                return True
            # 2+ commas → location list
            if s.count(',') >= 2:
                return True
            # Contains "Viertelfinale"/"Halbfinale" → German bracket text
            if re.search(r'\b(viertelfinale|halbfinale)\b', lo):
                return True
            # "III and Name" where III is a Roman numeral rank (not a person)
            if re.match(r'^(I{1,3}|IV|V|VI|VII|VIII|IX|X)\s+and\b', s):
                return True
            return False

        mask_multi = (
            name.str.contains(_RE_MULTI_PERSON, na=False) &
            (name.str.len() > 0) &
            ~name.map(_is_multi_false_positive)
        )
        if mask_multi.any():
            ex = name[mask_multi].value_counts().head(50)
            for n, cnt in ex.items():
                issues.append(Issue(
                    check_id="T1_MULTI_PERSON_IN_NAME_FIELD",
                    severity="WARN",
                    field=f"player{side}_name",
                    message="Single name field appears to contain multiple people; needs parsing/splitting or quarantine.",
                    example_value=f"{n} (count={cnt})",
                ))

        # 5) trailing junk markers (require 2+ words — pure noise like "*" or "G*" are excluded)
        mask_tail = name.str.contains(_RE_TRAILING_JUNK, na=False) & (name.str.split().str.len() >= 2)
        if mask_tail.any():
            ex = name[mask_tail].value_counts().head(50)
            for n, cnt in ex.items():
                issues.append(Issue(
                    check_id="T1_TRAILING_JUNK_MARKER",
                    severity="INFO",
                    field=f"player{side}_name",
                    message="Name ends with junk marker (*, -, –); consider cleanup rule.",
                    example_value=f"{n} (count={cnt})",
                ))

        # 6) open parenthesis fragment
        mask_open = name.str.contains(_RE_OPEN_PAREN, na=False)
        if mask_open.any():
            ex = name[mask_open].value_counts().head(50)
            for n, cnt in ex.items():
                issues.append(Issue(
                    check_id="T1_OPEN_PAREN_FRAGMENT",
                    severity="INFO",
                    field=f"player{side}_name",
                    message="Name contains an unmatched '(' fragment (often location spill).",
                    example_value=f"{n} (count={cnt})",
                ))

    scan_side(1)
    scan_side(2)

    summary = {
        "issues_total": len(issues),
        "counts_by_check_id": pd.Series([i.check_id for i in issues]).value_counts().to_dict(),
        "counts_by_severity": pd.Series([i.severity for i in issues]).value_counts().to_dict(),
    }
    return summary, issues


def main() -> int:
    repo = Path(__file__).resolve().parent
    pf_csv = repo / "out" / "Placements_Flat.csv"
    out_dir = repo / "out"

    pf = load_pf(pf_csv)
    summary, issues = run_tier1_people_qc(pf)

    (out_dir / "qc_tier1_people_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    with (out_dir / "qc_tier1_people_issues.jsonl").open("w", encoding="utf-8") as f:
        for i in issues:
            f.write(json.dumps(i.__dict__, ensure_ascii=False) + "\n")

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
