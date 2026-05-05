# backend/src/services/supabase_service.py
"""
Supabase client and all data queries against live tables.

Provides:
  - get_client()                  Singleton Supabase client
  - get_live_aum()                SUM(Invested) from latest pfees snapshot
  - get_live_pnl()                SUM(Current PnL) from latest pfees snapshot
  - get_latest_pfees_date()       Most recent Date in user_pfees_estimation
  - get_pfees_latest_snapshot()   All rows from pfees for latest date
  - get_balance_history()         All rows from balance_history ordered by date
  - get_capital_events()          All rows from capital_events ordered by date
  - compute_fund_metrics()        AUM, PnL, TWR, sub-periods, bank balance
  - get_period_return(days)       % equity change over N days from balance_history
  - get_portfolio_kpis()          Full KpiData dict for portfolio home page
  - get_equity_curve_data(days)   Equity curve filtered by time range
  - get_pods_with_kpis()          Pod strips with live KPIs
  - get_allocation_data()         Donut chart slices by pod
  - get_pnl_contribution_data()   Bar chart PnL by pod
  - get_hierarchy_rows(type)      BreakdownRow-compatible rows for hierarchy tabs
  - list_pods()
  - list_strategies()
  - create_capital_event()
  - delete_capital_event()
  - create_pod() / update_pod() / delete_pod()
  - create_strategy() / update_strategy() / delete_strategy()
"""

import os
import time
from functools import lru_cache, reduce
from datetime import date, datetime, timedelta
from typing import Optional
from supabase import create_client, Client


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_SUPABASE_URL = os.getenv("SUPABASE_URL", "")
_SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# ---------------------------------------------------------------------------
# TTL cache — reduces ~30 Supabase round-trips to ~7 per page load
# ---------------------------------------------------------------------------

_TTL   = 60          # seconds — all read-only tables cached for 60s
_cache: dict = {}    # key → { "val": ..., "ts": float }


def _get_cached(key: str, fetcher, ttl: int = _TTL):
    """Return cached value if still fresh, else fetch, store, return."""
    entry = _cache.get(key)
    if entry and time.monotonic() - entry["ts"] < ttl:
        return entry["val"]
    val = fetcher()
    _cache[key] = {"val": val, "ts": time.monotonic()}
    return val


def _invalidate(*keys: str) -> None:
    """Evict cache entries by key (call after any write operation)."""
    for k in keys:
        _cache.pop(k, None)


def invalidate_all_cache() -> None:
    """Evict every cache entry (call after CSV upload)."""
    _cache.clear()


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
    """Return the most recent Date in user_pfees_estimation (cached 60s)."""
    def _fetch():
        sb  = get_client()
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
    return _get_cached("pfees_date", _fetch)


def get_pfees_latest_snapshot() -> list[dict]:
    """All rows from user_pfees_estimation for the latest date (cached 60s)."""
    def _fetch():
        latest_date = get_latest_pfees_date()
        if not latest_date:
            return []
        sb  = get_client()
        res = (
            sb.table("user_pfees_estimation")
            .select('"Date","AccountId","Darwin","Invested","Current PnL"')
            .eq('"Date"', latest_date)
            .execute()
        )
        return res.data or []
    return _get_cached("pfees_snapshot", _fetch)


def get_live_aum(snapshot_date: Optional[str] = None) -> float:
    """Sum of 'Invested' from latest pfees snapshot (uses cache when no date override)."""
    if snapshot_date is None:
        # Use cached snapshot — avoids an extra DB round-trip
        return round(sum(float(r.get("Invested") or 0) for r in get_pfees_latest_snapshot()), 2)
    sb  = get_client()
    res = (
        sb.table("user_pfees_estimation")
        .select('"Invested"')
        .eq('"Date"', snapshot_date)
        .execute()
    )
    return round(sum(float(r["Invested"] or 0) for r in (res.data or [])), 2)


def get_live_pnl(snapshot_date: Optional[str] = None) -> float:
    """Sum of 'Current PnL' from latest pfees snapshot (uses cache when no date override)."""
    if snapshot_date is None:
        return round(sum(float(r.get("Current PnL") or 0) for r in get_pfees_latest_snapshot()), 2)
    sb  = get_client()
    res = (
        sb.table("user_pfees_estimation")
        .select('"Current PnL"')
        .eq('"Date"', snapshot_date)
        .execute()
    )
    return round(sum(float(r["Current PnL"] or 0) for r in (res.data or [])), 2)


