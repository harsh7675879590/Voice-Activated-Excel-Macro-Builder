"""
Dry-Run Engine — Executes validated code against a CLONED in-memory copy
of the target DataFrame. Never touches the live data.

Computes a before/after diff and returns it for user preview and approval.
Only on explicit user confirmation does the execution runtime re-execute
the SAME validated code against the live object.
"""

from __future__ import annotations

import logging
from typing import Optional

import pandas as pd

from backend.models.schemas import DiffResult, ValidationResult
from backend.core.ast_validator import ASTSafetyValidator
from backend.utils.diff_engine import compute_diff

logger = logging.getLogger(__name__)


class DryRunEngine:
    """
    Sandboxed execution engine.
    
    1. Deep-clones the target DataFrame
    2. Executes validated code in a restricted namespace
    3. Computes cell-level diff
    4. Returns the diff without modifying the original data
    """

    # Minimal safe builtins — no file I/O, no eval, no imports
    SAFE_BUILTINS = {
        "len": len,
        "round": round,
        "sum": sum,
        "min": min,
        "max": max,
        "abs": abs,
        "int": int,
        "float": float,
        "str": str,
        "bool": bool,
        "list": list,
        "dict": dict,
        "tuple": tuple,
        "set": set,
        "sorted": sorted,
        "reversed": reversed,
        "enumerate": enumerate,
        "zip": zip,
        "range": range,
        "isinstance": isinstance,
        "type": type,
        "print": print,  # Allow print for debugging
        "True": True,
        "False": False,
        "None": None,
    }

    def __init__(self):
        self.last_result: Optional[pd.DataFrame] = None
        self.last_diff: Optional[DiffResult] = None
        self.last_code: Optional[str] = None

    def execute_dry_run(
        self,
        code: str,
        df: pd.DataFrame,
        validation: Optional[ValidationResult] = None,
    ) -> tuple[DiffResult, pd.DataFrame]:
        """
        Execute code against a cloned DataFrame and return the diff.
        
        Args:
            code: Validated Python/Pandas code to execute
            df: The original DataFrame (will NOT be modified)
            validation: Optional pre-computed validation result
            
        Returns:
            Tuple of (DiffResult, result_df)
            
        Raises:
            ValueError: If validation fails
            RuntimeError: If execution fails in sandbox
        """
        # Re-validate if no prior validation provided
        if validation is None:
            validator = ASTSafetyValidator()
            validation = validator.validate(code)

        if not validation.is_safe:
            violations_str = "; ".join(v.message for v in validation.violations)
            raise ValueError(f"Code failed safety validation: {violations_str}")

        # Deep clone the DataFrame — this is the core safety guarantee
        cloned_df = df.copy(deep=True)

        # Build restricted execution namespace
        import numpy as np
        local_ns = {
            "df": cloned_df,
            "pd": pd,
            "np": np,
        }

        # Execute in sandbox with restricted builtins
        try:
            exec(code, {"__builtins__": self.SAFE_BUILTINS}, local_ns)
        except Exception as e:
            raise RuntimeError(
                f"Code execution failed in sandbox: {type(e).__name__}: {e}"
            )

        # Extract result
        result_df = local_ns.get("result")
        if result_df is None:
            # If no 'result' variable, use the (possibly modified) 'df'
            result_df = local_ns.get("df", cloned_df)

        # Ensure result is a DataFrame
        if isinstance(result_df, pd.Series):
            result_df = result_df.to_frame()
        elif not isinstance(result_df, pd.DataFrame):
            # Wrap scalar or other types
            result_df = pd.DataFrame({"result": [result_df]})

        # Compute diff between original and result
        diff = compute_diff(df, result_df)

        # Cache for later execution
        self.last_result = result_df
        self.last_diff = diff
        self.last_code = code

        logger.info(
            f"Dry run complete: {diff.rows_added} added, "
            f"{diff.rows_removed} removed, {diff.cells_modified} modified"
        )

        return diff, result_df

    def get_last_result(self) -> Optional[pd.DataFrame]:
        """Retrieve the last dry-run result DataFrame."""
        return self.last_result

    def get_last_diff(self) -> Optional[DiffResult]:
        """Retrieve the last dry-run diff."""
        return self.last_diff

    def get_last_code(self) -> Optional[str]:
        """Retrieve the last validated code that was dry-run."""
        return self.last_code
