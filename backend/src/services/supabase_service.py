# backend/src/services/supabase_service.py
"""
Supabase client and all data queries against live tables.

Provides:
  - get_client()              Singleton Supabase client
  - get_live_aum()            SUM(Invested) from latest pfees snapshot
  - get_live_pnl()            SUM(Current PnL) from latest pfees snapshot
  - get_latest_pfees_date()   Most recent Date in user_pfees_estimation
  - get_balance_history()     All rows from balance_history ordered by date
  - get_capital_events()      All rows from capital_events ordered by date
  - compute_fund_metrics()    Combines above → AUM, PnL, TWR, sub-periods, bank balance
  - list_pods()
  - list_strategies()
  - create_capital_event()
  - delete_capital_event()
  - create_pod()
  - update_pod()
  - delete_pod()
  - create_strategy()
  - update_strategy()
  - delete_strategy()
"""

import os
from functools import lru_cache
from datetime import date, datetime
from typing import Optional
from supabase import create_client, Client
from functools import reduce


# ---------------------------------------------------------------------------
# CONFIGURABLE
# ---------------------------------------------------------------------------

_SUPABASE_URL = os.getenv("SUPABASE_URL", "")
_SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


# ---------------------------------------------------------------------------
# Client — singleton
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_client() -> Client:
    if not _SUPABASE_URL or not _SUPABASE_KEY:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env"
        )
    return create_client(_SUPABASE_URL, _SUPABASE_KEY)


# ---------------------------------------------------------------------------
# Live AUM + PnL from user_pfees_estimation (latest snapshot date)
# ---------------------------------------------------------------------------

def get_latest_pfees_date() -> Optional[str]:
    """Return the most recent Date in user_pfees_estimation."""
    sb = get_client()
    res = (
        sb.table("user_pfees_estimation")
        .select('"Date"')
        .order('"Date"', desc=True)
        .limit(1)
        .execute()
    )
    if res.data:
        return str(res.data[0]["Date"])
    return None


def get_live_aum(snapshot_date: Optional[str] = None) -> float:
    """
    Sum of 'Invested' from user_pfees_estimation for the given date.
    Falls back to latest date if not provided.
    Uses max date only — no double-counting across accounts is handled
    by summing unique (AccountId, Darwin) pairs on the latest date.
    """
    sb   = get_client()
    date = snapshot_date or get_latest_pfees_date()
    if not date:
        return 0.0

    res = (
        sb.table("user_pfees_estimation")
        .select('"Invested"')
        .eq('"Date"', date)
        .execute()
    )
    return round(sum(float(r["Invested"] or 0) for r in (res.data or [])), 2)


def get_live_pnl(snapshot_date: Optional[str] = None) -> float:
    """Sum of 'Current PnL' for latest snapshot date."""
    sb   = get_client()
    date = snapshot_date or get_latest_pfees_date()
    if not date:
        return 0.0

    res = (
        sb.table("user_pfees_estimation")
        .select('"Current PnL"')
        .eq('"Date"', date)
        .execute()
    )
    return round(sum(float(r["Current PnL"] or 0) for r in (res.data or [])), 2)


# ---------------------------------------------------------------------------
# Balance history from Supabase
# ---------------------------------------------------------------------------

def get_balance_history() -> list[dict]:
    """
    All rows from balance_history ordered by date ascending.
    Returns list of { date: str, investor_equity: float }
    """
    sb  = get_client()
    res = (
        sb.table("balance_history")
        .select('"Date","Investor Equity"')
        .order('"Date"', desc=False)
        .execute()
    )
    return [
        {
            "date":            str(r["Date"]),
            "investor_equity": float(r["Investor Equity"] or 0),
        }
        for r in (res.data or [])
    ]


# ---------------------------------------------------------------------------
# Capital events from Supabase (user-managed deposits/withdrawals)
# ---------------------------------------------------------------------------

