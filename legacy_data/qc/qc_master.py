#!/usr/bin/env python3
"""
qc_master.py — Master QC Orchestrator

This module consolidates ALL QC checks across all pipeline stages.
It separates QC concerns from main pipeline logic for better token management.

Usage from main scripts:
    from qc_master import run_qc_for_stage

    # In 02_canonicalize_results.py:
    qc_summary, qc_issues = run_qc_for_stage("stage2", canonical_records)

    # In 03_build_excel.py:
    qc_summary, qc_issues = run_qc_for_stage("stage3", records, results_map)

Architecture:
- Stage 1: Extraction QC (raw HTML → structured)
- Stage 2: Canonicalization QC (field validation + slop detection)
- Stage 3: Output QC (Excel cell scanning)

All checks return (summary_dict, issues_list) tuples.
Issues are written to out/stage{N}_qc_{summary.json, issues.jsonl}
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[1]

# Import stage-specific check modules
# These contain the actual check functions to keep this orchestrator lean
try:
    # Import Stage 2 checks from existing 02_canonicalize_results.py
    # We'll keep them there for now to avoid breaking changes
    from typing import TYPE_CHECKING
    if TYPE_CHECKING:
        pass  # Will refactor later
except ImportError:
    pass

# Slop detection is optional. Repo may omit it.
try:
    from qc_slop_detection import (
        run_slop_detection_checks_stage2,
        run_slop_detection_checks_stage3_excel,
        QCIssue,
    )
except Exception as e:
    run_slop_detection_checks_stage2 = None
    run_slop_detection_checks_stage3_excel = None
    _SLOP_IMPORT_ERROR = e

    class QCIssue:
        """Stub when qc_slop_detection is not available."""
        def __init__(self, check_id="", severity="ERROR", event_id="", field="", message="", example_value="", context=None):
            self.check_id = check_id
            self.severity = severity
            self.event_id = event_id
            self.field = field
            self.message = message
            self.example_value = example_value or ""
            self.context = context or {}

        def to_dict(self):
            return {"check_id": self.check_id, "severity": self.severity, "event_id": self.event_id, "field": self.field, "message": self.message, "example_value": self.example_value, "context": self.context}
else:
    _SLOP_IMPORT_ERROR = None


# ============================================================
# QC ORCHESTRATION - Master Entry Point
# ============================================================

def run_qc_for_stage(
    stage: str,
    records: list[dict],
    results_map: dict = None,
    players_by_id: dict = None,
    out_dir: Path = None,
) -> tuple[dict, list]:
    """
    Master QC orchestrator - runs ALL checks for a given stage.

    Args:
        stage: "stage1", "stage2", or "stage3"
        records: List of event records (format varies by stage)
        results_map: Dict[event_id -> results_text] (Stage 3 only)
        players_by_id: Dict[player_id -> {player_name_clean, ...}] (Stage 3 only, optional)
        out_dir: Output directory for QC artifacts (default: ./out)

    Returns:
        (summary_dict, issues_list) tuple

    Side effects:
        Writes out/stage{N}_qc_summary.json
        Writes out/stage{N}_qc_issues.jsonl
    """
    if out_dir is None:
        out_dir = Path("out")
    out_dir.mkdir(parents=True, exist_ok=True)

    # Route to stage-specific orchestrator
    if stage == "stage1":
        return run_stage1_qc(records, out_dir)
    elif stage == "stage2":
        return run_stage2_qc(records, out_dir)
    elif stage == "stage3":
        if results_map is None:
            raise ValueError("Stage 3 QC requires results_map parameter")
        return run_stage3_qc(records, results_map, out_dir, players_by_id=players_by_id)
    else:
        raise ValueError(f"Unknown stage: {stage}. Must be stage1, stage2, or stage3")


# ============================================================
# STAGE 1 QC - Extraction Quality
# ============================================================

def run_stage1_qc(records: list[dict], out_dir: Path) -> tuple[dict, list]:
    """
    Stage 1 QC: Validate extraction from HTML mirror.

    Checks:
    - All events have event_id
    - Event names extracted
    - Source HTML quality markers
    - Extraction completeness

    Note: Stage 1 currently has minimal QC.
    Most validation happens in Stage 2 after canonicalization.
    """
    all_issues = []

    # Basic extraction checks
    for rec in records:
        event_id = rec.get("event_id", "")

        # Check event_id exists
        if not event_id:
            all_issues.append(QCIssue(
                check_id="stage1_missing_event_id",
                severity="ERROR",
                event_id="UNKNOWN",
                field="event_id",
                message="Extracted record missing event_id",
                example_value=str(rec)[:100],
            ))

        # Check event_name exists (accept Stage 1 or Stage 2 naming)
        event_name = (rec.get("event_name_raw") or rec.get("event_name") or "").strip()
        if not event_name:
            all_issues.append(QCIssue(
                check_id="stage1_missing_event_name",
                severity="WARN",
                event_id=str(event_id),
                field="event_name_raw",
                message="Extracted record missing event_name",
            ))

        # Check if source HTML was readable (accept Stage 1 or Stage 2 naming)
        results_raw = (rec.get("results_block_raw") or rec.get("results_raw") or "").strip()
        # Stage 1 doesn't have has_results_page; infer from core fields if available
        has_core = bool((rec.get("location_raw") or rec.get("location")) or (rec.get("date_raw") or rec.get("date")))
        if not results_raw and has_core:
            all_issues.append(QCIssue(
                check_id="stage1_empty_results",
                severity="INFO",
                event_id=str(event_id),
                field="results_raw",
                message="Event has core fields but results block is empty",
            ))

    # Build summary
    summary, issues_dicts = _build_summary_and_issues("stage1", records, all_issues)

    # Write outputs
    _write_qc_outputs(summary, issues_dicts, out_dir, "stage1")

    return summary, issues_dicts


# ============================================================
# STAGE 2 QC - Canonicalization + Slop Detection
# ============================================================

def run_stage2_qc(records: list[dict], out_dir: Path) -> tuple[dict, list]:
    """
    Stage 2 QC: Comprehensive validation after canonicalization.

    Checks:
    - Field validation (required fields, formats, ranges)
    - Semantic validation (event_type consistency, division categories)
    - Cross-validation (expected divisions, team splitting, duplicates)
    - Slop detection (URLs, control chars, HTML remnants, whitespace)
    - Data integrity (duplicate rows, dropped results)

    This is the main QC stage where most issues are detected.
    """
    all_issues = []

    # Import Stage 2 checks from the main canonicalization module by file path
    # (module name "02_canonicalize_results" is invalid for import_module)
    from importlib.util import spec_from_file_location, module_from_spec

    stage2_path = REPO_ROOT / "pipeline" / "02_canonicalize_results.py"
    if stage2_path.exists():
        spec = spec_from_file_location("stage2_canonicalize_results", stage2_path)
        canon_module = module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(canon_module)
    else:
        raise FileNotFoundError(f"Missing Stage 2 module at {stage2_path}")

    try:
        # Get existing Stage 2 checks
        # These include: field validation, semantic checks, cross-validation
        existing_checks = [
            'check_event_id',
            'check_event_name',
            'check_event_type',
            'check_location',
            'check_date',
            'check_year',
            'check_host_club',
            'check_placements_json',
            'check_results_extraction',
            'check_string_hygiene',
            'check_event_name_quality',
            'check_year_range',
            'check_missing_required_fields',
            'check_location_semantics',
            'check_date_semantics',
            'check_host_club_semantics',
            'check_country_names',
            'check_field_leakage',
            'check_player_name_quality',
            'check_division_name_quality',
            'check_place_values',
            'check_place_sequences',
            'check_expected_divisions',
            'check_division_quality',
            'check_division_canon_looks_like_placement_line',
            'check_team_splitting',
            'check_year_date_consistency',
            'check_event_id_uniqueness',
            'check_worlds_per_year',
            'check_duplicates',
            'check_host_club_location_consistency',
        ]

        # Run all existing checks
        for rec in records:
            for check_name in existing_checks:
                if check_name in ['check_event_id_uniqueness', 'check_worlds_per_year',
                                 'check_duplicates', 'check_host_club_location_consistency']:
                    # These are cross-record checks, run once
                    if rec is records[0]:  # Only run on first record
                        check_func = getattr(canon_module, check_name)
                        all_issues.extend(check_func(records))
                else:
                    # Per-record checks
                    if hasattr(canon_module, check_name):
                        check_func = getattr(canon_module, check_name)
                        all_issues.extend(check_func(rec))

    except (ImportError, AttributeError) as e:
        # If import fails, continue with just slop detection
        print(f"Warning: Could not import existing checks: {e}")

    # Add new slop detection checks
    if run_slop_detection_checks_stage2 is None:
        # optional: log once
        # print(f"[QC] INFO: slop detection disabled ({_SLOP_IMPORT_ERROR})")
        slop_issues = []
    else:
        slop_issues = run_slop_detection_checks_stage2(records)
    all_issues.extend(slop_issues)

    # Build summary
    summary, issues_dicts = _build_summary_and_issues("stage2", records, all_issues)

    # Write outputs
    _write_qc_outputs(summary, issues_dicts, out_dir, "stage2")

    return summary, issues_dicts


# ============================================================
# STAGE 3 QC - Excel Output Quality
# ============================================================

def run_stage3_qc(
    records: list[dict],
    results_map: dict,
    out_dir: Path,
    players_by_id: dict = None,
) -> tuple[dict, list]:
    """
    Stage 3 QC: Validate final Excel output.

    Checks:
    - Results cell duplicate lines
    - Results cell roundtrip integrity (all placements appear)
    - Results cell near Excel char limit (32,767)
    - Global slop detection on Results cells
    - All spreadsheet cells scanned for corruption

    Args:
        records: List of canonical event records
        results_map: Dict mapping event_id -> formatted results text
        players_by_id: Dict mapping player_id -> {player_name_clean} (optional, improves roundtrip check)
    """
    all_issues = []

    # Run slop detection on Excel cells
    if run_slop_detection_checks_stage3_excel is None:
        slop_issues = []
    else:
        slop_issues = run_slop_detection_checks_stage3_excel(
            records, results_map, players_by_id=players_by_id
        )
    all_issues.extend(slop_issues)

    # Build summary
    summary, issues_dicts = _build_summary_and_issues("stage3", records, all_issues)

    # Write outputs
    _write_qc_outputs(summary, issues_dicts, out_dir, "stage3")

    return summary, issues_dicts


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def _build_summary_and_issues(
    stage: str,
    records: list[dict],
    all_issues: list[QCIssue]
) -> tuple[dict, list[dict]]:
    """Build summary dict and convert issues to dicts."""

    # Convert QCIssue objects to dicts
    issues_dicts = []
    for issue in all_issues:
        if hasattr(issue, 'to_dict'):
            issues_dicts.append(issue.to_dict())
        elif isinstance(issue, dict):
            issues_dicts.append(issue)
        else:
            # Fallback for unexpected types
            issues_dicts.append({
                "check_id": "unknown",
                "severity": "ERROR",
                "event_id": "",
                "field": "",
                "message": str(issue),
            })

    # Count by severity and check_id
    counts_by_check = defaultdict(lambda: {"ERROR": 0, "WARN": 0, "INFO": 0})
    for issue in issues_dicts:
        check_id = issue.get("check_id", "unknown")
        severity = issue.get("severity", "ERROR")
        counts_by_check[check_id][severity] += 1

    total_errors = sum(1 for i in issues_dicts if i.get("severity") == "ERROR")
    total_warnings = sum(1 for i in issues_dicts if i.get("severity") == "WARN")
    total_info = sum(1 for i in issues_dicts if i.get("severity") == "INFO")

    summary = {
        "stage": stage,
        "total_records": len(records),
        "total_errors": total_errors,
        "total_warnings": total_warnings,
        "total_info": total_info,
        "counts_by_check": dict(counts_by_check),
    }

    return summary, issues_dicts


def _write_qc_outputs(
    summary: dict,
    issues: list[dict],
    out_dir: Path,
    stage: str
) -> None:
    """Write QC summary and issues to output files."""

    # Write summary JSON
    summary_path = out_dir / f"{stage}_qc_summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"Wrote: {summary_path}")

    # Write issues JSONL
    issues_path = out_dir / f"{stage}_qc_issues.jsonl"
    with open(issues_path, "w", encoding="utf-8") as f:
        for issue in issues:
            f.write(json.dumps(issue, ensure_ascii=False) + "\n")
    print(f"Wrote: {issues_path} ({len(issues)} issues)")


# ============================================================
# BASELINE MANAGEMENT
# ============================================================

def load_baseline(data_dir: Path, stage: str) -> Optional[dict]:
    """Load QC baseline if it exists."""
    baseline_path = data_dir / f"qc_baseline_{stage}.json"
    if baseline_path.exists():
        with open(baseline_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def save_baseline(summary: dict, data_dir: Path, stage: str) -> None:
    """Save QC summary as baseline."""
    data_dir.mkdir(parents=True, exist_ok=True)
    baseline_path = data_dir / f"qc_baseline_{stage}.json"
    with open(baseline_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"Saved baseline: {baseline_path}")


def print_qc_delta(current: dict, baseline: dict, stage: str) -> bool:
    """
    Print delta between current and baseline QC results.
    Returns True if no regressions (ERROR increases), False otherwise.
    """
    print(f"\n{'='*60}")
    print(f"QC DELTA REPORT ({stage} vs baseline)")
    print(f"{'='*60}")

    baseline_checks = baseline.get("counts_by_check", {})
    current_checks = current.get("counts_by_check", {})

    all_checks = set(baseline_checks.keys()) | set(current_checks.keys())
    regressions = []

    for check_id in sorted(all_checks):
        b = baseline_checks.get(check_id, {"ERROR": 0, "WARN": 0, "INFO": 0})
        c = current_checks.get(check_id, {"ERROR": 0, "WARN": 0, "INFO": 0})

        b_err, b_warn, b_info = b.get("ERROR", 0), b.get("WARN", 0), b.get("INFO", 0)
        c_err, c_warn, c_info = c.get("ERROR", 0), c.get("WARN", 0), c.get("INFO", 0)

        err_delta = c_err - b_err
        warn_delta = c_warn - b_warn
        info_delta = c_info - b_info

        if err_delta != 0 or warn_delta != 0 or info_delta != 0:
            err_sign = "+" if err_delta > 0 else ""
            warn_sign = "+" if warn_delta > 0 else ""
            info_sign = "+" if info_delta > 0 else ""
            print(f"  {check_id}:")
            if err_delta != 0:
                print(f"    ERROR: {b_err} -> {c_err} ({err_sign}{err_delta})")
            if warn_delta != 0:
                print(f"    WARN:  {b_warn} -> {c_warn} ({warn_sign}{warn_delta})")
            if info_delta != 0:
                print(f"    INFO:  {b_info} -> {c_info} ({info_sign}{info_delta})")

            if err_delta > 0:
                regressions.append(check_id)

    if not regressions and all_checks:
        # Check for any changes
        has_changes = any(
            baseline_checks.get(c, {}) != current_checks.get(c, {})
            for c in all_checks
        )
        if not has_changes:
            print("  No changes from baseline.")

    print(f"\nTotal: {baseline.get('total_errors', 0)} -> {current.get('total_errors', 0)} errors, "
          f"{baseline.get('total_warnings', 0)} -> {current.get('total_warnings', 0)} warnings")

    if regressions:
        print(f"\n⚠️  REGRESSIONS DETECTED in: {regressions}")
        print(f"{'='*60}\n")
        return False

    print(f"{'='*60}\n")
    return True


# ============================================================
# SUMMARY REPORTING
# ============================================================

def print_qc_summary(summary: dict, stage: str) -> None:
    """Print human-readable QC summary."""
    print(f"\n{'='*60}")
    print(f"QC SUMMARY - {stage.upper()}")
    print(f"{'='*60}")
    print(f"Total records: {summary.get('total_records', 0)}")
    print(f"Total errors:  {summary.get('total_errors', 0)}")
    print(f"Total warnings: {summary.get('total_warnings', 0)}")
    print(f"Total info:     {summary.get('total_info', 0)}")

    counts_by_check = summary.get("counts_by_check", {})
    if counts_by_check:
        print(f"\nIssues by check:")
        for check_id in sorted(counts_by_check.keys()):
            counts = counts_by_check[check_id]
            err = counts.get("ERROR", 0)
            warn = counts.get("WARN", 0)
            info = counts.get("INFO", 0)
            if err + warn + info > 0:
                parts = []
                if err: parts.append(f"{err} ERROR")
                if warn: parts.append(f"{warn} WARN")
                if info: parts.append(f"{info} INFO")
                print(f"  {check_id}: {', '.join(parts)}")

    print(f"{'='*60}\n")
