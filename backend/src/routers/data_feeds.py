# backend/src/routers/data_feeds.py
"""
Data Feeds router — the self-service "tab-builder" system (confirmed with
Nish 2026-09-01). Lets Nish create a brand-new broker/statement intake tab
(e.g. INVESTGTX) from the Data & Reports UI without Claude hand-writing a
new router file each time.

Two-step creation flow (per standing rule — Claude never runs SQL):
  1. POST /api/data-feeds/preview-sql  -> exact CREATE TABLE text for the
     new feed's physical table(s). Nish copies + runs it once in Supabase.
  2. POST /api/data-feeds              -> inserts the registry row. Only
     call this AFTER the SQL above has actually run — every other endpoint
     here assumes the resolved table already exists.

Endpoints:
  GET    /api/data-feeds                    List every registered feed
  POST   /api/data-feeds/preview-sql        SQL text only, no execution
  POST   /api/data-feeds                    Create registry row (tables must already exist)
  PATCH  /api/data-feeds/{id}               Edit name/color/currency/sort_order
                                             (cadence + table names are immutable post-creation)
  DELETE /api/data-feeds/{id}               Remove registry row (blocked if any
                                             strategy is still linked to it)

  Daily-cadence feeds (mirrors axia_equity.py / ig_equity.py exactly, table
  names resolved from the registry instead of hardcoded):
  GET    /api/data-feeds/{slug}/clients
  POST   /api/data-feeds/{slug}/clients
  PATCH  /api/data-feeds/{slug}/clients/{id}
  DELETE /api/data-feeds/{slug}/clients/{id}
  GET    /api/data-feeds/{slug}/equity
  GET    /api/data-feeds/{slug}/equity/prev
  POST   /api/data-feeds/{slug}/equity
  PATCH  /api/data-feeds/{slug}/equity/{id}
  DELETE /api/data-feeds/{slug}/equity/{id}

  Monthly-cadence feeds (mirrors fund_statements.py exactly, table resolved
  from the registry):
  GET    /api/data-feeds/{slug}/statements
  GET    /api/data-feeds/{slug}/statements/prev
  POST   /api/data-feeds/{slug}/statements
  PATCH  /api/data-feeds/{slug}/statements/{id}
  POST   /api/data-feeds/{slug}/statements/{id}/refetch-fx
  DELETE /api/data-feeds/{slug}/statements/{id}
"""

import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from src.services.supabase_service import (
    get_client, invalidate_all_cache, get_data_feed_by_slug,
    list_fund_statements, get_fund_statement_prev, create_fund_statement,
    update_fund_statement, delete_fund_statement, refetch_fund_statement_fx,
)

router = APIRouter(prefix="/api/data-feeds", tags=["data-feeds"])

SLUG_RE = re.compile(r"^[a-z][a-z0-9_]{1,30}$")


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return s[:31]


def _require_feed(slug: str) -> dict:
    feed = get_data_feed_by_slug(slug)
    if not feed:
        raise HTTPException(status_code=404, detail=f"No data feed with slug '{slug}'.")
    return feed


def _require_cadence(feed: dict, cadence: str) -> None:
    if feed.get("cadence") != cadence:
        raise HTTPException(
            status_code=400,
            detail=f"Feed '{feed['slug']}' is {feed.get('cadence')} cadence — this endpoint is {cadence}-only.",
        )


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class FeedCreate(BaseModel):
    name:     str
    slug:     Optional[str] = None   # auto-derived from name if omitted
    color:    str = "#38BDF8"
    cadence:  str            # 'daily' | 'monthly'
    currency: str = "GBP"
    sort_order: int = 0


class FeedPatch(BaseModel):
    name:       Optional[str] = None
    color:      Optional[str] = None
    currency:   Optional[str] = None
    sort_order: Optional[int] = None


class SqlPreviewRequest(BaseModel):
    name:    str
    slug:    Optional[str] = None
    cadence: str


@router.get("")
def list_feeds():
    sb = get_client()
    return sb.table("data_feeds").select("*").order("sort_order").execute().data or []