def get_capital_events() -> list[dict]:
    """
    All rows from capital_events ordered by event_date ascending.
    Returns canonical CapitalEvent-compatible dicts.
    """
    sb  = get_client()
    res = (
        sb.table("capital_events")
        .select("id,event_date,event_type,amount,notes,created_at")
        .order("event_date", desc=False)
        .execute()
    )
    events = []
    for r in (res.data or []):
        amt = float(r["amount"])
        events.append({
            "event_id":   str(r["id"]),
            "date":       str(r["event_date"]),
            "event_type": r["event_type"],
            "amount":     amt if r["event_type"] == "deposit" else -amt,
            "pod_id":     None,
            "notes":      r.get("notes") or "",
        })
    return events


# ---------------------------------------------------------------------------
# TWR + sub-period computation
# ---------------------------------------------------------------------------

def _annualised(period_return: float, start_date: str, end_date: str) -> Optional[float]:
    """Annualise a sub-period return over its date range."""
    try:
        d0 = datetime.fromisoformat(start_date).date()
        d1 = datetime.fromisoformat(end_date).date()
        days = (d1 - d0).days
        if days <= 0:
            return None
        return round((1 + period_return) ** (365 / days) - 1, 6)
    except Exception:
        return None


def compute_fund_metrics() -> dict:
    """
    Build full fund ledger summary from Supabase live data.

    Sources:
      - balance_history  → daily equity curve (Investor Equity)
      - capital_events   → period boundaries + bank balance
      - user_pfees_estimation (latest) → current AUM + PnL

    Returns FundLedgerSummary-compatible dict.
    """
    events  = get_capital_events()
    history = get_balance_history()
    current_aum = get_live_aum()
    total_pnl   = get_live_pnl()

    # Index balance history by date string for fast lookup
    equity_by_date: dict[str, float] = {
        row["date"]: row["investor_equity"]
        for row in history
    }

    # Filter only external events (deposit/withdrawal) for sub-period boundaries
    external = [e for e in events if e["event_type"] in ("deposit", "withdrawal")]

    # Bank balance: Σ(deposits) − Σ(withdrawals)
    total_deposited = round(sum(e["amount"]           for e in external if e["amount"] > 0), 2)
    total_withdrawn = round(sum(abs(e["amount"])       for e in external if e["amount"] < 0), 2)
    bank_balance    = round(total_deposited - total_withdrawn, 2)

    # ── Sub-period construction ──
    # A new period starts on each external cash flow date.
    # Period i: from event[i].date to day before event[i+1].date (or today)
    periods = []
    sorted_dates = sorted(set(e["date"] for e in external))

    for i, start_date in enumerate(sorted_dates):
        # End date: day before next event, or latest available equity date
        if i + 1 < len(sorted_dates):
            end_date = sorted_dates[i + 1]
            # Walk back to find last available equity before next event
            avail = [d for d in equity_by_date if d < end_date]
            end_date_equity = max(avail) if avail else None
        else:
            avail = list(equity_by_date.keys())
            end_date_equity = max(avail) if avail else None
            end_date = end_date_equity or start_date

        # Cash flow at start of this period (net of same-day events)
        same_day = [e for e in external if e["date"] == start_date]
        cash_flow = round(sum(e["amount"] for e in same_day), 2)

        # AUM at start of period (after cash flow applied)
        # = equity just before this date + cash_flow
        prev_dates = [d for d in equity_by_date if d < start_date]
        equity_before = equity_by_date[max(prev_dates)] if prev_dates else 0.0
        start_aum = round(equity_before + cash_flow, 2)

        # AUM at end of period
        end_aum = equity_by_date.get(end_date_equity, start_aum) if end_date_equity else start_aum

        pnl = round(end_aum - start_aum, 2)
        period_return = round(pnl / start_aum, 6) if start_aum != 0 else 0.0

        periods.append({
            "period_num":         i + 1,
            "start_date":         start_date,
            "end_date":           end_date_equity or end_date,
            "start_aum":          start_aum,
            "cash_flow_at_start": cash_flow,
            "end_aum":            end_aum,
            "pnl":                pnl,
            "period_return":      period_return,
            "annualised_return":  _annualised(period_return, start_date, end_date_equity or end_date),
        })

    # TWR = chain-link: Π(1 + R_i) − 1
    twr = round(
        reduce(lambda acc, p: acc * (1.0 + p["period_return"]), periods, 1.0) - 1.0,
        6
    ) if periods else 0.0

    initial_aum = periods[0]["start_aum"] if periods else 0.0
    inception_date = sorted_dates[0] if sorted_dates else str(date.today())

    return {
        "twr":              twr,
        "total_pnl":        total_pnl,
        "initial_aum":      initial_aum,
        "current_aum":      current_aum,
        "bank_balance":     bank_balance,
        "total_deposited":  total_deposited,
        "total_withdrawn":  total_withdrawn,
        "periods":          periods,
        "events":           events,
        "num_periods":      len(periods),
        "inception_date":   inception_date,
        "last_updated":     str(date.today()),
    }