# ---------------------------------------------------------------------------
# Balance history
# ---------------------------------------------------------------------------

def get_balance_history() -> list[dict]:
    """
    All rows from balance_history ordered by date ascending (cached 60s).
    Returns list of { date: str, investor_equity: float }
    """
    def _fetch():
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
    return _get_cached("balance_history", _fetch)


def get_period_return(days: int) -> float:
    """
    % change in investor equity over the last N days.
    Uses balance_history sorted by date DESC.
    Returns 0.0 if insufficient data.
    """
    history = get_balance_history()
    if len(history) < 2:
        return 0.0

    # Latest equity
    latest     = history[-1]["investor_equity"]
    cutoff_str = (datetime.today() - timedelta(days=days)).strftime("%Y-%m-%d")

    # Find the closest row at or before cutoff
    past = [r for r in history if r["date"] <= cutoff_str]
    if not past:
        return 0.0

    past_equity = past[-1]["investor_equity"]
    if past_equity == 0:
        return 0.0

    return round((latest - past_equity) / past_equity, 6)


# ---------------------------------------------------------------------------
# Capital events
# ---------------------------------------------------------------------------

def get_capital_events() -> list[dict]:
    """
    All rows from capital_events ordered by event_date ascending (cached 60s).
    Returns canonical CapitalEvent-compatible dicts.
    """
    def _fetch():
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
    return _get_cached("capital_events", _fetch)


# ---------------------------------------------------------------------------
# TWR + sub-period computation
# ---------------------------------------------------------------------------

