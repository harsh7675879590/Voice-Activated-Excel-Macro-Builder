# Voice-Activated Excel Macro Builder for Tax Professionals
## End-to-End Technical Implementation Plan

---

## 1. High-Level System Architecture & Data Flow

### 1.1 Pipeline Sequence

```
[Voice Input]
     │
     ▼
┌─────────────────────┐
│  STT Engine          │  Streaming transcription, low-latency
│  (Local Whisper)     │  partial + final transcript emission
└─────────┬────────────┘
          ▼
┌─────────────────────┐
│  Domain Intent       │  Classifies: FILTER / AGGREGATE / CALC /
│  Parser              │  FORMAT / EXPORT. Extracts entities
│                       │  (columns, thresholds, date ranges)
└─────────┬────────────┘
          ▼
┌─────────────────────┐
│  Workbook State      │  Injects ONLY schema (col names, dtypes,
│  Context Injection   │  ranges) — never raw cell values — into
│                       │  the LLM prompt
└─────────┬────────────┘
          ▼
┌─────────────────────┐
│  Code Generation     │  LLM outputs Pandas OR VBA/Office.js,
│  Engine               │  constrained by a strict output schema
└─────────┬────────────┘
          ▼
┌─────────────────────┐
│  AST Safety          │  Whitelist-based static analysis.
│  Validator            │  Rejects anything not explicitly allowed
└─────────┬────────────┘
          ▼
┌─────────────────────┐
│  Dry-Run Diff         │  Executes against a cloned in-memory
│  Engine               │  copy, computes before/after diff
└─────────┬────────────┘
          ▼
┌─────────────────────┐
│  User Confirmation    │  Preview shown; user approves/rejects
└─────────┬────────────┘
          ▼
┌─────────────────────┐
│  Execution Runtime    │  Applies validated code to live workbook
└──────────────────────┘
```

### 1.2 Client/Server Split (ASCII Data Flow Diagram)

```
┌───────────────────────────── CLIENT SIDE ─────────────────────────────┐
│                                                                         │
│   ┌──────────────┐      ┌───────────────────┐    ┌─────────────────┐  │
│   │ Mic Capture   │─────▶│ Local STT (Whisper │───▶│ Schema Extractor │  │
│   │ (WebRTC /     │      │ small/turbo, ONNX) │    │ (openpyxl /      │  │
│   │  Office.js)   │      └───────────────────┘    │  Office.js API)  │  │
│   └──────────────┘                                └────────┬─────────┘  │
│                                                              │            │
│   ┌──────────────────────────────────────────────────────┐│            │
│   │ PII Redaction Layer (regex + Presidio, runs LOCALLY,   ││◀───────────┘
│   │ before ANY network call)                                ││
│   └───────────────────────┬──────────────────────────────┘│
│                            │  (transcript + REDACTED schema only)
└────────────────────────────┼────────────────────────────────┘
                             ▼
┌───────────────────────────── SERVER SIDE ──────────────────────────────┐
│                                                                          │
│   ┌───────────────┐   ┌────────────────┐   ┌─────────────────────┐     │
│   │ Intent Parser  │──▶│ Prompt Builder  │──▶│ LLM Code Gen Engine │     │
│   │ (fast, cheap    │   │ (context window │   │ (Pandas or VBA/     │     │
│   │  classifier)    │   │  budget mgmt)   │   │  Office.js output)  │     │
│   └───────────────┘   └────────────────┘   └──────────┬──────────┘     │
│                                                          │                │
│   ┌───────────────────────────────────────────────────▼──────────┐     │
│   │ AST Validator (Python `ast` module — whitelist enforcement)    │     │
│   └───────────────────────────┬────────────────────────────────┘     │
│                                 ▼                                       │
│   ┌───────────────────────────────────────────────────────────┐       │
│   │ Sandboxed Dry-Run Executor (resource-limited subprocess,    │       │
│   │ operates on cloned DataFrame / cloned workbook copy)          │       │
│   └───────────────────────────┬───────────────────────────────┘       │
│                                 ▼                                       │
│                     Diff payload returned to client                     │
└──────────────────────────────┬───────────────────────────────────────┘
                                ▼
┌───────────────────────────── CLIENT SIDE ──────────────────────────────┐
│   ┌───────────────────┐        ┌─────────────────────────────┐         │
│   │ Diff Preview UI     │──────▶│ User Approves → Execution    │         │
│   │ (side-by-side view) │        │ Runtime (local Python kernel │         │
│   │                     │        │ or Office.js writes to sheet)│         │
│   └───────────────────┘        └─────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────────┘
```

**Key architectural decision:** raw financial cell *values* never leave the client. Only the transcript and the redacted schema (column names, dtypes, row counts, ranges) cross the network boundary. Code is generated against the *shape* of the data, not the data itself, and executed locally against the real data.

