# backend/src/routers/ig_equity.py
"""
IG Daily Equity router.

Exact mirror of axia_equity.py, sourced from separate ig_clients /
ig_daily_equity tables (physically separate from AXIA's — kept apart so
each broker's history exports as its own clean spreadsheet, confirmed with
Nish 2026-08-27). A strategy links to an IG client via
strategies.ig_client_id, the IG counterpart of axia_client_id — see
_ig_strategy_agg in supabase_service.py for how that feeds Current
Equity/Total P&L, identical mechanism to AXIA.

Endpoints:
  GET    /api/ig/clients              List all client/account pairs
  POST   /api/ig/clients              Create new client/account pair
  PATCH  /api/ig/clients/{id}         Update client/account/label — cascades
                                       client/account text changes onto
                                       existing ig_daily_equity rows so
                                       history stays linked
  DELETE /api/ig/clients/{id}         Delete client

  GET    /api/ig/equity               Paginated records ?client=&account=&limit=&offset=
                                       Returns {rows, total} — total lets the
                                       frontend render Page X of Y / Next-Prev.
  GET    /api/ig/equity/prev          Most recent record before a date
  POST   /api/ig/equity               Create record (409 on duplicate)
  PATCH  /api/ig/equity/{id}          Update record
  DELETE /api/ig/equity/{id}          Delete record
"""

from datetime import date as DateType
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from src.services.supabase_service import get_client, invalidate_all_cache


router = APIRouter(prefix="/api/ig", tags=["ig"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ClientCreate(BaseModel):
    client:  str
    account: str
    label:   Optional[str] = None


class ClientPatch(BaseModel):
    client:  Optional[str] = None
    account: Optional[str] = None
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
    rows = sb.table("ig_clients").select("*").order("created_at").execute().data or []
    return rows


@router.post("/clients", status_code=201)
def create_client(body: ClientCreate):
    sb = get_client()
    try:
        row = (
            sb.table("ig_clients")
            .insert({
                "client":  body.client.strip().upper(),
                "account": body.account.strip(),
                "label":   body.label,
            })
            .execute()
            .data[0]
        )
        invalidate_all_cache()
        return row
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Client/account already exists.")
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/clients/{client_id}")
def update_client(client_id: str, body: ClientPatch):
    """
    Update a client's client/account/label. If client or account text changes,
    cascades that change onto every existing ig_daily_equity row so
    historical equity entries stay linked to the correct client — otherwise
    they'd silently orphan (row still exists, but no longer matches on
    client/account lookup).
    """
    sb = get_client()
    existing = sb.table("ig_clients").select("*").eq("id", client_id).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Client not found.")
    old = existing[0]

    fields = {}
    if body.client is not None:
        fields["client"] = body.client.strip().upper()
    if body.account is not None:
        fields["account"] = body.account.strip()
    if body.label is not None:
        fields["label"] = body.label.strip() or None
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update.")

    try:
        new_client  = fields.get("client",  old["client"])
        new_account = fields.get("account", old["account"])

        row = (
            sb.table("ig_clients")
            .update(fields)
            .eq("id", client_id)
            .execute()
            .data[0]
        )

        # Cascade client/account text change onto existing equity history
        if new_client != old["client"] or new_account != old["account"]:
            sb.table("ig_daily_equity").update({
                "client":  new_client,
                "account": new_account,
            }).eq("client", old["client"]).eq("account", old["account"]).execute()

        invalidate_all_cache()
        return row
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Another client already has that client/account.")
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/clients/{client_id}", status_code=204)
def delete_client(client_id: str):
    sb = get_client()
    sb.table("ig_clients").delete().eq("id", client_id).execute()
    invalidate_all_cache()
    return JSONResponse(status_code=204, content=None)


# ---------------------------------------------------------------------------
# Equity records
# ---------------------------------------------------------------------------

@router.get("/equity")
def list_equity(
    client:  str = Query(...),
    account: str = Query(...),
    limit:   int = Query(50),
    offset:  int = Query(0),
):
    """
    Paginated — applies to every client/account. Returns {rows, total} so
    the frontend can render "Page X of Y" and a Next/Prev control instead
    of silently truncating older history past `limit`.
    """
    sb = get_client()
    res = (
        sb.table("ig_daily_equity")
        .select("*", count="exact")
        .eq("client", client)
        .eq("account", account)
        .order("trade_date", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return {"rows": res.data or [], "total": res.count or 0}


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
        sb.table("ig_daily_equity")
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
        row = sb.table("ig_daily_equity").insert(payload).execute().data[0]
        invalidate_all_cache()
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
    sb = get_client()
    # exclude_unset (not "is not None") — a field the client actually sent as
    # null (e.g. clearing Notes) must still reach the update. Filtering on
    # "v is not None" silently dropped explicit nulls, so clearing Notes in
    # the edit row never persisted.
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No fields to update.")
    try:
        rows = (
            sb.table("ig_daily_equity")
            .update(payload)
            .eq("id", record_id)
            .execute()
            .data
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Record not found.")
        invalidate_all_cache()
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
    sb.table("ig_daily_equity").delete().eq("id", record_id).execute()
    invalidate_all_cache()
    return JSONResponse(status_code=204, content=None)
