# backend/src/routers/management.py
"""
/api/management  —  CRUD for capital events, pods and strategies.

Endpoints:
  GET  /api/management/capital-events            List all capital events
  POST /api/management/capital-events            Record deposit or withdrawal
  DELETE /api/management/capital-events/{id}     Delete a capital event

  GET  /api/management/pods                      List all pods
  POST /api/management/pods                      Create pod
  PATCH /api/management/pods/{id}                Update pod
  DELETE /api/management/pods/{id}               Delete pod

  GET  /api/management/strategies                List strategies (optional ?pod_id=)
  POST /api/management/strategies                Create strategy
  PATCH /api/management/strategies/{id}          Update strategy
  DELETE /api/management/strategies/{id}         Delete strategy

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
    pod_id:             Optional[int] = None
    initial_investment: float = Field(default=0.0, ge=0)
    date_created:       str   = Field(default_factory=lambda: str(date.today()))
    status:             str   = Field(default="Active")
    notes:              Optional[str] = None


class StrategyPatch(BaseModel):
    name:               Optional[str]   = None
    strategy_code:      Optional[str]   = None
    pod_id:             Optional[int]   = None
    initial_investment: Optional[float] = None
    date_created:       Optional[str]   = None
    status:             Optional[str]   = None
    notes:              Optional[str]   = None
    account_id:         Optional[int]   = None


# ---------------------------------------------------------------------------
# Fund metrics (live from Supabase)
# ---------------------------------------------------------------------------

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
