# backend/src/routers/portfolio.py
"""
/api/portfolio  —  all portfolio and drill-down endpoints.

Endpoints:
  GET /api/portfolio/                         Portfolio home page data
  GET /api/portfolio/drilldown/{entity_id}    Any entity drill-down
  GET /api/portfolio/trader_context/{entity_id}  3-tab trader breakdown
  GET /api/portfolio/hierarchy/{entity_type}  Hierarchy table tabs
  GET /api/portfolio/fund_ledger              TWR + bank balance + ledger
"""

from fastapi import APIRouter, Query, HTTPException
from typing import Optional
import os

from src.services import data_service as ds
from src.services import supabase_service as sb_svc
from src.models.schemas import (
    PortfolioPageResponse, DrillDownPageResponse,
    TraderContextResponse,
    KpiData, PodSummary, EquityPoint, AllocationSlice,
    PnlBar, BreakdownRow, HierarchyTableResponse,
    FundLedgerSummary, SubPeriod, CapitalEvent,
)

router   = APIRouter(prefix="/api/portfolio", tags=["portfolio"])
DATA_DIR = os.environ.get(
    "DATA_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "data")
)

TIME_RANGE_DAYS = {"1D": 1, "7D": 7, "30D": 30, "YTD": None, "SI": None}


def _days(time_range: str) -> Optional[int]:
    if time_range.upper() == "YTD":
        import datetime
        today = datetime.date.today()
        return (today - today.replace(month=1, day=1)).days
    return TIME_RANGE_DAYS.get(time_range.upper())


# ---------------------------------------------------------------------------
# Portfolio home page
# ---------------------------------------------------------------------------

@router.get("/", response_model=PortfolioPageResponse)
def get_portfolio(time_range: str = Query("SI")):
    days      = _days(time_range)
    port_snap = ds.latest_snapshot("portfolio_main", DATA_DIR)
    kpis      = KpiData(**ds.snapshot_kpis(port_snap))

    entities = ds.get_entities(DATA_DIR)
    ents_idx = entities.set_index("entity_id")

    # Pod summaries — include pod_code and pod_color
    pods          = ds.children_of("portfolio_main", entity_type="pod", data_dir=DATA_DIR)
    pod_summaries = []
    for _, pod in pods.iterrows():
        snap = ds.latest_snapshot(pod["entity_id"], DATA_DIR)
        if snap is None:
            continue
        ent = ents_idx.loc[pod["entity_id"]] if pod["entity_id"] in ents_idx.index else None
        pod_summaries.append(PodSummary(
            entity_id = pod["entity_id"],
            name      = pod["name"],
            pod_code  = ent["pod_code"]  if ent is not None else "",
            pod_color = ent["pod_color"] if ent is not None else "",
            kpis      = KpiData(**ds.snapshot_kpis(snap)),
        ))

    # Equity curve
    curve_df     = ds.equity_series_for("portfolio_main", days=days, data_dir=DATA_DIR)
    equity_curve = [
        EquityPoint(timestamp=str(r["timestamp"]), equity=float(r["equity"]))
        for _, r in curve_df.iterrows()
    ]

    allocation       = [AllocationSlice(**r) for r in ds.allocation_by_children("portfolio_main", DATA_DIR)]
    pnl_contribution = [PnlBar(**r)          for r in ds.pnl_by_children("portfolio_main", DATA_DIR)]

    port_name = entities.loc[
        entities["entity_id"] == "portfolio_main", "name"
    ].values[0] if not entities.empty else "Portfolio"

    return PortfolioPageResponse(
        portfolio_name   = port_name,
        last_updated     = str(port_snap["timestamp"]) if port_snap is not None else "",
        kpis             = kpis,
        pods             = pod_summaries,
        equity_curve     = equity_curve,
        allocation       = allocation,
        pnl_contribution = pnl_contribution,
    )


# ---------------------------------------------------------------------------
# Drill-down page (any entity)
# ---------------------------------------------------------------------------

