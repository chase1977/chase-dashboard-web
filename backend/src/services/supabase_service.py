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


def _darwin_display(raw: str) -> str:
    """Strip Darwinex version suffix: 'CFZ.5.18' → 'CFZ', 'DRW.1.2' → 'DRW'."""
    if not raw:
        return "—"
    return raw.split(".")[0].upper()


def _sum_equity_by_date(history: list[dict]) -> dict[str, float]:
    """
    Sum investor_equity per date from balance_history rows.

    balance_history may have multiple rows per date (one per Darwinex account).
    A plain dict comprehension would overwrite — this correctly aggregates totals.
    Returns { date_str: total_investor_equity_float }.
    """
    eq: dict[str, float] = {}
    for r in history:
        d = r["date"]
        eq[d] = round(eq.get(d, 0.0) + r["investor_equity"], 2)
    return eq


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


def get_pfees_history_all() -> list[dict]:
    """
    All rows from user_pfees_estimation ordered by Date asc (cached 60s).
    Used for per-Darwin period returns, drawdown, and sparklines.
    ~880 rows for 22 days × 20 Darwins × 2 accounts — fine to cache.
    """
    def _fetch():
        sb  = get_client()
        res = (
            sb.table("user_pfees_estimation")
            .select('"Date","AccountId","Darwin","Invested","Current PnL"')
            .order('"Date"', desc=False)
            .execute()
        )
        return res.data or []
    return _get_cached("pfees_history_all", _fetch)


