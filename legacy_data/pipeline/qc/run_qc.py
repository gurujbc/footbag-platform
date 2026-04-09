#!/usr/bin/env python3
"""
tools/run_qc_gate.py

Authoritative QC gate for the Footbag results pipeline.

Primary authority:
    out/canonical/
        events.csv
        event_disciplines.csv
        event_results.csv
        event_result_participants.csv
        persons.csv

Secondary artifact:
    community workbook (.xlsx)
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import pandas as pd


# =============================================================================
# CONFIG
# =============================================================================

DEFAULT_ROOT = Path(".").resolve()
DEFAULT_CANONICAL_DIR = DEFAULT_ROOT / "out" / "canonical"
DEFAULT_STAGE2_EVENTS = DEFAULT_ROOT / "out" / "stage2_canonical_events.csv"
DEFAULT_WORKBOOK = DEFAULT_ROOT / "Footbag_Results_Community_FINAL_v13.xlsx"

OPTIONAL_CHECKS = [
    # Community workbook matters, but qc_spreadsheet_gate.py expects a different workbook shape.
    {
        "name": "workbook_qc",
        "path": "qc_footbag_workbook.py",
        "severity": "warn",
        "needs_workbook": True,
    },
    {
        "name": "incomplete_results",
        "path": "qc_detect_incomplete_results.py",
        "severity": "warn",
        "needs_workbook": False,
    },
    {
        "name": "team_contamination",
        "path": "qc_team_contamination.py",
        "severity": "warn",
        "needs_workbook": False,
    },
    {
        "name": "qc2_structural",
        "path": "qc2.py",
        "severity": "warn",
        "needs_workbook": False,
    },
    {
        "name": "qc3_hygiene",
        "path": "qc3.py",
        "severity": "info",
        "needs_workbook": True,
    },
]

NON_PERSON_PATTERNS = [
    "contact:",
    "location:",
    "home page:",
    "site(s)",
    "owner:",
    "copyright",
    "results:",
    "events offered:",
    "[non-person]",
]


# =============================================================================
# DATA STRUCTURES
# =============================================================================


@dataclass
class Issue:
    severity: str   # hard | warn | info
    code: str
    message: str
    table: str = ""
    context: str = ""

    def format(self) -> str:
        parts = [f"[{self.severity.upper()}]", self.code]
        if self.table:
            parts.append(f"table={self.table}")
        parts.append(self.message)
        if self.context:
            parts.append(f"context={self.context}")
        return " | ".join(parts)


class IssueCollector:
    def __init__(self) -> None:
        self.issues: list[Issue] = []

    def add(self, severity: str, code: str, message: str, table: str = "", context: str = "") -> None:
        self.issues.append(Issue(severity, code, message, table, context))

    def hard(self, code: str, message: str, table: str = "", context: str = "") -> None:
        self.add("hard", code, message, table, context)

    def warn(self, code: str, message: str, table: str = "", context: str = "") -> None:
        self.add("warn", code, message, table, context)

    def info(self, code: str, message: str, table: str = "", context: str = "") -> None:
        self.add("info", code, message, table, context)

    def by_severity(self, severity: str) -> list[Issue]:
        return [i for i in self.issues if i.severity == severity]

    def counts(self) -> dict[str, int]:
        c = Counter(i.severity for i in self.issues)
        return {"hard": c.get("hard", 0), "warn": c.get("warn", 0), "info": c.get("info", 0)}

    def print_summary(self) -> None:
        counts = self.counts()
        print("\n=== QC GATE SUMMARY ===")
        print(f"hard_failures: {counts['hard']}")
        print(f"warnings:      {counts['warn']}")
        print(f"info:          {counts['info']}")

        for severity in ("hard", "warn", "info"):
            items = self.by_severity(severity)
            if not items:
                continue
            print(f"\n--- {severity.upper()} ISSUES ({len(items)}) ---")
            for issue in items[:200]:
                print(issue.format())
            if len(items) > 200:
                print(f"... {len(items) - 200} more {severity} issues omitted")

    def status(self) -> str:
        return "FAIL" if self.by_severity("hard") else "PASS"


# =============================================================================
# HELPERS
# =============================================================================


def read_csv_required(path: Path, required_cols: list[str], collector: IssueCollector, table_name: str) -> pd.DataFrame:
    if not path.exists():
        collector.hard("missing_file", f"Required file missing: {path}", table=table_name)
        return pd.DataFrame()

    try:
        df = pd.read_csv(path, dtype=str, keep_default_na=False)
    except Exception as e:
        collector.hard("csv_read_error", f"Failed to read {path}: {e}", table=table_name)
        return pd.DataFrame()

    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        collector.hard("missing_columns", f"Missing required columns: {missing}", table=table_name)

    return df


def normalize_text(x: object) -> str:
    if x is None:
        return ""
    return " ".join(str(x).strip().split())


def looks_non_person(s: str) -> bool:
    x = normalize_text(s).lower()
    return any(p in x for p in NON_PERSON_PATTERNS)


def print_detected_columns(name: str, df: pd.DataFrame) -> None:
    print(f"\n[{name}] columns:")
    for c in df.columns:
        print(f"  - {c}")


def safe_int_series(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce")


# =============================================================================
# CORE CHECKS
# =============================================================================


def check_events(events: pd.DataFrame, collector: IssueCollector) -> None:
    table = "events.csv"
    if events.empty:
        return

    for col in ["event_key"]:
        if col not in events.columns:
            collector.hard("missing_required_column", f"Missing required column: {col}", table=table)
            return

    dup = int(events.duplicated(subset=["event_key"]).sum())
    if dup:
        collector.hard("duplicate_event_key", f"{dup} duplicate event_key rows", table=table)

    for col in ["event_name", "year"]:
        if col in events.columns:
            blanks = int((events[col].astype(str).str.strip() == "").sum())
            if blanks:
                collector.hard("blank_required_field", f"{blanks} blank values in {col}", table=table)
        else:
            collector.warn("missing_recommended_column", f"Recommended column missing: {col}", table=table)


def check_event_disciplines(event_disciplines: pd.DataFrame, events: pd.DataFrame, collector: IssueCollector) -> None:
    table = "event_disciplines.csv"
    if event_disciplines.empty:
        return

    required = ["event_key", "discipline_key", "discipline_name", "team_type"]
    missing = [c for c in required if c not in event_disciplines.columns]
    if missing:
        collector.hard("missing_required_column", f"Missing required columns: {missing}", table=table)
        return

    dup = int(event_disciplines.duplicated(subset=["event_key", "discipline_key"]).sum())
    if dup:
        collector.hard("duplicate_event_discipline", f"{dup} duplicate (event_key, discipline_key) rows", table=table)

    valid_events = set(events["event_key"].astype(str).str.strip()) if not events.empty and "event_key" in events.columns else set()
    if valid_events:
        orphan = int((~event_disciplines["event_key"].astype(str).str.strip().isin(valid_events)).sum())
        if orphan:
            collector.hard("orphan_event_reference", f"{orphan} rows reference unknown event_key", table=table)

    bad_team_type = int((~event_disciplines["team_type"].astype(str).str.strip().isin(["singles", "doubles"])).sum())
    if bad_team_type:
        collector.warn("unexpected_team_type", f"{bad_team_type} rows have team_type outside singles/doubles", table=table)


def check_event_results(event_results: pd.DataFrame, event_disciplines: pd.DataFrame, collector: IssueCollector) -> None:
    table = "event_results.csv"
    if event_results.empty:
        return

    required = ["event_key", "discipline_key", "placement"]
    missing = [c for c in required if c not in event_results.columns]
    if missing:
        collector.hard("missing_required_column", f"Missing required columns: {missing}", table=table)
        return

    dup = int(event_results.duplicated(subset=["event_key", "discipline_key", "placement"]).sum())
    if dup:
        collector.hard("duplicate_event_result", f"{dup} duplicate (event_key, discipline_key, placement) rows", table=table)

    valid_disc = set()
    if not event_disciplines.empty and {"event_key", "discipline_key"}.issubset(event_disciplines.columns):
        valid_disc = set(
            zip(
                event_disciplines["event_key"].astype(str).str.strip(),
                event_disciplines["discipline_key"].astype(str).str.strip(),
            )
        )
    if valid_disc:
        pairs = list(
            zip(
                event_results["event_key"].astype(str).str.strip(),
                event_results["discipline_key"].astype(str).str.strip(),
            )
        )
        orphan = sum(1 for p in pairs if p not in valid_disc)
        if orphan:
            collector.hard("orphan_result_discipline", f"{orphan} event_results rows reference unknown (event_key, discipline_key)", table=table)

    placements = safe_int_series(event_results["placement"])
    bad_numeric = int(placements.isna().sum())
    if bad_numeric:
        collector.hard("non_numeric_placement", f"{bad_numeric} non-numeric placement values", table=table)

    tmp = event_results.copy()
    tmp["_placement_num"] = placements
    tmp = tmp.dropna(subset=["_placement_num"])

    gap_groups = 0
    for _, g in tmp.groupby(["event_key", "discipline_key"]):
        vals = sorted(set(int(x) for x in g["_placement_num"].tolist()))
        if not vals:
            continue
        if vals[0] != 1:
            gap_groups += 1
            continue
        expected = set(range(1, vals[-1] + 1))
        if set(vals) != expected:
            gap_groups += 1

    if gap_groups:
        collector.info("placement_gap_groups", f"{gap_groups} event-discipline groups have placement gaps (typically tie semantics: 1,1,3,3,5...)", table=table)


def check_event_result_participants(
    participants: pd.DataFrame,
    event_results: pd.DataFrame,
    event_disciplines: pd.DataFrame,
    persons: pd.DataFrame,
    collector: IssueCollector,
) -> None:
    table = "event_result_participants.csv"
    if participants.empty:
        return

    required = ["event_key", "discipline_key", "placement", "participant_order", "display_name", "person_id"]
    missing = [c for c in required if c not in participants.columns]
    if missing:
        collector.hard("missing_required_column", f"Missing required columns: {missing}", table=table)
        return

    dup_struct = int(
        participants.duplicated(subset=["event_key", "discipline_key", "placement", "participant_order"]).sum()
    )
    if dup_struct:
        collector.hard(
            "duplicate_participant_slot",
            f"{dup_struct} duplicate (event_key, discipline_key, placement, participant_order) rows",
            table=table,
        )

    # Only check duplicate person_id for rows with a non-empty person_id.
    # Empty person_id means "unresolved participant" — two unresolved players at
    # the same placement do NOT represent the same person, so they must not be
    # flagged as duplicates.
    resolved_participants = participants[
        participants["person_id"].fillna("").astype(str).str.strip() != ""
    ]
    dup_person_same_result = int(
        resolved_participants.duplicated(
            subset=["event_key", "discipline_key", "placement", "person_id"]
        ).sum()
    )
    if dup_person_same_result:
        collector.hard(
            "duplicate_participant_same_result",
            f"{dup_person_same_result} duplicate person_id within same result",
            table=table,
        )

    valid_results = set()
    if not event_results.empty and {"event_key", "discipline_key", "placement"}.issubset(event_results.columns):
        valid_results = set(
            zip(
                event_results["event_key"].astype(str).str.strip(),
                event_results["discipline_key"].astype(str).str.strip(),
                event_results["placement"].astype(str).str.strip(),
            )
        )
    if valid_results:
        refs = list(
            zip(
                participants["event_key"].astype(str).str.strip(),
                participants["discipline_key"].astype(str).str.strip(),
                participants["placement"].astype(str).str.strip(),
            )
        )
        orphan = sum(1 for r in refs if r not in valid_results)
        if orphan:
            collector.hard("orphan_result_reference", f"{orphan} participant rows reference unknown result", table=table)

    valid_person_ids = set(persons["person_id"].astype(str).str.strip()) if not persons.empty and "person_id" in persons.columns else set()
    if valid_person_ids:
        pids = participants["person_id"].astype(str).str.strip()
        # Exclude empty person_id (= unresolved/no-person-assigned) and __NON_PERSON__.
        # Only flag rows where a specific person_id was set but doesn't exist in persons.csv.
        orphan_person = int(
            ((~pids.isin(valid_person_ids)) & (pids != "__NON_PERSON__") & (pids != "")).sum()
        )
        if orphan_person:
            collector.hard("orphan_person_reference", f"{orphan_person} participant rows reference unknown person_id", table=table)

    # participant count by result vs team_type
    discipline_meta = {}
    if not event_disciplines.empty and {"event_key", "discipline_key", "team_type"}.issubset(event_disciplines.columns):
        for _, row in event_disciplines.iterrows():
            discipline_meta[(str(row["event_key"]).strip(), str(row["discipline_key"]).strip())] = str(row["team_type"]).strip()

    grouped = (
        participants.groupby(["event_key", "discipline_key", "placement"])
        .size()
        .reset_index(name="_participant_count")
    )

    singles_shared_place_count = 0
    for _, row in grouped.iterrows():
        key = (str(row["event_key"]).strip(), str(row["discipline_key"]).strip())
        team_type = discipline_meta.get(key, "")
        n = int(row["_participant_count"])

        if team_type == "singles" and n != 1:
            # Shared-place in singles: ties or pool-play. Aggregated to one INFO summary.
            singles_shared_place_count += 1
        elif team_type == "doubles" and n != 2:
            collector.hard(
                "invalid_doubles_participant_count",
                f"Doubles result has {n} participants; expected 2",
                table=table,
                context=f"event_key={row['event_key']} discipline_key={row['discipline_key']} placement={row['placement']}",
            )

    if singles_shared_place_count:
        collector.info(
            "team_row_in_singles_discipline",
            f"{singles_shared_place_count} singles result slots have multiple participants (shared-place ties or pool-play)",
            table=table,
        )

    bad_non_person = 0
    blank_display = 0
    for raw in participants["display_name"].astype(str):
        s = normalize_text(raw)
        if not s:
            blank_display += 1
            continue
        if looks_non_person(s):
            bad_non_person += 1

    if blank_display:
        collector.hard("blank_display_name", f"{blank_display} blank display_name values", table=table)
    if bad_non_person:
        collector.hard("non_person_artifact", f"{bad_non_person} display_name values look like metadata/non-person artifacts", table=table)


def check_persons(persons: pd.DataFrame, collector: IssueCollector) -> None:
    table = "persons.csv"
    if persons.empty:
        return

    required = ["person_id", "person_name"]
    missing = [c for c in required if c not in persons.columns]
    if missing:
        collector.hard("missing_required_column", f"Missing required columns: {missing}", table=table)
        return

    dup_pid = int(persons.duplicated(subset=["person_id"]).sum())
    if dup_pid:
        collector.hard("duplicate_person_id", f"{dup_pid} duplicate person_id rows", table=table)

    blanks = int((persons["person_name"].astype(str).str.strip() == "").sum())
    if blanks:
        collector.hard("blank_person_name", f"{blanks} blank person_name values", table=table)

    name_conflicts = 0
    for _, g in persons.groupby("person_id"):
        names = {str(x).strip() for x in g["person_name"] if str(x).strip()}
        if len(names) > 1:
            name_conflicts += 1
    if name_conflicts:
        collector.hard("person_name_conflict", f"{name_conflicts} person_id values map to multiple person_name values", table=table)


def check_cross_table_integrity(
    events: pd.DataFrame,
    event_disciplines: pd.DataFrame,
    event_results: pd.DataFrame,
    participants: pd.DataFrame,
    collector: IssueCollector,
) -> None:
    valid_events = set(events["event_key"].astype(str).str.strip()) if not events.empty and "event_key" in events.columns else set()

    if valid_events and not event_results.empty and "event_key" in event_results.columns:
        orphan = int((~event_results["event_key"].astype(str).str.strip().isin(valid_events)).sum())
        if orphan:
            collector.hard("event_results_orphan_event", f"{orphan} event_results rows reference unknown event_key", table="event_results.csv")

    if valid_events and not participants.empty and "event_key" in participants.columns:
        orphan = int((~participants["event_key"].astype(str).str.strip().isin(valid_events)).sum())
        if orphan:
            collector.hard("participants_orphan_event", f"{orphan} participant rows reference unknown event_key", table="event_result_participants.csv")


def check_stage2_support(stage2_df: pd.DataFrame, collector: IssueCollector) -> None:
    table = "stage2_canonical_events.csv"
    if stage2_df.empty:
        collector.warn("missing_stage2_support", "stage2_canonical_events.csv missing or unreadable; mirror-support checks skipped", table=table)
        return

    if "event_name" not in stage2_df.columns:
        collector.warn("stage2_missing_event_name", "No event_name column in stage2_canonical_events.csv", table=table)

    if "status" not in stage2_df.columns:
        collector.info("stage2_no_status", "No status column in stage2_canonical_events.csv; old quarantine-style checks skipped", table=table)


# =============================================================================
# OPTIONAL EXTERNAL CHECKS
# =============================================================================


def run_optional_check(root: Path, workbook_path: Path | None, item: dict, collector: IssueCollector, python_exe: str) -> None:
    script_path = root / item["path"]
    severity = item["severity"]
    name = item["name"]

    if not script_path.exists():
        collector.info("optional_check_missing", f"Optional script not found: {script_path}", table=name)
        return

    if item["needs_workbook"] and (workbook_path is None or not workbook_path.exists()):
        collector.warn("workbook_missing_for_optional_check", f"Skipped {name}; workbook not found", table=name)
        return

    cmd = [python_exe, str(script_path)]
    if name in {"workbook_qc", "qc3_hygiene"} and workbook_path is not None:
        cmd.append(str(workbook_path))

    print(f"\n=== RUN {name} ({severity}) ===")
    proc = subprocess.run(cmd, cwd=root, capture_output=True, text=True)

    if proc.stdout:
        print(proc.stdout.rstrip())
    if proc.stderr:
        print(proc.stderr.rstrip())

    if proc.returncode != 0:
        if severity == "hard":
            collector.hard("optional_check_failed", f"{name} returned exit code {proc.returncode}", table=name)
        elif severity == "warn":
            collector.warn("optional_check_failed", f"{name} returned exit code {proc.returncode}", table=name)
        else:
            collector.info("optional_check_failed", f"{name} returned exit code {proc.returncode}", table=name)


# =============================================================================
# MAIN
# =============================================================================


def main() -> int:
    parser = argparse.ArgumentParser(description="Run authoritative QC gate for Footbag canonical dataset.")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="Project root")
    parser.add_argument("--canonical-dir", type=Path, default=DEFAULT_CANONICAL_DIR, help="Canonical CSV directory")
    parser.add_argument("--stage2-events", type=Path, default=DEFAULT_STAGE2_EVENTS, help="Stage2 canonical events CSV")
    parser.add_argument("--workbook", type=Path, default=DEFAULT_WORKBOOK, help="Community workbook path")
    parser.add_argument("--python", default=sys.executable, help="Python executable for optional checks")
    parser.add_argument("--skip-optional", action="store_true", help="Skip optional external QC scripts")
    parser.add_argument("--print-columns", action="store_true", help="Print detected CSV columns")
    args = parser.parse_args()

    root = args.root.resolve()
    canonical_dir = args.canonical_dir.resolve()
    stage2_events_path = args.stage2_events.resolve()
    workbook_path = args.workbook.resolve() if args.workbook else None

    collector = IssueCollector()

    if not canonical_dir.exists():
        print(f"ERROR: canonical directory not found: {canonical_dir}", file=sys.stderr)
        return 2

    events = read_csv_required(canonical_dir / "events.csv", [], collector, "events.csv")
    event_disciplines = read_csv_required(canonical_dir / "event_disciplines.csv", [], collector, "event_disciplines.csv")
    event_results = read_csv_required(canonical_dir / "event_results.csv", [], collector, "event_results.csv")
    participants = read_csv_required(canonical_dir / "event_result_participants.csv", [], collector, "event_result_participants.csv")
    persons = read_csv_required(canonical_dir / "persons.csv", [], collector, "persons.csv")

    stage2_df = pd.DataFrame()
    if stage2_events_path.exists():
        try:
            stage2_df = pd.read_csv(stage2_events_path, dtype=str, keep_default_na=False)
        except Exception as e:
            collector.warn("stage2_read_error", f"Failed to read {stage2_events_path}: {e}", table="stage2_canonical_events.csv")

    if args.print_columns:
        print_detected_columns("events.csv", events)
        print_detected_columns("event_disciplines.csv", event_disciplines)
        print_detected_columns("event_results.csv", event_results)
        print_detected_columns("event_result_participants.csv", participants)
        print_detected_columns("persons.csv", persons)

    print("=== RUN canonical_csv_checks ===")
    check_events(events, collector)
    check_event_disciplines(event_disciplines, events, collector)
    check_event_results(event_results, event_disciplines, collector)
    check_event_result_participants(participants, event_results, event_disciplines, persons, collector)
    check_persons(persons, collector)
    check_cross_table_integrity(events, event_disciplines, event_results, participants, collector)

    print("\n=== RUN stage2_support_checks ===")
    check_stage2_support(stage2_df, collector)

    if not args.skip_optional:
        for item in OPTIONAL_CHECKS:
            run_optional_check(root, workbook_path, item, collector, args.python)

    collector.print_summary()
    print(f"\nQC STATUS: {collector.status()}")
    return 1 if collector.status() == "FAIL" else 0


if __name__ == "__main__":
    raise SystemExit(main())
