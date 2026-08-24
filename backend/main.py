"""
Voice-Activated Excel Macro Builder — FastAPI Application
Main entry point for the backend server.

Serves the frontend, handles file uploads, processes voice commands
through the full pipeline, and manages execution approval.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.core.ast_validator import ASTSafetyValidator
from backend.core.code_generator import CodeGenerator
from backend.core.dry_run_engine import DryRunEngine
from backend.core.execution_runtime import ExecutionRuntime
from backend.core.intent_parser import IntentParser
from backend.core.pii_redactor import PIIRedactor
from backend.core.schema_extractor import SchemaExtractor
from backend.models.schemas import (
    CodeLanguage, ExecuteRequest, ExecutionResult, HistoryEntry,
    PipelineResponse, PipelineStage, VoiceCommandRequest,
)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)-25s | %(levelname)-7s | %(message)s",
)
logger = logging.getLogger("voice_macro_builder")

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Voice-Activated Excel Macro Builder",
    description="AI-powered voice-to-code pipeline for tax professionals",
    version="1.0.0",
)

# CORS — allow frontend on different port during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Global state (single-user for capstone demo)
# ---------------------------------------------------------------------------

schema_extractor = SchemaExtractor()
code_generator = CodeGenerator()
dry_run_engine = DryRunEngine()
execution_runtime = ExecutionRuntime()
pii_redactor = PIIRedactor()

# Current session state
current_file: Optional[str] = None
current_sheet: Optional[str] = None
current_df: Optional[pd.DataFrame] = None
original_df: Optional[pd.DataFrame] = None
command_history: list[HistoryEntry] = []
pending_code: Optional[str] = None
pending_transcript: Optional[str] = None

# ---------------------------------------------------------------------------
# Static file serving — frontend
# ---------------------------------------------------------------------------

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


@app.get("/")
async def serve_index():
    """Serve the main dashboard page."""
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return JSONResponse({"error": "Frontend not found"}, status_code=404)


# Mount static assets after the root route
if FRONTEND_DIR.exists():
    app.mount("/css", StaticFiles(directory=str(FRONTEND_DIR / "css")), name="css")
    app.mount("/js", StaticFiles(directory=str(FRONTEND_DIR / "js")), name="js")
    if (FRONTEND_DIR / "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/status")
async def get_status():
    """Return current application state."""
    return {
        "status": "ready",
        "has_file": current_file is not None,
        "current_file": current_file,
        "current_sheet": current_sheet,
        "has_llm": code_generator.has_llm,
        "history_count": len(command_history),
    }


@app.post("/api/upload-excel")
async def upload_excel(file: UploadFile = File(...)):
    """
    Upload an Excel file and extract its schema.
    Raw cell values are cached locally but NEVER sent to any external service.
    """
    global current_file, current_sheet, current_df, original_df

    if not file.filename.endswith((".xlsx", ".xls", ".xlsm")):
        raise HTTPException(400, "Only .xlsx, .xls, .xlsm files are supported")

    try:
        file_bytes = await file.read()
        workbook_schema = schema_extractor.extract_from_bytes(file_bytes, file.filename)

        current_file = file.filename
        current_sheet = workbook_schema.active_sheet

        # Cache the active sheet's DataFrame and pristine original backup
        current_df = schema_extractor.get_dataframe(file.filename, current_sheet)
        original_df = schema_extractor.get_original_dataframe(file.filename, current_sheet)
        if original_df is None and current_df is not None:
            original_df = current_df.copy(deep=True)

        logger.info(
            f"Uploaded: {file.filename} — "
            f"{len(workbook_schema.sheets)} sheets, "
            f"active: {current_sheet}"
        )

        return {
            "success": True,
            "schema": workbook_schema.model_dump(),
        }

    except Exception as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(500, f"Failed to process file: {str(e)}")


@app.post("/api/set-active-sheet")
async def set_active_sheet(request: dict):
    """Switch the active sheet for operations."""
    global current_sheet, current_df, original_df

    sheet_name = request.get("sheet_name")
    if not current_file:
        raise HTTPException(400, "No file uploaded")

    df = schema_extractor.get_dataframe(current_file, sheet_name)
    if df is None:
        raise HTTPException(404, f"Sheet '{sheet_name}' not found")

    current_sheet = sheet_name
    current_df = df
    orig = schema_extractor.get_original_dataframe(current_file, sheet_name)
    original_df = orig if orig is not None else df.copy(deep=True)

    schema = schema_extractor.get_sheet_schema(current_file, sheet_name)
    return {
        "success": True,
        "active_sheet": sheet_name,
        "schema": schema.model_dump() if schema else None,
    }


@app.post("/api/process-voice")
async def process_voice_command(request: VoiceCommandRequest):
    """
    Main pipeline endpoint: transcript → intent → schema → code → validate → dry-run.
    Returns the complete pipeline result for frontend display.
    """
    global current_df, pending_code, pending_transcript

    transcript = request.transcript
    logger.info(f"Processing voice command: '{transcript}'")

    if not current_file or current_df is None:
        raise HTTPException(400, "Please upload an Excel file or load sample data first")

    try:
        # Stage 1: PII Redaction
        redaction_report = pii_redactor.redact(transcript)
        safe_transcript = redaction_report.redacted_text

        # Stage 2: Get schema for current sheet
        schema = schema_extractor.get_sheet_schema(current_file, current_sheet)
        if not schema:
            schema = schema_extractor.extract_sheet_schema(current_df, current_sheet or "Sheet1")

        # Stage 3: Parse intent
        parser = IntentParser(schema=schema)
        intent = parser.parse(safe_transcript)

        # Check for ambiguities — return them for clarification
        if intent.ambiguities:
            return PipelineResponse(
                stage=PipelineStage.ERROR,
                transcript=transcript,
                intent=intent,
                schema_card=schema,
                redaction_report=redaction_report,
                error=f"Clarification needed: {'; '.join(intent.ambiguities)}",
            ).model_dump()

        # Stage 4: Generate code
        generated = code_generator.generate(
            transcript=safe_transcript,
            intent=intent,
            schema=schema,
        )

        # Stage 5: AST Validation
        validator = ASTSafetyValidator()
        validation = validator.validate(generated.code)

        if not validation.is_safe:
            violations_str = "; ".join(v.message for v in validation.violations)
            return PipelineResponse(
                stage=PipelineStage.ERROR,
                transcript=transcript,
                intent=intent,
                schema_card=schema,
                generated_code=generated,
                validation=validation,
                redaction_report=redaction_report,
                error=f"Generated code failed safety check: {violations_str}",
            ).model_dump()

        # Stage 6: Dry-run execution
        try:
            diff, result_df = dry_run_engine.execute_dry_run(
                code=generated.code,
                df=current_df,
                validation=validation,
            )
        except RuntimeError as e:
            return PipelineResponse(
                stage=PipelineStage.ERROR,
                transcript=transcript,
                intent=intent,
                schema_card=schema,
                generated_code=generated,
                validation=validation,
                redaction_report=redaction_report,
                error=f"Dry-run execution failed: {str(e)}",
            ).model_dump()

        # Cache pending code and transcript for approval
        pending_code = generated.code
        pending_transcript = transcript

        # Return full pipeline result (awaiting approval)
        return PipelineResponse(
            stage=PipelineStage.AWAITING_APPROVAL,
            transcript=transcript,
            intent=intent,
            schema_card=schema,
            generated_code=generated,
            validation=validation,
            diff=diff,
            redaction_report=redaction_report,
        ).model_dump()

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Pipeline error: {e}", exc_info=True)
        return PipelineResponse(
            stage=PipelineStage.ERROR,
            transcript=transcript,
            error=str(e),
        ).model_dump()


@app.post("/api/execute")
async def execute_approved_code(request: ExecuteRequest):
    """
    Execute user-approved code against the live DataFrame.
    Uses the SAME validated code from the dry-run — never re-generates.
    """
    global current_df, current_file, current_sheet, pending_transcript

    if current_df is None:
        raise HTTPException(400, "No data loaded")

    code = request.code

    # Re-validate (belt and suspenders)
    validator = ASTSafetyValidator()
    validation = validator.validate(code)
    if not validation.is_safe:
        raise HTTPException(400, "Code failed safety re-validation")

    try:
        result, result_df = execution_runtime.execute(code, current_df)

        if result.success:
            # Update the live DataFrame
            current_df = result_df

            # Dynamically update the workbook schema cache so future queries know new columns
            updated_schema = None
            if current_file and current_sheet:
                updated_schema = schema_extractor.update_sheet_dataframe(current_file, current_sheet, current_df)
                result.updated_schema = updated_schema

            # Log to history
            transcript_text = request.transcript or pending_transcript or "Executed operation"
            history_entry = HistoryEntry(
                id=str(uuid.uuid4()),
                transcript=transcript_text,
                intent_type="EXECUTED",
                code=code,
                language=request.language,
                was_executed=True,
                timestamp=datetime.now(),
                result_summary=result.message,
            )
            command_history.append(history_entry)

        return result.model_dump()

    except Exception as e:
        logger.error(f"Execution error: {e}")
        raise HTTPException(500, f"Execution failed: {str(e)}")


@app.post("/api/reject")
async def reject_code():
    """Reject the pending code — no changes applied."""
    global pending_code, pending_transcript
    pending_code = None
    pending_transcript = None
    return {"success": True, "message": "Changes rejected — no modifications made"}


@app.post("/api/reset-data")
async def reset_data():
    """Complete app reset: Wipe all history, delete executed commands, and reset whole app to sample_tax_data.xlsx."""
    global current_df, original_df, current_file, current_sheet, command_history, pending_code, pending_transcript

    command_history.clear()
    pending_code = None
    pending_transcript = None

    # Always reset the entire app back to the default sample_tax_data.xlsx
    return await generate_sample_data()


@app.post("/api/clear-history")
async def clear_history():
    """Clear all command execution history."""
    global command_history
    command_history.clear()
    return {"success": True, "message": "Command history cleared"}


@app.get("/api/history")
async def get_history():
    """Return command execution history for the audit trail."""
    return {
        "history": [h.model_dump() for h in reversed(command_history[-50:])],
        "total": len(command_history),
    }


@app.get("/api/current-data")
async def get_current_data():
    """Return a preview of the current DataFrame state."""
    if current_df is None:
        return {"data": [], "columns": [], "row_count": 0}

    preview = []
    for _, row in current_df.head(100).iterrows():
        record = {}
        for col in current_df.columns:
            val = row[col]
            if val is None or (isinstance(val, float) and np.isnan(val)) or pd.isna(val):
                record[str(col)] = None
            elif isinstance(val, (pd.Timestamp, np.datetime64)):
                record[str(col)] = pd.to_datetime(val).strftime("%Y-%m-%d")
            else:
                record[str(col)] = str(val)
        preview.append(record)

    return {
        "data": preview,
        "columns": [str(c) for c in current_df.columns],
        "row_count": len(current_df),
    }


@app.post("/api/generate-sample")
async def generate_sample_data():
    """
    Generate a sample tax dataset for demo purposes.
    Useful when no real Excel file is available.
    """
    global current_file, current_sheet, current_df, original_df, command_history, pending_code, pending_transcript

    command_history.clear()
    pending_code = None
    pending_transcript = None

    sample_df = pd.DataFrame({
        "Client_Name": [
            "Acme Corp", "Beta Industries", "Gamma LLC",
            "Delta Partners", "Epsilon Inc", "Zeta Holdings",
            "Eta Solutions", "Theta Group", "Iota Services", "Kappa Ltd",
            "Lambda Corp", "Mu Associates", "Nu Technologies",
            "Xi Enterprises", "Omicron LLC"
        ],
        "State": [
            "CA", "NY", "TX", "FL", "CA", "NY",
            "TX", "FL", "CA", "NY", "TX", "FL", "CA", "NY", "TX"
        ],
        "Gross_Revenue": [
            520000, 380000, 710000, 290000, 450000, 630000,
            180000, 540000, 670000, 320000, 490000, 150000,
            890000, 410000, 560000
        ],
        "Net_Revenue": [
            468000, 342000, 639000, 261000, 405000, 567000,
            162000, 486000, 603000, 288000, 441000, 135000,
            801000, 369000, 504000
        ],
        "Tax_Amount": [
            78000, 57000, 106500, 43500, 67500, 94500,
            27000, 81000, 100500, 48000, 73500, 22500,
            133500, 61500, 84000
        ],
        "Filing_Status": [
            "Filed", "Pending", "Filed", "Overdue", "Filed", "Pending",
            "Filed", "Filed", "Pending", "Filed", "Overdue", "Filed",
            "Filed", "Pending", "Filed"
        ],
        "Quarter": [
            "Q1", "Q1", "Q1", "Q2", "Q2", "Q2",
            "Q3", "Q3", "Q3", "Q4", "Q4", "Q4",
            "Q1", "Q2", "Q3"
        ],
        "Filing_Date": pd.to_datetime([
            "2024-04-15", "2024-04-14", "2024-04-12", "2024-07-15",
            "2024-07-10", "2024-07-14", "2024-10-15", "2024-10-12",
            "2024-10-14", "2025-01-15", "2025-01-14", "2025-01-12",
            "2024-04-10", "2024-07-12", "2024-10-11"
        ]),
    })

    current_file = "sample_tax_data.xlsx"
    current_sheet = "Tax_Data"
    current_df = sample_df
    original_df = sample_df.copy(deep=True)

    # Create schema
    from backend.models.schemas import ColumnSchema, SchemaCard, WorkbookSchema

    columns = []
    for col in sample_df.columns:
        dtype_str = str(sample_df[col].dtype)
        if "datetime" in dtype_str:
            dtype_str = "datetime64"
        elif "int" in dtype_str:
            dtype_str = "int64"
        elif "float" in dtype_str:
            dtype_str = "float64"
        else:
            dtype_str = "string"
        columns.append(ColumnSchema(
            name=str(col),
            dtype=dtype_str,
            sample_cardinality=int(sample_df[col].nunique()),
        ))

    schema = SchemaCard(
        sheet_name="Tax_Data",
        columns=columns,
        row_count=len(sample_df),
    )

    # Cache the schema and original dataframes
    schema_extractor._workbook_cache[current_file] = WorkbookSchema(
        filename=current_file,
        sheets=[schema],
        active_sheet=current_sheet,
    )
    schema_extractor._dataframe_cache[current_file] = {current_sheet: sample_df.copy(deep=True)}
    schema_extractor._original_dataframe_cache[current_file] = {current_sheet: sample_df.copy(deep=True)}

    return {
        "success": True,
        "schema": WorkbookSchema(
            filename=current_file,
            sheets=[schema],
            active_sheet=current_sheet,
        ).model_dump(),
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
