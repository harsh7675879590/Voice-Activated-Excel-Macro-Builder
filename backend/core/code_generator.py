"""
Code Generation Engine — Generates Pandas code from voice commands + schema context.

Three tiers:
1. LLM-based (Google Gemini API) — best quality, requires API key
2. Rule-based fallback — covers common operations without any API
3. Error with guidance — when the request is too complex for rule-based

Prompt architecture follows Section 2.3 of the architecture doc exactly:
- System prompt fixes persona (code-only, no explanations in code)
- Output contract (JSON schema)
- Schema card injection
- Last 2-3 turns for conversational continuity
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Optional

from backend.models.schemas import (
    CodeLanguage, GeneratedCode, IntentType, ParsedIntent, SchemaCard,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# System prompt — the core persona and output contract
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a specialized code generation engine for tax professionals working with Excel data.
You generate ONLY executable Python/Pandas code — never explanations, never markdown, never comments outside the code.

## Output Contract
You MUST respond with a valid JSON object in this exact format:
{
    "language": "pandas",
    "code": "<executable pandas code operating on a variable named 'df'>",
    "explanation": "<one-sentence plain-English description of what the code does>"
}

## Rules
1. The input DataFrame is always named `df`. Your code must operate on `df` and store the result in a variable named `result`.
2. NEVER import any modules — pandas is available as `pd`, numpy as `np`.
3. NEVER use eval(), exec(), open(), os.*, or any file I/O.
4. NEVER use while loops — use vectorized pandas operations.
5. Keep code concise — prefer chained operations.
6. Handle edge cases: use .copy() to avoid SettingWithCopyWarning.
7. For date filtering, use pd.to_datetime() for type safety.
8. Always preserve the original DataFrame — assign results to `result`, never modify `df` in-place.

## Context
You are operating on the following workbook schema:
{schema_context}

## Conversation History (last 2-3 turns)
{conversation_context}
"""