def _compute_trader_metrics(history: list[dict]) -> dict:
    """
    Compute per-(AccountId, Darwin_raw) performance metrics from full pfees history.

    Equity = Invested + Current PnL  (Darwinex: Invested is deployed capital,
    PnL is cumulative gain/loss — equity is the true current value).

    Period returns: (equity_latest - equity_Ndays_ago) / equity_Ndays_ago
    Max drawdown:   peak-to-trough on equity series, expressed as a negative fraction.

    Returns { (account_id_int, darwin_raw_str): { pct_1d, pct_7d, pct_30d, max_drawdown } }
    """
    from collections import defaultdict

    # Build equity time series per (AccountId, Darwin)
    series: dict = defaultdict(list)
    for row in history:
        acct = int(row.get("AccountId") or 0)
        drw  = (row.get("Darwin") or "").strip()
        inv  = float(row.get("Invested")     or 0)
        pnl  = float(row.get("Current PnL") or 0)
        d    = str(row.get("Date"))
        series[(acct, drw)].append({"date": d, "equity": round(inv + pnl, 2)})

    # Sort each series by date
    for key in series:
        series[key].sort(key=lambda r: r["date"])

    result: dict = {}
    for (acct, drw), pts in series.items():
        if not pts:
            result[(acct, drw)] = {"pct_1d": 0.0, "pct_7d": 0.0, "pct_30d": 0.0, "max_drawdown": 0.0}
            continue

        latest_equity = pts[-1]["equity"]
        latest_date   = pts[-1]["date"]

        def _pct(n_days: int) -> float:
            cutoff = (datetime.fromisoformat(latest_date) - timedelta(days=n_days)).strftime("%Y-%m-%d")
            past   = [p for p in pts if p["date"] <= cutoff]
            if not past or past[-1]["equity"] == 0:
                return 0.0
            return round((latest_equity - past[-1]["equity"]) / abs(past[-1]["equity"]), 6)

        # Max drawdown: peak-to-trough on equity series
        peak   = -float("inf")
        max_dd = 0.0
        for pt in pts:
            eq = pt["equity"]
            if eq > peak:
                peak = eq
            if peak > 0:
                dd = (eq - peak) / peak
                if dd < max_dd:
                    max_dd = dd

        result[(acct, drw)] = {
            "pct_1d":       _pct(1),
            "pct_7d":       _pct(7),
            "pct_30d":      _pct(30),
            "max_drawdown": round(max_dd, 6),
        }

    return result


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
    Uses the latest date in balance_history as reference (not today's date),
    so this works correctly even when data is not yet updated today.
    Returns 0.0 if insufficient data.
    """
    return _period_return_from_hist(get_balance_history(), days)


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

    # Portfolio equity per date — prefer user_accounts_equity (deduplicated per-account
    # source); fall back to balance_history if accounts table is empty.
    equity_by_date: dict[str, float] = _portfolio_equity_by_date()
    if not equity_by_date:
        equity_by_date = _sum_equity_by_date(history)
    sorted_hist_dates = sorted(equity_by_date.keys())

    # Filter only external events (deposit/withdrawal) for sub-period boundaries
    external = [e for e in events if e["event_type"] in ("deposit", "withdrawal")]

    # Bank balance: Σ(deposits) − Σ(withdrawals)
    total_deposited = round(sum(e["amount"]       for e in external if e["amount"] > 0), 2)
    total_withdrawn = round(sum(abs(e["amount"])   for e in external if e["amount"] < 0), 2)
    bank_balance    = round(total_deposited - total_withdrawn, 2)

    # ── Sub-period construction — use Darwinex cash flows, not bank deposits ──
    # capital_events are bank→wallet events.  The Darwinex balance_history only
    # moves when money is actually deployed via internal_transfers (Wallet→account).
    # Using internal_transfers as boundaries gives the correct TWR.
    darwinex_flows   = _get_darwinex_cashflows()
    cashflow_by_date = {f["date"]: f["amount"] for f in darwinex_flows}

    periods      = []
    sorted_dates = [f["date"] for f in darwinex_flows]

    if not sorted_dates:
        # No transfers recorded yet — fall back to capital_events for basic TWR
        sorted_dates = sorted(set(e["date"] for e in external))
        cashflow_by_date = {d: round(sum(e["amount"] for e in external if e["date"] == d), 2)
                            for d in sorted_dates}

    for i, start_date in enumerate(sorted_dates):
        if i + 1 < len(sorted_dates):
            end_date        = sorted_dates[i + 1]
            avail           = [d for d in equity_by_date if d < end_date]
            end_date_equity = max(avail) if avail else None
        else:
            end_date_equity = sorted_hist_dates[-1] if sorted_hist_dates else None
            end_date        = end_date_equity or start_date

        cash_flow = cashflow_by_date.get(start_date, 0.0)

        if i == 0:
            # First period: ground-truth start_aum from balance_history at/after deployment.
            # Handles incomplete internal_transfers where some Wallet→account flows are missing.
            after_start = [d for d in sorted_hist_dates if d >= start_date]
            if after_start:
                start_aum = equity_by_date[after_start[0]]
            else:
                prev_dates    = [d for d in equity_by_date if d < start_date]
                equity_before = equity_by_date[max(prev_dates)] if prev_dates else 0.0
                start_aum     = round(equity_before + cash_flow, 2)
        else:
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
    # inception_date = first bank deposit (shows in ledger header), not first Darwinex trade
    cap_dates      = sorted(set(e["date"] for e in external))
    inception_date = cap_dates[0] if cap_dates else (sorted_dates[0] if sorted_dates else str(date.today()))

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
        metrics     = compute_fund_metrics()
        performance = metrics["twr"]
        # Portfolio initial_investment = total capital deposited from bank (capital_events).
        # This is always correct and never double-counts internal reallocations.
        # e.g. £500K + £500K deposits = £1M regardless of how many times money moves
        #      between Chase1 ↔ Chase3xA internally.
        initial_investment = metrics["total_deposited"]
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

    # Build dual mapping: account_id (primary) and strategy_code (fallback)
    # account_id matches pfees.AccountId — most reliable when set
    # strategy_code matches pfees.Darwin — fallback if account_id not set
    account_to_pod: dict[int, int] = {}
    darwin_to_pod:  dict[str, int] = {}
    for s in strategies:
        pid = s.get("pod_id")
        if pid is None:
            continue
        acct_id = s.get("account_id")
        if acct_id is not None:
            account_to_pod[int(acct_id)] = pid
        code = (s.get("strategy_code") or "").upper()
        if code:
            darwin_to_pod[code] = pid

    # Aggregate pfees by pod_id
    pod_agg: dict = {}   # pod_id → { invested, pnl, darwins }
    UNALLOCATED = -1

    for row in snapshot:
        darwin_raw = (row.get("Darwin") or "")
        darwin     = _darwin_display(darwin_raw)   # CFZ.5.18 → CFZ
        invested   = float(row.get("Invested") or 0)
        pnl        = float(row.get("Current PnL") or 0)
        # Prefer account_id mapping; fall back to strategy_code → Darwin match
        raw_acct = row.get("AccountId")
        if raw_acct is not None and int(raw_acct) in account_to_pod:
            pod_id = account_to_pod[int(raw_acct)]
        else:
            pod_id = darwin_to_pod.get(darwin, UNALLOCATED)

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

    # Net deployed per brokerage account — pod initial = sum of net deployed
    # for all strategies in that pod that have a brokerage_account set.
    # Hybrid: auto when brokerage_account set, manual initial_investment fallback.
    net_deployed = _get_net_deployed_per_account()

    def _strategy_initial(s: dict) -> float:
        """Auto from transfers if brokerage_account set, else manual initial_investment."""
        acct = s.get("brokerage_account")
        if acct:
            return net_deployed.get(acct, 0.0)
        return float(s.get("initial_investment") or 0)

    result = []

    if pods_list:
        # Mode A: pods table populated — one card per pod
        for pod in pods_list:
            pid   = pod["id"]
            agg   = pod_agg.get(pid, {"invested": 0.0, "pnl": 0.0})
            initial = sum(
                _strategy_initial(s)
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
        # Group by display name (prefix only: CFZ.5.18 → CFZ)
        snapshot = get_pfees_latest_snapshot()
        darwin_agg: dict = {}
        for row in snapshot:
            darwin   = _darwin_display(row.get("Darwin") or "")
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

        total_aum    = sum(v["invested"] for v in pod_agg.values()) or 1.0
        net_deployed = _get_net_deployed_per_account()
        rows         = []

        def _hier_strat_initial(s: dict) -> float:
            acct = s.get("brokerage_account")
            if acct:
                return net_deployed.get(acct, 0.0)
            return float(s.get("initial_investment") or 0)

        for pid, agg in pod_agg.items():
            if pid == UNALLOCATED:
                pod = {"name": "Unallocated", "pod_code": "", "color": "#6b7280", "id": -1}
            else:
                pod = pods_idx.get(pid, {"name": f"Pod {pid}", "pod_code": "", "color": "#6366f1", "id": pid})

            initial = sum(
                _hier_strat_initial(s)
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

        # Aggregate pfees by Darwin display name (prefix only: CFZ.5.18 → CFZ)
        darwin_agg: dict = {}
        for row in snapshot:
            darwin   = _darwin_display(row.get("Darwin") or "")
            invested = float(row.get("Invested") or 0)
            pnl      = float(row.get("Current PnL") or 0)
            if darwin not in darwin_agg:
                darwin_agg[darwin] = {"invested": 0.0, "pnl": 0.0}
            darwin_agg[darwin]["invested"] = round(darwin_agg[darwin]["invested"] + invested, 2)
            darwin_agg[darwin]["pnl"]      = round(darwin_agg[darwin]["pnl"] + pnl, 2)

        # ALSO aggregate pfees by AccountId — primary lookup when account_id set on strategy
        acct_agg: dict[int, dict] = {}
        for row in snapshot:
            acct     = int(row.get("AccountId") or 0)
            invested = float(row.get("Invested") or 0)
            pnl      = float(row.get("Current PnL") or 0)
            if acct not in acct_agg:
                acct_agg[acct] = {"invested": 0.0, "pnl": 0.0}
            acct_agg[acct]["invested"] = round(acct_agg[acct]["invested"] + invested, 2)
            acct_agg[acct]["pnl"]      = round(acct_agg[acct]["pnl"] + pnl, 2)

        total_aum          = sum(v["invested"] for v in darwin_agg.values()) or 1.0
        rows               = []
        strat_net_deployed = _get_net_deployed_per_account()

        # Broker → AccountId reverse mapping (for strategies with brokerage_account set)
        acct_to_broker_s = _match_pfees_accounts_to_brokerage()   # { acct_int: "Chase1" }
        broker_to_acct_s = {v: k for k, v in acct_to_broker_s.items()}  # { "Chase1": acct_int }

        # Per-account equity series from user_accounts_equity — used for per-strategy
        # period returns (1D/7D/30D) and max drawdown
        acct_eq_series = _per_account_equity_series()   # { account_id: [{ date, equity }] }

        def _strat_account_id(s: dict) -> Optional[int]:
            """Resolve AccountId for a strategy: direct > broker match > None."""
            aid = s.get("account_id")
            if aid is not None:
                return int(aid)
            broker = s.get("brokerage_account")
            if broker:
                return broker_to_acct_s.get(broker)   # may be None
            return None

        if strategies:
            for s in strategies:
                code    = (s.get("strategy_code") or "").upper()
                acct_id = s.get("account_id")
                broker  = s.get("brokerage_account")

                # Lookup priority:
                # 1. account_id column directly (if set + matches pfees AccountId)
                # 2. brokerage_account → AccountId via invest-vs-deploy matching
                # 3. strategy_code → Darwin display name fallback
                if acct_id is not None and int(acct_id) in acct_agg:
                    agg = acct_agg[int(acct_id)]
                elif broker and broker_to_acct_s.get(broker) in acct_agg:
                    agg = acct_agg[broker_to_acct_s[broker]]
                else:
                    agg = darwin_agg.get(code, {"invested": 0.0, "pnl": 0.0})

                pid        = s.get("pod_id")
                pod        = pods_idx.get(pid, {}) if pid else {}
                pod_joined = s.get("pods") or {}
                pod_color  = pod_joined.get("color") or pod.get("color") or "#6366f1"
                pod_code_s = pod_joined.get("pod_code") or pod.get("pod_code") or ""

                _acct      = s.get("brokerage_account")
                initial    = strat_net_deployed.get(_acct, 0.0) if _acct else float(s.get("initial_investment") or 0)

                # Per-strategy period returns from user_accounts_equity
                resolved_aid = _strat_account_id(s)
                acct_series  = acct_eq_series.get(resolved_aid, []) if resolved_aid else []
                s_pct_1d     = _account_period_return(acct_series, 1)  if acct_series else pct_1d
                s_pct_7d     = _account_period_return(acct_series, 7)  if acct_series else pct_7d
                s_pct_30d    = _account_period_return(acct_series, 30) if acct_series else pct_30d

                # Max drawdown from per-account equity series
                s_drawdown = 0.0
                if acct_series:
                    peak = -float("inf")
                    for pt in acct_series:
                        eq = pt["equity"]
                        if eq > peak:
                            peak = eq
                        if peak > 0:
                            dd = (eq - peak) / peak
                            if dd < s_drawdown:
                                s_drawdown = dd

                rows.append({
                    "entity_id":      f"strategy_{s['id']}",
                    "name":           s.get("name", code),
                    "entity_type":    "strategy",
                    "allocation_pct": round(agg["invested"] / total_aum * 100, 2),
                    "aum":            agg["invested"],
                    "pnl":            agg["pnl"],
                    "pct_1d":         s_pct_1d,
                    "pct_7d":         s_pct_7d,
                    "pct_30d":        s_pct_30d,
                    "drawdown":       round(s_drawdown, 6),
                    "win_rate":       0.0,
                    "trading_style":  s.get("trading_style", None),
                    "status":         s.get("status", "Active"),
                    "pod_code":       pod_code_s,
                    "strategy_code":  s.get("strategy_code", ""),
                    "pod_color":      pod_color,
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

    elif entity_type == "trader":
        snapshot   = get_pfees_latest_snapshot()
        history    = get_pfees_history_all()          # full date history for metrics
        strategies = list_strategies()
        pods_list  = list_pods()
        pods_idx   = {p["id"]: p for p in pods_list}

        # ── Lookup chain (3 levels) ──────────────────────────────────────────
        # 1. account_id on strategy matches pfees AccountId integer directly
        acct_to_strat: dict[int, dict] = {}
        for s in strategies:
            aid = s.get("account_id")
            if aid is not None:
                acct_to_strat[int(aid)] = s

        # 2. brokerage_account on strategy matched to pfees AccountId via
        #    invested-vs-net_deployed ratio comparison (works without account_id column)
        broker_to_strat: dict[str, dict] = {}
        for s in strategies:
            broker = s.get("brokerage_account")
            if broker:
                broker_to_strat[broker] = s
        acct_to_broker = _match_pfees_accounts_to_brokerage()   # { acct_int: "Chase1" }

        # 3. strategy_code → strategy (last resort; works only if code == Darwin prefix)
        darwin_to_strat: dict[str, dict] = {}
        for s in strategies:
            code = (s.get("strategy_code") or "").upper()
            if code:
                darwin_to_strat[code] = s

        # Pre-compute per-(AccountId, Darwin) metrics from full history
        trader_metrics = _compute_trader_metrics(history)

        # Total invested per AccountId — denominator for within-strategy allocation %
        acct_total: dict[int, float] = {}
        for row in snapshot:
            acct     = int(row.get("AccountId") or 0)
            invested = float(row.get("Invested") or 0)
            acct_total[acct] = round(acct_total.get(acct, 0.0) + invested, 2)

        rows = []
        for row in snapshot:
            darwin_raw     = (row.get("Darwin") or "").strip()
            darwin_display = _darwin_display(darwin_raw)   # CFZ.5.18 → CFZ
            acct           = int(row.get("AccountId") or 0)
            invested       = float(row.get("Invested") or 0)
            pnl            = float(row.get("Current PnL") or 0)

            # Strategy lookup: account_id → brokerage_account match → darwin code
            broker = acct_to_broker.get(acct)
            strat  = (
                acct_to_strat.get(acct)                             # level 1
                or (broker_to_strat.get(broker) if broker else None)  # level 2 ← key fix
                or darwin_to_strat.get(darwin_display)              # level 3
                or {}
            )
            pid   = strat.get("pod_id")
            pod   = pods_idx.get(pid, {}) if pid else {}

            # Pod color: prefer joined pod data from list_strategies() join,
            # fall back to pods_idx lookup, then generic blue
            pod_joined  = strat.get("pods") or {}   # from .select("*,pods(name,color,pod_code)")
            pod_color   = pod_joined.get("color") or pod.get("color") or "#6366f1"
            pod_code_t  = pod_joined.get("pod_code") or pod.get("pod_code") or ""

            # Per-Darwin metrics from full history
            m         = trader_metrics.get((acct, darwin_raw), {})
            t_pct_1d  = m.get("pct_1d",       0.0)
            t_pct_7d  = m.get("pct_7d",        0.0)
            t_pct_30d = m.get("pct_30d",       0.0)
            t_max_dd  = m.get("max_drawdown",  0.0)

            # Allocation % within AccountId (strategy-level denominator)
            acct_tot  = acct_total.get(acct, 0.0)
            alloc_pct = round(invested / acct_tot * 100, 2) if acct_tot else 0.0

            rows.append({
                "entity_id":      f"trader_{darwin_raw.lower().replace('.', '_')}_{acct}",
                "name":           darwin_display,
                "entity_type":    "trader",
                "allocation_pct": alloc_pct,
                "aum":            invested,
                "pnl":            pnl,
                "pct_1d":         t_pct_1d,
                "pct_7d":         t_pct_7d,
                "pct_30d":        t_pct_30d,
                "drawdown":       t_max_dd,
                "win_rate":       0.0,
                "trading_style":  None,
                "status":         "Active",
                "pod_code":       pod_code_t,
                "strategy_code":  strat.get("strategy_code", ""),
                "pod_color":      pod_color,
            })

        rows.sort(key=lambda x: x["aum"], reverse=True)
        return rows

    # venue — return empty until venue-level data available
    return []


# ---------------------------------------------------------------------------
# _fast variants — accept pre-fetched data, zero extra DB round-trips
# Called by get_portfolio() endpoint to share data across all computations
# ---------------------------------------------------------------------------

def _period_return_from_hist(history: list[dict], days: int) -> float:
    """
    Compute % equity change over last N days from pre-fetched balance history.

    Prefers user_accounts_equity (portfolio sum) as source of truth.
    Falls back to summed balance_history rows if accounts table is empty.
    Uses latest date in data as reference — not today — so stale data returns
    real period returns rather than 0.0.
    """
    # Prefer accounts equity table
    eq_by_date = _portfolio_equity_by_date()
    if not eq_by_date:
        eq_by_date = _sum_equity_by_date(history)
    if len(eq_by_date) < 2:
        return 0.0
    sorted_dates = sorted(eq_by_date.keys())
    latest_date  = sorted_dates[-1]
    latest       = eq_by_date[latest_date]
    cutoff_str   = (datetime.fromisoformat(latest_date) - timedelta(days=days)).strftime("%Y-%m-%d")
    past_dates   = [d for d in sorted_dates if d <= cutoff_str]
    if not past_dates:
        return 0.0
    past_equity = eq_by_date[past_dates[-1]]
    if past_equity == 0:
        return 0.0
    return round((latest - past_equity) / past_equity, 6)


def compute_fund_metrics_fast(events: list[dict], history: list[dict]) -> dict:
    """compute_fund_metrics() using pre-fetched events + history."""
    current_aum = get_live_aum()   # single pfees query (cached)
    total_pnl   = get_live_pnl()   # single pfees query (cached)

    # Portfolio equity per date — prefer user_accounts_equity (deduplicated per-account
    # source); fall back to summed balance_history if accounts table is empty.
    equity_by_date: dict[str, float] = _portfolio_equity_by_date()
    if not equity_by_date:
        equity_by_date = _sum_equity_by_date(history)
    sorted_hist_dates = sorted(equity_by_date.keys())

    external = [e for e in events if e["event_type"] in ("deposit", "withdrawal")]

    total_deposited = round(sum(e["amount"]       for e in external if e["amount"] > 0), 2)
    total_withdrawn = round(sum(abs(e["amount"])   for e in external if e["amount"] < 0), 2)
    bank_balance    = round(total_deposited - total_withdrawn, 2)

    # Use Darwinex internal_transfers net cash flows for accurate TWR periods
    # (cached — no extra DB call)
    darwinex_flows   = _get_darwinex_cashflows()
    cashflow_by_date = {f["date"]: f["amount"] for f in darwinex_flows}

    periods      = []
    sorted_dates = [f["date"] for f in darwinex_flows]
    if not sorted_dates:
        sorted_dates = sorted(set(e["date"] for e in external))
        cashflow_by_date = {d: round(sum(e["amount"] for e in external if e["date"] == d), 2)
                            for d in sorted_dates}

    for i, start_date in enumerate(sorted_dates):
        if i + 1 < len(sorted_dates):
            end_date        = sorted_dates[i + 1]
            avail           = [d for d in equity_by_date if d < end_date]
            end_date_equity = max(avail) if avail else None
        else:
            end_date_equity = sorted_hist_dates[-1] if sorted_hist_dates else None
            end_date        = end_date_equity or start_date

        cash_flow = cashflow_by_date.get(start_date, 0.0)

        if i == 0:
            # First period: use the first balance_history equity AT OR AFTER start_date
            # as start_aum. This is the ground-truth total portfolio equity on deployment
            # day and correctly handles the case where not all Wallet→account transfers
            # are recorded in internal_transfers (e.g. Chase3xA funded from Chase1
            # internally — equity_by_date already reflects both accounts, but
            # darwinex_flows only sees the Wallet→Chase1 flow, understating cash_flow).
            after_start = [d for d in sorted_hist_dates if d >= start_date]
            if after_start:
                start_aum = equity_by_date[after_start[0]]
            else:
                prev_dates    = [d for d in equity_by_date if d < start_date]
                equity_before = equity_by_date[max(prev_dates)] if prev_dates else 0.0
                start_aum     = round(equity_before + cash_flow, 2)
        else:
            # Subsequent periods: standard TWR — equity before the new cash inflow
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
    cap_dates      = sorted(set(e["date"] for e in external))
    inception_date = cap_dates[0] if cap_dates else (sorted_dates[0] if sorted_dates else str(date.today()))

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
        performance        = metrics["twr"]
        initial_investment = metrics["total_deposited"]   # always £total bank deposits
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

    net_deployed = _get_net_deployed_per_account()

    def _strat_initial_fast(s: dict) -> float:
        acct = s.get("brokerage_account")
        if acct:
            return net_deployed.get(acct, 0.0)
        return float(s.get("initial_investment") or 0)

    result = []

    if pods_list:
        for pod in pods_list:
            pid     = pod["id"]
            agg     = pod_agg.get(pid, {"invested": 0.0, "pnl": 0.0})
            initial = sum(
                _strat_initial_fast(s)
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
        # Mode B: no pods — one card per Darwin (display prefix only)
        darwin_agg: dict = {}
        for row in pod_pfees_map.get("_snapshot", get_pfees_latest_snapshot()):
            darwin   = _darwin_display(row.get("Darwin") or "")
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
    """
    Equity curve — prefers user_accounts_equity (summed per date) as source of truth.
    Falls back to pre-fetched balance_history rows if accounts table is empty.
    """
    # Prefer accounts equity (more reliable, deduplicated per-account)
    eq_by_date = _portfolio_equity_by_date()
    if eq_by_date:
        sorted_dates = sorted(eq_by_date.keys())
        if days is not None:
            cutoff       = (datetime.today() - timedelta(days=days)).strftime("%Y-%m-%d")
            sorted_dates = [d for d in sorted_dates if d >= cutoff]
        return [{"timestamp": d, "equity": eq_by_date[d]} for d in sorted_dates]

    # Fallback: balance_history rows
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
                    status: str = "Active", notes: str = "",
                    brokerage_account: Optional[str] = None) -> dict:
    sb  = get_client()
    res = sb.table("strategies").insert({
        "name":               name,
        "strategy_code":      strategy_code.upper(),
        "pod_id":             pod_id,
        "initial_investment": round(initial_investment, 2),
        "date_created":       date_created,
        "status":             status,
        "notes":              notes or None,
        "brokerage_account":  brokerage_account or None,
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


def get_accounts_equity_history() -> list[dict]:
    """
    Full history from user_accounts_equity ordered by Date asc (cached 60s).

    Primary source of truth for:
      - Portfolio equity curve (sum Equity per date across all AccountIds)
      - TWR sub-period computation
      - Per-account equity series for strategy period returns (1D/7D/30D)

    Returns list of { date: str, account_id: int, equity: float }.
    """
    def _fetch():
        sb  = get_client()
        res = (
            sb.table("user_accounts_equity")
            .select('"Date","AccountId","Equity"')
            .order('"Date"', desc=False)
            .execute()
        )
        return [
            {
                "date":       str(r["Date"]),
                "account_id": int(r["AccountId"]),
                "equity":     float(r["Equity"] or 0),
            }
            for r in (res.data or [])
        ]
    return _get_cached("accounts_equity_history", _fetch)


def _portfolio_equity_by_date() -> dict[str, float]:
    """
    Total portfolio equity per date: SUM(Equity) across all AccountIds per Date.
    Sourced from user_accounts_equity — deduplicated at DB level via trigger.
    Returns { date_str: total_equity_float } sorted keys.
    """
    history = get_accounts_equity_history()
    eq: dict[str, float] = {}
    for r in history:
        d = r["date"]
        eq[d] = round(eq.get(d, 0.0) + r["equity"], 2)
    return eq


def _per_account_equity_series() -> dict[int, list[dict]]:
    """
    Per-account equity time series from user_accounts_equity.
    Returns { account_id: [{ date: str, equity: float }, ...] } sorted by date.
    Used for per-strategy period returns in hierarchy table.
    """
    history = get_accounts_equity_history()
    series: dict[int, list] = {}
    for r in history:
        aid = r["account_id"]
        if aid not in series:
            series[aid] = []
        series[aid].append({"date": r["date"], "equity": r["equity"]})
    # Already sorted by Date asc from DB query
    return series


def _account_period_return(series: list[dict], days: int) -> float:
    """
    % equity change over last N days for a single account equity series.
    Uses latest date in the series as reference (not today).
    """
    if len(series) < 2:
        return 0.0
    latest_date  = series[-1]["date"]
    latest       = series[-1]["equity"]
    cutoff_str   = (datetime.fromisoformat(latest_date) - timedelta(days=days)).strftime("%Y-%m-%d")
    past         = [p for p in series if p["date"] <= cutoff_str]
    if not past or past[-1]["equity"] == 0:
        return 0.0
    return round((latest - past[-1]["equity"]) / abs(past[-1]["equity"]), 6)


# ---------------------------------------------------------------------------
# Internal Transfers CRUD
# ---------------------------------------------------------------------------

def list_internal_transfers() -> list[dict]:
    """
    All rows from internal_transfers ordered by transfer_date ASC, id ASC.
    Python-side sort used because postgrest-py chained .order() calls may
    replace rather than compound — guarantees correct secondary sort by id.
    """
    def _fetch():
        rows = (
            get_client()
            .table("internal_transfers")
            .select("*")
            .execute()
            .data or []
        )
        rows.sort(key=lambda r: (r["transfer_date"], r["id"]))
        return rows

    return _get_cached("internal_transfers", _fetch)


def _get_darwinex_cashflows() -> list[dict]:
    """
    Compute net daily cash flows INTO Darwinex accounts from internal_transfers.

    FROM Wallet  → positive  (deploying capital to a Darwinex account)
    TO   Wallet  → negative  (withdrawing capital from a Darwinex account)
    Account↔account (rebalancing inside Darwinex) → ignored (net 0 for total exposure)

    Returns sorted list of { date: str, amount: float } for days with non-zero net.
    Used as TWR sub-period boundaries instead of bank capital_events.
    """
    transfers = list_internal_transfers()
    daily: dict[str, float] = {}
    for t in transfers:
        d   = t["transfer_date"]
        amt = float(t["amount"])
        if t["from_account"] == "Wallet":
            daily[d] = round(daily.get(d, 0.0) + amt, 2)
        elif t["to_account"] == "Wallet":
            daily[d] = round(daily.get(d, 0.0) - amt, 2)
        # Rebalance between non-Wallet accounts nets to zero — not a fund cash flow
    return sorted(
        [{"date": d, "amount": a} for d, a in daily.items() if a != 0],
        key=lambda x: x["date"],
    )


def _get_net_deployed_per_account() -> dict[str, float]:
    """
    Net capital deployed per brokerage account from internal_transfers.

    Only counts Wallet↔account flows — account-to-account rebalances are excluded
    because they represent internal reallocations, not new capital deployment.

      Wallet → account  : positive (deploying capital)
      account → Wallet  : negative (returning capital)

    Returns { account_name: net_deployed_float }
    e.g. { "Chase1": 899950.0, "Chase3xA": 100000.0, "XPF2026": 50.0 }
    """
    transfers = list_internal_transfers()
    net: dict[str, float] = {}
    for t in transfers:
        amt = float(t["amount"])
        frm = t["from_account"]
        to  = t["to_account"]
        if frm == "Wallet" and to != "Wallet":
            net[to]  = round(net.get(to, 0.0) + amt, 2)
        elif to == "Wallet" and frm != "Wallet":
            net[frm] = round(net.get(frm, 0.0) - amt, 2)
        # account↔account: ignored — same capital, different location
    return net


def get_net_deployed() -> dict[str, float]:
    """
    Public wrapper — returns net deployed per brokerage account (cached via
    internal_transfers cache). Used by /api/management/net-deployed endpoint.
    """
    return _get_net_deployed_per_account()


def _match_pfees_accounts_to_brokerage() -> dict[int, str]:
    """
    Match pfees AccountId integers → brokerage account names (Chase1, Chase3xA etc.)
    by comparing total Invested per AccountId against net_deployed per brokerage account.

    Greedy closest-ratio match: largest AccountId total → closest net_deployed bucket.
    Handles leveraged accounts (3x) where invested ≠ net_deployed exactly.

    Returns { account_id_int: brokerage_account_name }
    e.g. { 12345: "Chase1", 67890: "Chase3xA" }

    Cached under "pfees_acct_broker_map" for 60s (invalidated with internal_transfers).
    """
    def _compute():
        snapshot     = get_pfees_latest_snapshot()
        net_deployed = _get_net_deployed_per_account()
        if not net_deployed or not snapshot:
            return {}

        # Sum Invested per AccountId from pfees
        acct_invested: dict[int, float] = {}
        for row in snapshot:
            acct = int(row.get("AccountId") or 0)
            inv  = float(row.get("Invested") or 0)
            acct_invested[acct] = round(acct_invested.get(acct, 0.0) + inv, 2)

        # Greedy match: sort AccountIds by total invested desc, pick closest broker
        remaining = dict(net_deployed)   # brokers not yet matched
        mapping: dict[int, str] = {}

        for acct, inv_total in sorted(acct_invested.items(), key=lambda x: x[1], reverse=True):
            if not remaining:
                break
            if inv_total == 0:
                continue
            # Closest by ratio inv_total / deployed → 1.0
            best_broker = min(
                remaining,
                key=lambda b: abs(inv_total / remaining[b] - 1.0) if remaining[b] > 0 else float("inf"),
            )
            deployed = remaining[best_broker]
            if deployed > 0:
                ratio = inv_total / deployed
                if 0.3 <= ratio <= 3.0:   # wide tolerance: 3x leverage, early PnL swings
                    mapping[acct]   = best_broker
                    del remaining[best_broker]

        return mapping

    return _get_cached("pfees_acct_broker_map", _compute)


def create_internal_transfer(transfer_date: str, from_account: str,
                              to_account: str, amount: float,
                              notes: str = "") -> dict:
    sb  = get_client()
    res = sb.table("internal_transfers").insert({
        "transfer_date": transfer_date,
        "from_account":  from_account,
        "to_account":    to_account,
        "amount":        round(abs(amount), 2),
        "notes":         notes or None,
    }).execute()
    _invalidate("internal_transfers")
    return res.data[0] if res.data else {}


def update_internal_transfer(transfer_id: int, **fields) -> dict:
    sb = get_client()
    if "amount" in fields:
        fields["amount"] = round(abs(float(fields["amount"])), 2)
    res = sb.table("internal_transfers").update(fields).eq("id", transfer_id).execute()
    _invalidate("internal_transfers")
    return res.data[0] if res.data else {}


def delete_internal_transfer(transfer_id: int) -> bool:
    sb = get_client()
    sb.table("internal_transfers").delete().eq("id", transfer_id).execute()
    _invalidate("internal_transfers")
    return True


# ---------------------------------------------------------------------------
# Miscellaneous Events CRUD
# ---------------------------------------------------------------------------

def list_misc_events() -> list[dict]:
    """All rows from misc_events ordered by event_date asc (cached 60s)."""
    return _get_cached("misc_events", lambda: (
        get_client()
        .table("misc_events")
        .select("*")
        .order("event_date", desc=False)
        .execute()
        .data or []
    ))


def create_misc_event(event_date: str, event_type: str, direction: str,
                      amount: float, notes: str = "") -> dict:
    sb  = get_client()
    res = sb.table("misc_events").insert({
        "event_date": event_date,
        "event_type": event_type,
        "direction":  direction,
        "amount":     round(abs(amount), 2),
        "notes":      notes or None,
    }).execute()
    _invalidate("misc_events")
    return res.data[0] if res.data else {}


def update_misc_event(misc_id: int, **fields) -> dict:
    sb = get_client()
    if "amount" in fields:
        fields["amount"] = round(abs(float(fields["amount"])), 2)
    res = sb.table("misc_events").update(fields).eq("id", misc_id).execute()
    _invalidate("misc_events")
    return res.data[0] if res.data else {}


def delete_misc_event(misc_id: int) -> bool:
    sb = get_client()
    sb.table("misc_events").delete().eq("id", misc_id).execute()
    _invalidate("misc_events")
    return True
