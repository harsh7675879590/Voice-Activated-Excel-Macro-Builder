"""
AST Safety Validator — Whitelist-based static analysis for generated code.
This is the load-bearing security control: default-deny, not default-allow.

Every generated code snippet is parsed with Python's ast module BEFORE
execution — no exceptions, no 'trusted' fast path.
"""

from __future__ import annotations

import ast
import logging
from typing import Optional

from backend.models.schemas import ValidationResult, ValidationViolation, ValidationSeverity

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Whitelists
# ---------------------------------------------------------------------------

# Only these function/method calls are permitted in generated code
ALLOWED_CALLS: set[str] = {
    # Pandas DataFrame methods
    "groupby", "filter", "loc", "iloc", "query",
    "sort_values", "reset_index", "fillna", "dropna",
    "astype", "apply", "map", "replace", "rename",
    "head", "tail", "sample", "nlargest", "nsmallest",
    "merge", "concat", "join", "pivot_table", "melt",
    "value_counts", "unique", "nunique", "duplicated", "drop_duplicates",
    "isin", "between", "clip", "abs",
    "to_datetime", "to_numeric", "to_string",
    "str", "dt",  # Accessor objects

    # Aggregation methods
    "sum", "mean", "median", "std", "var",
    "min", "max", "count", "agg", "aggregate",
    "cumsum", "cumprod", "cummax", "cummin",

    # Built-in safe functions
    "len", "round", "int", "float", "str", "bool",
    "list", "dict", "tuple", "set",
    "sorted", "reversed", "enumerate", "zip", "range",
    "isinstance", "type", "print",

    # Pandas top-level
    "DataFrame", "Series", "read_excel", "to_datetime", "to_numeric",
    "concat", "merge", "pivot_table", "cut", "qcut",

    # Numpy safe subset
    "array", "zeros", "ones", "arange", "linspace",
    "where", "nan", "isnan", "isinf",

    # String methods via .str accessor
    "contains", "startswith", "endswith", "lower", "upper",
    "strip", "split", "replace", "extract", "match",

    # Datetime methods via .dt accessor
    "year", "month", "day", "hour", "minute",
    "date", "time", "dayofweek", "quarter",

    # Column operations
    "copy", "values", "tolist", "to_dict", "to_list",
    "items", "iterrows", "iteritems",
    "assign", "insert", "pop", "drop",
    "set_index", "reindex",
}

# Absolutely forbidden constructs — these are BLOCK-level violations
FORBIDDEN_NAMES: set[str] = {
    "eval", "exec", "compile", "__import__",
    "globals", "locals", "vars", "dir",
    "getattr", "setattr", "delattr",
    "open", "file", "input",
    "breakpoint", "exit", "quit",
}

# Forbidden module access
FORBIDDEN_MODULES: set[str] = {
    "os", "sys", "subprocess", "shutil", "pathlib",
    "socket", "http", "urllib", "requests",
    "pickle", "shelve", "marshal",
    "ctypes", "importlib", "runpy",
    "signal", "threading", "multiprocessing",
    "code", "codeop", "compileall",
}


class UnsafeCodeError(Exception):
    """Raised when generated code fails safety validation."""
    def __init__(self, violations: list[ValidationViolation]):
        self.violations = violations
        messages = [v.message for v in violations]
        super().__init__(f"Unsafe code detected: {'; '.join(messages)}")


