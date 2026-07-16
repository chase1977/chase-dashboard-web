# backend/src/routers/axia_analysis.py
"""
AXIA Trade Analysis Router
Upload AXIA statement Excel → deep quantitative analysis → Excel report export.
"""

import io

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from src.services.analysis_service import (
    generate_excel_report,
    get_analysis,
    parse_statement,
    store_analysis,
)

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.post("/upload")
async def upload_analysis(file: UploadFile = File(...)):
    """
    Parse uploaded AXIA statement Excel (.xlsx) and return full analysis JSON.
    Returns analysis_id (UUID) for use with the /export endpoint.
    """
    if not (file.filename or '').lower().endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Only .xlsx / .xls files accepted")

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File exceeds 20 MB limit")

    try:
        data = parse_statement(content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Parse error: {exc}") from exc

    analysis_id = store_analysis(data)
    return {"analysis_id": analysis_id, "data": data}


@router.get("/{analysis_id}/export")
def export_analysis(
    analysis_id: str,
    trader:  str = Query(default="Unknown Trader"),
    account: str = Query(default="—"),
):
    """
    Generate and download the professional Excel analysis report.
    Uses the analysis stored from the /upload call (cached by analysis_id).
    """
    if not get_analysis(analysis_id):
        raise HTTPException(
            status_code=404,
            detail="Analysis not found or expired — please re-upload the file"
        )

    try:
        xlsx_bytes = generate_excel_report(analysis_id, trader, account)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Export error: {exc}") from exc

    filename = f"AXIA-Analysis-{account}.xlsx"
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
