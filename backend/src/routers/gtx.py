# backend/src/routers/gtx.py
"""
GlobalGTX router — Global Trading X daily statement reconciliation.

Endpoints:
  GET    /api/gtx/state                 Full replay: summary, open/closed lots, recon log
  POST   /api/gtx/preview               Parse + dry-run replay for one pasted statement
  POST   /api/gtx/statements            Save statement (409 if date exists, unless overwrite)
  GET    /api/gtx/statements/{id}/raw   Original pasted text
  DELETE /api/gtx/statements/{id}       Delete statement
  GET    /api/gtx/settings              Engine parameters (defaults + overrides)
  PATCH  /api/gtx/settings              Update parameter overrides
"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from src.services import gtx_service as svc

router = APIRouter(prefix="/api/gtx", tags=["gtx"])


class StatementIn(BaseModel):
    stmt_date: str                # YYYY-MM-DD
    text: str                     # pasted email body or concatenated sections
    notes: Optional[str] = None
    overwrite: bool = False


class PreviewIn(BaseModel):
    stmt_date: str
    text: str


def _missing_table(e: Exception) -> bool:
    m = str(e).lower()
    return "gtx_" in m and ("does not exist" in m or "not find" in m or "42p01" in m)


@router.get("/state")
def state(account: str = svc.DEFAULT_ACCOUNT):
    try:
        return svc.get_state(account)
    except Exception as e:
        if _missing_table(e):
            raise HTTPException(503, "GTX tables not created yet — run sql/2026-09-29_gtx_statements.sql")
        raise


@router.post("/preview")
def preview(body: PreviewIn):
    try:
        return svc.preview(body.stmt_date, body.text)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/statements")
def create_statement(body: StatementIn):
    try:
        return svc.save_statement(body.stmt_date, body.text, body.notes, body.overwrite)
    except FileExistsError:
        return JSONResponse(status_code=409, content={"detail": f"Statement for {body.stmt_date} already exists"})
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.get("/statements/{stmt_id}/raw")
def statement_raw(stmt_id: int):
    row = svc.get_statement_raw(stmt_id)
    if not row:
        raise HTTPException(404, "Not found")
    return {"id": row["id"], "stmt_date": row["stmt_date"], "raw_text": row["raw_text"]}


@router.delete("/statements/{stmt_id}", status_code=204)
def delete_statement(stmt_id: int):
    svc.delete_statement(stmt_id)


@router.get("/settings")
def get_settings():
    return svc.get_settings()


@router.patch("/settings")
def patch_settings(body: dict):
    return svc.save_settings(body)