def _annualised(period_return: float, start_date: str, end_date: str) -> Optional[float]:
    """Annualise a sub-period return over its date range."""
    try:
        d0   = datetime.fromisoformat(start_date).date()
        d1   = datetime.fromisoformat(end_date).date()
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
      - balance_history          → daily equity curve (Investor Equity)
      - capital_events           → period boundaries + bank balance
      - user_pfees_estimation    → current AUM + PnL (latest snapshot)

    Returns FundLedgerSummary-compatible dict.
    """
    events      = get_capital_events()
    history     = get_balance_history()
    current_aum = get_live_aum()
    total_pnl   = get_live_pnl()

    # Index balance history by date string for fast lookup
    equity_by_date: dict[str, float] = {
        row["date"]: row["investor_equity"] for row in history
    }

    # Filter only external events (deposit/withdrawal) for sub-period boundaries
    external = [e for e in events if e["event_type"] in ("deposit", "withdrawal")]

    # Bank balance: Σ(deposits) − Σ(withdrawals)
    total_deposited = round(sum(e["amount"]       for e in external if e["amount"] > 0), 2)
    total_withdrawn = round(sum(abs(e["amount"])   for e in external if e["amount"] < 0), 2)
    bank_balance    = round(total_deposited - total_withdrawn, 2)

    # ── Sub-period construction ──
    periods     = []
    sorted_dates = sorted(set(e["date"] for e in external))

    for i, start_date in enumerate(sorted_dates):
        if i + 1 < len(sorted_dates):
            end_date = sorted_dates[i + 1]
            avail    = [d for d in equity_by_date if d < end_date]
            end_date_equity = max(avail) if avail else None
        else:
            avail           = list(equity_by_date.keys())
            end_date_equity = max(avail) if avail else None
            end_date        = end_date_equity or start_date

        same_day  = [e for e in external if e["date"] == start_date]
        cash_flow = round(sum(e["amount"] for e in same_day), 2)

        prev_dates    = [d for d in equity_by_date if d < start_date]
        equity_before = equity_by_date[max(prev_dates)] if prev_dates else 0.0
        start_aum     = round(equity_before + cash_flow, 2)
        end_aum       = equity_by_date.get(end_date_equity, start_aum) if end_date_equity else start_aum

        pnl           = round(end_aum - start_aum, 2)
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

    twr = round(
        reduce(lambda acc, p: acc * (1.0 + p["period_return"]), periods, 1.0) - 1.0,
        6
    ) if periods else 0.0

    initial_aum    = periods[0]["start_aum"] if periods else 0.0
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
# Portfolio home page — KPIs
# ---------------------------------------------------------------------------

def get_portfolio_kpis() -> dict:
    """
    Build KpiData dict for the portfolio home page.

    Sources:
      - user_pfees_estimation  → current_equity, total_pnl
      - capital_events         → initial_investment (first deposit), performance (TWR)
      - balance_history        → pct_1d, pct_7d, pct_30d
    """
    current_equity = get_live_aum()
    total_pnl      = get_live_pnl()
    pct_1d         = get_period_return(1)
    pct_7d         = get_period_return(7)
    pct_30d        = get_period_return(30)

    # TWR + initial AUM from fund metrics
    try:
        metrics           = compute_fund_metrics()
        initial_investment = metrics["initial_aum"]
        performance        = metrics["twr"]
    except Exception:
        initial_investment = current_equity
        performance        = 0.0

    return {
        "initial_investment": initial_investment,
        "current_equity":     current_equity,
        "performance":        performance,
        "total_pnl":          total_pnl,
        "pct_1d":             pct_1d,
        "pct_7d":             pct_7d,
        "pct_30d":            pct_30d,
    }


# ---------------------------------------------------------------------------
# Equity curve
# ---------------------------------------------------------------------------

def get_equity_curve_data(days: Optional[int] = None) -> list[dict]:
    """
    Returns equity curve from balance_history filtered to the last N days.
    days=None → all history (SI).
    Returns list of { timestamp: str, equity: float }.
    """
    history = get_balance_history()
    if not history:
        return []

    if days is not None:
        cutoff = (datetime.today() - timedelta(days=days)).strftime("%Y-%m-%d")
        history = [r for r in history if r["date"] >= cutoff]

    return [
        {"timestamp": r["date"], "equity": r["investor_equity"]}
        for r in history
    ]


# ---------------------------------------------------------------------------
# Pod-level aggregates (from pfees + strategies + pods tables)
# ---------------------------------------------------------------------------

def _build_pod_pfees_map() -> dict:
    """
    Returns { pod_id: { "invested": float, "pnl": float, "darwins": [str] } }

    Mapping logic:
      1. pfees snapshot → Darwin codes with Invested + PnL
      2. strategies table → Darwin (strategy_code) → pod_id
      3. If strategies empty or Darwin not mapped → bucket into pod_id=-1 ("Unallocated")

    Also returns pod metadata from pods table.
    """
    snapshot   = get_pfees_latest_snapshot()
    strategies = list_strategies()         # may be empty
    pods_list  = list_pods()              # may be empty

    # Darwin → pod_id mapping from strategies table
    darwin_to_pod: dict[str, int] = {}
    for s in strategies:
        code = (s.get("strategy_code") or "").upper()
        pid  = s.get("pod_id")
        if code and pid is not None:
            darwin_to_pod[code] = pid

    # Aggregate pfees by pod_id
    pod_agg: dict = {}   # pod_id → { invested, pnl, darwins }
    UNALLOCATED = -1

    for row in snapshot:
        darwin  = (row.get("Darwin") or "").upper()
        invested = float(row.get("Invested") or 0)
        pnl      = float(row.get("Current PnL") or 0)
        pod_id   = darwin_to_pod.get(darwin, UNALLOCATED)

        if pod_id not in pod_agg:
            pod_agg[pod_id] = {"invested": 0.0, "pnl": 0.0, "darwins": []}
        pod_agg[pod_id]["invested"] = round(pod_agg[pod_id]["invested"] + invested, 2)
        pod_agg[pod_id]["pnl"]      = round(pod_agg[pod_id]["pnl"] + pnl, 2)
        if darwin:
            pod_agg[pod_id]["darwins"].append(darwin)

    return {
        "pod_agg":     pod_agg,
        "pods_list":   pods_list,
        "strategies":  strategies,
        "UNALLOCATED": UNALLOCATED,
        "_snapshot":   snapshot,   # reused by _fast variants to avoid extra DB call
    }


def get_pods_with_kpis() -> list[dict]:
    """
    Returns list of PodSummary-compatible dicts with live KPIs per pod.

    When pods table is empty: returns one entry per Darwin code from pfees.
    When pods table is populated: groups darwins by pod.
    """
    data         = _build_pod_pfees_map()
    pod_agg      = data["pod_agg"]
    pods_list    = data["pods_list"]
    UNALLOCATED  = data["UNALLOCATED"]

    # Build pod metadata index
    pods_idx = {p["id"]: p for p in pods_list}

    pct_1d  = get_period_return(1)
    pct_7d  = get_period_return(7)
    pct_30d = get_period_return(30)

    # Total AUM for initial_investment fallback
    total_invested = sum(v["invested"] for v in pod_agg.values())

    result = []

    if pods_list:
        # Mode A: pods table populated — one card per pod
        for pod in pods_list:
            pid   = pod["id"]
            agg   = pod_agg.get(pid, {"invested": 0.0, "pnl": 0.0})
            initial = sum(
                float(s.get("initial_investment") or 0)
                for s in data["strategies"]
                if s.get("pod_id") == pid
            )
            result.append({
                "entity_id": f"pod_{pid}",
                "name":      pod.get("name", f"Pod {pid}"),
                "pod_code":  pod.get("pod_code", ""),
                "pod_color": pod.get("color", "#6366f1"),
                "kpis": {
                    "initial_investment": round(initial, 2),
                    "current_equity":     agg["invested"],
                    "performance":        round(agg["pnl"] / initial, 6) if initial else 0.0,
                    "total_pnl":          agg["pnl"],
                    "pct_1d":             pct_1d,
                    "pct_7d":             pct_7d,
                    "pct_30d":            pct_30d,
                },
            })

    else:
        # Mode B: no pods table — one card per Darwin (raw pfees grouping)
        snapshot = get_pfees_latest_snapshot()
        darwin_agg: dict = {}
        for row in snapshot:
            darwin   = (row.get("Darwin") or "Unknown").upper()
            invested = float(row.get("Invested") or 0)
            pnl      = float(row.get("Current PnL") or 0)
            if darwin not in darwin_agg:
                darwin_agg[darwin] = {"invested": 0.0, "pnl": 0.0}
            darwin_agg[darwin]["invested"] = round(darwin_agg[darwin]["invested"] + invested, 2)
            darwin_agg[darwin]["pnl"]      = round(darwin_agg[darwin]["pnl"] + pnl, 2)

        for i, (darwin, agg) in enumerate(darwin_agg.items()):
            result.append({
                "entity_id": f"darwin_{darwin.lower()}",
                "name":      darwin,
                "pod_code":  darwin[:3],
                "pod_color": "#6366f1",
                "kpis": {
                    "initial_investment": agg["invested"],
                    "current_equity":     agg["invested"],
                    "performance":        0.0,
                    "total_pnl":          agg["pnl"],
                    "pct_1d":             pct_1d,
                    "pct_7d":             pct_7d,
                    "pct_30d":            pct_30d,
                },
            })

    return result


def get_allocation_data() -> list[dict]:
    """
    Donut chart slices: allocation by pod.
    Returns list of { name, aum, pct }.
    """
    data       = _build_pod_pfees_map()
    pod_agg    = data["pod_agg"]
    pods_list  = data["pods_list"]
    UNALLOCATED = data["UNALLOCATED"]

    pods_idx   = {p["id"]: p for p in pods_list}
    total      = sum(v["invested"] for v in pod_agg.values())
    if total == 0:
        return []

    slices = []
    for pid, agg in pod_agg.items():
        if agg["invested"] == 0:
            continue
        if pid == UNALLOCATED:
            name = "Unallocated"
        else:
            pod = pods_idx.get(pid, {})
            name = pod.get("name") or f"Pod {pid}"
        slices.append({
            "name": name,
            "aum":  agg["invested"],
            "pct":  round(agg["invested"] / total * 100, 2),
        })

    slices.sort(key=lambda x: x["aum"], reverse=True)
    return slices


def get_pnl_contribution_data() -> list[dict]:
    """
    Bar chart: PnL contribution by pod.
    Returns list of { name, pnl }.
    """
    data        = _build_pod_pfees_map()
    pod_agg     = data["pod_agg"]
    pods_list   = data["pods_list"]
    UNALLOCATED = data["UNALLOCATED"]

    pods_idx = {p["id"]: p for p in pods_list}
    bars     = []

    for pid, agg in pod_agg.items():
        if pid == UNALLOCATED:
            name = "Unallocated"
        else:
            pod  = pods_idx.get(pid, {})
            name = pod.get("name") or f"Pod {pid}"
        bars.append({"name": name, "pnl": agg["pnl"]})

    bars.sort(key=lambda x: x["pnl"], reverse=True)
    return bars


# ---------------------------------------------------------------------------
# Hierarchy table rows (Pods / Strategies / Traders / Venues tabs)
# ---------------------------------------------------------------------------

def get_hierarchy_rows(entity_type: str) -> list[dict]:
    """
    Returns BreakdownRow-compatible dicts for the hierarchy tabs.

    entity_type in {"pod", "strategy", "trader", "venue"}

    Sources:
      - pods       + pfees → pod rows
      - strategies + pfees → strategy rows
      - trader / venue     → empty list (populate when data available)
    """
    pct_1d  = get_period_return(1)
    pct_7d  = get_period_return(7)
    pct_30d = get_period_return(30)

    if entity_type == "pod":
        data        = _build_pod_pfees_map()
        pod_agg     = data["pod_agg"]
        pods_list   = data["pods_list"]
        UNALLOCATED = data["UNALLOCATED"]
        pods_idx    = {p["id"]: p for p in pods_list}

        total_aum = sum(v["invested"] for v in pod_agg.values()) or 1.0
        rows      = []

        for pid, agg in pod_agg.items():
            if pid == UNALLOCATED:
                pod = {"name": "Unallocated", "pod_code": "", "color": "#6b7280", "id": -1}
            else:
                pod = pods_idx.get(pid, {"name": f"Pod {pid}", "pod_code": "", "color": "#6366f1", "id": pid})

            initial = sum(
                float(s.get("initial_investment") or 0)
                for s in data["strategies"]
                if s.get("pod_id") == pid
            ) if pid != UNALLOCATED else agg["invested"]

            rows.append({
                "entity_id":      f"pod_{pid}",
                "name":           pod.get("name", ""),
                "entity_type":    "pod",
                "allocation_pct": round(agg["invested"] / total_aum * 100, 2),
                "aum":            agg["invested"],
                "pnl":            agg["pnl"],
                "pct_1d":         pct_1d,
                "pct_7d":         pct_7d,
                "pct_30d":        pct_30d,
                "drawdown":       0.0,
                "win_rate":       0.0,
                "trading_style":  None,
                "status":         "Active",
                "pod_code":       pod.get("pod_code", ""),
                "strategy_code":  None,
                "pod_color":      pod.get("color", "#6366f1"),
            })

        rows.sort(key=lambda x: x["aum"], reverse=True)
        return rows

    elif entity_type == "strategy":
        snapshot   = get_pfees_latest_snapshot()
        strategies = list_strategies()
        pods_list  = list_pods()
        pods_idx   = {p["id"]: p for p in pods_list}

        # Aggregate pfees by Darwin
        darwin_agg: dict = {}
        for row in snapshot:
            darwin   = (row.get("Darwin") or "").upper()
            invested = float(row.get("Invested") or 0)
            pnl      = float(row.get("Current PnL") or 0)
            if darwin not in darwin_agg:
                darwin_agg[darwin] = {"invested": 0.0, "pnl": 0.0}
            darwin_agg[darwin]["invested"] = round(darwin_agg[darwin]["invested"] + invested, 2)
            darwin_agg[darwin]["pnl"]      = round(darwin_agg[darwin]["pnl"] + pnl, 2)

        # Map strategies → pfees
        total_aum = sum(v["invested"] for v in darwin_agg.values()) or 1.0
        rows      = []

        if strategies:
            for s in strategies:
                code    = (s.get("strategy_code") or "").upper()
                agg     = darwin_agg.get(code, {"invested": 0.0, "pnl": 0.0})
                pid     = s.get("pod_id")
                pod     = pods_idx.get(pid, {}) if pid else {}
                initial = float(s.get("initial_investment") or 0)

                rows.append({
                    "entity_id":      f"strategy_{s['id']}",
                    "name":           s.get("name", code),
                    "entity_type":    "strategy",
                    "allocation_pct": round(agg["invested"] / total_aum * 100, 2),
                    "aum":            agg["invested"],
                    "pnl":            agg["pnl"],
                    "pct_1d":         pct_1d,
                    "pct_7d":         pct_7d,
                    "pct_30d":        pct_30d,
                    "drawdown":       0.0,
                    "win_rate":       0.0,
                    "trading_style":  s.get("trading_style", None),
                    "status":         s.get("status", "Active"),
                    "pod_code":       pod.get("pod_code", ""),
                    "strategy_code":  s.get("strategy_code", ""),
                    "pod_color":      pod.get("color", "#6366f1"),
                })
        else:
            # No strategies — one row per Darwin code
            for darwin, agg in darwin_agg.items():
                rows.append({
                    "entity_id":      f"darwin_{darwin.lower()}",
                    "name":           darwin,
                    "entity_type":    "strategy",
                    "allocation_pct": round(agg["invested"] / total_aum * 100, 2),
                    "aum":            agg["invested"],
                    "pnl":            agg["pnl"],
                    "pct_1d":         pct_1d,
                    "pct_7d":         pct_7d,
                    "pct_30d":        pct_30d,
                    "drawdown":       0.0,
                    "win_rate":       0.0,
                    "trading_style":  None,
                    "status":         "Active",
                    "pod_code":       darwin[:3],
                    "strategy_code":  darwin,
                    "pod_color":      "#6366f1",
                })

        rows.sort(key=lambda x: x["aum"], reverse=True)
        return rows

    # trader / venue — return empty until data available
    return []


# ---------------------------------------------------------------------------
# _fast variants — accept pre-fetched data, zero extra DB round-trips
# Called by get_portfolio() endpoint to share data across all computations
# ---------------------------------------------------------------------------

def _period_return_from_hist(history: list[dict], days: int) -> float:
    """Compute % equity change over N days from a pre-fetched balance history."""
    if len(history) < 2:
        return 0.0
    latest     = history[-1]["investor_equity"]
    cutoff_str = (datetime.today() - timedelta(days=days)).strftime("%Y-%m-%d")
    past = [r for r in history if r["date"] <= cutoff_str]
    if not past:
        return 0.0
    past_equity = past[-1]["investor_equity"]
    if past_equity == 0:
        return 0.0
    return round((latest - past_equity) / past_equity, 6)


def compute_fund_metrics_fast(events: list[dict], history: list[dict]) -> dict:
    """compute_fund_metrics() using pre-fetched events + history."""
    current_aum = get_live_aum()   # single pfees query (cached)
    total_pnl   = get_live_pnl()   # single pfees query (cached)

    equity_by_date: dict[str, float] = {r["date"]: r["investor_equity"] for r in history}
    external = [e for e in events if e["event_type"] in ("deposit", "withdrawal")]

    total_deposited = round(sum(e["amount"]       for e in external if e["amount"] > 0), 2)
    total_withdrawn = round(sum(abs(e["amount"])   for e in external if e["amount"] < 0), 2)
    bank_balance    = round(total_deposited - total_withdrawn, 2)

    periods      = []
    sorted_dates = sorted(set(e["date"] for e in external))

    for i, start_date in enumerate(sorted_dates):
        if i + 1 < len(sorted_dates):
            end_date        = sorted_dates[i + 1]
            avail           = [d for d in equity_by_date if d < end_date]
            end_date_equity = max(avail) if avail else None
        else:
            avail           = list(equity_by_date.keys())
            end_date_equity = max(avail) if avail else None
            end_date        = end_date_equity or start_date

        same_day      = [e for e in external if e["date"] == start_date]
        cash_flow     = round(sum(e["amount"] for e in same_day), 2)
        prev_dates    = [d for d in equity_by_date if d < start_date]
        equity_before = equity_by_date[max(prev_dates)] if prev_dates else 0.0
        start_aum     = round(equity_before + cash_flow, 2)
        end_aum       = equity_by_date.get(end_date_equity, start_aum) if end_date_equity else start_aum
        pnl           = round(end_aum - start_aum, 2)
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

    twr = round(
        reduce(lambda acc, p: acc * (1.0 + p["period_return"]), periods, 1.0) - 1.0, 6
    ) if periods else 0.0

    initial_aum    = periods[0]["start_aum"] if periods else 0.0
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


def get_portfolio_kpis_fast(pod_pfees_map: dict, balance_hist: list[dict],
                             capital_evts: list[dict]) -> dict:
    """get_portfolio_kpis() with pre-fetched data — 0 extra DB calls."""
    snapshot      = pod_pfees_map.get("_snapshot", get_pfees_latest_snapshot())
    current_equity = round(sum(float(r.get("Invested") or 0) for r in snapshot), 2)
    total_pnl      = round(sum(float(r.get("Current PnL") or 0) for r in snapshot), 2)
    pct_1d  = _period_return_from_hist(balance_hist, 1)
    pct_7d  = _period_return_from_hist(balance_hist, 7)
    pct_30d = _period_return_from_hist(balance_hist, 30)
    try:
        metrics            = compute_fund_metrics_fast(capital_evts, balance_hist)
        initial_investment = metrics["initial_aum"]
        performance        = metrics["twr"]
    except Exception:
        initial_investment = current_equity
        performance        = 0.0
    return {
        "initial_investment": initial_investment,
        "current_equity":     current_equity,
        "performance":        performance,
        "total_pnl":          total_pnl,
        "pct_1d":             pct_1d,
        "pct_7d":             pct_7d,
        "pct_30d":            pct_30d,
    }


def get_pods_with_kpis_fast(pod_pfees_map: dict, balance_hist: list[dict]) -> list[dict]:
    """get_pods_with_kpis() with pre-fetched data — 0 extra DB calls."""
    pod_agg     = pod_pfees_map["pod_agg"]
    pods_list   = pod_pfees_map["pods_list"]
    strategies  = pod_pfees_map["strategies"]
    UNALLOCATED = pod_pfees_map["UNALLOCATED"]

    pct_1d  = _period_return_from_hist(balance_hist, 1)
    pct_7d  = _period_return_from_hist(balance_hist, 7)
    pct_30d = _period_return_from_hist(balance_hist, 30)

    result = []

    if pods_list:
        for pod in pods_list:
            pid     = pod["id"]
            agg     = pod_agg.get(pid, {"invested": 0.0, "pnl": 0.0})
            initial = sum(
                float(s.get("initial_investment") or 0)
                for s in strategies if s.get("pod_id") == pid
            )
            result.append({
                "entity_id": f"pod_{pid}",
                "name":      pod.get("name", f"Pod {pid}"),
                "pod_code":  pod.get("pod_code", ""),
                "pod_color": pod.get("color", "#6366f1"),
                "kpis": {
                    "initial_investment": round(initial, 2),
                    "current_equity":     agg["invested"],
                    "performance":        round(agg["pnl"] / initial, 6) if initial else 0.0,
                    "total_pnl":          agg["pnl"],
                    "pct_1d":             pct_1d,
                    "pct_7d":             pct_7d,
                    "pct_30d":            pct_30d,
                },
            })
    else:
        # Mode B: no pods — one card per Darwin
        darwin_agg: dict = {}
        for row in pod_pfees_map.get("_snapshot", get_pfees_latest_snapshot()):
            darwin   = (row.get("Darwin") or "Unknown").upper()
            invested = float(row.get("Invested") or 0)
            pnl      = float(row.get("Current PnL") or 0)
            if darwin not in darwin_agg:
                darwin_agg[darwin] = {"invested": 0.0, "pnl": 0.0}
            darwin_agg[darwin]["invested"] = round(darwin_agg[darwin]["invested"] + invested, 2)
            darwin_agg[darwin]["pnl"]      = round(darwin_agg[darwin]["pnl"] + pnl, 2)
        for darwin, agg in darwin_agg.items():
            result.append({
                "entity_id": f"darwin_{darwin.lower()}",
                "name":      darwin,
                "pod_code":  darwin[:3],
                "pod_color": "#6366f1",
                "kpis": {
                    "initial_investment": agg["invested"],
                    "current_equity":     agg["invested"],
                    "performance":        0.0,
                    "total_pnl":          agg["pnl"],
                    "pct_1d":             pct_1d,
                    "pct_7d":             pct_7d,
                    "pct_30d":            pct_30d,
                },
            })

    return result


def get_equity_curve_data_fast(history: list[dict], days: Optional[int] = None) -> list[dict]:
    """get_equity_curve_data() using pre-fetched history."""
    if not history:
        return []
    if days is not None:
        cutoff  = (datetime.today() - timedelta(days=days)).strftime("%Y-%m-%d")
        history = [r for r in history if r["date"] >= cutoff]
    return [{"timestamp": r["date"], "equity": r["investor_equity"]} for r in history]


def get_allocation_data_fast(pod_pfees_map: dict) -> list[dict]:
    """get_allocation_data() using pre-fetched pod_pfees_map."""
    pod_agg     = pod_pfees_map["pod_agg"]
    pods_list   = pod_pfees_map["pods_list"]
    UNALLOCATED = pod_pfees_map["UNALLOCATED"]
    pods_idx    = {p["id"]: p for p in pods_list}
    total       = sum(v["invested"] for v in pod_agg.values())
    if total == 0:
        return []
    slices = []
    for pid, agg in pod_agg.items():
        if agg["invested"] == 0:
            continue
        name = "Unallocated" if pid == UNALLOCATED else (pods_idx.get(pid, {}).get("name") or f"Pod {pid}")
        slices.append({"name": name, "aum": agg["invested"], "pct": round(agg["invested"] / total * 100, 2)})
    slices.sort(key=lambda x: x["aum"], reverse=True)
    return slices


def get_pnl_contribution_data_fast(pod_pfees_map: dict) -> list[dict]:
    """get_pnl_contribution_data() using pre-fetched pod_pfees_map."""
    pod_agg     = pod_pfees_map["pod_agg"]
    pods_list   = pod_pfees_map["pods_list"]
    UNALLOCATED = pod_pfees_map["UNALLOCATED"]
    pods_idx    = {p["id"]: p for p in pods_list}
    bars = []
    for pid, agg in pod_agg.items():
        name = "Unallocated" if pid == UNALLOCATED else (pods_idx.get(pid, {}).get("name") or f"Pod {pid}")
        bars.append({"name": name, "pnl": agg["pnl"]})
    bars.sort(key=lambda x: x["pnl"], reverse=True)
    return bars


# ---------------------------------------------------------------------------
# Pods CRUD
# ---------------------------------------------------------------------------

def list_pods() -> list[dict]:
    return _get_cached("pods", lambda: (
        get_client().table("pods").select("*").order("name").execute().data or []
    ))


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
    _invalidate("pods")
    return res.data[0] if res.data else {}


def update_pod(pod_id: int, **fields) -> dict:
    sb  = get_client()
    res = sb.table("pods").update(fields).eq("id", pod_id).execute()
    _invalidate("pods")
    return res.data[0] if res.data else {}


def delete_pod(pod_id: int) -> bool:
    sb = get_client()
    sb.table("pods").delete().eq("id", pod_id).execute()
    _invalidate("pods")
    return True


# ---------------------------------------------------------------------------
# Strategies CRUD
# ---------------------------------------------------------------------------

def list_strategies(pod_id: Optional[int] = None) -> list[dict]:
    if pod_id is not None:
        # Filtered query — skip cache (rare, management UI only)
        res = (
            get_client()
            .table("strategies")
            .select("*,pods(name,color,pod_code)")
            .eq("pod_id", pod_id)
            .order("name")
            .execute()
        )
        return res.data or []
    return _get_cached("strategies_all", lambda: (
        get_client()
        .table("strategies")
        .select("*,pods(name,color,pod_code)")
        .order("name")
        .execute()
        .data or []
    ))


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
    _invalidate("strategies_all")
    return res.data[0] if res.data else {}


def update_strategy(strategy_id: int, **fields) -> dict:
    sb  = get_client()
    res = sb.table("strategies").update(fields).eq("id", strategy_id).execute()
    _invalidate("strategies_all")
    return res.data[0] if res.data else {}


def delete_strategy(strategy_id: int) -> bool:
    sb = get_client()
    sb.table("strategies").delete().eq("id", strategy_id).execute()
    _invalidate("strategies_all")
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
    _invalidate("capital_events")
    return res.data[0] if res.data else {}


def update_capital_event(event_id: int, **fields) -> dict:
    """Patch one or more fields on a capital event row."""
    sb = get_client()
    if "amount" in fields:
        fields["amount"] = round(abs(float(fields["amount"])), 2)
    res = sb.table("capital_events").update(fields).eq("id", event_id).execute()
    _invalidate("capital_events")
    return res.data[0] if res.data else {}


def delete_capital_event(event_id: int) -> bool:
    sb = get_client()
    sb.table("capital_events").delete().eq("id", event_id).execute()
    _invalidate("capital_events")
    return True


def get_account_ids() -> list[dict]:
    """
    Distinct AccountIds from user_accounts_equity (latest date snapshot, cached 60s).
    Returns list of { account_id: int, equity: float }.
    Auto-updates as new accounts appear in the table.
    """
    def _fetch():
        sb = get_client()
        latest_res = (
            sb.table("user_accounts_equity")
            .select('"Date"')
            .order('"Date"', desc=True)
            .limit(1)
            .execute()
        )
        if not latest_res.data:
            return []
        latest_date = latest_res.data[0]["Date"]
        res = (
            sb.table("user_accounts_equity")
            .select('"AccountId","Equity"')
            .eq('"Date"', latest_date)
            .order('"AccountId"')
            .execute()
        )
        return [
            {"account_id": r["AccountId"], "equity": float(r["Equity"] or 0)}
            for r in (res.data or [])
        ]
    return _get_cached("account_ids", _fetch)