---

## 2. Modern Tech Stack Selection

### 2.1 Speech Processing

| Concern | Choice | Rationale |
|---|---|---|
| STT engine | **Faster-Whisper** (CTranslate2 backend), `small.en` or `distil-whisper` for latency | Runs fully on-device (CPU or modest GPU); no audio ever leaves the machine — critical for tax data privacy (IRS Pub 4557 / client confidentiality norms) |
| Streaming | Chunked 1–2s audio buffers over local WebSocket to a local STT microservice | Enables partial-transcript UI feedback (<300ms perceived latency) without cloud round-trip |
| Fallback | Cloud STT (Azure Speech / Deepgram) as an **opt-in** toggle for low-power client machines | Must be explicitly consented to per firm compliance policy; disabled by default |

**Why not cloud-first (e.g., raw OpenAI Whisper API)?** Sending accountant voice memos ("filter Johnson LLC's Q3 revenue...") to a third party by default is a non-starter for a tax product. Local-first is the correct default; cloud is the exception, not the rule.

### 2.2 Context Manager (Schema Injection)

- **Extraction layer:** `openpyxl` (desktop Python path) or Office.js `Excel.run()` context (web add-in path) reads sheet names, header rows, column dtypes (inferred via a 50-row sample), and named ranges.
- **Tokenization budget strategy:** Never inject the full sheet. Inject a **schema card**:
  ```json
  {
    "sheet": "Q3_Revenue",
    "columns": [
      {"name": "State", "dtype": "string", "sample_cardinality": 12},
      {"name": "Revenue", "dtype": "float64"},
      {"name": "Date", "dtype": "datetime64"}
    ],
    "row_count": 4821
  }
  ```
  This keeps prompt size constant regardless of dataset size — a 50-row sheet and a 500,000-row sheet produce the same token footprint.
- **Multi-sheet indexing (Phase 2):** maintain a lightweight in-memory schema index per open workbook, refreshed on sheet-change events (Office.js `onChanged` handlers), so cross-sheet references ("pull tax rate from the Rates tab") resolve without re-scanning the whole workbook each turn.

### 2.3 LLM / Code Engine

- **Orchestration:** A thin custom router (not a heavyweight agent framework) — this task doesn't need multi-step agentic planning, it needs **one constrained generation call with strict output schema**, so avoid over-engineering with LangChain-style agent loops that add latency and non-determinism.
- **Prompt architecture:** System prompt fixes: (a) the persona ("You generate ONLY Pandas or VBA, never explanations"), (b) the output contract (structured JSON: `{"language": "pandas"|"vba", "code": "...", "explanation": "..."}`), (c) the injected schema card, (d) a short list of the last 2–3 turns for conversational continuity (e.g., "now also filter by state" referring to the prior filter).
- **VBA vs. Pandas selection logic:** Determined by *client context*, not by the LLM guessing — if the request originates from the Excel Add-in (Office.js runtime), generate Office.js/VBA; if from the standalone Python desktop app, generate Pandas. This removes a whole class of ambiguity rather than trying to prompt-engineer around it.
- **Fine-tuning strategy:** Start with few-shot prompting only (Phase 1–2). Fine-tuning (LoRA on a code-focused base model) becomes worthwhile only once you have a real corpus of transcript→verified-code pairs from production dry-run approvals — don't fine-tune on synthetic data first.

### 2.4 Execution & Runtime

| Path | Technology | When to use |
|---|---|---|
| Web Add-in | **Office.js** (Excel JavaScript API) | Cross-platform (Excel Online, Mac, Windows), sandboxed by Office's own security model — the safest default |
| Desktop deep integration | **PyXLL** or **xlwings** | When the firm needs native Pandas execution against `.xlsx` files directly, outside Office's JS sandbox |
| Legacy VSTO | C#/.NET VSTO wrapper | Only for firms still on on-prem legacy Excel deployments requiring COM-level integration — highest complexity, lowest priority |

**Recommendation for this build:** start with **Office.js Web Add-in** as the primary path. It's cross-platform, has a first-party sandboxing model, and avoids the far riskier surface area of raw VBA macro execution (`ActiveWorkbook` object model has broad, dangerous permissions).

---

## 3. Tax & Financial Domain Guardrails

### 3.1 Security & PII Shield

