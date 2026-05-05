# backend/src/routers/reports.py
"""
/api/reports  —  download endpoints for Excel, PDF, and CSV reports.
/api/upload   —  CSV upload endpoint (replaces data files + clears cache).
"""

import os
import shutil
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import Response

from src.services import report_service  as rs
from src.services import data_service    as ds
from src.services import supabase_service as sb_svc

router = APIRouter(tags=["reports"])

# ---------------------------------------------------------------------------
# Configurable paths
# ---------------------------------------------------------------------------

DATA_DIR = os.environ.get(
    "DATA_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "data")
)

ALLOWED_CSV_NAMES = {"entities.csv", "snapshots.csv", "equity_curve.csv"}


# ---------------------------------------------------------------------------
# Excel download
# ---------------------------------------------------------------------------

@router.get("/api/reports/excel")
def download_excel(entity_id: str = "portfolio_main"):
    """Download the full metrics workbook as .xlsx."""
    try:
        content = rs.generate_excel(DATA_DIR, entity_id=entity_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return Response(
        content     = content,
        media_type  = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers     = {"Content-Disposition": "attachment; filename=chase_report.xlsx"},
    )


# ---------------------------------------------------------------------------
# PDF download
# ---------------------------------------------------------------------------

@router.get("/api/reports/pdf")
def download_pdf():
    """Download the investor-facing PDF summary."""
    try:
        content = rs.generate_pdf(DATA_DIR)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return Response(
        content     = content,
        media_type  = "application/pdf",
        headers     = {"Content-Disposition": "attachment; filename=chase_report.pdf"},
    )


# ---------------------------------------------------------------------------
# CSV download
# ---------------------------------------------------------------------------

@router.get("/api/reports/csv")
def download_csv():
    """Download the merged snapshots + entity metadata as CSV."""
    try:
        content = rs.generate_csv(DATA_DIR)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return Response(
        content     = content,
        media_type  = "text/csv",
        headers     = {"Content-Disposition": "attachment; filename=chase_data.csv"},
    )


# ---------------------------------------------------------------------------
# CSV upload  (replaces one of the three canonical data files)
# ---------------------------------------------------------------------------

@router.post("/api/upload")
async def upload_csv(file: UploadFile = File(...)):
    """
    Upload a replacement CSV (entities / snapshots / equity_curve).
    Saves the file to the data directory and clears the in-memory cache.
    """
    filename = file.filename
    if filename not in ALLOWED_CSV_NAMES:
        raise HTTPException(
            status_code=400,
            detail=f"Filename must be one of: {ALLOWED_CSV_NAMES}",
        )

    dest_path = os.path.join(DATA_DIR, filename)
    os.makedirs(DATA_DIR, exist_ok=True)

    try:
        with open(dest_path, "wb") as out:
            shutil.copyfileobj(file.file, out)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {exc}")
    finally:
        await file.close()

    # Clear all caches so next request picks up the new file
    ds.invalidate_cache()
    sb_svc.invalidate_all_cache()

    return {"status": "ok", "saved": filename}
