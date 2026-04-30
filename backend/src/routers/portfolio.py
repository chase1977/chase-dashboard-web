# backend/src/routers/portfolio.py
"""
/api/portfolio  —  all portfolio and drill-down endpoints.

Endpoints:
  GET /api/portfolio/                         Portfolio home page (live Supabase)
  GET /api/portfolio/drilldown/{entity_id}    Any entity drill-down
  GET /api/portfolio/trader_context/{entity_id}  3-tab trader breakdown
  GET /api/portfolio/hierarchy/{entity_type}  Hierarchy table tabs (live Supabase)
  GET /api/portfolio/fund_ledger              TWR + bank balance + ledger (live Supabase)
"""

from fastapi import APIRouter, Query, HTTPException
from typing import Optional
import os
import datetime

from src.services import supabase_service as sb_svc
from src.models.schemas import (
    PortfolioPageResponse, DrillDownPageResponse,
    TraderContextResponse,
    KpiData, PodSummary, EquityPoint, AllocationSlice,
    PnlBar, BreakdownRow, HierarchyTableResponse,
    FundLedgerSummary, SubPeriod, CapitalEvent,
)

router   = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

TIME_RANGE_DAYS = {"1D": 1, "7D": 7, "30D": 30, "YTD": None, "SI": None}


def _days(time_range: str) -> Optional[int]:
    tr = time_range.upper()
    if tr == "YTD":
        today = datetime.date.today()
        return (today - today.replace(month=1, day=1)).days
    return TIME_RANGE_DAYS.get(tr)


# ---------------------------------------------------------------------------
# Portfolio home page — live Supabase
# ---------------------------------------------------------------------------

@router.get("/", response_model=PortfolioPageResponse)
def get_portfolio(time_range: str = Query("SI")):
    """
    Portfolio home page data — all figures from live Supabase tables.

    Sources:
      - user_pfees_estimation  → KPIs (AUM, PnL), pod allocation, pod PnL
      - balance_history        → equity curve, period returns (1D/7D/30D)
      - capital_events         → TWR, initial investment
      - pods + strategies      → pod grouping (empty = Darwin-level grouping)
    """
    days = _days(time_range)

    # KPIs
    kpis_dict = sb_svc.get_portfolio_kpis()
    kpis      = KpiData(**kpis_dict)

    # Pod strips
    pod_data = sb_svc.get_pods_with_kpis()
    pods     = [
        PodSummary(
            entity_id = p["entity_id"],
            name      = p["name"],
            pod_code  = p.get("pod_code", ""),
            pod_color = p.get("pod_color", "#6366f1"),
            kpis      = KpiData(**p["kpis"]),
        )
        for p in pod_data
    ]

    # Equity curve
    equity_curve = [
        EquityPoint(timestamp=pt["timestamp"], equity=pt["equity"])
        for pt in sb_svc.get_equity_curve_data(days)
    ]

    # Allocation donut + PnL bars
    allocation       = [AllocationSlice(**a) for a in sb_svc.get_allocation_data()]
    pnl_contribution = [PnlBar(**p)          for p in sb_svc.get_pnl_contribution_data()]

    last_updated = sb_svc.get_latest_pfees_date() or str(datetime.date.today())

    return PortfolioPageResponse(
        portfolio_name   = "Chase Capital",
        last_updated     = last_updated,
        kpis             = kpis,
        pods             = pods,
        equity_curve     = equity_curve,
        allocation       = allocation,
        pnl_contribution = pnl_contribution,
    )


# ---------------------------------------------------------------------------
# Hierarchy tables (Pods / Strategies / Traders / Venues tabs) — live Supabase
# ---------------------------------------------------------------------------

@router.get("/hierarchy/{entity_type}", response_model=HierarchyTableResponse)
def get_hierarchy_table(entity_type: str):
    """
    Returns hierarchy tab rows from live Supabase data.

    entity_type: pod | strategy | trader | venue
    - pod / strategy: aggregated from user_pfees_estimation + pods/strategies tables
    - trader / venue: returns empty rows until trader data is available
    """
    rows = [BreakdownRow(**r) for r in sb_svc.get_hierarchy_rows(entity_type)]
    return HierarchyTableResponse(entity_type=entity_type, rows=rows)


