# backend/src/services/data_service.py
"""
Single source of truth for all data access.

Loads entities.csv, snapshots.csv and equity_curve.csv.
Key helpers:
  - _ensure_aggregates()      — computes missing strategy/pod/portfolio rows
                                so trader-only CSV uploads work end-to-end
  - trader_context()          — returns venues, pods and strategies for a
                                given trader, resolved by display name so
                                cross-pod traders show all their contexts
  - get_fund_ledger_summary() — TWR, bank balance, sub-period breakdown
                                for the BankCard + FundLedgerCard strip
"""

import os
import json
import numpy as np
import pandas as pd
from datetime import datetime, date
from functools import lru_cache, reduce
from typing import Optional

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_DEFAULT_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")


# ---------------------------------------------------------------------------
# Loaders (LRU cached — invalidate_cache() clears them after upload)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _load_entities(data_dir: str) -> pd.DataFrame:
    path = os.path.join(data_dir, "entities.csv")
    df   = pd.read_csv(path, dtype=str).fillna("")
    return df


@lru_cache(maxsize=1)
def _load_snapshots(data_dir: str) -> pd.DataFrame:
    path = os.path.join(data_dir, "snapshots.csv")
    df   = pd.read_csv(path)
    df   = _normalise_snapshots(df)
    df   = _ensure_aggregates(df, data_dir)
    return df


@lru_cache(maxsize=1)
def _load_equity_curve(data_dir: str) -> pd.DataFrame:
    path = os.path.join(data_dir, "equity_curve.csv")
    df   = pd.read_csv(path)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

def _normalise_snapshots(df: pd.DataFrame) -> pd.DataFrame:
    """Map source column names to canonical names and fill missing columns."""
    renames = {
        "invested_capital": "aum",
        "open_pnl":         "pnl_total",
        "performance_1d":   "pct_1d",
        "performance_7d":   "pct_7d",
        "performance_30d":  "pct_30d",
        "max_drawdown":     "drawdown",
    }
    for src, tgt in renames.items():
        if src in df.columns and tgt not in df.columns:
            df[tgt] = df[src]

    # Keep both canonical and legacy names in sync
    for tgt, src in {v: k for k, v in renames.items()}.items():
        if tgt in df.columns and src not in df.columns:
            df[src] = df[tgt]

    for col, default in [
        ("drawdown",       0.0),
        ("win_rate",       0.0),
        ("allocation_pct", np.nan),
        ("pct_1d",         0.0),
        ("pct_7d",         0.0),
        ("pct_30d",        0.0),
    ]:
        if col not in df.columns:
            df[col] = default

    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df


# ---------------------------------------------------------------------------
# Auto aggregate roll-up
# ---------------------------------------------------------------------------