class CodeGenerator:
    """
    Generates validated Pandas code from voice commands.
    Uses LLM when available, falls back to rule-based generation.
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        self._genai = None
        self._model = None
        self._conversation_history: list[dict] = []

        if self.api_key:
            try:
                import google.generativeai as genai
                genai.configure(api_key=self.api_key)
                self._genai = genai
                self._model = genai.GenerativeModel("gemini-2.0-flash")
                logger.info("Gemini API initialized successfully")
            except Exception as e:
                logger.warning(f"Failed to initialize Gemini API: {e}")
                self._genai = None
                self._model = None

    @property
    def has_llm(self) -> bool:
        return self._model is not None

    def generate(
        self,
        transcript: str,
        intent: ParsedIntent,
        schema: Optional[SchemaCard] = None,
    ) -> GeneratedCode:
        """
        Generate code from a voice transcript.
        Tries LLM first, falls back to rule-based.
        """
        # Add to conversation history (keep last 3)
        self._conversation_history.append({
            "role": "user",
            "content": transcript,
        })
        if len(self._conversation_history) > 6:
            self._conversation_history = self._conversation_history[-6:]

        # Try LLM generation first
        if self.has_llm:
            try:
                result = self._generate_with_llm(transcript, intent, schema)
                if result:
                    return result
            except Exception as e:
                logger.warning(f"LLM generation failed, falling back to rules: {e}")

        # Fall back to rule-based generation
        return self._generate_rule_based(transcript, intent, schema)

    def _generate_with_llm(
        self,
        transcript: str,
        intent: ParsedIntent,
        schema: Optional[SchemaCard],
    ) -> Optional[GeneratedCode]:
        """Generate code using the LLM API."""
        schema_context = schema.to_prompt_context() if schema else "No schema available."
        conversation_context = self._format_conversation_history()

        system = SYSTEM_PROMPT.format(
            schema_context=schema_context,
            conversation_context=conversation_context,
        )

        user_message = f"Voice command: \"{transcript}\"\nDetected intent: {intent.intent_type.value}\nEntities: {json.dumps(intent.entities)}"

        try:
            response = self._model.generate_content(
                [
                    {"role": "user", "parts": [{"text": system + "\n\n" + user_message}]},
                ],
                generation_config={
                    "temperature": 0.1,
                    "max_output_tokens": 1024,
                    "response_mime_type": "application/json",
                },
            )

            response_text = response.text.strip()

            # Parse JSON response
            try:
                result = json.loads(response_text)
            except json.JSONDecodeError:
                # Try to extract JSON from the response
                json_match = re.search(r'\{[^{}]*\}', response_text, re.DOTALL)
                if json_match:
                    result = json.loads(json_match.group())
                else:
                    return None

            code = result.get("code", "")
            explanation = result.get("explanation", "Generated by AI")
            language = result.get("language", "pandas")

            if not code:
                return None

            # Track in conversation
            self._conversation_history.append({
                "role": "assistant",
                "content": f"Generated: {explanation}",
            })

            return GeneratedCode(
                language=CodeLanguage(language),
                code=code,
                explanation=explanation,
                intent_used=intent.intent_type,
            )

        except Exception as e:
            logger.error(f"LLM API call failed: {e}")
            return None

    def _generate_rule_based(
        self,
        transcript: str,
        intent: ParsedIntent,
        schema: Optional[SchemaCard],
    ) -> GeneratedCode:
        """
        Generate code using deterministic rules for common operations.
        Covers ~80% of tax professional use cases without any API.
        """
        entities = intent.entities
        columns = entities.get("columns", [])
        thresholds = entities.get("thresholds", [])
        comparison = entities.get("comparison", ">")
        group_by = entities.get("group_by")
        agg_func = entities.get("agg_function", "sum")
        ascending = entities.get("ascending", True)
        limit = entities.get("limit")

        # Categorize available columns
        all_numeric = [c.name for c in schema.columns if c.dtype in ("int64", "float64")] if schema else []
        all_string = [c.name for c in schema.columns if c.dtype in ("string", "object", "category")] if schema else []

        extracted_numeric = [c for c in columns if c in all_numeric]
        extracted_string = [c for c in columns if c in all_string]

        # Smart column assignment based on intent
        if intent.intent_type == IntentType.AGGREGATE:
            group_col = group_by if (group_by and schema and any(c.name == group_by for c in schema.columns)) else None
            if not group_col and extracted_string:
                group_col = extracted_string[0]
            elif not group_col and all_string:
                group_col = all_string[0]

            target_col = extracted_numeric[0] if extracted_numeric else (all_numeric[0] if all_numeric else (columns[0] if columns else "value"))
            # Ensure target_col != group_col
            if target_col == group_col and len(all_numeric) > 0:
                target_col = all_numeric[0]
        elif intent.intent_type == IntentType.SORT:
            # When sorting/ranking, prefer numeric metric unless explicitly string
            target_col = extracted_numeric[0] if extracted_numeric else (columns[0] if columns else (all_numeric[0] if all_numeric else "value"))
            group_col = group_by or (extracted_string[0] if extracted_string else (all_string[0] if all_string else None))
        elif intent.intent_type == IntentType.FILTER:
            if thresholds:
                target_col = extracted_numeric[0] if extracted_numeric else (columns[0] if columns else (all_numeric[0] if all_numeric else "value"))
            else:
                target_col = columns[0] if columns else (all_string[0] if all_string else (all_numeric[0] if all_numeric else "value"))
            group_col = group_by
        else:
            target_col = extracted_numeric[0] if extracted_numeric else (columns[0] if columns else (all_numeric[0] if all_numeric else "value"))
            group_col = group_by or (extracted_string[0] if extracted_string else (all_string[0] if all_string else None))

        generators = {
            IntentType.FILTER: self._gen_filter,
            IntentType.AGGREGATE: self._gen_aggregate,
            IntentType.SORT: self._gen_sort,
            IntentType.CALCULATE: self._gen_calculate,
            IntentType.PIVOT: self._gen_pivot,
            IntentType.MERGE: self._gen_merge,
            IntentType.FORMAT: self._gen_format,
            IntentType.EXPORT: self._gen_export,
        }

        generator = generators.get(intent.intent_type, self._gen_default)

        code, explanation = generator(
            transcript=transcript,
            target_col=target_col,
            group_col=group_col,
            thresholds=thresholds,
            comparison=comparison,
            agg_func=agg_func,
            ascending=ascending,
            limit=limit,
            schema=schema,
            columns=columns,
        )

        return GeneratedCode(
            language=CodeLanguage.PANDAS,
            code=code,
            explanation=explanation,
            intent_used=intent.intent_type,
        )

    # -------------------------------------------------------------------
    # Rule-based generators for each intent type
    # -------------------------------------------------------------------

    def _gen_filter(self, *, target_col, thresholds, comparison, **kwargs) -> tuple[str, str]:
        if thresholds:
            threshold = thresholds[0]
            if comparison == "between" and len(thresholds) >= 2:
                code = (
                    f"result = df[df['{target_col}'].between({thresholds[0]}, {thresholds[1]})].copy()"
                )
                explanation = f"Filter rows where {target_col} is between {thresholds[0]} and {thresholds[1]}"
            else:
                code = f"result = df[df['{target_col}'] {comparison} {threshold}].copy()"
                explanation = f"Filter rows where {target_col} {comparison} {threshold}"
        else:
            code = f"result = df[df['{target_col}'].notna()].copy()"
            explanation = f"Filter rows where {target_col} has non-null values"
        return code, explanation

    def _gen_aggregate(self, *, target_col, group_col, agg_func, **kwargs) -> tuple[str, str]:
        if group_col and group_col != target_col:
            code = (
                f"result = df.groupby('{group_col}')['{target_col}'].{agg_func}()"
                f".reset_index()"
            )
            explanation = f"Calculate {agg_func} of {target_col} grouped by {group_col}"
        else:
            code = f"result = df[['{target_col}']].agg(['{agg_func}']).reset_index()"
            explanation = f"Calculate {agg_func} of {target_col}"
        return code, explanation

    def _gen_sort(self, *, target_col, ascending, limit, **kwargs) -> tuple[str, str]:
        direction = "ascending" if ascending else "descending"
        code = f"result = df.sort_values('{target_col}', ascending={ascending}).copy()"
        if limit:
            code = f"result = df.sort_values('{target_col}', ascending={ascending}).head({limit}).copy()"
            explanation = f"Top {limit} rows sorted by {target_col} ({direction})"
        else:
            explanation = f"Sort by {target_col} ({direction})"
        return code, explanation

    def _gen_calculate(self, *, target_col, transcript, columns, **kwargs) -> tuple[str, str]:
        t = transcript.lower()
        if "percentage" in t or "percent" in t or "%" in t:
            code = f"result = df.copy()\nresult['{target_col}_pct'] = (df['{target_col}'] / df['{target_col}'].sum() * 100).round(2)"
            explanation = f"Calculate percentage of {target_col}"
        elif "tax" in t and "rate" in t:
            tax_col = columns[0] if columns else target_col
            income_col = columns[1] if len(columns) > 1 else target_col
            code = f"result = df.copy()\nresult['tax_rate'] = (df['{tax_col}'] / df['{income_col}'] * 100).round(2)"
            explanation = f"Calculate tax rate from {tax_col} and {income_col}"
        elif "difference" in t or "change" in t:
            code = f"result = df.copy()\nresult['{target_col}_diff'] = df['{target_col}'].diff()"
            explanation = f"Calculate row-over-row difference for {target_col}"
        elif "cumulative" in t or "running" in t:
            code = f"result = df.copy()\nresult['{target_col}_cumsum'] = df['{target_col}'].cumsum()"
            explanation = f"Calculate cumulative sum of {target_col}"
        else:
            code = f"result = df.copy()\nresult['{target_col}_calculated'] = df['{target_col}']"
            explanation = f"Added calculated column based on {target_col}"
        return code, explanation

    def _gen_pivot(self, *, target_col, group_col, agg_func, **kwargs) -> tuple[str, str]:
        if group_col:
            code = f"result = df.pivot_table(values='{target_col}', index='{group_col}', aggfunc='{agg_func}').reset_index()"
            explanation = f"Pivot table of {target_col} by {group_col} ({agg_func})"
        else:
            code = f"result = df.describe().reset_index()"
            explanation = "Generated summary statistics"
        return code, explanation

    def _gen_merge(self, **kwargs) -> tuple[str, str]:
        code = "result = df.copy()  # Merge requires a second DataFrame — please upload both files"
        explanation = "Merge operation requires two data sources"
        return code, explanation

    def _gen_format(self, *, target_col, **kwargs) -> tuple[str, str]:
        code = f"result = df.copy()\nresult['{target_col}'] = df['{target_col}'].apply(lambda x: f'${{x:,.2f}}' if isinstance(x, (int, float)) else x)"
        explanation = f"Format {target_col} as currency"
        return code, explanation

    def _gen_export(self, **kwargs) -> tuple[str, str]:
        code = "result = df.copy()"
        explanation = "Data prepared for export"
        return code, explanation

    def _gen_default(self, **kwargs) -> tuple[str, str]:
        code = "result = df.copy()"
        explanation = "Could not determine specific operation — showing original data"
        return code, explanation

    # -------------------------------------------------------------------
    # Helper methods
    # -------------------------------------------------------------------

    def _infer_columns(self, transcript: str, schema: SchemaCard) -> list[str]:
        """Try to match words in the transcript to column names."""
        found = []
        t_lower = transcript.lower()
        for col in schema.columns:
            col_lower = col.name.lower().replace("_", " ")
            if col_lower in t_lower or col.name.lower() in t_lower:
                found.append(col.name)
        return found

    def _get_first_numeric_col(self, schema: Optional[SchemaCard]) -> str:
        if schema:
            for col in schema.columns:
                if col.dtype in ("int64", "float64"):
                    return col.name
        return "value"

    def _get_first_string_col(self, schema: Optional[SchemaCard]) -> str:
        if schema:
            for col in schema.columns:
                if col.dtype == "string":
                    return col.name
        return "category"

    def _format_conversation_history(self) -> str:
        """Format recent conversation turns for context injection."""
        if not self._conversation_history:
            return "No prior conversation."
        recent = self._conversation_history[-6:]
        lines = []
        for turn in recent:
            role = turn["role"].capitalize()
            lines.append(f"{role}: {turn['content']}")
        return "\n".join(lines)