@router.get("/drilldown/{entity_id}", response_model=DrillDownPageResponse)
def get_drilldown(entity_id: str, time_range: str = Query("SI")):
    days     = _days(time_range)
    entities = ds.get_entities(DATA_DIR)
    ent_row  = entities[entities["entity_id"] == entity_id]

    if ent_row.empty:
        raise HTTPException(status_code=404, detail=f"Entity {entity_id} not found")

    ent  = ent_row.iloc[0]
    snap = ds.latest_snapshot(entity_id, DATA_DIR)
    kpis = KpiData(**ds.snapshot_kpis(snap))

    curve_df     = ds.equity_series_for(entity_id, days=days, data_dir=DATA_DIR)
    equity_curve = [
        EquityPoint(timestamp=str(r["timestamp"]), equity=float(r["equity"]))
        for _, r in curve_df.iterrows()
    ]

    allocation       = [AllocationSlice(**r) for r in ds.allocation_by_children(entity_id, DATA_DIR)]
    pnl_contribution = [PnlBar(**r)          for r in ds.pnl_by_children(entity_id, DATA_DIR)]
    breakdown        = [BreakdownRow(**r)    for r in ds.breakdown_table(entity_id, DATA_DIR)]
    breadcrumb       = ds.ancestor_chain(entity_id, DATA_DIR)

    return DrillDownPageResponse(
        entity_id        = entity_id,
        entity_name      = ent["name"],
        entity_type      = ent["entity_type"],
        breadcrumb       = breadcrumb,
        pod_code         = ent.get("pod_code",      ""),
        pod_color        = ent.get("pod_color",     ""),
        strategy_code    = ent.get("strategy_code", ""),
        trading_style    = ent.get("trading_style", ""),
        entity_status    = ent.get("status",        ""),
        kpis             = kpis,
        equity_curve     = equity_curve,
        allocation       = allocation,
        pnl_contribution = pnl_contribution,
        breakdown        = breakdown,
    )


# ---------------------------------------------------------------------------
# Trader context — 3-tab breakdown (Venues | Pods | Strategies)
# ---------------------------------------------------------------------------

@router.get("/trader_context/{entity_id}", response_model=TraderContextResponse)
def get_trader_context(entity_id: str):
    """
    Returns venues, pods and strategies for a given trader entity_id.
    Cross-pod traders (e.g. CFZ in SYSDWX and ALPHA) show multiple rows
    in pods and strategies — one per allocation slice.
    """
    entities = ds.get_entities(DATA_DIR)
    ent_row  = entities[entities["entity_id"] == entity_id]

    if ent_row.empty:
        raise HTTPException(status_code=404, detail=f"Entity {entity_id} not found")

    entity_name = ent_row.iloc[0]["name"]
    ctx         = ds.trader_context(entity_id, DATA_DIR)

    return TraderContextResponse(
        entity_id   = entity_id,
        entity_name = entity_name,
        venues      = [BreakdownRow(**r) for r in ctx["venues"]],
        pods        = [BreakdownRow(**r) for r in ctx["pods"]],
        strategies  = [BreakdownRow(**r) for r in ctx["strategies"]],
    )


# ---------------------------------------------------------------------------
# Hierarchy tables (Pods / Strategies / Traders / Venues tabs)
# ---------------------------------------------------------------------------

