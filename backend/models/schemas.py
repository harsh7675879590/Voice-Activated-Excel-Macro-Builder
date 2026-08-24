"""
Pydantic models — API contracts for the Voice Macro Builder pipeline.
Every request/response between frontend and backend is typed through these schemas.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class IntentType(str, Enum):
    FILTER = "FILTER"
    AGGREGATE = "AGGREGATE"
    CALCULATE = "CALCULATE"
    FORMAT = "FORMAT"
    EXPORT = "EXPORT"
    SORT = "SORT"
    PIVOT = "PIVOT"
    MERGE = "MERGE"
    UNKNOWN = "UNKNOWN"


class PipelineStage(str, Enum):
    IDLE = "IDLE"
    LISTENING = "LISTENING"
    TRANSCRIBING = "TRANSCRIBING"
    PARSING_INTENT = "PARSING_INTENT"
    EXTRACTING_SCHEMA = "EXTRACTING_SCHEMA"
    GENERATING_CODE = "GENERATING_CODE"
    VALIDATING = "VALIDATING"
    DRY_RUNNING = "DRY_RUNNING"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    EXECUTING = "EXECUTING"
    COMPLETE = "COMPLETE"
    ERROR = "ERROR"


class CodeLanguage(str, Enum):
    PANDAS = "pandas"
    VBA = "vba"
    OFFICE_JS = "office_js"


class DiffType(str, Enum):
    ADDED = "added"
    REMOVED = "removed"
    MODIFIED = "modified"
    UNCHANGED = "unchanged"


class ValidationSeverity(str, Enum):
    BLOCK = "BLOCK"
    WARN = "WARN"


# ---------------------------------------------------------------------------
# Schema Models
# ---------------------------------------------------------------------------

class ColumnSchema(BaseModel):
    name: str
    dtype: str
    sample_cardinality: Optional[int] = None
    sample_values: Optional[list[str]] = Field(
        default=None,
        description="A few non-PII sample values for ambiguity resolution (never raw financial data)"
    )


class SchemaCard(BaseModel):
    sheet_name: str
    columns: list[ColumnSchema]
    row_count: int
    named_ranges: Optional[list[str]] = None

    def to_prompt_context(self) -> str:
        cols = ", ".join(f"{c.name} ({c.dtype})" for c in self.columns)
        return f"Sheet '{self.sheet_name}' has {self.row_count} rows. Columns: {cols}."


class WorkbookSchema(BaseModel):
    filename: str
    sheets: list[SchemaCard]
    active_sheet: str


# ---------------------------------------------------------------------------
# Intent Models
# ---------------------------------------------------------------------------

class ParsedIntent(BaseModel):
    intent_type: IntentType
    confidence: float = Field(ge=0.0, le=1.0)
    entities: dict = Field(default_factory=dict)
    ambiguities: list[str] = Field(default_factory=list)
    raw_transcript: str


# ---------------------------------------------------------------------------
# Code Generation Models
# ---------------------------------------------------------------------------

class GeneratedCode(BaseModel):
    language: CodeLanguage
    code: str
    explanation: str
    intent_used: IntentType


# ---------------------------------------------------------------------------
# Validation Models
# ---------------------------------------------------------------------------

class ValidationViolation(BaseModel):
    rule: str
    message: str
    severity: ValidationSeverity
    line_number: Optional[int] = None


class ValidationResult(BaseModel):
    is_safe: bool
    violations: list[ValidationViolation] = Field(default_factory=list)
    warnings: list[ValidationViolation] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Diff Models
# ---------------------------------------------------------------------------

class CellDiff(BaseModel):
    row: int
    column: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    diff_type: DiffType


class DiffResult(BaseModel):
    total_rows_before: int
    total_rows_after: int
    rows_added: int
    rows_removed: int
    cells_modified: int
    changes: list[CellDiff]
    preview_before: list[dict] = Field(default_factory=list)
    preview_after: list[dict] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# PII Models
# ---------------------------------------------------------------------------

class RedactionEntry(BaseModel):
    original_pattern: str
    replacement: str
    category: str  # SSN, EIN, PHONE, EMAIL, PERSON


class RedactionReport(BaseModel):
    redacted_text: str
    entries: list[RedactionEntry]
    total_redactions: int


# ---------------------------------------------------------------------------
# Pipeline / API Models
# ---------------------------------------------------------------------------

class VoiceCommandRequest(BaseModel):
    transcript: str
    active_sheet: Optional[str] = None
    conversation_history: list[dict] = Field(default_factory=list)


class PipelineResponse(BaseModel):
    stage: PipelineStage
    transcript: str
    intent: Optional[ParsedIntent] = None
    schema_card: Optional[SchemaCard] = None
    generated_code: Optional[GeneratedCode] = None
    validation: Optional[ValidationResult] = None
    diff: Optional[DiffResult] = None
    redaction_report: Optional[RedactionReport] = None
    error: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.now)


class ExecuteRequest(BaseModel):
    code: str
    language: CodeLanguage = CodeLanguage.PANDAS
    active_sheet: Optional[str] = None


class ExecutionResult(BaseModel):
    success: bool
    rows_affected: int = 0
    message: str
    result_preview: list[dict] = Field(default_factory=list)


class HistoryEntry(BaseModel):
    id: str
    transcript: str
    intent_type: IntentType | str = IntentType.UNKNOWN
    code: str
    language: CodeLanguage
    was_executed: bool
    timestamp: datetime = Field(default_factory=datetime.now)
    result_summary: Optional[str] = None