def _ensure_aggregates(df: pd.DataFrame, data_dir: str) -> pd.DataFrame:
    """
    Walk the entity tree bottom-up and compute any missing aggregate rows
    (strategy / pod / portfolio level).

    Users only need to upload trader-level CSVs — all roll-ups are computed
    automatically on the fly.
    """
    try:
        entities = _load_entities(data_dir)
    except Exception:
        return df

    if df.empty:
        return df

    ts = df["timestamp"].max()

    # Build working dict keyed by entity_id (latest snapshot per entity)
    snap_dict = {
        row["entity_id"]: row.to_dict()
        for _, row in (
            df.sort_values("timestamp")
              .groupby("entity_id").last()
              .reset_index()
              .iterrows()
        )
    }

    def _f(row, *keys):
        """Safely read a float field from a snapshot dict."""
        for k in keys:
            v = row.get(k)
            if v is not None and not (isinstance(v, float) and np.isnan(v)):
                try:
                    return float(v)
                except (TypeError, ValueError):
                    pass
        return 0.0

    # Process strictly bottom-up: strategy → pod → portfolio
    for level in ["strategy", "pod", "portfolio"]:
        parents = entities[entities["entity_type"] == level]
        for _, parent in parents.iterrows():
            pid = parent["entity_id"]
            if pid in snap_dict:
                continue

            child_ids = entities[entities["parent_id"] == pid]["entity_id"].tolist()
            children  = [snap_dict[c] for c in child_ids if c in snap_dict]
            if not children:
                continue

            total_inv = sum(_f(c, "aum", "invested_capital") for c in children)
            total_eq  = sum(_f(c, "equity")                  for c in children)
            total_pnl = sum(_f(c, "pnl_total", "open_pnl")   for c in children)

            def wavg(field, *aliases):
                if total_inv == 0:
                    return 0.0
                return sum(
                    _f(c, field, *aliases) * _f(c, "aum", "invested_capital")
                    for c in children
                ) / total_inv

            snap_dict[pid] = dict(
                entity_id        = pid,
                timestamp        = ts,
                equity           = round(total_eq,              2),
                aum              = round(total_inv,              2),
                invested_capital = round(total_inv,              2),
                pnl_total        = round(total_pnl,              2),
                open_pnl         = round(total_pnl,              2),
                pct_1d           = round(wavg("pct_1d",  "performance_1d"),  6),
                pct_7d           = round(wavg("pct_7d",  "performance_7d"),  6),
                pct_30d          = round(wavg("pct_30d", "performance_30d"), 6),
                performance_1d   = round(wavg("pct_1d",  "performance_1d"),  6),
                performance_7d   = round(wavg("pct_7d",  "performance_7d"),  6),
                performance_30d  = round(wavg("pct_30d", "performance_30d"), 6),
                drawdown         = round(wavg("drawdown", "max_drawdown"),   4),
                win_rate         = round(wavg("win_rate"),                   4),
                allocation_pct   = None,
            )

    return pd.DataFrame(list(snap_dict.values()))


# ---------------------------------------------------------------------------
# Cache invalidation
# ---------------------------------------------------------------------------

def invalidate_cache() -> None:
    """Clear all LRU caches so next request re-reads CSVs from disk."""
    _load_entities.cache_clear()
    _load_snapshots.cache_clear()
    _load_equity_curve.cache_clear()


# ---------------------------------------------------------------------------
# Public accessors
# ---------------------------------------------------------------------------

def get_entities(data_dir: str = _DEFAULT_DATA_DIR) -> pd.DataFrame:
    return _load_entities(data_dir)


def get_snapshots(data_dir: str = _DEFAULT_DATA_DIR) -> pd.DataFrame:
    return _load_snapshots(data_dir)


def get_equity_curve(data_dir: str = _DEFAULT_DATA_DIR) -> pd.DataFrame:
    return _load_equity_curve(data_dir)


# ---------------------------------------------------------------------------
# Snapshot helpers
# ---------------------------------------------------------------------------

def latest_snapshot(entity_id: str,
                    data_dir: str = _DEFAULT_DATA_DIR) -> Optional[pd.Series]:
    """Return the most recent snapshot row for a given entity_id."""
    snaps = get_snapshots(data_dir)
    rows  = snaps[snaps["entity_id"] == entity_id]
    if rows.empty:
        return None
    return rows.sort_values("timestamp").iloc[-1]


def snapshot_kpis(snap: pd.Series) -> dict:
    """Extract the 7 KPI values from a snapshot row."""
    invested = float(snap.get("aum", snap.get("invested_capital", 0)))
    equity   = float(snap["equity"])
    pnl      = float(snap.get("pnl_total", snap.get("open_pnl", 0)))
    perf     = (equity / invested - 1) if invested > 0 else 0.0
    return dict(
        initial_investment = invested,
        current_equity     = equity,
        performance        = round(perf, 6),
        total_pnl          = round(pnl,  2),
        pct_1d             = round(float(snap.get("pct_1d",  0)), 6),
        pct_7d             = round(float(snap.get("pct_7d",  0)), 6),
        pct_30d            = round(float(snap.get("pct_30d", 0)), 6),
    )


# ---------------------------------------------------------------------------
# Tree helpers
# ---------------------------------------------------------------------------

def children_of(parent_id: str,
                entity_type: Optional[str] = None,
                data_dir: str = _DEFAULT_DATA_DIR) -> pd.DataFrame:
    ents = get_entities(data_dir)
    mask = ents["parent_id"] == parent_id
    if entity_type:
        mask &= ents["entity_type"] == entity_type
    return ents[mask]


