"""
Diff Engine — Computes cell-level and row-level deltas between two DataFrames.
Used by the dry-run engine to show a before/after preview.
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np
import pandas as pd

from backend.models.schemas import CellDiff, DiffResult, DiffType

logger = logging.getLogger(__name__)

MAX_PREVIEW_ROWS = 50  # Max rows to include in the preview payload


def compute_diff(before: pd.DataFrame, after: pd.DataFrame) -> DiffResult:
    """
    Compute a structured diff between two DataFrames with fast vectorized comparison.
    Returns cell-level changes and summary statistics.
    """
    changes: list[CellDiff] = []

    rows_before = len(before)
    rows_after = len(after)

    # Convert columns list while preserving order
    all_cols = list(dict.fromkeys(list(before.columns) + list(after.columns)))

    # Align DataFrames for comparison
    before_aligned = before.reindex(columns=all_cols).reset_index(drop=True)
    after_aligned = after.reindex(columns=all_cols).reset_index(drop=True)

    rows_added = max(0, rows_after - rows_before)
    rows_removed = max(0, rows_before - rows_after)
    cells_modified = 0

    min_rows = min(rows_before, rows_after)

    # Fast row-by-row check on converted string arrays
    if min_rows > 0 and len(all_cols) > 0:
        b_sub = before_aligned.iloc[:min_rows]
        a_sub = after_aligned.iloc[:min_rows]

        for col in all_cols:
            b_col_vals = b_sub[col].values
            a_col_vals = a_sub[col].values

            for i in range(min_rows):
                old_val = b_col_vals[i]
                new_val = a_col_vals[i]

                old_str = _safe_str(old_val)
                new_str = _safe_str(new_val)

                if old_str != new_str:
                    cells_modified += 1
                    if len(changes) < 500:
                        changes.append(CellDiff(
                            row=i,
                            column=str(col),
                            old_value=old_str,
                            new_value=new_str,
                            diff_type=DiffType.MODIFIED,
                        ))

    # Handle added rows
    if rows_after > rows_before:
        for i in range(rows_before, rows_after):
            for col in all_cols:
                if len(changes) >= 500:
                    break
                val = after_aligned.at[i, col] if col in after_aligned.columns else None
                changes.append(CellDiff(
                    row=i,
                    column=str(col),
                    old_value=None,
                    new_value=_safe_str(val),
                    diff_type=DiffType.ADDED,
                ))

    # Handle removed rows
    if rows_before > rows_after:
        for i in range(rows_after, rows_before):
            for col in all_cols:
                if len(changes) >= 500:
                    break
                val = before_aligned.at[i, col] if col in before_aligned.columns else None
                changes.append(CellDiff(
                    row=i,
                    column=str(col),
                    old_value=_safe_str(val),
                    new_value=None,
                    diff_type=DiffType.REMOVED,
                ))

    # Build preview data (first MAX_PREVIEW_ROWS)
    preview_before = _df_to_preview(before, MAX_PREVIEW_ROWS)
    preview_after = _df_to_preview(after, MAX_PREVIEW_ROWS)

    return DiffResult(
        total_rows_before=rows_before,
        total_rows_after=rows_after,
        rows_added=rows_added,
        rows_removed=rows_removed,
        cells_modified=cells_modified,
        changes=changes[:500],
        preview_before=preview_before,
        preview_after=preview_after,
    )


def _safe_str(val) -> Optional[str]:
    """Convert a value to string, handling NaN/None gracefully."""
    if val is None or (isinstance(val, float) and np.isnan(val)) or pd.isna(val):
        return None
    if isinstance(val, (pd.Timestamp, np.datetime64)):
        return pd.to_datetime(val).strftime("%Y-%m-%d")
    return str(val)


def _df_to_preview(df: pd.DataFrame, max_rows: int) -> list[dict]:
    """Convert a DataFrame to a list of dicts for JSON serialization."""
    if df is None or len(df) == 0:
        return []
    preview_df = df.head(max_rows)
    records = []
    columns = [str(c) for c in preview_df.columns]
    for _, row in preview_df.iterrows():
        record = {}
        for col in columns:
            record[col] = _safe_str(row.get(col))
        records.append(record)
    return records

