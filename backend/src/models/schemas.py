# backend/src/models/schemas.py

from enum import Enum
from typing import Optional, List
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Entity
# ---------------------------------------------------------------------------

class Entity(BaseModel):
    entity_id:     str
    entity_type:   str
    parent_id:     Optional[str]
    name:          str
    status:        Optional[str]
    trading_style: Optional[str]
    pod_code:      Optional[str]
    strategy_code: Optional[str]
    pod_color:     Optional[str]


# ---------------------------------------------------------------------------
# KPI strip (7 headline numbers)
# ---------------------------------------------------------------------------

class KpiData(BaseModel):
    initial_investment: float
    current_equity:     float
    performance:        float
    total_pnl:          float
    pct_1d:             float
    pct_7d:             float
    pct_30d:            float


# ---------------------------------------------------------------------------
# Pod summary (used in Portfolio page pod overview strip)
# ---------------------------------------------------------------------------

class PodSummary(BaseModel):
    entity_id:  str
    name:       str
    pod_code:   Optional[str]
    pod_color:  Optional[str]
    kpis:       KpiData


# ---------------------------------------------------------------------------
# Equity curve point
# ---------------------------------------------------------------------------

class EquityPoint(BaseModel):
    timestamp: str
    equity:    float


# ---------------------------------------------------------------------------
# Allocation slice (donut chart)
# ---------------------------------------------------------------------------

class AllocationSlice(BaseModel):
    name: str
    aum:  float
    pct:  float


# ---------------------------------------------------------------------------
# PnL bar item
# ---------------------------------------------------------------------------

class PnlBar(BaseModel):
    name: str
    pnl:  float


# ---------------------------------------------------------------------------
# Breakdown table row
# Includes pod_code, strategy_code, pod_color for coloured dots and tags
# ---------------------------------------------------------------------------

class BreakdownRow(BaseModel):
    entity_id:      str
    name:           str
    entity_type:    str
    allocation_pct: float
    aum:            float
    pnl:            float
    pct_1d:         float
    pct_7d:         float
    pct_30d:        float
    drawdown:       float
    win_rate:       float
    trading_style:  Optional[str]
    status:         Optional[str]
    pod_code:       Optional[str]
    strategy_code:  Optional[str]
    pod_color:      Optional[str]


# ---------------------------------------------------------------------------
# Trader context — 3-tab breakdown shown when drilling into a trader
# Returns venues (children), pods (all pods this trader appears in),
# and strategies (all strategies this trader appears in),
# resolved by matching trader display name across all entity rows.
# ---------------------------------------------------------------------------

class TraderContextResponse(BaseModel):
    entity_id:   str
    entity_name: str
    venues:      List[BreakdownRow]
    pods:        List[BreakdownRow]
    strategies:  List[BreakdownRow]


# ---------------------------------------------------------------------------
# Portfolio page response
# ---------------------------------------------------------------------------

class PortfolioPageResponse(BaseModel):
    portfolio_name:   str
    last_updated:     str
    kpis:             KpiData
    pods:             List[PodSummary]
    equity_curve:     List[EquityPoint]
    allocation:       List[AllocationSlice]
    pnl_contribution: List[PnlBar]


# ---------------------------------------------------------------------------
# Drill-down page response
# ---------------------------------------------------------------------------

class DrillDownPageResponse(BaseModel):
    entity_id:        str
    entity_name:      str
    entity_type:      str
    breadcrumb:       List[dict]
    pod_code:         Optional[str]
    pod_color:        Optional[str]
    strategy_code:    Optional[str]
    trading_style:    Optional[str]
    entity_status:    Optional[str]
    kpis:             KpiData
    equity_curve:     List[EquityPoint]
    allocation:       List[AllocationSlice]
    pnl_contribution: List[PnlBar]
    breakdown:        List[BreakdownRow]


# ---------------------------------------------------------------------------
# Hierarchy table response (tabs at bottom of portfolio page)
# ---------------------------------------------------------------------------

class HierarchyTableResponse(BaseModel):
    entity_type: str
    rows:        List[BreakdownRow]


# ---------------------------------------------------------------------------
# Capital Event Types
# ---------------------------------------------------------------------------

class CapitalEventType(str, Enum):
    deposit        = "deposit"
    withdrawal     = "withdrawal"
    pod_allocation = "pod_allocation"   # internal — pod receives capital
    pod_redemption = "pod_redemption"   # internal — pod returns capital


# ---------------------------------------------------------------------------
# Single Capital Event
# ---------------------------------------------------------------------------

class CapitalEvent(BaseModel):
    event_id:   str
    date:       str                     # ISO 8601 "YYYY-MM-DD"
    event_type: CapitalEventType
    amount:     float                   # positive = inflow, negative = outflow
    pod_id:     Optional[str] = None    # None for portfolio-level events
    notes:      Optional[str] = None


# ---------------------------------------------------------------------------
# Sub-Period — bounded by external cash flows (deposits / withdrawals only)
# Pod allocations are internal and do NOT create new sub-periods.
# ---------------------------------------------------------------------------

class SubPeriod(BaseModel):
    period_num:         int
    start_date:         str
    end_date:           str
    start_aum:          float           # AUM after cash flow applied at boundary
    cash_flow_at_start: float           # external flow at period start (+/-)
    end_aum:            float           # AUM before next cash flow
    pnl:                float           # end_aum − start_aum
    period_return:      float           # pnl / start_aum — pure manager performance
    annualised_return:  Optional[float] = None


# ---------------------------------------------------------------------------
# Fund Ledger Summary — powers BankCard + FundLedgerCard on dashboard
# ---------------------------------------------------------------------------

class FundLedgerSummary(BaseModel):
    # Core performance
    twr:             float   # Time-Weighted Return: Π(1+Rᵢ) − 1
    total_pnl:       float   # Σ PnL across all sub-periods
    initial_aum:     float   # AUM at fund inception
    current_aum:     float   # Latest AUM

    # Capital flow tracking (external only)
    bank_balance:    float   # Σ(deposits) − Σ(withdrawals)
    total_deposited: float   # Σ all deposits
    total_withdrawn: float   # Σ all withdrawals (expressed as positive)

    # Breakdowns
    periods:         List[SubPeriod]
    events:          List[CapitalEvent]

    # Display metadata
    num_periods:     int
    inception_date:  str
    last_updated:    str