def ancestor_chain(entity_id: str,
                   data_dir: str = _DEFAULT_DATA_DIR) -> list:
    """Return [{id, name, type, pod_code, pod_color}, ...] root → entity."""
    ents    = get_entities(data_dir).set_index("entity_id")
    chain   = []
    current = entity_id
    while current:
        if current not in ents.index:
            break
        row = ents.loc[current]
        chain.append(dict(
            id        = current,
            name      = row["name"],
            type      = row["entity_type"],
            pod_code  = row.get("pod_code",  ""),
            pod_color = row.get("pod_color", ""),
        ))
        current = row["parent_id"] if row["parent_id"] else None
    chain.reverse()
    return chain


def _find_ancestor_of_type(entity_id: str,
                            target_type: str,
                            ents_indexed: pd.DataFrame) -> Optional[str]:
    """Walk up the tree until finding an entity of target_type."""
    current = entity_id
    while current:
        if current not in ents_indexed.index:
            return None
        row = ents_indexed.loc[current]
        if row["entity_type"] == target_type:
            return current
        current = row["parent_id"] if row["parent_id"] else None
    return None


def _resolve_pod_info(entity_id: str,
                      data_dir: str = _DEFAULT_DATA_DIR) -> dict:
    ents = get_entities(data_dir)
    row  = ents[ents["entity_id"] == entity_id]
    if row.empty:
        return dict(pod_code="", strategy_code="", pod_color="")
    r = row.iloc[0]
    return dict(
        pod_code      = r.get("pod_code",      ""),
        strategy_code = r.get("strategy_code", ""),
        pod_color     = r.get("pod_color",     ""),
    )


# ---------------------------------------------------------------------------
# Equity curve helpers
# ---------------------------------------------------------------------------

def equity_series_for(entity_id: str,
                      days: Optional[int] = None,
                      data_dir: str = _DEFAULT_DATA_DIR) -> pd.DataFrame:
    curve = get_equity_curve(data_dir)
    df    = curve[curve["entity_id"] == entity_id].sort_values("timestamp")
    if days is not None:
        cutoff = df["timestamp"].max() - pd.Timedelta(days=days)
        df     = df[df["timestamp"] >= cutoff]
    return df


def sparkline_for(entity_id: str,
                  points: int = 20,
                  data_dir: str = _DEFAULT_DATA_DIR) -> list:
    """
    Return the last N equity values for mini sparklines in KPI cards.
    Normalised to start at 100 for consistent rendering.
    """
    df = equity_series_for(entity_id, data_dir=data_dir)
    if df.empty:
        return []
    series = df["equity"].tail(points).tolist()
    if not series:
        return []
    base = series[0] if series[0] != 0 else 1
    return [round(v / base * 100, 4) for v in series]


# ---------------------------------------------------------------------------
# Allocation + PnL helpers
# ---------------------------------------------------------------------------

def allocation_by_children(parent_id: str,
                            data_dir: str = _DEFAULT_DATA_DIR) -> list:
    children = children_of(parent_id, data_dir=data_dir)
    rows = []
    for _, child in children.iterrows():
        snap = latest_snapshot(child["entity_id"], data_dir)
        if snap is None:
            continue
        aum = float(snap.get("aum", snap.get("invested_capital", 0)))
        rows.append(dict(name=child["name"], aum=aum,
                         entity_id=child["entity_id"]))
    total = sum(r["aum"] for r in rows)
    for r in rows:
        r["pct"] = round(r["aum"] / total * 100, 2) if total > 0 else 0.0
    return rows


def pnl_by_children(parent_id: str,
                    data_dir: str = _DEFAULT_DATA_DIR) -> list:
    children = children_of(parent_id, data_dir=data_dir)
    rows = []
    for _, child in children.iterrows():
        snap = latest_snapshot(child["entity_id"], data_dir)
        if snap is None:
            continue
        pnl = float(snap.get("pnl_total", snap.get("open_pnl", 0)))
        rows.append(dict(name=child["name"], pnl=round(pnl, 2)))
    return sorted(rows, key=lambda x: x["pnl"], reverse=True)


