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
    banked_profit:      float = 0.0
    # True net realized P&L for display, wherever it differs from
    # banked_profit. banked_profit itself stays the gross-cash bookkeeping
    # figure Total P&L's formula needs internally (equity + banked_profit −
    # invested must reconcile against the frozen Capital Invested baseline —
    # see README §12.3/§9); for a CLOSED strategy that figure includes
    # returned principal, not just profit, so it's not fit to *display* as
    # "Banked Profit/Loss". banked_profit_true carries the real number
    # (identical to banked_profit for any strategy where the two don't
    # diverge, e.g. AXIA-TW's pure profit-skim withdrawals). None only if
    # not computed for that response path.
    banked_profit_true: Optional[float] = None
    capital_allocated:  float = 0.0
    pct_1d:             float
    pct_7d:             float
    pct_30d:            float
    # Fund-statement-backed strategies only (e.g. 12-FLAGS): the fund's own
    # latest USD net income / return %, straight from the NAV administrator
    # statement — NOT GBP-translated. Shown as a sub-line under total_pnl /
    # performance so a GBP FX-translation effect never reads as a
    # discrepancy against the fund's own quoted numbers. None for every
    # other strategy type.
    fund_usd_net_income: Optional[float] = None
    fund_usd_return_pct: Optional[float] = None


# ---------------------------------------------------------------------------
# Pod summary (used in Portfolio page pod overview strip)
# ---------------------------------------------------------------------------

class PodSummary(BaseModel):
    entity_id:  str
    name:       str
    pod_code:   Optional[str]
    pod_color:  Optional[str]
    status:     Optional[str] = "Active"
    kpis:       KpiData


# ---------------------------------------------------------------------------
# Strategy summary (used in Portfolio page strategy overview strip)
# ---------------------------------------------------------------------------

class StrategySummary(BaseModel):
    entity_id:         str
    name:              str
    strategy_code:     Optional[str]
    pod_code:          Optional[str]
    pod_color:         Optional[str]
    status:            Optional[str]   = "Active"
    watermark:         Optional[float] = None
    profit_share_pct:  Optional[float] = None
    # True once ANY real performance source is matched for this strategy
    # (live pfees feed, AXIA/fund/closed-Darwinex aggregator, or a
    # brokerage_account match). False means only a capital figure exists
    # (e.g. a Capital Transfers deposit) with nothing tracking performance
    # yet — the KPI card shows Capital Invested at par (pnl 0) if Active,
    # or zero everywhere if Inactive, instead of a fabricated 100% loss.
    # See README §14 (three-state status model).
    has_data:          Optional[bool]  = None
    kpis:              KpiData


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
# Trader context — 2-tab breakdown shown when drilling into a trader
# Returns pods (all pods this trader appears in) and strategies (all
# strategies this trader appears in), resolved by matching trader display
# name across all entity rows.
# ---------------------------------------------------------------------------

class TraderContextResponse(BaseModel):
    entity_id:   str
    entity_name: str
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
    strategies:       List[StrategySummary]
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
    reference:  Optional[str] = None    # statement reference, e.g. bank/broker txn ref


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