@router.post("/preview-sql")
def preview_sql(body: SqlPreviewRequest):
    slug = body.slug.strip().lower() if body.slug else _slugify(body.name)
    if not SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Slug must be lowercase letters/numbers/underscores, starting with a letter.")
    if body.cadence not in ("daily", "monthly"):
        raise HTTPException(status_code=400, detail="cadence must be 'daily' or 'monthly'.")

    if body.cadence == "daily":
        clients_table = f"{slug}_clients"
        equity_table  = f"{slug}_daily_equity"
        sql = f"""CREATE TABLE {clients_table} (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client     text NOT NULL,
    account    text NOT NULL,
    label      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (client, account)
);

CREATE TABLE {equity_table} (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client     text NOT NULL,
    account    text NOT NULL,
    trade_date date NOT NULL,
    currency   text NOT NULL DEFAULT 'GBP',
    equity     numeric NOT NULL,
    chg_nlv    numeric,
    notes      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (client, account, trade_date, currency)
);"""
        return {"slug": slug, "clients_table": clients_table, "equity_table": equity_table,
                "statements_table": None, "sql": sql}

    statements_table = f"{slug}_monthly_statements"
    sql = f"""CREATE TABLE {statements_table} (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategy_id        bigint NOT NULL REFERENCES strategies(id),
    period_end_date    date NOT NULL,
    currency           text NOT NULL DEFAULT 'USD',
    beginning_balance  numeric NOT NULL,
    additions          numeric NOT NULL DEFAULT 0,
    redemptions        numeric NOT NULL DEFAULT 0,
    ending_balance     numeric NOT NULL,
    net_income         numeric,
    rate_of_return_pct numeric,
    fx_rate            numeric,
    fx_rate_date       date,
    ending_balance_gbp numeric,
    notes              text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (strategy_id, period_end_date)
);"""
    return {"slug": slug, "clients_table": None, "equity_table": None,
            "statements_table": statements_table, "sql": sql}


@router.post("", status_code=201)
def create_feed(body: FeedCreate):
    slug = body.slug.strip().lower() if body.slug else _slugify(body.name)
    if not SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Slug must be lowercase letters/numbers/underscores, starting with a letter.")
    if body.cadence not in ("daily", "monthly"):
        raise HTTPException(status_code=400, detail="cadence must be 'daily' or 'monthly'.")

    payload = {
        "slug":     slug,
        "name":     body.name.strip(),
        "color":    body.color,
        "cadence":  body.cadence,
        "currency": body.currency,
        "sort_order": body.sort_order,
        "clients_table":    f"{slug}_clients" if body.cadence == "daily" else None,
        "equity_table":     f"{slug}_daily_equity" if body.cadence == "daily" else None,
        "statements_table": f"{slug}_monthly_statements" if body.cadence == "monthly" else None,
    }
    sb = get_client()
    try:
        row = sb.table("data_feeds").insert(payload).execute().data[0]
        invalidate_all_cache()
        return row
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail=f"A feed with slug '{slug}' already exists.")
        raise HTTPException(
            status_code=500,
            detail=f"{exc} — if this is a 'relation does not exist' error, run the SQL from /preview-sql first.",
        )


