"""
Intent Parser — Classifies voice transcripts into domain-specific intents
and extracts structured entities (columns, thresholds, text filters, calculations).

This is a fast, rule-based classifier (not LLM-based) that runs before
code generation to provide structured context to the prompt builder.
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
        "starts with", "ends with", "matching", "having", "is", "are",
        "show only", "find",
    ],
    IntentType.AGGREGATE: [
        "group by", "grouped by", "sum", "total", "average", "mean", "count",
        "aggregate", "subtotal", "grand total", "summarize", "summarise",
        "breakdown", "tally", "per", "by state", "by quarter", "by client",
    ],
    IntentType.SORT: [
        "sort", "order", "rank", "arrange", "ascending", "descending",
        "highest", "lowest", "top", "bottom", "largest", "smallest",
    ],
    IntentType.CALCULATE: [
        "calculate", "compute", "formula", "add column", "new column",
        "multiply", "divide", "subtract", "minus", "plus", "percentage", "percent", "ratio", "margin",
        "tax rate", "deduction", "difference", "growth", "cumulative", "profit",
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
    "exceeds": ">", "higher than": ">", "greater": ">",
    "below": "<", "less than": "<", "fewer than": "<", "under": "<",
    "lower than": "<", "less": "<",
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

# Known common tax dataset categories for instant recognition
COMMON_CATEGORIES = {
    "State": ["CA", "NY", "TX", "FL", "IL", "PA", "OH", "GA", "NC", "MI", "NJ", "VA", "WA", "AZ", "MA"],
    "Filing_Status": ["Filed", "Pending", "Overdue", "Rejected", "Under Review", "Approved"],
    "Quarter": ["Q1", "Q2", "Q3", "Q4"],
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
                pattern = r'\b' + re.escape(keyword) + r'\b'
                if re.search(pattern, text):
                    weight = len(keyword.split()) * 0.25
                    score += 0.35 + weight
            scores[intent_type] = min(score, 1.0)

        # Explicit intent boosts
        if re.search(r'\b(?:top|bottom|highest|lowest|rank)\s+\d+\b', text):
            scores[IntentType.SORT] = max(scores.get(IntentType.SORT, 0.0), 0.9)

        if re.search(r'\b(?:minus|subtract|plus|multiply|divide|profit|margin|rate|calculate|pct|percentage)\b', text):
            scores[IntentType.CALCULATE] = max(scores.get(IntentType.CALCULATE, 0.0), 0.85)

        if re.search(r'\b(?:group\s*by|by\s+state|by\s+quarter|by\s+client|total\s+by|sum\s+of)\b', text):
            scores[IntentType.AGGREGATE] = max(scores.get(IntentType.AGGREGATE, 0.0), 0.9)

        if not scores or max(scores.values()) == 0:
            return IntentType.UNKNOWN, 0.0

        best_intent = max(scores, key=scores.get)
        confidence = scores[best_intent]

        if confidence > 0.4:
            confidence = min(confidence * 1.25, 0.99)

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

        # Extract string/categorical filters
        text_filters = self._extract_text_filters(text)
        if text_filters:
            entities["text_filters"] = text_filters

        # Extract arithmetic operation (for calculate)
        arithmetic = self._extract_arithmetic(text)
        if arithmetic:
            entities["arithmetic"] = arithmetic

        # Extract aggregation function
        if intent_type == IntentType.AGGREGATE or "sum" in text or "total" in text or "average" in text:
            agg_func = self._extract_agg_function(text)
            if agg_func:
                entities["agg_function"] = agg_func

        # Extract sort direction
        if intent_type == IntentType.SORT or "sort" in text or "order" in text:
            entities["ascending"] = not any(
                kw in text for kw in ["descending", "desc", "highest", "largest", "top"]
            )

        # Extract "group by" column
        group_col_found = self._extract_group_by_col(text)
        if group_col_found:
            entities["group_by"] = group_col_found

        # Extract top/bottom N
        top_match = re.search(r'(?:top|first|bottom|last|highest|lowest)\s+(\d+)', text)
        if top_match:
            entities["limit"] = int(top_match.group(1))

        return entities

    def _extract_columns(self, text: str) -> list[str]:
        """Match words in the transcript against known column names."""
        if not self.schema:
            return []

        found_columns = []
        text_words = set(re.findall(r'\b[a-zA-Z0-9_]+\b', text))

        for col in self.schema.columns:
            col_lower = col.name.lower()
            col_spaced = col_lower.replace("_", " ")

            # Exact match on full name
            if col_spaced in text or col_lower in text:
                if col.name not in found_columns:
                    found_columns.append(col.name)
                continue

            # Word match: check if individual meaningful parts match
            col_parts = [p for p in col_lower.split("_") if len(p) >= 3]
            for part in col_parts:
                if part in text_words:
                    if col.name not in found_columns:
                        found_columns.append(col.name)
                    break

        return found_columns

    def _extract_text_filters(self, text: str) -> list[dict]:
        """Extract categorical / text matches (e.g. State='CA', Status='Pending', Quarter='Q1')."""
        matches = []

        # Check against common known categories and schema columns
        schema_col_names = [c.name for c in self.schema.columns] if self.schema else list(COMMON_CATEGORIES.keys())

        for col_name, values in COMMON_CATEGORIES.items():
            # Check if column exists in schema
            actual_col = next((c for c in schema_col_names if c.lower() == col_name.lower()), None)
            if not actual_col:
                continue

            for val in values:
                # Match word boundary for category
                pattern = r'\b' + re.escape(val.lower()) + r'\b'
                if re.search(pattern, text):
                    matches.append({
                        "column": actual_col,
                        "value": val,
                        "operator": "=="
                    })

        # Also check for explicit quotes or "where/is X"
        quoted_matches = re.findall(r'["\']([^"\']+)["\']', text)
        for qm in quoted_matches:
            if not any(m["value"].lower() == qm.lower() for m in matches):
                # Assign to first string column if available
                string_cols = [c.name for c in self.schema.columns if c.dtype in ("string", "object")] if self.schema else []
                if string_cols:
                    matches.append({
                        "column": string_cols[0],
                        "value": qm,
                        "operator": "contains"
                    })

        return matches

    def _extract_arithmetic(self, text: str) -> Optional[dict]:
        """Extract arithmetic operations like col1 minus col2."""
        if any(w in text for w in ["minus", "subtract", "subtracted from", "less"]):
            return {"op": "-", "name": "diff"}
        if any(w in text for w in ["plus", "add", "added to", "sum of"]):
            return {"op": "+", "name": "sum"}
        if any(w in text for w in ["divided by", "ratio", "over", "per"]):
            return {"op": "/", "name": "ratio"}
        if any(w in text for w in ["times", "multiplied by", "product of"]):
            return {"op": "*", "name": "product"}
        return None

    def _extract_group_by_col(self, text: str) -> Optional[str]:
        """Find the grouping column in the query."""
        if not self.schema:
            return None

        # Check explicit "group by X" or "by X" or "per X"
        pattern = re.search(r'(?:group(?:ed)?\s+by|by|per|across)\s+([a-zA-Z0-9_\s]+)', text)
        if pattern:
            following = pattern.group(1).strip().lower()
            for col in self.schema.columns:
                col_clean = col.name.lower().replace("_", " ")
                if col_clean in following or col.name.lower() in following:
                    return col.name
                for word in col.name.lower().split("_"):
                    if len(word) >= 3 and word in following.split()[:2]:
                        return col.name

        # Check if query mentions state/quarter/client directly
        for col in self.schema.columns:
            if col.name.lower() in text or col.name.lower().replace("_", " ") in text:
                if col.dtype in ("string", "object", "category") and ("group" in text or "total" in text or "sum" in text or "average" in text):
                    return col.name

        return None

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
        for phrase, op in sorted(COMPARISON_MAP.items(), key=lambda x: -len(x[0])):
            if re.search(r'\b' + re.escape(phrase) + r'\b', text):
                return op
        return None

    def _extract_agg_function(self, text: str) -> Optional[str]:
        """Extract aggregation function."""
        for phrase, func in sorted(AGG_FUNCTIONS.items(), key=lambda x: -len(x[0])):
            if re.search(r'\b' + re.escape(phrase) + r'\b', text):
                return func
        return None

    def _detect_ambiguities(self, text: str, entities: dict) -> list[str]:
        """Advisory ambiguities."""
        return []