@router.get("/hierarchy/{entity_type}", response_model=HierarchyTableResponse)
def get_hierarchy_table(entity_type: str):
    entities  = ds.get_entities(DATA_DIR)
    snap_map  = (ds.get_snapshots(DATA_DIR)
                   .sort_values("timestamp")
                   .groupby("entity_id").last())
    port_snap = ds.latest_snapshot("portfolio_main", DATA_DIR)
    port_inv  = float(port_snap.get("aum", port_snap.get("invested_capital", 1))) \
                if port_snap is not None else 1

    subset = entities[entities["entity_type"] == entity_type]

    # ── Venues: aggregate by unique venue name ──
    # Each trader has its own venue child entity, but the user sees
    # one row per counterparty (Alpha, Darwinex, IB) with combined metrics.
    if entity_type == "venue":
        venue_agg = {}  # name → aggregated dict

        for _, ent in subset.iterrows():
            if ent["entity_id"] not in snap_map.index:
                continue
            s    = snap_map.loc[ent["entity_id"]]
            aum  = float(s.get("aum", s.get("invested_capital", 0)))
            pnl  = float(s.get("pnl_total", s.get("open_pnl", 0)))
            name = ent["name"]

            if name not in venue_agg:
                venue_agg[name] = dict(
                    name          = name,
                    entity_id     = f"venue__{name.lower().replace(' ', '_')}",
                    entity_type   = "venue",
                    pod_code      = "",
                    strategy_code = "",
                    pod_color     = "",
                    trading_style = "",
                    status        = "Active",
                    aum           = 0.0,
                    pnl           = 0.0,
                    _weight       = 0.0,
                    pct_1d        = 0.0,
                    pct_7d        = 0.0,
                    pct_30d       = 0.0,
                    drawdown      = 0.0,
                    win_rate      = 0.0,
                )

            agg       = venue_agg[name]
            agg["aum"] = round(agg["aum"] + aum, 2)
            agg["pnl"] = round(agg["pnl"] + pnl, 2)
            old_w      = agg["_weight"]
            agg["_weight"] += aum
            new_w      = agg["_weight"]

            for field in ("pct_1d", "pct_7d", "pct_30d", "drawdown", "win_rate"):
                val = float(s.get(field, 0))
                agg[field] = round(
                    (agg[field] * old_w + val * aum) / new_w
                    if new_w > 0 else 0.0,
                    6
                )

        rows = []
        for agg in venue_agg.values():
            agg.pop("_weight", None)
            alloc_pct = round(agg["aum"] / port_inv * 100, 2) if port_inv > 0 else 0.0
            rows.append(BreakdownRow(allocation_pct=alloc_pct, **agg))

        rows.sort(key=lambda x: x.name.lower())
        return HierarchyTableResponse(entity_type=entity_type, rows=rows)

    # ── All other entity types: one row per entity ──
    rows = []
    for _, ent in subset.iterrows():
        if ent["entity_id"] not in snap_map.index:
            continue
        s   = snap_map.loc[ent["entity_id"]]
        aum = float(s.get("aum", s.get("invested_capital", 0)))
        pnl = float(s.get("pnl_total", s.get("open_pnl",   0)))

        rows.append(BreakdownRow(
            entity_id      = ent["entity_id"],
            name           = ent["name"],
            entity_type    = ent["entity_type"],
            allocation_pct = round(aum / port_inv * 100, 2) if port_inv > 0 else 0.0,
            aum            = round(aum, 2),
            pnl            = round(pnl, 2),
            pct_1d         = round(float(s.get("pct_1d",   0)), 6),
            pct_7d         = round(float(s.get("pct_7d",   0)), 6),
            pct_30d        = round(float(s.get("pct_30d",  0)), 6),
            drawdown       = round(float(s.get("drawdown", 0)), 4),
            win_rate       = round(float(s.get("win_rate", 0)), 4),
            trading_style  = ent.get("trading_style", ""),
            status         = ent.get("status",        ""),
            pod_code       = ent.get("pod_code",      ""),
            strategy_code  = ent.get("strategy_code", ""),
            pod_color      = ent.get("pod_color",     ""),
        ))

    rows.sort(key=lambda x: x.name.lower())
    return HierarchyTableResponse(entity_type=entity_type, rows=rows)


# ---------------------------------------------------------------------------
# Fund Ledger — TWR + Bank Balance + Capital Events
# ---------------------------------------------------------------------------

@router.get("/fund_ledger", response_model=FundLedgerSummary)
def get_fund_ledger():
    """
    GET /api/portfolio/fund_ledger

    Returns the complete fund capital ledger computed from live Supabase data:
      - AUM from user_pfees_estimation (latest snapshot)
      - PnL from user_pfees_estimation (latest snapshot)
      - TWR chain-linked from capital_events + balance_history
      - Bank balance from capital_events (deposits - withdrawals)
      - Sub-period breakdown bounded by capital events

    Falls back to local JSON/CSV if Supabase is not configured.
    Used by: SummaryStrip on dashboard top.
    """
    try:
        summary = sb_svc.compute_fund_metrics()
    except Exception:
        # Fallback to local demo data if Supabase not reachable
        summary = ds.get_fund_ledger_summary(DATA_DIR)

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