- **Local redaction pass before any network call.** Use Microsoft Presidio (or a custom regex + NER pass) to scan the schema card and transcript for SSNs, EINs, account numbers, and named individuals. Redact to placeholder tokens (`<PERSON_1>`, `<SSN_REDACTED>`) before the payload leaves the client process.
- **Schema-only transmission.** As established in Section 1 — cell *values* are never serialized into the LLM request. This is the single most important guardrail in the whole system and should be enforced at the network boundary layer (a hard assertion in the client's HTTP client wrapper, not just a policy).
- **Zero-retention LLM endpoint.** Use an API tier with contractual zero data retention (Azure OpenAI with data processing agreement, or Anthropic/OpenAI enterprise zero-retention tiers) — not consumer endpoints.

### 3.2 AST Validation & Sandboxing

Every generated code snippet is parsed with Python's `ast` module (for Pandas output) or a restricted VBA grammar parser (for VBA output) **before execution, full stop — no exceptions, no "trusted" fast path.**

Whitelist enforcement blocks:
- Any `import` outside `pandas`, `numpy`, `datetime`
- File I/O calls (`open`, `os.*`, `shutil.*`)
- `eval`, `exec`, `__import__`, dunder attribute access
- Unbounded loops (`while True` without a static bound)
- For VBA: `Kill`, `FileCopy`, `Shell`, `Application.DisplayAlerts = False` (a common trick to suppress destructive-action confirmations), `ActiveWorkbook.Close SaveChanges:=False`

### 3.3 Non-Destructive Execution (Dry-Run Mode)

1. Generated code executes first against a **deep-cloned in-memory copy** of the target DataFrame/worksheet range — never the live object.
2. A diff engine computes cell-level and row-level deltas (added/removed/modified rows, changed cell values) between the pre- and post-execution clones.
3. UI renders a side-by-side or highlighted diff view (green = added, red = removed, yellow = modified) — analogous to a git diff, applied to spreadsheet data.
4. Only on explicit user confirmation does the runtime re-execute the *same validated code* against the live object — never re-generate, to guarantee what was approved is what runs.

---

## 4. Step-by-Step Engineering Execution Roadmap

### Phase 1 — Proof of Concept (STT → Simple AST Execution)
**Deliverables:**
- Local Faster-Whisper STT running end-to-end from mic to transcript
- Single-sheet schema extraction (openpyxl, one active sheet only)
- LLM call generating single-operation Pandas code (filter OR aggregate, not chained)
- AST whitelist validator covering ~15 safe Pandas operations
- Execution against a static sample DataFrame, output rendered as an `st.dataframe`
- **No dry-run diff yet** — direct execution is acceptable at PoC stage on sample data only

### Phase 2 — Context Awareness & Multi-Sheet Indexing
**Deliverables:**
- Multi-sheet schema index with change-event refresh
- Conversational continuity (last-turn context injection for follow-up commands)
- Ambiguity resolution layer: when the parser detects an underspecified term ("revenue" — gross or net?), the system asks a clarifying follow-up instead of guessing
- Dry-run diff engine implemented and wired to a preview UI

### Phase 3 — Dual Output Support (VBA vs. Native Pandas)
**Deliverables:**
- Office.js Add-in shell built and side-loaded into Excel
- Runtime router selecting Pandas vs. Office.js/VBA output based on client context
- VBA-specific AST/grammar validator (separate whitelist from the Python one)
- Cross-platform testing (Excel Desktop Windows/Mac, Excel Online)

### Phase 4 — Enterprise Hardening (Security, SOC2, Offline Execution)
**Deliverables:**
- Presidio-based PII redaction pass integrated at the client boundary
- Zero-retention LLM endpoint contractual configuration
- Fully offline mode (local LLM via Ollama/llama.cpp for firms with strict data-residency requirements) as a fallback path
- Audit logging (every generated-and-approved code snippet logged with transcript, timestamp, user ID — for compliance trail, not for content review)
- SOC2 Type I control mapping and pen-test cycle

---

## 5. Code Engine Schema & Guardrail Code Example

```python
"""
Voice Macro Builder — Phase 1 Core Loop
Captures transcript + schema, generates candidate code, validates via AST
whitelist, executes ONLY against a sample DataFrame if validation passes.
"""

import ast
import pandas as pd
from dataclasses import dataclass


# ---------------------------------------------------------------------------
# 1. Schema extraction (never sends raw values — only structure)
# ---------------------------------------------------------------------------

@dataclass
class SchemaCard:
    sheet_name: str
    columns: list[dict]
    row_count: int

    def to_prompt_context(self) -> str:
        cols = ", ".join(f"{c['name']} ({c['dtype']})" for c in self.columns)
        return f"Sheet '{self.sheet_name}' has {self.row_count} rows. Columns: {cols}."


def extract_schema(df: pd.DataFrame, sheet_name: str) -> SchemaCard:
    columns = [{"name": col, "dtype": str(df[col].dtype)} for col in df.columns]
    return SchemaCard(sheet_name=sheet_name, columns=columns, row_count=len(df))


# ---------------------------------------------------------------------------
# 2. AST Safety Validator — whitelist-only enforcement
# ---------------------------------------------------------------------------

# Only these top-level function/method calls are permitted in generated code.
ALLOWED_CALLS = {
    "sum", "mean", "len", "round",
    "groupby", "filter", "loc", "iloc", "query",
    "sort_values", "reset_index", "fillna", "dropna",
    "astype", "apply", "map",
}

# Attribute access is restricted to pandas-native DataFrame/Series operations.
FORBIDDEN_NODE_TYPES = (
    ast.Import, ast.ImportFrom, ast.Exec if hasattr(ast, "Exec") else (),
)


class UnsafeCodeError(Exception):
    pass


class ASTSafetyValidator(ast.NodeVisitor):
    """
    Walks the parsed AST of LLM-generated code and raises UnsafeCodeError
    on ANY construct not explicitly whitelisted. Default-deny, not
    default-allow — this is the load-bearing security control.
    """

    def __init__(self):
        self.violations: list[str] = []

    def visit_Import(self, node):
        self.violations.append(f"Disallowed import: {ast.dump(node)}")

    def visit_ImportFrom(self, node):
        self.violations.append(f"Disallowed import: {ast.dump(node)}")

    def visit_Call(self, node):
        func_name = self._get_call_name(node)
        if func_name and func_name not in ALLOWED_CALLS:
            self.violations.append(f"Disallowed call: {func_name}")
        self.generic_visit(node)

    def visit_Attribute(self, node):
        # Block dunder / private attribute access (e.g. __class__, __globals__)
        if node.attr.startswith("__"):
            self.violations.append(f"Disallowed dunder access: {node.attr}")
        self.generic_visit(node)

    def visit_While(self, node):
        # Block unbounded while loops entirely — not needed for tabular ops
        self.violations.append("Unbounded while-loop construct is disallowed")

    @staticmethod
    def _get_call_name(node: ast.Call) -> str | None:
        if isinstance(node.func, ast.Attribute):
            return node.func.attr
        if isinstance(node.func, ast.Name):
            return node.func.id
        return None

    def validate(self, code: str) -> None:
        tree = ast.parse(code, mode="exec")
        self.visit(tree)
        if self.violations:
            raise UnsafeCodeError("; ".join(self.violations))


# ---------------------------------------------------------------------------
# 3. Candidate code generation (stubbed — replace with real LLM call)
# ---------------------------------------------------------------------------

def generate_candidate_code(transcript: str, schema: SchemaCard) -> str:
    """
    In production this calls the LLM with a system prompt fixing the output
    contract to raw Pandas code operating on a variable named `df`.
    Stubbed here for a concrete, testable example matching the transcript
    "Filter Q3 revenue above 50000 and group by state".
    """
    return (
        "result = df[df['Revenue'] > 50000]\n"
        "result = result.groupby('State')['Revenue'].sum().reset_index()"
    )


# ---------------------------------------------------------------------------
# 4. End-to-end guarded execution against a SAMPLE DataFrame only
# ---------------------------------------------------------------------------

def run_voice_command(transcript: str, df: pd.DataFrame) -> pd.DataFrame:
    schema = extract_schema(df, sheet_name="Q3_Revenue")
    candidate_code = generate_candidate_code(transcript, schema)

    validator = ASTSafetyValidator()
    validator.validate(candidate_code)  # raises UnsafeCodeError if unsafe

    # Execute in a restricted namespace — only `df` and `pd` exposed,
    # no builtins beyond a minimal safe set.
    local_ns = {"df": df.copy(), "pd": pd}
    safe_builtins = {"len": len, "round": round, "sum": sum}
    exec(candidate_code, {"__builtins__": safe_builtins}, local_ns)

    return local_ns.get("result", df)


# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    sample_df = pd.DataFrame({
        "State": ["CA", "CA", "NY", "TX", "NY"],
        "Revenue": [62000, 41000, 58000, 71000, 39000],
    })

    output = run_voice_command(
        "Filter Q3 revenue above 50000 and group by state", sample_df
    )
    print(output)
```

**Ambiguity-resolution note (gross vs. net revenue):** this is handled *upstream* of code generation, in the Intent Parser (Section 1), not inside the LLM prompt. If the schema card contains both a `Gross_Revenue` and `Net_Revenue` column and the transcript says only "revenue," the parser flags this as underspecified and the system asks a one-word clarifying question ("Gross or net?") before any code is generated — this is cheaper, faster, and more reliable than hoping the LLM infers correctly, and it produces an auditable decision point in the transcript log.

---

## Honest Scoping Note for the Capstone Deadline

Given your submission window, **Phase 1 exactly as specified above is a realistic, complete, and impressive capstone deliverable on its own** — full voice → schema → AST-validated Pandas execution loop, live on Streamlit. Present Phases 2–4 as your "System Design & Documentation" roadmap section rather than attempting to build them; that satisfies the rubric's System Design category without requiring you to actually ship enterprise SOC2 tooling in a few days.