# ---------------------------------------------------------------------------
# Breakdown table
# ---------------------------------------------------------------------------

def breakdown_table(parent_id: str,
                    data_dir: str = _DEFAULT_DATA_DIR) -> list:
    """
    Return breakdown rows for all immediate children of parent_id.
    Includes pod_code, strategy_code, pod_color for frontend dot/tag.
    Sorted A-Z by name.
    """
    parent_snap     = latest_snapshot(parent_id, data_dir)
    parent_invested = float(parent_snap.get(
        "aum", parent_snap.get("invested_capital", 1))
    ) if parent_snap is not None else 1

    children = children_of(parent_id, data_dir=data_dir)
    rows     = []

    for _, child in children.iterrows():
        snap = latest_snapshot(child["entity_id"], data_dir)
        if snap is None:
            continue

        aum       = float(snap.get("aum", snap.get("invested_capital", 0)))
        pnl       = float(snap.get("pnl_total", snap.get("open_pnl",   0)))
        alloc_pct = round(aum / parent_invested * 100, 2) if parent_invested > 0 else 0.0
        pod_info  = _resolve_pod_info(child["entity_id"], data_dir)

        rows.append(dict(
            entity_id     = child["entity_id"],
            name          = child["name"],
            entity_type   = child["entity_type"],
            allocation_pct= alloc_pct,
            aum           = round(aum, 2),
            pnl           = round(pnl, 2),
            pct_1d        = round(float(snap.get("pct_1d",   0)), 6),
            pct_7d        = round(float(snap.get("pct_7d",   0)), 6),
            pct_30d       = round(float(snap.get("pct_30d",  0)), 6),
            drawdown      = round(float(snap.get("drawdown", 0)), 4),
            win_rate      = round(float(snap.get("win_rate", 0)), 4),
            trading_style = child.get("trading_style", ""),
            status        = child.get("status",        ""),
            pod_code      = pod_info["pod_code"],
            strategy_code = pod_info["strategy_code"],
            pod_color     = pod_info["pod_color"],
        ))

    return sorted(rows, key=lambda x: x["name"].lower())


# ---------------------------------------------------------------------------
# Trader context — 3-tab breakdown (Venues | Pods | Strategies)
# ---------------------------------------------------------------------------

