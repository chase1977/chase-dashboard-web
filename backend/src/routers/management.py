# backend/src/routers/management.py
"""
/api/management  —  CRUD for capital events, pods, strategies, internal transfers, misc events.

Endpoints:
  GET  /api/management/capital-events            List all capital events
  POST /api/management/capital-events            Record deposit or withdrawal
  PATCH /api/management/capital-events/{id}      Update capital event
  DELETE /api/management/capital-events/{id}     Delete a capital event

  GET  /api/management/pods                      List all pods
  POST /api/management/pods                      Create pod
  PATCH /api/management/pods/{id}                Update pod
  DELETE /api/management/pods/{id}               Delete pod

  GET  /api/management/strategies                List strategies (optional ?pod_id=)
  POST /api/management/strategies                Create strategy
  PATCH /api/management/strategies/{id}          Update strategy
  DELETE /api/management/strategies/{id}         Delete strategy

  GET  /api/management/internal-transfers        List all internal transfers
  POST /api/management/internal-transfers        Create internal transfer
  PATCH /api/management/internal-transfers/{id}  Update internal transfer
  DELETE /api/management/internal-transfers/{id} Delete internal transfer

  GET  /api/management/misc-events               List all misc events
  POST /api/management/misc-events               Create misc event
  PATCH /api/management/misc-events/{id}         Update misc event
  DELETE /api/management/misc-events/{id}        Delete misc event

  GET  /api/management/fund-metrics              Live AUM, PnL, TWR from Supabase
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from datetime import date

from src.services import supabase_service as sb

router = APIRouter(prefix="/api/management", tags=["management"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class CapitalEventIn(BaseModel):
    event_date:  str   = Field(..., description="ISO date YYYY-MM-DD")
    event_type:  str   = Field(..., pattern="^(deposit|withdrawal)$")
    amount:      float = Field(..., gt=0, description="Always positive")
    notes:       Optional[str] = None


class CapitalEventPatch(BaseModel):
    event_date:  Optional[str]   = None
    event_type:  Optional[str]   = Field(None, pattern="^(deposit|withdrawal)$")
    amount:      Optional[float] = Field(None, gt=0)
    notes:       Optional[str]   = None


class PodIn(BaseModel):
    name:         str
    pod_code:     str = Field(..., min_length=1, max_length=8)
    color:        str = Field(default="#0EA5E9")
    date_created: str = Field(default_factory=lambda: str(date.today()))
    status:       str = Field(default="Active")
    notes:        Optional[str] = None


class PodPatch(BaseModel):
    name:         Optional[str]  = None
    pod_code:     Optional[str]  = None
    color:        Optional[str]  = None
    date_created: Optional[str]  = None
    status:       Optional[str]  = None
    notes:        Optional[str]  = None


class StrategyIn(BaseModel):
    name:               str
    strategy_code:      str   = Field(..., min_length=1, max_length=12)
    pod_id:             Optional[int]  = None
    initial_investment: float          = Field(default=0.0, ge=0)
    date_created:       str            = Field(default_factory=lambda: str(date.today()))
    status:             str            = Field(default="Active")
    notes:              Optional[str]  = None
    brokerage_account:  Optional[str]  = None  # e.g. "Chase1", "Chase3xA", "XPF2026"


class StrategyPatch(BaseModel):
    name:               Optional[str]   = None
    strategy_code:      Optional[str]   = None
    pod_id:             Optional[int]   = None
    initial_investment: Optional[float] = None
    date_created:       Optional[str]   = None
    status:             Optional[str]   = None
    notes:              Optional[str]   = None
    account_id:         Optional[int]   = None
    brokerage_account:  Optional[str]   = None  # e.g. "Chase1", "Chase3xA", "XPF2026"


# ---------------------------------------------------------------------------
# Fund metrics (live from Supabase)
# ---------------------------------------------------------------------------

@router.get("/diagnostics")
def get_diagnostics():
    """
    GET /api/management/diagnostics

    Returns full mapping state so you can see exactly how pfees data flows
    into strategies and pods. Use this to identify unmatched AccountIds,
    missing strategy configs, or broken pod wiring.

    Response:
      pfees_snapshot     — latest pfees rows (AccountId, Darwin, Invested, PnL)
      account_ids        — accounts from user_accounts_equity (latest date)
      strategies         — all configured strategies
      pods               — all configured pods
      broker_map         — AccountId → brokerage_account computed by ratio matching
      acct_to_pod        — AccountId → pod_id resolved from strategies (all 3 levels)
      unmatched_accts    — AccountIds in pfees not mapped to any pod
      pod_agg_preview    — preview of how pfees data aggregates per pod
    """
    try:
        snapshot   = sb.get_pfees_latest_snapshot()
        strategies = sb.list_strategies()
        pods       = sb.list_pods()
        acct_ids   = sb.get_account_ids()
        broker_map = sb.get_net_deployed()        # brokerage → net deployed £
        acct_broker = {}
        try:
            acct_broker = sb._match_pfees_accounts_to_brokerage()   # { acct_int: broker_name }
        except Exception:
            pass

        # Build resolved acct→pod from all 3 levels
        account_to_pod: dict = {}
        broker_to_pod:  dict = {}
        darwin_to_pod:  dict = {}
        for s in strategies:
            pid = s.get("pod_id")
            if pid is None:
                continue
            aid = s.get("account_id")
            if aid is not None:
                account_to_pod[int(aid)] = pid
            broker = s.get("brokerage_account")
            if broker:
                broker_to_pod[broker] = pid
            code = (s.get("strategy_code") or "").upper()
            if code:
                darwin_to_pod[code] = pid

        # Resolve each pfees AccountId
        resolved: list = []
        unmatched: list = []
        seen_accts: set = set()
        darwin_to_pod_resolved: dict = {}

        def _d(raw): return raw.split(".")[0].upper() if raw else "—"

        for row in snapshot:
            acct   = int(row.get("AccountId") or 0)
            darwin = _d(row.get("Darwin") or "")
            broker = acct_broker.get(acct)
            level  = None
            pod_id = None

            if acct in account_to_pod:
                pod_id, level = account_to_pod[acct], "account_id"
            elif broker and broker in broker_to_pod:
                pod_id, level = broker_to_pod[broker], "brokerage_account"
            elif darwin in darwin_to_pod:
                pod_id, level = darwin_to_pod[darwin], "strategy_code"
            else:
                unmatched.append({"account_id": acct, "darwin": darwin, "broker": broker})

            if acct not in seen_accts:
                seen_accts.add(acct)
                resolved.append({
                    "account_id":        acct,
                    "broker":            broker,
                    "pod_id":            pod_id,
                    "mapped_via":        level,
                    "example_darwin":    darwin,
                })

        # Pod aggregate preview
        pod_preview: dict = {}
        for row in snapshot:
            acct   = int(row.get("AccountId") or 0)
            darwin = _d(row.get("Darwin") or "")
            inv    = float(row.get("Invested") or 0)
            pnl    = float(row.get("Current PnL") or 0)
            broker = acct_broker.get(acct)
            if acct in account_to_pod:
                pid = account_to_pod[acct]
            elif broker and broker in broker_to_pod:
                pid = broker_to_pod[broker]
            elif darwin in darwin_to_pod:
                pid = darwin_to_pod[darwin]
            else:
                pid = -1
            pod_preview[pid] = {
                "invested": round(pod_preview.get(pid, {}).get("invested", 0) + inv, 2),
                "pnl":      round(pod_preview.get(pid, {}).get("pnl", 0) + pnl, 2),
            }

        pods_idx = {p["id"]: p["name"] for p in pods}
        pod_preview_named = [
            {"pod_id": pid, "pod_name": pods_idx.get(pid, "Unallocated" if pid == -1 else f"Pod {pid}"),
             **v}
            for pid, v in pod_preview.items()
        ]

        # TWR debug — show exactly what periods are computed and why
        twr_debug = {}
        try:
            darwinex_flows = sb._get_darwinex_cashflows()
            equity_by_date = sb._portfolio_equity_by_date()
            sorted_hist    = sorted(equity_by_date.keys())
            metrics        = sb.compute_fund_metrics()
            twr_debug = {
                "twr":               metrics["twr"],
                "num_periods":       metrics["num_periods"],
                "darwinex_flows":    darwinex_flows,
                "equity_first_3":    [{d: equity_by_date[d]} for d in sorted_hist[:3]],
                "equity_last_3":     [{d: equity_by_date[d]} for d in sorted_hist[-3:]],
                "equity_date_count": len(equity_by_date),
                "periods":           metrics["periods"],
                "live_aum_pfees":    sb.get_live_aum(),
                "live_pnl_pfees":    sb.get_live_pnl(),
                "total_deposited":   metrics["total_deposited"],
            }
        except Exception as twr_err:
            twr_debug = {"error": str(twr_err)}

        return {
            "pfees_snapshot":     snapshot,
            "account_ids":        acct_ids,
            "strategies":         strategies,
            "pods":               pods,
            "broker_map":         broker_map,
            "acct_broker_map":    {str(k): v for k, v in acct_broker.items()},
            "acct_to_pod_resolved": resolved,
            "unmatched_accts":    list({u["account_id"]: u for u in unmatched}.values()),
            "pod_agg_preview":    pod_preview_named,
            "twr_debug":          twr_debug,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/fund-metrics")
def get_fund_metrics():
    """
    GET /api/management/fund-metrics
    Returns AUM, PnL, TWR, sub-periods, bank balance — all computed from
    live Supabase data (user_pfees_estimation + balance_history + capital_events).
    """
    try:
        return sb.compute_fund_metrics()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Capital events
# ---------------------------------------------------------------------------

@router.get("/capital-events")
def list_capital_events():
    try:
        return sb.get_capital_events()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/capital-events", status_code=201)
def record_capital_event(body: CapitalEventIn):
    try:
        return sb.create_capital_event(
            event_date = body.event_date,
            event_type = body.event_type,
            amount     = body.amount,
            notes      = body.notes or "",
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/capital-events/{event_id}")
def edit_capital_event(event_id: int, body: CapitalEventPatch):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        return sb.update_capital_event(event_id, **fields)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/capital-events/{event_id}", status_code=204)
def remove_capital_event(event_id: int):
    try:
        sb.delete_capital_event(event_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Net deployed per brokerage account (computed from internal_transfers)
# ---------------------------------------------------------------------------

@router.get("/net-deployed")
def get_net_deployed():
    """
    GET /api/management/net-deployed
    Returns net capital deployed per brokerage account from internal_transfers.
    { "Chase1": 899950.0, "Chase3xA": 100000.0, "XPF2026": 50.0 }
    Used by PodStrategyManager to show computed initial investment per strategy.
    """
    try:
        return sb.get_net_deployed()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Account IDs (from user_accounts_equity — live, auto-updated)
# ---------------------------------------------------------------------------

@router.get("/account-ids")
def list_account_ids():
    """
    GET /api/management/account-ids
    Returns distinct AccountIds from user_accounts_equity (latest snapshot).
    Used to populate strategy Account ID dropdown.
    """
    try:
        return sb.get_account_ids()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Pods
# ---------------------------------------------------------------------------

@router.get("/pods")
def list_pods():
    try:
        return sb.list_pods()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/pods", status_code=201)
def create_pod(body: PodIn):
    try:
        return sb.create_pod(
            name         = body.name,
            pod_code     = body.pod_code,
            color        = body.color,
            date_created = body.date_created,
            status       = body.status,
            notes        = body.notes or "",
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/pods/{pod_id}")
def update_pod(pod_id: int, body: PodPatch):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if "pod_code" in fields:
        fields["pod_code"] = fields["pod_code"].upper()
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        return sb.update_pod(pod_id, **fields)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/pods/{pod_id}", status_code=204)
def delete_pod(pod_id: int):
    try:
        sb.delete_pod(pod_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

@router.get("/strategies")
def list_strategies(pod_id: Optional[int] = None):
    try:
        return sb.list_strategies(pod_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/strategies", status_code=201)
def create_strategy(body: StrategyIn):
    try:
        return sb.create_strategy(
            name               = body.name,
            strategy_code      = body.strategy_code,
            pod_id             = body.pod_id,
            initial_investment = body.initial_investment,
            date_created       = body.date_created,
            status             = body.status,
            notes              = body.notes or "",
            brokerage_account  = body.brokerage_account,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/strategies/{strategy_id}")
def update_strategy(strategy_id: int, body: StrategyPatch):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if "strategy_code" in fields:
        fields["strategy_code"] = fields["strategy_code"].upper()
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        return sb.update_strategy(strategy_id, **fields)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/strategies/{strategy_id}", status_code=204)
def delete_strategy(strategy_id: int):
    try:
        sb.delete_strategy(strategy_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Internal Transfers
# ---------------------------------------------------------------------------

_ACCOUNTS = {"Wallet", "Chase1", "Chase3xA", "XPF2026"}


class InternalTransferIn(BaseModel):
    transfer_date: str   = Field(..., description="ISO date YYYY-MM-DD")
    from_account:  str   = Field(..., description="Wallet | Chase1 | Chase3xA | XPF2026")
    to_account:    str   = Field(..., description="Wallet | Chase1 | Chase3xA | XPF2026")
    amount:        float = Field(..., gt=0, description="Always positive")
    notes:         Optional[str] = None


class InternalTransferPatch(BaseModel):
    transfer_date: Optional[str]   = None
    from_account:  Optional[str]   = None
    to_account:    Optional[str]   = None
    amount:        Optional[float] = Field(None, gt=0)
    notes:         Optional[str]   = None


@router.get("/internal-transfers")
def list_internal_transfers():
    try:
        return sb.list_internal_transfers()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/internal-transfers", status_code=201)
def create_internal_transfer(body: InternalTransferIn):
    try:
        return sb.create_internal_transfer(
            transfer_date = body.transfer_date,
            from_account  = body.from_account,
            to_account    = body.to_account,
            amount        = body.amount,
            notes         = body.notes or "",
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/internal-transfers/{transfer_id}")
def update_internal_transfer(transfer_id: int, body: InternalTransferPatch):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        return sb.update_internal_transfer(transfer_id, **fields)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/internal-transfers/{transfer_id}", status_code=204)
def delete_internal_transfer(transfer_id: int):
    try:
        sb.delete_internal_transfer(transfer_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Miscellaneous Events
# ---------------------------------------------------------------------------

class MiscEventIn(BaseModel):
    event_date: str   = Field(..., description="ISO date YYYY-MM-DD")
    event_type: str   = Field(..., description="Rebate | Service Cost | Fee | Other")
    direction:  str   = Field(..., pattern="^(credit|debit)$")
    amount:     float = Field(..., gt=0, description="Always positive")
    notes:      Optional[str] = None


class MiscEventPatch(BaseModel):
    event_date: Optional[str]   = None
    event_type: Optional[str]   = None
    direction:  Optional[str]   = Field(None, pattern="^(credit|debit)$")
    amount:     Optional[float] = Field(None, gt=0)
    notes:      Optional[str]   = None


@router.get("/misc-events")
def list_misc_events():
    try:
        return sb.list_misc_events()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/misc-events", status_code=201)
def create_misc_event(body: MiscEventIn):
    try:
        return sb.create_misc_event(
            event_date = body.event_date,
            event_type = body.event_type,
            direction  = body.direction,
            amount     = body.amount,
            notes      = body.notes or "",
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/misc-events/{misc_id}")
def update_misc_event(misc_id: int, body: MiscEventPatch):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        return sb.update_misc_event(misc_id, **fields)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/misc-events/{misc_id}", status_code=204)
def delete_misc_event(misc_id: int):
    try:
        sb.delete_misc_event(misc_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
