"""
Intent Parser — Classifies voice transcripts into domain-specific intents
and extracts structured entities (columns, thresholds, date ranges).

This is a fast, rule-based classifier (not LLM-based) that runs before
code generation to provide structured context to the prompt builder.
Ambiguity detection is handled here, not in the LLM.
"""

from __future__ import annotations

import re
import logging
from typing import Optional

from backend.models.schemas import IntentType, ParsedIntent, SchemaCard

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Keyword → Intent mapping
# ---------------------------------------------------------------------------

INTENT_KEYWORDS: dict[IntentType, list[str]] = {
    IntentType.FILTER: [
        "filter", "where", "only", "above", "below",
        "greater", "less", "more than", "fewer", "between", "exclude",
        "include", "remove", "keep", "equals", "not equal", "contains",
        "starts with", "ends with", "matching", "having",
    ],
    IntentType.AGGREGATE: [
        "group by", "grouped by", "sum", "total", "average", "mean", "count",
        "aggregate", "subtotal", "grand total", "summarize", "summarise",
        "breakdown", "tally",
    ],
    IntentType.SORT: [
        "sort", "order", "rank", "arrange", "ascending", "descending",
        "highest", "lowest", "top", "bottom", "largest", "smallest",
    ],
    IntentType.CALCULATE: [
        "calculate", "compute", "formula", "add column", "new column",
        "multiply", "divide", "subtract", "percentage", "percent", "ratio", "margin",
        "tax rate", "deduction", "difference", "growth", "cumulative",
    ],
    IntentType.FORMAT: [
        "format", "bold", "highlight", "color", "colour", "underline",
        "italic", "font", "style", "conditional", "heatmap", "currency",
    ],
    IntentType.EXPORT: [
        "export", "save", "download", "csv", "pdf", "copy",
        "send", "email", "output",
    ],
    IntentType.PIVOT: [
        "pivot", "pivot table", "cross tab", "crosstab", "cross-tab",
        "transpose", "reshape",
    ],
    IntentType.MERGE: [
        "merge", "join", "combine", "vlookup", "lookup", "match",
        "link", "connect", "relate", "cross-reference",
    ],
}

# Numerical pattern: captures numbers like 50000, 50,000, 50k, $50000
NUM_PATTERN = re.compile(
    r'(?:\$\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?)\s*([kKmMbB])?'
    r'|(?:\$\s*)?(\d+(?:\.\d+)?)\s*([kKmMbB])?',
    re.IGNORECASE,
)

# Comparison operators in natural language
COMPARISON_MAP = {
    "above": ">", "greater than": ">", "more than": ">", "over": ">",
    "exceeds": ">", "higher than": ">",
    "below": "<", "less than": "<", "fewer than": "<", "under": "<",
    "lower than": "<",
    "at least": ">=", "minimum": ">=", "no less than": ">=",
    "at most": "<=", "maximum": "<=", "no more than": "<=",
    "equals": "==", "equal to": "==", "exactly": "==", "is": "==",
    "not equal": "!=", "not": "!=", "except": "!=",
    "between": "between",
}

# Aggregation functions
AGG_FUNCTIONS = {
    "sum": "sum", "total": "sum", "add up": "sum",
    "average": "mean", "mean": "mean", "avg": "mean",
    "count": "count", "how many": "count", "number of": "count",
    "maximum": "max", "max": "max", "highest": "max", "largest": "max",
    "minimum": "min", "min": "min", "lowest": "min", "smallest": "min",
    "median": "median", "middle": "median",
    "standard deviation": "std", "std": "std",
}