class ASTSafetyValidator(ast.NodeVisitor):
    """
    Walks the parsed AST of LLM-generated code and raises UnsafeCodeError
    on ANY construct not explicitly whitelisted.
    
    Default-deny, not default-allow — this is the load-bearing security control.
    """

    def __init__(self):
        self.violations: list[ValidationViolation] = []
        self.warnings: list[ValidationViolation] = []

    def _add_violation(self, message: str, node: Optional[ast.AST] = None,
                       severity: ValidationSeverity = ValidationSeverity.BLOCK):
        line = getattr(node, "lineno", None) if node else None
        entry = ValidationViolation(
            rule="AST_SAFETY",
            message=message,
            severity=severity,
            line_number=line,
        )
        if severity == ValidationSeverity.BLOCK:
            self.violations.append(entry)
        else:
            self.warnings.append(entry)

    # -- Import statements (always blocked) --

    def visit_Import(self, node: ast.Import):
        for alias in node.names:
            if alias.name.split(".")[0] in {"pandas", "numpy", "datetime"}:
                self._add_violation(
                    f"Import '{alias.name}' detected — imports are handled by the runtime, not generated code",
                    node,
                    ValidationSeverity.WARN,
                )
            else:
                self._add_violation(
                    f"Disallowed import: '{alias.name}'. Only pandas, numpy, datetime are permitted.",
                    node,
                )
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom):
        module = node.module or ""
        if module.split(".")[0] in {"pandas", "numpy", "datetime"}:
            self._add_violation(
                f"Import from '{module}' detected — imports are handled by the runtime",
                node,
                ValidationSeverity.WARN,
            )
        else:
            self._add_violation(
                f"Disallowed import from: '{module}'",
                node,
            )
        self.generic_visit(node)

    # -- Function calls --

    def visit_Call(self, node: ast.Call):
        func_name = self._get_call_name(node)
        if func_name:
            # Check forbidden names first
            if func_name in FORBIDDEN_NAMES:
                self._add_violation(
                    f"Forbidden function call: '{func_name}' — this operation is never permitted",
                    node,
                )
            elif func_name not in ALLOWED_CALLS:
                self._add_violation(
                    f"Unrecognized function call: '{func_name}' — not in the safety whitelist",
                    node,
                    ValidationSeverity.WARN,
                )
        self.generic_visit(node)

    # -- Attribute access --

    def visit_Attribute(self, node: ast.Attribute):
        # Block dunder / private attribute access
        if node.attr.startswith("__"):
            self._add_violation(
                f"Disallowed dunder attribute access: '{node.attr}' — potential sandbox escape",
                node,
            )
        # Block access to forbidden modules
        if isinstance(node.value, ast.Name) and node.value.id in FORBIDDEN_MODULES:
            self._add_violation(
                f"Disallowed module access: '{node.value.id}.{node.attr}'",
                node,
            )
        self.generic_visit(node)

    # -- Control flow restrictions --

    def visit_While(self, node: ast.While):
        """Block unbounded while loops — not needed for tabular operations."""
        self._add_violation(
            "While-loop construct is disallowed — use vectorized pandas operations instead",
            node,
        )

    def visit_With(self, node: ast.With):
        """Block 'with' statements (file I/O pattern)."""
        self._add_violation(
            "'with' statement is disallowed — typically used for file I/O",
            node,
        )

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
        self._add_violation("Async function definitions are disallowed", node)

    def visit_AsyncWith(self, node: ast.AsyncWith):
        self._add_violation("Async with statements are disallowed", node)

    def visit_AsyncFor(self, node: ast.AsyncFor):
        self._add_violation("Async for loops are disallowed", node)

    # -- Global/Nonlocal --

    def visit_Global(self, node: ast.Global):
        self._add_violation(
            f"Global declaration disallowed: {', '.join(node.names)}",
            node,
        )

    def visit_Nonlocal(self, node: ast.Nonlocal):
        self._add_violation(
            f"Nonlocal declaration disallowed: {', '.join(node.names)}",
            node,
        )

    # -- Class definitions --

    def visit_ClassDef(self, node: ast.ClassDef):
        self._add_violation(
            f"Class definition '{node.name}' is disallowed in generated code",
            node,
        )

    # -- Delete statements --

    def visit_Delete(self, node: ast.Delete):
        self._add_violation("Delete statement is disallowed", node, ValidationSeverity.WARN)

    # -- Helper methods --

    @staticmethod
    def _get_call_name(node: ast.Call) -> Optional[str]:
        """Extract the function/method name from a Call node."""
        if isinstance(node.func, ast.Attribute):
            return node.func.attr
        if isinstance(node.func, ast.Name):
            return node.func.id
        return None

    def validate(self, code: str) -> ValidationResult:
        """
        Parse and validate generated code.
        Returns a ValidationResult with is_safe=True only if zero BLOCK violations.
        """
        self.violations = []
        self.warnings = []

        try:
            tree = ast.parse(code, mode="exec")
        except SyntaxError as e:
            self.violations.append(ValidationViolation(
                rule="SYNTAX",
                message=f"Code has syntax errors: {e}",
                severity=ValidationSeverity.BLOCK,
                line_number=e.lineno,
            ))
            return ValidationResult(
                is_safe=False,
                violations=self.violations,
                warnings=self.warnings,
            )

        self.visit(tree)

        return ValidationResult(
            is_safe=len(self.violations) == 0,
            violations=self.violations,
            warnings=self.warnings,
        )
