# backend/src/routers/statement.py
"""
Statement upload router.

POST /api/statement/upload
  — Accepts a single PDF daily detail statement
  — Returns JSON (parsed rows) + downloadable Excel

POST /api/statement/upload-batch
  — Accepts multiple PDFs
  — Returns a ZIP of individual Excel files

POST /api/statement/merge
  — Accepts multiple .xlsx statement files
  — Returns a single merged Excel sorted chronologically

GET  /api/statement/download/{filename}
  — Serves a previously generated Excel file
"""

import io
import uuid
import zipfile
import tempfile
from pathlib import Path
from typing import List

from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from src.services.statement_service import extract_statement
from src.services.excel_writer      import write_statement_excel
from src.services.merge_service     import merge_statements


router = APIRouter(prefix="/api/statement", tags=["statement"])

_OUT_DIR = Path(tempfile.gettempdir()) / "chase_statements"
_OUT_DIR.mkdir(exist_ok=True)


@router.post("/upload")
async def upload_statement(file: UploadFile = File(...)):
    """Upload a PDF daily detail statement. Returns parsed data + Excel download token."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    pdf_bytes = await file.read()
    tmp_pdf   = _OUT_DIR / f"{uuid.uuid4()}.pdf"
    tmp_pdf.write_bytes(pdf_bytes)

    try:
        data = extract_statement(tmp_pdf)
    except Exception as exc:
        tmp_pdf.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=f"PDF parse error: {exc}")
    finally:
        tmp_pdf.unlink(missing_ok=True)

    if not data.get("rows"):
        raise HTTPException(status_code=422, detail="No trade data found in PDF.")

    token   = uuid.uuid4().hex
    client  = data.get("client",     "UNKNOWN")
    account = data.get("account",    "UNKNOWN")
    date    = data.get("trade_date", "unknown")
    xl_name = f"AXIA-{client}-{account}_{date}.xlsx"
    xl_path = _OUT_DIR / xl_name
    write_statement_excel(data, output_path=xl_path)

    return JSONResponse({
        "trade_date":      data.get("trade_date"),
        "client":          data.get("client"),
        "account":         data.get("account"),
        "row_count":       len(data["rows"]),
        "rows":            data["rows"],
        "download_token":  token,
        "filename":        xl_name,
    })


@router.post("/upload-batch")
async def upload_statement_batch(files: List[UploadFile] = File(...)):
    """Upload multiple PDF statements. Returns a ZIP of individual Excel files."""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    processed = []
    skipped   = []

    for f in files:
        if not f.filename.lower().endswith(".pdf"):
            skipped.append(f.filename)
            continue

        pdf_bytes = await f.read()
        tmp_pdf   = _OUT_DIR / f"{uuid.uuid4()}.pdf"
        tmp_pdf.write_bytes(pdf_bytes)

        try:
            data = extract_statement(tmp_pdf)
        except Exception as exc:
            skipped.append(f"{f.filename} (parse error: {exc})")
            continue
        finally:
            tmp_pdf.unlink(missing_ok=True)

        if not data.get("rows"):
            skipped.append(f"{f.filename} (no trade data found)")
            continue

        client  = data.get("client",     "UNKNOWN")
        account = data.get("account",    "UNKNOWN")
        date    = data.get("trade_date", "unknown")
        xl_name = f"AXIA-{client}-{account}_{date}.xlsx"
        xl_path = _OUT_DIR / xl_name
        write_statement_excel(data, output_path=xl_path)
        processed.append((xl_name, xl_path))

    if not processed:
        detail = "No valid PDFs could be parsed."
        if skipped:
            detail += " Skipped: " + "; ".join(skipped)
        raise HTTPException(status_code=422, detail=detail)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for xl_name, xl_path in processed:
            zf.write(xl_path, xl_name)
            xl_path.unlink(missing_ok=True)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=AXIA-Statements.zip"},
    )


@router.post("/merge")
async def merge_statement_excels(files: List[UploadFile] = File(...)):
    """
    Upload multiple AXIA statement Excel files.
    Returns a single merged Excel sorted chronologically.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    xl_paths = []
    try:
        for f in files:
            if not f.filename.lower().endswith(".xlsx"):
                raise HTTPException(
                    status_code=400,
                    detail=f"{f.filename} is not an .xlsx file.",
                )
            raw = await f.read()
            tmp = _OUT_DIR / f"{uuid.uuid4()}.xlsx"
            tmp.write_bytes(raw)
            xl_paths.append(tmp)

        merged_bytes = merge_statements(xl_paths)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Merge error: {exc}")
    finally:
        for p in xl_paths:
            p.unlink(missing_ok=True)

    return StreamingResponse(
        io.BytesIO(merged_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=AXIA-Merged-Statement.xlsx"},
    )


@router.get("/download/{filename}")
def download_statement(filename: str):
    """Download the Excel generated from a previous upload."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    xl_path = _OUT_DIR / filename
    if not xl_path.exists():
        raise HTTPException(status_code=404, detail="File not found or expired.")

    return FileResponse(
        path       = str(xl_path),
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename   = filename,
    )