@router.patch("/{feed_id}")
def update_feed(feed_id: str, body: FeedPatch):
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update.")
    sb = get_client()
    rows = sb.table("data_feeds").update(fields).eq("id", feed_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Feed not found.")
    invalidate_all_cache()
    return rows[0]


@router.delete("/{feed_id}", status_code=204)
def delete_feed(feed_id: str):
    sb = get_client()
    linked = sb.table("strategies").select("id,name").eq("data_feed_id", feed_id).execute().data or []
    if linked:
        names = ", ".join(s["name"] for s in linked)
        raise HTTPException(
            status_code=409,
            detail=f"Unlink these strategies first (Manage Pods & Strategies): {names}",
        )
    sb.table("data_feeds").delete().eq("id", feed_id).execute()
    invalidate_all_cache()
    return JSONResponse(status_code=204, content=None)


# ---------------------------------------------------------------------------
# Daily-cadence clients (mirrors axia_equity.py's ClientCreate/ClientPatch)
# ---------------------------------------------------------------------------

class ClientCreate(BaseModel):
    client:  str
    account: str
    label:   Optional[str] = None


class ClientPatch(BaseModel):
    client:  Optional[str] = None
    account: Optional[str] = None
    label:   Optional[str] = None


@router.get("/{slug}/clients")
def list_clients(slug: str):
    feed = _require_feed(slug)
    _require_cadence(feed, "daily")
    sb   = get_client()
    rows = sb.table(feed["clients_table"]).select("*").order("created_at").execute().data or []
    return rows


@router.post("/{slug}/clients", status_code=201)
def create_client(slug: str, body: ClientCreate):
    feed = _require_feed(slug)
    _require_cadence(feed, "daily")
    sb = get_client()
    try:
        row = (
            sb.table(feed["clients_table"])
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


@router.patch("/{slug}/clients/{client_id}")
def update_client(slug: str, client_id: str, body: ClientPatch):
    feed = _require_feed(slug)
    _require_cadence(feed, "daily")
    sb = get_client()
    clients_table, equity_table = feed["clients_table"], feed["equity_table"]

    existing = sb.table(clients_table).select("*").eq("id", client_id).execute().data
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
        row = sb.table(clients_table).update(fields).eq("id", client_id).execute().data[0]
        if new_client != old["client"] or new_account != old["account"]:
            sb.table(equity_table).update({
                "client":  new_client,
                "account": new_account,
            }).eq("client", old["client"]).eq("account", old["account"]).execute()
        invalidate_all_cache()
        return row
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Another client already has that client/account.")
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/{slug}/clients/{client_id}", status_code=204)
def delete_client(slug: str, client_id: str):
    feed = _require_feed(slug)
    _require_cadence(feed, "daily")
    sb = get_client()
    sb.table(feed["clients_table"]).delete().eq("id", client_id).execute()
    invalidate_all_cache()
    return JSONResponse(status_code=204, content=None)


# ---------------------------------------------------------------------------
# Daily-cadence equity records (mirrors axia_equity.py's equity endpoints)
# ---------------------------------------------------------------------------

class EquityCreate(BaseModel):
    client:     str
    account:    str
    trade_date: str
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


@router.get("/{slug}/equity")
def list_equity(
    slug: str,
    client:  str = Query(...),
    account: str = Query(...),
    limit:   int = Query(50),
    offset:  int = Query(0),
):
    feed = _require_feed(slug)
    _require_cadence(feed, "daily")
    sb = get_client()
    res = (
        sb.table(feed["equity_table"])
        .select("*", count="exact")
        .eq("client", client)
        .eq("account", account)
        .order("trade_date", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return {"rows": res.data or [], "total": res.count or 0}


@router.get("/{slug}/equity/prev")
def prev_equity(
    slug: str,
    client:   str = Query(...),
    account:  str = Query(...),
    date:     str = Query(...),
    currency: str = Query("GBP"),
):
    feed = _require_feed(slug)
    _require_cadence(feed, "daily")
    sb = get_client()
    rows = (
        sb.table(feed["equity_table"])
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


@router.post("/{slug}/equity", status_code=201)
def create_equity(slug: str, body: EquityCreate):
    feed = _require_feed(slug)
    _require_cadence(feed, "daily")
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
        row = sb.table(feed["equity_table"]).insert(payload).execute().data[0]
        invalidate_all_cache()
        return row
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(
                status_code=409,
                detail=f"Record already exists for {body.client}/{body.account} on {body.trade_date} ({body.currency}). Edit the existing row instead."
            )
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/{slug}/equity/{record_id}")
def update_equity(slug: str, record_id: str, body: EquityUpdate):
    feed = _require_feed(slug)
    _require_cadence(feed, "daily")
    sb = get_client()
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No fields to update.")
    try:
        rows = sb.table(feed["equity_table"]).update(payload).eq("id", record_id).execute().data
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


@router.delete("/{slug}/equity/{record_id}", status_code=204)
def delete_equity(slug: str, record_id: str):
    feed = _require_feed(slug)
    _require_cadence(feed, "daily")
    sb = get_client()
    sb.table(feed["equity_table"]).delete().eq("id", record_id).execute()
    invalidate_all_cache()
    return JSONResponse(status_code=204, content=None)


# ---------------------------------------------------------------------------
# Monthly-cadence statements (mirrors fund_statements.py exactly, table
# resolved from the registry via the already-parameterized service functions)
# ---------------------------------------------------------------------------

class StatementCreate(BaseModel):
    strategy_id:       int
    period_end_date:   str
    currency:          str = "USD"
    beginning_balance: float
    additions:         float = 0.0
    redemptions:       float = 0.0
    ending_balance:    float
    notes:             Optional[str] = None


class StatementUpdate(BaseModel):
    period_end_date:   Optional[str]   = None
    currency:          Optional[str]   = None
    beginning_balance: Optional[float] = None
    additions:         Optional[float] = None
    redemptions:       Optional[float] = None
    ending_balance:    Optional[float] = None
    notes:             Optional[str]   = None


@router.get("/{slug}/statements")
def list_statements(slug: str, strategy_id: int = Query(...), limit: int = Query(50), offset: int = Query(0)):
    feed = _require_feed(slug)
    _require_cadence(feed, "monthly")
    all_rows = list_fund_statements(strategy_id, table=feed["statements_table"])
    total    = len(all_rows)

    year_start_balance: dict[str, float] = {}
    year_cum_income:    dict[str, float] = {}
    enriched = []
    for r in all_rows:
        year = r["period_end_date"][:4]
        if year not in year_start_balance:
            year_start_balance[year] = float(r["beginning_balance"])
            year_cum_income[year]    = 0.0
        year_cum_income[year] = round(year_cum_income[year] + float(r["net_income"]), 2)
        start = year_start_balance[year]
        enriched.append({
            **r,
            "ytd_net_income": year_cum_income[year],
            "ytd_return_pct": round(year_cum_income[year] / start * 100, 2) if start else 0.0,
        })

    rows = list(reversed(enriched))[offset: offset + limit]
    return {"rows": rows, "total": total}


@router.get("/{slug}/statements/prev")
def prev_statement(slug: str, strategy_id: int = Query(...), before_date: str = Query(...)):
    feed = _require_feed(slug)
    _require_cadence(feed, "monthly")
    return get_fund_statement_prev(strategy_id, before_date, table=feed["statements_table"])


@router.post("/{slug}/statements", status_code=201)
def create_statement(slug: str, body: StatementCreate):
    feed = _require_feed(slug)
    _require_cadence(feed, "monthly")
    try:
        return create_fund_statement(
            strategy_id       = body.strategy_id,
            period_end_date   = body.period_end_date,
            beginning_balance = body.beginning_balance,
            additions         = body.additions,
            redemptions       = body.redemptions,
            ending_balance    = body.ending_balance,
            currency          = body.currency,
            notes             = body.notes or "",
            table             = feed["statements_table"],
        )
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(
                status_code=409,
                detail=f"A statement already exists for this strategy on {body.period_end_date}. Edit the existing row instead.",
            )
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/{slug}/statements/{record_id}")
def patch_statement(slug: str, record_id: int, body: StatementUpdate):
    feed = _require_feed(slug)
    _require_cadence(feed, "monthly")
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No fields to update.")
    try:
        row = update_fund_statement(record_id, table=feed["statements_table"], **payload)
        if not row:
            raise HTTPException(status_code=404, detail="Record not found.")
        return row
    except HTTPException:
        raise
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Another statement already exists for that period.")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{slug}/statements/{record_id}/refetch-fx")
def retry_fx(slug: str, record_id: int):
    feed = _require_feed(slug)
    _require_cadence(feed, "monthly")
    row = refetch_fund_statement_fx(record_id, table=feed["statements_table"])
    if not row:
        raise HTTPException(status_code=404, detail="Record not found.")
    return row


@router.delete("/{slug}/statements/{record_id}", status_code=204)
def delete_statement(slug: str, record_id: int):
    feed = _require_feed(slug)
    _require_cadence(feed, "monthly")
    delete_fund_statement(record_id, table=feed["statements_table"])
    return JSONResponse(status_code=204, content=None)
