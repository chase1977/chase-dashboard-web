# backend/src/routers/fund_statements.py
"""
Fund Monthly Statements router — NAV-administrator-reported funds with no
daily broker feed (e.g. 12-FLAGS, from its monthly NAV Fund Services
Investor Statement). One row per strategy per period_end_date.

Endpoints:
  GET    /api/fund-statements              Paginated ?strategy_id=&limit=&offset=
                                            Returns {rows, total}
  GET    /api/fund-statements/prev         Most recent statement before a date
                                            ?strategy_id=&before_date=
  POST   /api/fund-statements              Create (net_income / rate_of_return_pct /
                                            ending_balance_gbp always computed server-side)
  PATCH  /api/fund-statements/{id}         Update — recomputes on relevant field changes
  POST   /api/fund-statements/{id}/refetch-fx   Manual retry for a failed OANDA lookup
  DELETE /api/fund-statements/{id}
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from src.services.supabase_service import (
    list_fund_statements, get_fund_statement_prev,
    create_fund_statement, update_fund_statement,
    delete_fund_statement, refetch_fund_statement_fx,
)

router = APIRouter(prefix="/api/fund-statements", tags=["fund-statements"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class FundStatementCreate(BaseModel):
    strategy_id:       int
    period_end_date:   str                     # YYYY-MM-DD
    currency:          str = "USD"
    beginning_balance: float
    additions:         float = 0.0
    redemptions:       float = 0.0
    ending_balance:    float
    notes:             Optional[str] = None


class FundStatementUpdate(BaseModel):
    period_end_date:   Optional[str]   = None
    currency:          Optional[str]   = None
    beginning_balance: Optional[float] = None
    additions:         Optional[float] = None
    redemptions:       Optional[float] = None
    ending_balance:    Optional[float] = None
    notes:             Optional[str]   = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
def list_statements(
    strategy_id: int = Query(...),
    limit:       int = Query(50),
    offset:      int = Query(0),
):
    all_rows = list_fund_statements(strategy_id)   # ASC by period_end_date
    total    = len(all_rows)

    # YTD — cumulative Net Income within each calendar year, chronological
    # order, divided by that year's FIRST Beginning Balance (not chain-linked
    # / compounded — matches the NAV administrator statement's own ITD/YTD
    # convention exactly: verified against the 12-FLAGS statement where
    # ITD Net Income (16,788.02) = May-June (1,243.43) + June-July (15,544.59)
    # and ITD Rate of Return (2.58%) = 16,788.02 / 650,000 (first-ever
    # Beginning Balance) — a plain sum, not compounded month-over-month.
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
            "ytd_net_income":   year_cum_income[year],
            "ytd_return_pct":   round(year_cum_income[year] / start * 100, 2) if start else 0.0,
        })

    # Show newest first
    rows = list(reversed(enriched))[offset: offset + limit]
    return {"rows": rows, "total": total}


@router.get("/prev")
def prev_statement(
    strategy_id: int = Query(...),
    before_date: str = Query(...),
):
    return get_fund_statement_prev(strategy_id, before_date)


@router.post("", status_code=201)
def create_statement(body: FundStatementCreate):
    try:
        row = create_fund_statement(
            strategy_id       = body.strategy_id,
            period_end_date   = body.period_end_date,
            beginning_balance = body.beginning_balance,
            additions         = body.additions,
            redemptions       = body.redemptions,
            ending_balance    = body.ending_balance,
            currency          = body.currency,
            notes             = body.notes or "",
        )
        return row
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(
                status_code=409,
                detail=f"A statement already exists for this strategy on {body.period_end_date}. Edit the existing row instead.",
            )
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/{record_id}")
def patch_statement(record_id: int, body: FundStatementUpdate):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No fields to update.")
    try:
        row = update_fund_statement(record_id, **payload)
        if not row:
            raise HTTPException(status_code=404, detail="Record not found.")
        return row
    except HTTPException:
        raise
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Another statement already exists for that period.")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{record_id}/refetch-fx")
def retry_fx(record_id: int):
    row = refetch_fund_statement_fx(record_id)
    if not row:
        raise HTTPException(status_code=404, detail="Record not found.")
    return row


@router.delete("/{record_id}", status_code=204)
def delete_statement(record_id: int):
    delete_fund_statement(record_id)
    return JSONResponse(status_code=204, content=None)