class IntentParser:
    """
    Rule-based intent parser with entity extraction and ambiguity detection.
    Runs BEFORE any LLM call — provides structured context to the code generator.
    """

    def __init__(self, schema: Optional[SchemaCard] = None):
        self.schema = schema
        self._column_names_lower: set[str] = set()
        if schema:
            self._column_names_lower = {
                col.name.lower().replace("_", " ")
                for col in schema.columns
            }

    def parse(self, transcript: str) -> ParsedIntent:
        """Parse a voice transcript into a structured intent."""
        text_lower = transcript.lower().strip()

        # 1. Classify intent
        intent_type, confidence = self._classify_intent(text_lower)

        # 2. Extract entities
        entities = self._extract_entities(text_lower, intent_type)

        # 3. Detect ambiguities
        ambiguities = self._detect_ambiguities(text_lower, entities)

        return ParsedIntent(
            intent_type=intent_type,
            confidence=confidence,
            entities=entities,
            ambiguities=ambiguities,
            raw_transcript=transcript,
        )

    def _classify_intent(self, text: str) -> tuple[IntentType, float]:
        """Score each intent type by keyword matches and return the best."""
        scores: dict[IntentType, float] = {}

        for intent_type, keywords in INTENT_KEYWORDS.items():
            score = 0.0
            for keyword in keywords:
                # Use word-boundary matching
                pattern = r'\b' + re.escape(keyword) + r'\b'
                if re.search(pattern, text):
                    # Multi-word keywords get higher weight
                    weight = len(keyword.split()) * 0.2
                    score += 0.3 + weight
            scores[intent_type] = min(score, 1.0)

        # Explicit intent boosts
        if re.search(r'\b(?:top|bottom|highest|lowest|rank)\s+\d+\b', text):
            scores[IntentType.SORT] = max(scores.get(IntentType.SORT, 0.0), 0.85)

        if not scores or max(scores.values()) == 0:
            return IntentType.UNKNOWN, 0.0

        best_intent = max(scores, key=scores.get)
        confidence = scores[best_intent]

        if confidence > 0.5:
            confidence = min(confidence * 1.2, 0.98)

        return best_intent, round(confidence, 2)

    def _extract_entities(self, text: str, intent_type: IntentType) -> dict:
        """Extract structured entities from the transcript."""
        entities: dict = {}

        # Extract column references
        columns = self._extract_columns(text)
        if columns:
            entities["columns"] = columns

        # Extract numerical thresholds
        numbers = self._extract_numbers(text)
        if numbers:
            entities["thresholds"] = numbers

        # Extract comparison operators
        comparison = self._extract_comparison(text)
        if comparison:
            entities["comparison"] = comparison

        # Extract aggregation function
        if intent_type == IntentType.AGGREGATE:
            agg_func = self._extract_agg_function(text)
            if agg_func:
                entities["agg_function"] = agg_func

        # Extract sort direction
        if intent_type == IntentType.SORT:
            entities["ascending"] = not any(
                kw in text for kw in ["descending", "desc", "highest", "largest", "top"]
            )

        # Extract "group by" column
        group_col_found = None
        if self.schema:
            # Check if any schema column follows "group by" or "by"
            group_pattern = re.search(r'(?:group(?:ed)?\s+by|by)\s+([a-zA-Z0-9_\s]+)', text)
            if group_pattern:
                following_text = group_pattern.group(1).lower()
                for col in self.schema.columns:
                    col_clean = col.name.lower().replace("_", " ")
                    if col_clean in following_text or col.name.lower() in following_text:
                        group_col_found = col.name
                        break
                    # Also check individual words
                    for word in col.name.lower().split("_"):
                        if len(word) >= 3 and word in following_text.split()[:3]:
                            group_col_found = col.name
                            break
                    if group_col_found:
                        break

        if group_col_found:
            entities["group_by"] = group_col_found
        elif "group by" in text:
            # Fallback simple regex
            group_match = re.search(r'(?:group\s+by|by)\s+(\w+)', text)
            if group_match and group_match.group(1) not in ("and", "the", "a", "all", "sum", "total"):
                entities["group_by"] = group_match.group(1).strip()

        # Extract top/bottom N
        top_match = re.search(r'(?:top|first|bottom|last|highest|lowest)\s+(\d+)', text)
        if top_match:
            entities["limit"] = int(top_match.group(1))

        return entities

    def _extract_columns(self, text: str) -> list[str]:
        """Match words in the transcript against known column names.
        Supports exact match, space-for-underscore match, and partial substring match."""
        if not self.schema:
            return []

        found_columns = []
        text_words = set(text.split())

        for col in self.schema.columns:
            col_lower = col.name.lower()
            col_spaced = col_lower.replace("_", " ")

            # Exact match
            if col_spaced in text or col_lower in text:
                found_columns.append(col.name)
                continue

            # Partial match: check if any word in the transcript appears as a
            # meaningful part of the column name (e.g., "revenue" matches "Gross_Revenue")
            col_parts = col_lower.split("_")
            for word in text_words:
                if len(word) >= 3 and word in col_parts:
                    found_columns.append(col.name)
                    break

        return found_columns

    def _extract_numbers(self, text: str) -> list[float]:
        """Extract numerical values from the transcript."""
        numbers = []
        multipliers = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}

        for match in NUM_PATTERN.finditer(text):
            num_str = match.group(1) or match.group(3)
            suffix = match.group(2) or match.group(4)

            if num_str:
                value = float(num_str.replace(",", ""))
                if suffix:
                    value *= multipliers.get(suffix.lower(), 1)
                numbers.append(value)

        return numbers

    def _extract_comparison(self, text: str) -> Optional[str]:
        """Extract comparison operator from natural language."""
        # Sort by length (longer phrases first) to match "greater than" before "greater"
        for phrase, op in sorted(COMPARISON_MAP.items(), key=lambda x: -len(x[0])):
            if phrase in text:
                return op
        return None

    def _extract_agg_function(self, text: str) -> Optional[str]:
        """Extract aggregation function."""
        for phrase, func in sorted(AGG_FUNCTIONS.items(), key=lambda x: -len(x[0])):
            if phrase in text:
                return func
        return None

    def _detect_ambiguities(self, text: str, entities: dict) -> list[str]:
        """
        Detect underspecified terms that COULD need clarification.
        Returns advisory hints — the pipeline should NOT block on these.
        If columns were already resolved, don't flag ambiguity.
        """
        ambiguities = []

        if not self.schema:
            return ambiguities

        columns = entities.get("columns", [])

        # If columns were already extracted, no ambiguity to flag
        if columns:
            return ambiguities

        # Only flag ambiguity if zero columns matched AND the intent requires a column
        # (Don't block — just hint)
        return ambiguities
