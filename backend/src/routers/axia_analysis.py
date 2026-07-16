# backend/src/routers/axia_analysis.py
"""
AXIA Trade Analysis Router
Upload AXIA statement Excel -> deep quantitative analysis -> Excel report export.
"""

import io

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from src.services.analysis_service import (
    generate_excel_report,
    get_analysis,
    parse_statement,
    refresh_gbp_rates,
    store_analysis,
)

router = APIRouter(prefix="/api/analysis", tags=["analysis"])

# Fields kept server-side only -- never sent to the client
_INTERNAL_KEYS = {"_raw"}


def _strip_internal(data: dict) -> dict:
    """Remove server-only keys before sending data to the client."""
    return {k: v for k, v in data.items() if k not in _INTERNAL_KEYS}


@router.post("/upload")
async def upload_analysis(file: UploadFile = File(...)):
    """
    Parse uploaded AXIA statement Excel (.xlsx) and return full analysis JSON.
    Returns analysis_id (UUID) for use with the /export and /refresh-gbp endpoints.
    """
    if not (file.filename or "").lower().endswith((".xlsx", ".xls")):
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
    return {"analysis_id": analysis_id, "data": _strip_internal(data)}


@router.post("/{analysis_id}/refresh-gbp")
def refresh_gbp(analysis_id: str):
    """
    Re-fetch OANDA daily close rates for an existing analysis and recompute GBP view.
    Returns the updated gbp_* fields to be merged into the client data state.
    """
    if not get_analysis(analysis_id):
        raise HTTPException(
            status_code=404,
            detail="Analysis not found or expired -- please re-upload the file",
        )

    try:
        gbp_view = refresh_gbp_rates(analysis_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"GBP rate refresh error: {exc}") from exc

    return _strip_internal(gbp_view)


@router.get("/{analysis_id}/export")
def export_analysis(
    analysis_id: str,
    trader:  str  = Query(default="Unknown Trader"),
    account: str  = Query(default="--"),
    gbp:     bool = Query(default=False),
):
    """
    Generate and download the professional Excel analysis report.
    Pass ?gbp=true to export the GBP-converted report with FX Rate Log sheet.
    Uses the analysis stored from the /upload call (cached by analysis_id).
    """
    if not get_analysis(analysis_id):
        raise HTTPException(
            status_code=404,
            detail="Analysis not found or expired -- please re-upload the file",
        )

    try:
        xlsx_bytes = generate_excel_report(analysis_id, trader, account, gbp=gbp)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Export error: {exc}") from exc

    suffix   = "_GBP" if gbp else ""
    filename = f"AXIA-Analysis-{account}{suffix}.xlsx"
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}, 
    )