def trader_context(entity_id: str,
                   data_dir: str = _DEFAULT_DATA_DIR) -> dict:
    """
    For a trader entity, return three breakdown lists:
      - venues:     direct children of this trader (execution venues)
      - pods:       all pods this trader (by display name) appears in,
                    AUM/PnL from each specific entity_id slice
      - strategies: all strategies this trader appears in, same logic

    Cross-pod traders (e.g. CFZ in SYSDWX and ALPHA) show two rows
    in pods and strategies — one per allocation slice.
    """
    entities = get_entities(data_dir)
    ents_idx = entities.set_index("entity_id")

    trader_row = entities[entities["entity_id"] == entity_id]
    if trader_row.empty:
        return {"venues": [], "pods": [], "strategies": []}

    trader_name = trader_row.iloc[0]["name"]

    # ── Venues: direct children of this trader ──
    venues = breakdown_table(entity_id, data_dir)

    # ── Find all trader instances sharing this display name ──
    all_instances = entities[
        (entities["name"] == trader_name) &
        (entities["entity_type"] == "trader")
    ]

    def _snap_row(inst_id: str) -> Optional[dict]:
        snap = latest_snapshot(inst_id, data_dir)
        if snap is None:
            return None
        aum = float(snap.get("aum", snap.get("invested_capital", 0)))
        pnl = float(snap.get("pnl_total", snap.get("open_pnl", 0)))
        return dict(
            aum     = round(aum, 2),
            pnl     = round(pnl, 2),
            pct_1d  = round(float(snap.get("pct_1d",   0)), 6),
            pct_7d  = round(float(snap.get("pct_7d",   0)), 6),
            pct_30d = round(float(snap.get("pct_30d",  0)), 6),
            drawdown= round(float(snap.get("drawdown", 0)), 4),
            win_rate= round(float(snap.get("win_rate", 0)), 4),
        )

    # ── Pods ──
    # Deduplicate by pod_id — if a trader has multiple instances in the
    # same pod (e.g. DXBV in both SWG and OPT within ALPHA), aggregate
    # their AUM and PnL rather than showing duplicate pod rows.
    pod_agg = {}  # pod_id → aggregated data dict

    for _, inst in all_instances.iterrows():
        inst_id = inst["entity_id"]
        pod_id  = _find_ancestor_of_type(inst_id, "pod", ents_idx)
        if not pod_id:
            continue

        snap_data = _snap_row(inst_id)
        if snap_data is None:
            continue

        if pod_id not in pod_agg:
            pod_ent = entities[entities["entity_id"] == pod_id]
            if pod_ent.empty:
                continue
            pod      = pod_ent.iloc[0]
            pod_snap = latest_snapshot(pod_id, data_dir)
            pod_inv  = float(pod_snap.get("aum", pod_snap.get("invested_capital", 1))) \
                       if pod_snap is not None else 1
            pod_agg[pod_id] = dict(
                entity_id     = pod_id,
                name          = pod["name"],
                entity_type   = "pod",
                trading_style = "",
                status        = pod.get("status", "Active"),
                pod_code      = pod.get("pod_code",  ""),
                strategy_code = "",   # pods span multiple strategies
                pod_color     = pod.get("pod_color", ""),
                _pod_inv      = pod_inv,
                aum           = 0.0,
                pnl           = 0.0,
                pct_1d        = 0.0,
                pct_7d        = 0.0,
                pct_30d       = 0.0,
                drawdown      = snap_data["drawdown"],
                win_rate      = snap_data["win_rate"],
                _weight       = 0.0,
            )

        agg      = pod_agg[pod_id]
        agg["aum"] = round(agg["aum"] + snap_data["aum"], 2)
        agg["pnl"] = round(agg["pnl"] + snap_data["pnl"], 2)
        agg["_weight"] += snap_data["aum"]
        w = snap_data["aum"]
        for field in ("pct_1d", "pct_7d", "pct_30d"):
            agg[field] = round(
                (agg[field] * (agg["_weight"] - w) + snap_data[field] * w)
                / agg["_weight"] if agg["_weight"] > 0 else 0.0,
                6
            )

    pods = []
    for pod_id, agg in pod_agg.items():
        pod_inv = agg.pop("_pod_inv", 1)
        agg.pop("_weight", None)
        agg["allocation_pct"] = round(agg["aum"] / pod_inv * 100, 2) if pod_inv > 0 else 0.0
        pods.append(agg)

    # ── Strategies ──
    strategies           = []
    seen_strat_instances = set()

    for _, inst in all_instances.iterrows():
        inst_id  = inst["entity_id"]
        strat_id = inst["parent_id"]

        if not strat_id or inst_id in seen_strat_instances:
            continue
        seen_strat_instances.add(inst_id)

        strat_ent = entities[entities["entity_id"] == strat_id]
        if strat_ent.empty:
            continue
        strat = strat_ent.iloc[0]

        snap_data = _snap_row(inst_id)
        if snap_data is None:
            continue

        strat_snap = latest_snapshot(strat_id, data_dir)
        strat_inv  = float(strat_snap.get("aum", strat_snap.get("invested_capital", 1))) \
                     if strat_snap is not None else 1
        alloc_pct  = round(snap_data["aum"] / strat_inv * 100, 2) if strat_inv > 0 else 0.0

        strategies.append(dict(
            entity_id      = strat_id,
            name           = strat["name"],
            entity_type    = "strategy",
            allocation_pct = alloc_pct,
            trading_style  = strat.get("trading_style", ""),
            status         = strat.get("status", "Active"),
            pod_code       = strat.get("pod_code",      ""),
            strategy_code  = strat.get("strategy_code", ""),
            pod_color      = strat.get("pod_color",     ""),
            **snap_data,
        ))

    return dict(
        venues     = sorted(venues,     key=lambda x: x["name"].lower()),
        pods       = sorted(pods,       key=lambda x: x["name"].lower()),
        strategies = sorted(strategies, key=lambda x: x["name"].lower()),
    )


