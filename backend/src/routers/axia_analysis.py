# backend/src/routers/axia_analysis.py
"""
AXIA Trade Analysis Router
Upload AXIA statement Excel -> deep quantitative analysis -> Excel report export.
"""

import io

from fastapi import APIRouter, Body, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from src.services.analysis_service import (
    delete_saved_analysis,
    generate_excel_report,
    get_analysis,
    get_saved_analysis,
    list_saved_analyses,
    parse_statement,
    persist_analysis,
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


# ---------------------------------------------------------------------------
# Save / Share -- persists an analysis to Supabase so it survives backend
# restarts, can be reopened without re-uploading, and can be shared via a
# public read-only link (frontend route: /analysis/shared/{analysis_id}).
# No auth layer -- consistent with the rest of this app; the link itself
# (an unguessable UUID) is the access control.
# ---------------------------------------------------------------------------

@router.post("/{analysis_id}/save")
def save_analysis(analysis_id: str, body: dict = Body(...)):
    """
    Persist the cached analysis for `analysis_id` to Supabase.
    Body: { trader: str, account: str, label?: str }
    Returns { analysis_id, share_path } -- share_path is the frontend route
    to append to the site origin for the shareable link.
    """
    trader  = (body.get("trader")  or "Unknown Trader").strip()
    account = (body.get("account") or "--").strip()
    label   = (body.get("label") or "").strip() or None

    try:
        saved_id = persist_analysis(analysis_id, trader, account, label)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Save error: {exc}") from exc

    return {"analysis_id": saved_id, "share_path": f"/analysis/shared/{saved_id}"}


@router.get("/saved")
def list_saved():
    """Lightweight list of all saved analyses (no jsonb payload) for the Saved Analyses panel."""
    try:
        return list_saved_analyses()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"List error: {exc}") from exc


@router.get("/saved/{analysis_id}")
def get_saved(analysis_id: str):
    """
    Fetch a saved analysis by id -- used both to reopen your own saved work
    and to serve the public /analysis/shared/{id} read-only page.
    """
    try:
        result = get_saved_analysis(analysis_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Fetch error: {exc}") from exc

    if not result:
        raise HTTPException(status_code=404, detail="Saved analysis not found -- it may have been deleted")

    result["data"] = _strip_internal(result["data"])
    return result


@router.delete("/saved/{analysis_id}")
def delete_saved(analysis_id: str):
    """Delete a saved analysis (revokes its share link permanently)."""
    try:
        ok = delete_saved_analysis(analysis_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Delete error: {exc}") from exc

    if not ok:
        raise HTTPException(status_code=404, detail="Saved analysis not found")
    return {"deleted": True}