# ---------------------------------------------------------------------------
# Pods CRUD
# ---------------------------------------------------------------------------

def list_pods() -> list[dict]:
    sb  = get_client()
    res = sb.table("pods").select("*").order("name").execute()
    return res.data or []


def create_pod(name: str, pod_code: str, color: str, date_created: str,
               status: str = "Active", notes: str = "") -> dict:
    sb  = get_client()
    res = sb.table("pods").insert({
        "name":         name,
        "pod_code":     pod_code.upper(),
        "color":        color,
        "date_created": date_created,
        "status":       status,
        "notes":        notes or None,
    }).execute()
    return res.data[0] if res.data else {}


def update_pod(pod_id: int, **fields) -> dict:
    sb  = get_client()
    res = sb.table("pods").update(fields).eq("id", pod_id).execute()
    return res.data[0] if res.data else {}


def delete_pod(pod_id: int) -> bool:
    sb = get_client()
    sb.table("pods").delete().eq("id", pod_id).execute()
    return True


# ---------------------------------------------------------------------------
# Strategies CRUD
# ---------------------------------------------------------------------------

def list_strategies(pod_id: Optional[int] = None) -> list[dict]:
    sb    = get_client()
    query = sb.table("strategies").select("*,pods(name,color,pod_code)")
    if pod_id is not None:
        query = query.eq("pod_id", pod_id)
    res = query.order("name").execute()
    return res.data or []


def create_strategy(name: str, strategy_code: str, pod_id: Optional[int],
                    initial_investment: float, date_created: str,
                    status: str = "Active", notes: str = "") -> dict:
    sb  = get_client()
    res = sb.table("strategies").insert({
        "name":               name,
        "strategy_code":      strategy_code.upper(),
        "pod_id":             pod_id,
        "initial_investment": round(initial_investment, 2),
        "date_created":       date_created,
        "status":             status,
        "notes":              notes or None,
    }).execute()
    return res.data[0] if res.data else {}


def update_strategy(strategy_id: int, **fields) -> dict:
    sb  = get_client()
    res = sb.table("strategies").update(fields).eq("id", strategy_id).execute()
    return res.data[0] if res.data else {}


def delete_strategy(strategy_id: int) -> bool:
    sb = get_client()
    sb.table("strategies").delete().eq("id", strategy_id).execute()
    return True


# ---------------------------------------------------------------------------
# Capital events CRUD
# ---------------------------------------------------------------------------

def create_capital_event(event_date: str, event_type: str,
                          amount: float, notes: str = "") -> dict:
    sb  = get_client()
    res = sb.table("capital_events").insert({
        "event_date":  event_date,
        "event_type":  event_type,
        "amount":      round(abs(amount), 2),
        "notes":       notes or None,
    }).execute()
    return res.data[0] if res.data else {}


def delete_capital_event(event_id: int) -> bool:
    sb = get_client()
    sb.table("capital_events").delete().eq("id", event_id).execute()
    return True
