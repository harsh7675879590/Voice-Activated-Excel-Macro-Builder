"""
PII Redaction Layer — Scans transcripts and schema for sensitive data
BEFORE any network call. This runs entirely locally on the client side.

Detects: SSNs, EINs, phone numbers, emails, and common name patterns.
Replaces with placeholder tokens (<SSN_REDACTED>, <PERSON_1>, etc.)
"""

from __future__ import annotations

import re
import logging
from typing import Optional

from backend.models.schemas import RedactionReport, RedactionEntry

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Detection patterns
# ---------------------------------------------------------------------------

PII_PATTERNS: dict[str, list[re.Pattern]] = {
    "SSN": [
        re.compile(r'\b\d{3}-\d{2}-\d{4}\b'),
        re.compile(r'\b\d{3}\s\d{2}\s\d{4}\b'),
        re.compile(r'\b\d{9}\b(?!\d)'),  # 9 consecutive digits (potential SSN)
    ],
    "EIN": [
        re.compile(r'\b\d{2}-\d{7}\b'),
        re.compile(r'\bEIN\s*:?\s*\d{2}-?\d{7}\b', re.IGNORECASE),
    ],
    "PHONE": [
        re.compile(r'\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b'),
        re.compile(r'\b\+1[-.\s]?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b'),
    ],
    "EMAIL": [
        re.compile(r'\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b'),
    ],
    "ACCOUNT_NUMBER": [
        re.compile(r'\baccount\s*#?\s*:?\s*\d{6,12}\b', re.IGNORECASE),
        re.compile(r'\baccountnum(?:ber)?\s*:?\s*\d{6,12}\b', re.IGNORECASE),
    ],
    "CREDIT_CARD": [
        re.compile(r'\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b'),
    ],
}

# Common name prefixes that suggest PII (conservative — only redact clearly named entities)
NAME_PATTERNS = [
    re.compile(r"\b(?:Mr|Mrs|Ms|Dr|Prof)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b"),
    re.compile(r"\bclient\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b", re.IGNORECASE),
]

# Common company name patterns
COMPANY_PATTERNS = [
    re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:LLC|Inc|Corp|Ltd|LLP|Co|Company|Partnership|Associates)\.?)\b"),
]


class PIIRedactor:
    """
    Scans text for PII patterns and replaces them with safe placeholders.
    This runs LOCALLY before any data leaves the client process.
    """

    def __init__(self):
        self._person_counter = 0
        self._company_counter = 0
        self._entity_map: dict[str, str] = {}  # original -> placeholder

    def reset(self):
        """Reset counters for a new redaction session."""
        self._person_counter = 0
        self._company_counter = 0
        self._entity_map = {}

    def redact(self, text: str) -> RedactionReport:
        """
        Scan text for PII and return a RedactionReport with the sanitized text
        and a log of what was redacted.
        """
        self.reset()
        entries: list[RedactionEntry] = []
        redacted_text = text

        # 1. Redact structured PII patterns (SSN, EIN, phone, email, etc.)
        for category, patterns in PII_PATTERNS.items():
            for pattern in patterns:
                matches = pattern.findall(redacted_text)
                for match in matches:
                    if match and match not in self._entity_map:
                        placeholder = self._get_placeholder(category)
                        self._entity_map[match] = placeholder
                        entries.append(RedactionEntry(
                            original_pattern=self._mask_original(match, category),
                            replacement=placeholder,
                            category=category,
                        ))

                redacted_text = pattern.sub(
                    lambda m: self._entity_map.get(m.group(0), self._get_placeholder(category)),
                    redacted_text,
                )

        # 2. Redact person names
        for pattern in NAME_PATTERNS:
            for match in pattern.finditer(redacted_text):
                name = match.group(1) if match.lastindex else match.group(0)
                if name and name not in self._entity_map:
                    self._person_counter += 1
                    placeholder = f"<PERSON_{self._person_counter}>"
                    self._entity_map[name] = placeholder
                    entries.append(RedactionEntry(
                        original_pattern=f"{name[0]}{'*' * (len(name) - 1)}",
                        replacement=placeholder,
                        category="PERSON",
                    ))
            redacted_text = pattern.sub(
                lambda m: self._entity_map.get(
                    m.group(1) if m.lastindex else m.group(0),
                    m.group(0)
                ),
                redacted_text,
            )

        # 3. Redact company names
        for pattern in COMPANY_PATTERNS:
            for match in pattern.finditer(redacted_text):
                company = match.group(1) if match.lastindex else match.group(0)
                if company and company not in self._entity_map:
                    self._company_counter += 1
                    placeholder = f"<COMPANY_{self._company_counter}>"
                    self._entity_map[company] = placeholder
                    entries.append(RedactionEntry(
                        original_pattern=f"{company[:3]}{'*' * (len(company) - 3)}",
                        replacement=placeholder,
                        category="COMPANY",
                    ))
            redacted_text = pattern.sub(
                lambda m: self._entity_map.get(
                    m.group(1) if m.lastindex else m.group(0),
                    m.group(0)
                ),
                redacted_text,
            )

        return RedactionReport(
            redacted_text=redacted_text,
            entries=entries,
            total_redactions=len(entries),
        )

    def _get_placeholder(self, category: str) -> str:
        """Generate a placeholder token for a PII category."""
        return f"<{category}_REDACTED>"

    def _mask_original(self, original: str, category: str) -> str:
        """Partially mask the original value for the redaction report."""
        if category in ("SSN", "EIN", "CREDIT_CARD"):
            # Show only last 4 characters
            return f"{'*' * (len(original) - 4)}{original[-4:]}"
        elif category in ("PHONE",):
            return f"{'*' * (len(original) - 4)}{original[-4:]}"
        elif category in ("EMAIL",):
            at_idx = original.find("@")
            if at_idx > 1:
                return f"{original[0]}{'*' * (at_idx - 1)}{original[at_idx:]}"
            return f"{'*' * len(original)}"
        else:
            return f"{'*' * len(original)}"

    def redact_schema_card(self, schema_dict: dict) -> tuple[dict, list[RedactionEntry]]:
        """
        Redact any PII that might appear in column names or sheet names.
        (Defensive — column names shouldn't contain PII, but belt-and-suspenders.)
        """
        import json

        text = json.dumps(schema_dict)
        report = self.redact(text)

        try:
            redacted_dict = json.loads(report.redacted_text)
        except json.JSONDecodeError:
            redacted_dict = schema_dict

        return redacted_dict, report.entries