# ===========================================================================
# Fund Ledger — Capital Events, TWR, Bank Balance
# ===========================================================================

def _load_capital_events(data_dir: str) -> list:
    """
    Load raw capital events from capital_events.json.
    Returns list of dicts sorted by date ascending.
    External types: deposit, withdrawal
    Internal types: pod_allocation, pod_redemption
    """
    path = os.path.join(data_dir, "capital_events.json")
    if not os.path.exists(path):
        return []
    with open(path) as fh:
        raw = json.load(fh)
    return sorted(raw, key=lambda e: e["date"])


def _load_sub_periods(data_dir: str) -> list:
    """
    Load sub-period definitions from sub_periods.json.
    Sub-periods are bounded by external cash flows only (deposits/withdrawals).
    Pod allocations are internal and do NOT create new periods.
    """
    path = os.path.join(data_dir, "sub_periods.json")
    if not os.path.exists(path):
        return []
    with open(path) as fh:
        raw = json.load(fh)
    return sorted(raw, key=lambda p: p["period_num"])


def _compute_twr(periods: list) -> float:
    """
    Compute portfolio-level Time-Weighted Return from sub-periods.

    Formula: TWR = Π(1 + Rᵢ) − 1  for all sub-periods i

    Each Rᵢ = pnl_i / start_aum_i  (pure manager performance).
    This eliminates the distortion from timing of external capital flows.
    Example: P1=5.00%, P2=4.878%, P3=1.538%
             TWR = (1.05 × 1.04878 × 1.01538) − 1 ≈ 12.35%
    """
    if not periods:
        return 0.0
    product = reduce(
        lambda acc, p: acc * (1.0 + float(p["period_return"])),
        periods,
        1.0
    )
    return round(product - 1.0, 6)


def _compute_bank_balance(events: list) -> dict:
    """
    Compute net bank balance from external capital events only.

    Bank = Σ(deposits) − Σ(|withdrawals|)
    Pod allocations and pod_redemptions are internal — excluded.

    Returns:
        bank_balance    : net external flow (positive = net capital in)
        total_deposited : sum of all deposit amounts
        total_withdrawn : sum of all withdrawal amounts (positive number)
    """
    deposits    = sum(float(e["amount"]) for e in events
                      if e["event_type"] == "deposit")
    withdrawals = sum(abs(float(e["amount"])) for e in events
                      if e["event_type"] == "withdrawal")
    return {
        "bank_balance":    round(deposits - withdrawals, 2),
        "total_deposited": round(deposits,               2),
        "total_withdrawn": round(withdrawals,            2),
    }


def get_fund_ledger_summary(data_dir: str = _DEFAULT_DATA_DIR) -> dict:
    """
    Assemble complete fund ledger summary dict for the dashboard.

    Combines:
      - Capital events ledger (all deposits, withdrawals, allocations)
      - Sub-period definitions (TWR period boundaries)
      - Time-Weighted Return computation
      - Bank balance computation (net external flows)

    Used by GET /api/portfolio/fund_ledger → returns FundLedgerSummary.
    """
    events  = _load_capital_events(data_dir)
    periods = _load_sub_periods(data_dir)

    twr        = _compute_twr(periods)
    total_pnl  = round(sum(float(p["pnl"]) for p in periods), 2)
    initial_aum = float(periods[0]["start_aum"]) if periods else 0.0
    current_aum = float(periods[-1]["end_aum"])  if periods else 0.0
    bank       = _compute_bank_balance(events)

    return dict(
        twr              = twr,
        total_pnl        = total_pnl,
        initial_aum      = initial_aum,
        current_aum      = current_aum,
        bank_balance     = bank["bank_balance"],
        total_deposited  = bank["total_deposited"],
        total_withdrawn  = bank["total_withdrawn"],
        periods          = periods,
        events           = events,
        num_periods      = len(periods),
        inception_date   = periods[0]["start_date"] if periods else "",
        last_updated     = date.today().isoformat(),
    )