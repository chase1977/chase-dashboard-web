# backend/src/routers/axia_equity.py
"""
AXIA Daily Equity router.

Endpoints:
  GET    /api/axia/clients              List all client/account pairs
  POST   /api/axia/clients              Create new client/account pair
  PATCH  /api/axia/clients/{id}         Update client/account/label — cascades
                                         client/account text changes onto
                                         existing axia_daily_equity rows so
                                         history stays linked
  DELETE /api/axia/clients/{id}         Delete client

  GET    /api/axia/equity               Paginated records ?client=&account=&limit=&offset=
                                         Returns {rows, total} — total lets the
                                         frontend render Page X of Y / Next-Prev.
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

from src.services.supabase_service import (
    get_client, invalidate_all_cache,
    sync_capital_flow_transfer, resync_capital_flow_transfer, delete_capital_flow_transfer,
    CAPITAL_FLOW_TYPES,
)


router = APIRouter(prefix="/api/axia", tags=["axia"])


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
    # 'initial' | 'addon' | None (ordinary trading day) — see
    # supabase_service.sync_capital_flow_transfer for what this triggers.
    capital_flow_type: Optional[str] = None


class EquityUpdate(BaseModel):
    trade_date: Optional[str]   = None
    currency:   Optional[str]   = None
    equity:     Optional[float] = None
    chg_nlv:    Optional[float] = None
    notes:      Optional[str]   = None
    capital_flow_type: Optional[str] = None


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
    cascades that change onto every existing axia_daily_equity row so
    historical equity entries stay linked to the correct client — otherwise
    they'd silently orphan (row still exists, but no longer matches on
    client/account lookup).
    """
    sb = get_client()
    existing = sb.table("axia_clients").select("*").eq("id", client_id).execute().data
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
            sb.table("axia_clients")
            .update(fields)
            .eq("id", client_id)
            .execute()
            .data[0]
        )

        # Cascade client/account text change onto existing equity history
        if new_client != old["client"] or new_account != old["account"]:
            sb.table("axia_daily_equity").update({
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
    sb.table("axia_clients").delete().eq("id", client_id).execute()
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
    Paginated — applies to every client/account, not just AXIA-TW. Returns
    {rows, total} so the frontend can render "Page X of Y" and a Next/Prev
    control instead of silently truncating older history past `limit`.
    """
    sb = get_client()
    res = (
        sb.table("axia_daily_equity")
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
    if body.capital_flow_type is not None and body.capital_flow_type not in CAPITAL_FLOW_TYPES:
        raise HTTPException(status_code=400, detail=f"capital_flow_type must be one of {CAPITAL_FLOW_TYPES}.")
    payload = {
        "client":     body.client,
        "account":    body.account,
        "trade_date": body.trade_date,
        "currency":   body.currency,
        "equity":     body.equity,
        "chg_nlv":    body.chg_nlv,
        "notes":      body.notes,
        "capital_flow_type":   body.capital_flow_type,
        "capital_transfer_id": None,
    }
    # Insert the equity row FIRST, before any capital_transfers ledger side
    # effect. Bugfix 2026-09-21 (OPTIOS report — Capital Invested showed
    # exactly double a single equity row's value): the old order created the
    # ledger row BEFORE this insert, so when the insert then hit the
    # (client,account,trade_date,currency) unique constraint — e.g. a
    # double-submit — the ledger row it had already committed had nothing
    # to roll it back, leaving an orphan contribution baked permanently into
    # the strategy's baseline. Now a genuine duplicate 409s here with zero
    # side effects; the ledger row is only created after this succeeds, and
    # if THAT then fails we delete the row we just inserted so nothing
    # half-persists either way.
    try:
        row = sb.table("axia_daily_equity").insert(payload).execute().data[0]
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(
                status_code=409,
                detail=f"Record already exists for {body.client}/{body.account} on {body.trade_date} ({body.currency}). Edit the existing row instead."
            )
        raise HTTPException(status_code=500, detail=str(exc))

    if body.capital_flow_type:
        contribution = body.chg_nlv if body.chg_nlv is not None else body.equity
        try:
            transfer_id = sync_capital_flow_transfer(
                client_table="axia_clients", client=body.client, account=body.account,
                client_field="axia_client_id", feed_id=None,
                trade_date=body.trade_date, contribution=contribution,
                capital_flow_type=body.capital_flow_type, label="AXIA",
            )
            row = sb.table("axia_daily_equity").update({"capital_transfer_id": transfer_id}).eq("id", row["id"]).execute().data[0]
        except ValueError as exc:
            sb.table("axia_daily_equity").delete().eq("id", row["id"]).execute()
            raise HTTPException(status_code=400, detail=str(exc))

    invalidate_all_cache()
    return row


@router.patch("/equity/{record_id}")
def update_equity(record_id: str, body: EquityUpdate):
    sb = get_client()
    existing = sb.table("axia_daily_equity").select("*").eq("id", record_id).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Record not found.")
    old = existing[0]

    # exclude_unset (not "is not None") — a field the client actually sent as
    # null (e.g. clearing Notes) must still reach the update. Filtering on
    # "v is not None" silently dropped explicit nulls, so clearing Notes in
    # the edit row never persisted.
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No fields to update.")
    if payload.get("capital_flow_type") is not None and payload["capital_flow_type"] not in CAPITAL_FLOW_TYPES:
        raise HTTPException(status_code=400, detail=f"capital_flow_type must be one of {CAPITAL_FLOW_TYPES}.")

    new_type     = payload["capital_flow_type"] if "capital_flow_type" in payload else old.get("capital_flow_type")
    new_date     = payload.get("trade_date", old["trade_date"])
    new_chg      = payload["chg_nlv"] if "chg_nlv" in payload else old.get("chg_nlv")
    new_eq       = payload.get("equity", old.get("equity"))
    contribution = new_chg if new_chg is not None else new_eq

    # Apply the row update FIRST — same root cause/fix as create_equity
    # above. Ledger sync only happens once this succeeds; if it then fails,
    # the row is reverted back to its pre-update values so nothing
    # half-applies either way.
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
    except HTTPException:
        raise
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Another record already exists for that date/currency.")
        raise HTTPException(status_code=500, detail=str(exc))

    saved = rows[0]
    try:
        if old.get("capital_transfer_id") and new_type not in CAPITAL_FLOW_TYPES:
            # Un-flagged back to a normal trading day — drop the linked ledger row.
            delete_capital_flow_transfer(old["capital_transfer_id"])
            saved = sb.table("axia_daily_equity").update({"capital_transfer_id": None}).eq("id", record_id).execute().data[0]
        elif new_type in CAPITAL_FLOW_TYPES:
            if old.get("capital_transfer_id"):
                resync_capital_flow_transfer(old["capital_transfer_id"], new_date, contribution, new_type, "AXIA")
            else:
                transfer_id = sync_capital_flow_transfer(
                    client_table="axia_clients", client=old["client"], account=old["account"],
                    client_field="axia_client_id", feed_id=None,
                    trade_date=new_date, contribution=contribution,
                    capital_flow_type=new_type, label="AXIA",
                )
                saved = sb.table("axia_daily_equity").update({"capital_transfer_id": transfer_id}).eq("id", record_id).execute().data[0]
    except ValueError as exc:
        revert_fields = {k: old.get(k) for k in payload.keys()}
        sb.table("axia_daily_equity").update(revert_fields).eq("id", record_id).execute()
        raise HTTPException(status_code=400, detail=str(exc))

    invalidate_all_cache()
    return saved


@router.delete("/equity/{record_id}", status_code=204)
def delete_equity(record_id: str):
    sb = get_client()
    existing = sb.table("axia_daily_equity").select("capital_transfer_id").eq("id", record_id).execute().data
    if existing and existing[0].get("capital_transfer_id"):
        delete_capital_flow_transfer(existing[0]["capital_transfer_id"])
    sb.table("axia_daily_equity").delete().eq("id", record_id).execute()
    invalidate_all_cache()
    return JSONResponse(status_code=204, content=None)
