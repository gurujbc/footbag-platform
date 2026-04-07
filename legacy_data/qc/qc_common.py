from __future__ import annotations
from pathlib import Path
import sys
import pandas as pd

ROOT = Path(".")
OUT = ROOT / "out"
QCDIR = OUT / "qc"

PLACEMENTS = OUT / "Placements_ByPerson.csv"
PERSONS = OUT / "Persons_Truth.csv"

def ensure_dirs() -> None:
    QCDIR.mkdir(parents=True, exist_ok=True)

def load_csv(path: Path, dtype=str) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Missing required file: {path}")
    return pd.read_csv(path, dtype=dtype).fillna("")

def write_csv(df: pd.DataFrame, name: str) -> Path:
    ensure_dirs()
    p = QCDIR / name
    df.to_csv(p, index=False)
    return p

def fail(msg: str, code: int = 2) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)

def ok(msg: str = "OK") -> None:
    print(msg)
