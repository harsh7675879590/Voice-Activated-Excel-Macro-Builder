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
    Compute a structured diff between two DataFrames.
    Returns cell-level changes and summary statistics.
    """
    changes: list[CellDiff] = []

    rows_before = len(before)
    rows_after = len(after)

    # Handle completely different column sets
    all_cols = sorted(set(list(before.columns) + list(after.columns)))

    # Align DataFrames for comparison
    before_aligned = before.reindex(columns=all_cols).reset_index(drop=True)
    after_aligned = after.reindex(columns=all_cols).reset_index(drop=True)

    rows_added = 0
    rows_removed = 0
    cells_modified = 0

    # Compare row by row up to the minimum length
    min_rows = min(len(before_aligned), len(after_aligned))

    for i in range(min_rows):
        for col in all_cols:
            old_val = before_aligned.iloc[i].get(col)
            new_val = after_aligned.iloc[i].get(col)

            old_str = _safe_str(old_val)
            new_str = _safe_str(new_val)

            if old_str != new_str:
                cells_modified += 1
                changes.append(CellDiff(
                    row=i,
                    column=col,
                    old_value=old_str,
                    new_value=new_str,
                    diff_type=DiffType.MODIFIED,
                ))

    # Handle added rows
    if len(after_aligned) > len(before_aligned):
        extra_rows = len(after_aligned) - len(before_aligned)
        rows_added = extra_rows
        for i in range(len(before_aligned), len(after_aligned)):
            for col in all_cols:
                new_val = after_aligned.iloc[i].get(col)
                changes.append(CellDiff(
                    row=i,
                    column=col,
                    old_value=None,
                    new_value=_safe_str(new_val),
                    diff_type=DiffType.ADDED,
                ))

    # Handle removed rows
    if len(before_aligned) > len(after_aligned):
        extra_rows = len(before_aligned) - len(after_aligned)
        rows_removed = extra_rows
        for i in range(len(after_aligned), len(before_aligned)):
            for col in all_cols:
                old_val = before_aligned.iloc[i].get(col)
                changes.append(CellDiff(
                    row=i,
                    column=col,
                    old_value=_safe_str(old_val),
                    new_value=None,
                    diff_type=DiffType.REMOVED,
                ))

    # New columns
    new_cols = set(after.columns) - set(before.columns)
    for col in new_cols:
        for i in range(min(len(after_aligned), MAX_PREVIEW_ROWS)):
            val = after_aligned.iloc[i].get(col)
            if val is not None and not (isinstance(val, float) and np.isnan(val)):
                changes.append(CellDiff(
                    row=i,
                    column=col,
                    old_value=None,
                    new_value=_safe_str(val),
                    diff_type=DiffType.ADDED,
                ))

    # Build preview data (limited rows)
    preview_before = _df_to_preview(before, MAX_PREVIEW_ROWS)
    preview_after = _df_to_preview(after, MAX_PREVIEW_ROWS)

    return DiffResult(
        total_rows_before=rows_before,
        total_rows_after=rows_after,
        rows_added=rows_added,
        rows_removed=rows_removed,
        cells_modified=cells_modified,
        changes=changes[:500],  # Cap changes for large diffs
        preview_before=preview_before,
        preview_after=preview_after,
    )


def _safe_str(val) -> Optional[str]:
    """Convert a value to string, handling NaN/None gracefully."""
    if val is None:
        return None
    if isinstance(val, float) and np.isnan(val):
        return None
    return str(val)


def _df_to_preview(df: pd.DataFrame, max_rows: int) -> list[dict]:
    """Convert a DataFrame to a list of dicts for JSON serialization."""
    preview_df = df.head(max_rows)
    records = []
    for _, row in preview_df.iterrows():
        record = {}
        for col in preview_df.columns:
            val = row[col]
            record[str(col)] = _safe_str(val)
        records.append(record)
    return records