# ---------------------------------------------------------------------------
# Fund Ledger — TWR + Bank Balance + Capital Events (live Supabase)
# ---------------------------------------------------------------------------

@router.get("/fund_ledger", response_model=FundLedgerSummary)
def get_fund_ledger():
    """
    GET /api/portfolio/fund_ledger

    Returns complete fund capital ledger from live Supabase:
      - AUM from user_pfees_estimation (latest snapshot)
      - PnL from user_pfees_estimation (latest snapshot)
      - TWR chain-linked from capital_events + balance_history
      - Bank balance from capital_events
      - Sub-period breakdown bounded by capital events
    """
    summary = sb_svc.compute_fund_metrics()

    return FundLedgerSummary(
        twr             = summary["twr"],
        total_pnl       = summary["total_pnl"],
        initial_aum     = summary["initial_aum"],
        current_aum     = summary["current_aum"],
        bank_balance    = summary["bank_balance"],
        total_deposited = summary["total_deposited"],
        total_withdrawn = summary["total_withdrawn"],
        periods         = [SubPeriod(**p)    for p in summary["periods"]],
        events          = [CapitalEvent(**e) for e in summary["events"]],
        num_periods     = summary["num_periods"],
        inception_date  = summary["inception_date"],
        last_updated    = summary["last_updated"],
    )


# ---------------------------------------------------------------------------
# Drill-down page (any entity) — retained for future use
# ---------------------------------------------------------------------------

@router.get("/drilldown/{entity_id}", response_model=DrillDownPageResponse)
def get_drilldown(entity_id: str, time_range: str = Query("SI")):
    """
    Entity drill-down page. Returns empty data until pods/strategies are populated
    and drilldown is wired to Supabase. entity_id format: pod_<id> | strategy_<id>
    """
    # Parse type + id from entity_id (e.g. "pod_3", "darwin_sxr")
    parts       = entity_id.split("_", 1)
    entity_type = parts[0] if parts else "unknown"
    days        = _days(time_range)

    kpis = KpiData(
        initial_investment=0,
        current_equity=0,
        performance=0,
        total_pnl=0,
        pct_1d=0,
        pct_7d=0,
        pct_30d=0,
    )

    # Try to get pod/strategy name from Supabase
    entity_name = entity_id
    pod_code    = ""
    pod_color   = ""
    strategy_code = ""

    if entity_type == "pod":
        try:
            pid  = int(parts[1]) if len(parts) > 1 else -1
            pods = sb_svc.list_pods()
            pod  = next((p for p in pods if p["id"] == pid), None)
            if pod:
                entity_name   = pod.get("name", entity_id)
                pod_code      = pod.get("pod_code", "")
                pod_color     = pod.get("color", "")
        except Exception:
            pass

    elif entity_type == "strategy":
        try:
            sid      = int(parts[1]) if len(parts) > 1 else -1
            strats   = sb_svc.list_strategies()
            strategy = next((s for s in strats if s["id"] == sid), None)
            if strategy:
                entity_name   = strategy.get("name", entity_id)
                strategy_code = strategy.get("strategy_code", "")
        except Exception:
            pass

    equity_curve = [
        EquityPoint(timestamp=pt["timestamp"], equity=pt["equity"])
        for pt in sb_svc.get_equity_curve_data(days)
    ]

    return DrillDownPageResponse(
        entity_id        = entity_id,
        entity_name      = entity_name,
        entity_type      = entity_type,
        breadcrumb       = [{"id": "portfolio_main", "name": "Portfolio"}],
        pod_code         = pod_code,
        pod_color        = pod_color,
        strategy_code    = strategy_code,
        trading_style    = "",
        entity_status    = "Active",
        kpis             = kpis,
        equity_curve     = equity_curve,
        allocation       = [],
        pnl_contribution = [],
        breakdown        = [],
    )


# ---------------------------------------------------------------------------
# Trader context — returns empty until trader data available
# ---------------------------------------------------------------------------

@router.get("/trader_context/{entity_id}", response_model=TraderContextResponse)
def get_trader_context(entity_id: str):
    return TraderContextResponse(
        entity_id   = entity_id,
        entity_name = entity_id,
        venues      = [],
        pods        = [],
        strategies  = [],
    )
