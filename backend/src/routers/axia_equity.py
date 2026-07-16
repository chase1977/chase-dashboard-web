# backend/src/routers/axia_equity.py
"""
AXIA Daily Equity router.

Endpoints:
  GET    /api/axia/clients              List all client/account pairs
  POST   /api/axia/clients              Create new client/account pair
  DELETE /api/axia/clients/{id}         Delete client

  GET    /api/axia/equity               List records ?client=&account=&limit=
  GET    /api/axia/equity/prev          Most recent record before a date
  POST   /api/axia/equity               Create record (409 on duplicate)
  PATCH  /api/axia/equity/{id}          Update record
  DELETE /api/axia/equity/{id}          Delete record
"""

from datetime import date as DateType
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from src.services.supabase_service import get_client


router = APIRouter(prefix="/api/axia", tags=["axia"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ClientCreate(BaseModel):
    client:  str
    account: str
    label:   Optional[str] = None


class EquityCreate(BaseModel):
    client:     str
    account:    str
    trade_date: str           # YYYY-MM-DD
    currency:   str = "GBP"
    equity:     float
    chg_nlv:    Optional[float] = None
    notes:      Optional[str]  = None


class EquityUpdate(BaseModel):
    trade_date: Optional[str]   = None
    currency:   Optional[str]   = None
    equity:     Optional[float] = None
    chg_nlv:    Optional[float] = None
    notes:      Optional[str]   = None


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------

@router.get("/clients")
def list_clients():
    sb   = get_client()
    rows = sb.table("axia_clients").select("*").order("created_at").execute().data or []
    return rows


@router.post("/clients", status_code=201)
def create_client(body: ClientCreate):
    sb = get_client()
    try:
        row = (
            sb.table("axia_clients")
            .insert({
                "client":  body.client.strip().upper(),
                "account": body.account.strip(),
                "label":   body.label,
            })
            .execute()
            .data[0]
        )
        return row
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Client/account already exists.")
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/clients/{client_id}", status_code=204)
def delete_client(client_id: str):
    sb = get_client()
    sb.table("axia_clients").delete().eq("id", client_id).execute()
    return JSONResponse(status_code=204, content=None)


# ---------------------------------------------------------------------------
# Equity records
# ---------------------------------------------------------------------------

@router.get("/equity")
def list_equity(
    client:  str = Query(...),
    account: str = Query(...),
    limit:   int = Query(60),
):
    sb = get_client()
    rows = (
        sb.table("axia_daily_equity")
        .select("*")
        .eq("client", client)
        .eq("account", account)
        .order("trade_date", desc=True)
        .limit(limit)
        .execute()
        .data or []
    )
    return rows


@router.get("/equity/prev")
def prev_equity(
    client:   str = Query(...),
    account:  str = Query(...),
    date:     str = Query(...),     # YYYY-MM-DD (exclusive upper bound)
    currency: str = Query("GBP"),
):
    """Return the most recent equity record strictly before `date`."""
    sb = get_client()
    rows = (
        sb.table("axia_daily_equity")
        .select("trade_date, equity, chg_nlv")
        .eq("client",   client)
        .eq("account",  account)
        .eq("currency", currency)
        .lt("trade_date", date)
        .order("trade_date", desc=True)
        .limit(1)
        .execute()
        .data or []
    )
    return rows[0] if rows else None


@router.post("/equity", status_code=201)
def create_equity(body: EquityCreate):
    sb = get_client()
    payload = {
        "client":     body.client,
        "account":    body.account,
        "trade_date": body.trade_date,
        "currency":   body.currency,
        "equity":     body.equity,
        "chg_nlv":    body.chg_nlv,
        "notes":      body.notes,
    }
    try:
        row = sb.table("axia_daily_equity").insert(payload).execute().data[0]
        return row
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(
                status_code=409,
                detail=f"Record already exists for {body.client}/{body.account} on {body.trade_date} ({body.currency}). Edit the existing row instead."
            )
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/equity/{record_id}")
def update_equity(record_id: str, body: EquityUpdate):
    sb      = get_client()
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    if not payload:
        raise HTTPException(status_code=400, detail="No fields to update.")
    try:
        rows = (
            sb.table("axia_daily_equity")
            .update(payload)
            .eq("id", record_id)
            .execute()
            .data
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Record not found.")
        return rows[0]
    except HTTPException:
        raise
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Another record already exists for that date/currency.")
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/equity/{record_id}", status_code=204)
def delete_equity(record_id: str):
    sb = get_client()
    sb.table("axia_daily_equity").delete().eq("id", record_id).execute()
    return JSONResponse(status_code=204, content=None)
