# backend/src/services/demo_service.py
"""
Rich demo dataset for Chase Multi-Strategy Portfolio.

Highlights:
  - 3 pods: ALPHA, SYSDWX, GLOBAL
  - Cross-pod traders keep their original short name (CFZ, EJL, DXBV)
    and appear twice — once per pod they are allocated to
  - Mixed positive and negative returns across all levels
  - Full 85-day equity curves for every entity
  - 6 strategies across the 3 pods
  - Capital events ledger + sub-periods for TWR / bank balance cards

Bump DEMO_VERSION to force full regeneration on next startup.
"""

import os
import json
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEMO_VERSION = "8"          # bumped — capital events + sub-periods added
VERSION_FILE = "demo_version.txt"

CURVE_START = datetime(2026, 1, 1)
CURVE_DAYS  = 85
RNG_SEED    = 77

# ---------------------------------------------------------------------------
# Pod colour map — single source of truth
# ---------------------------------------------------------------------------

POD_COLORS = {
    "pod_1": "#0EA5E9",   # ALPHA  — blue
    "pod_2": "#F59E0B",   # SYSDWX — amber
    "pod_3": "#34D399",   # GLOBAL — green
}

# ---------------------------------------------------------------------------
# Trader definitions
#
# (entity_id, display_name, parent_strategy_id,
#  invested, open_pnl, pct_1d, pct_7d, pct_30d,
#  drawdown, win_rate, alloc_pct,
#  pod_id, pod_code, strategy_code)
#
# Cross-pod traders use the SAME display_name (e.g. "CFZ") but different
# entity_ids (trader_cfz and trader_cfz_a) so they appear as separate rows
# in each pod/strategy context while sharing the same name everywhere.
# ---------------------------------------------------------------------------

TRADER_DEFS = [

    # ── Pod 1 ALPHA — Day Trading (DAY) ──
    ("trader_4751r",  "4751R",  "strat_p1_day",
     280000,   8200,  0.0031,  0.0124,  0.0293,  -0.022, 0.68, None,
     "pod_1", "ALPHA", "DAY"),

    ("trader_mnkr",   "MNKR",   "strat_p1_day",
     220000,   4100,  0.0018,  0.0080,  0.0186,  -0.031, 0.61, None,
     "pod_1", "ALPHA", "DAY"),

    # Negative trader — shows red in Day Trading
    ("trader_vxbt",   "VXBT",   "strat_p1_day",
     180000,  -3200, -0.0042, -0.0160, -0.0178,  -0.071, 0.44, None,
     "pod_1", "ALPHA", "DAY"),

    # ── Pod 1 ALPHA — Swing Trading (SWG) ──
    ("trader_dxbv",   "DXBV",   "strat_p1_swing",
     250000,   6800,  0.0027,  0.0108,  0.0272,  -0.018, 0.64, None,
     "pod_1", "ALPHA", "SWG"),

    # Negative swing trader
    ("trader_rkmt",   "RKMT",   "strat_p1_swing",
     120000,  -1800, -0.0015, -0.0060, -0.0150,  -0.054, 0.48, None,
     "pod_1", "ALPHA", "SWG"),

    # ── Pod 1 ALPHA — Options Overlay (OPT) ──
    ("trader_opx1",   "OPX1",   "strat_p1_opts",
     100000,   4400,  0.0044,  0.0176,  0.0440,  -0.038, 0.72, None,
     "pod_1", "ALPHA", "OPT"),

    ("trader_opx2",   "OPX2",   "strat_p1_opts",
      80000,   -900, -0.0011, -0.0044, -0.0113,  -0.029, 0.51, None,
     "pod_1", "ALPHA", "OPT"),

    # Cross-pod: CFZ also runs a slice under ALPHA Options Overlay
    # Same display name "CFZ" — appears in both SYSDWX and ALPHA contexts
    ("trader_cfz_a",  "CFZ",    "strat_p1_opts",
      50000,   1840,  0.0368,  0.0147,  0.0368,  -0.028, 0.67, None,
     "pod_1", "ALPHA", "OPT"),

    # Cross-strategy within ALPHA: DXBV also contributes to Options Overlay
    # Same name "DXBV" — appears in both SWG and OPT strategies
    ("trader_dxbv_o", "DXBV",   "strat_p1_opts",
      60000,    900,  0.0150,  0.0060,  0.0150,  -0.019, 0.60, None,
     "pod_1", "ALPHA", "OPT"),

    # ── Pod 2 SYSDWX — Darwinex Systematic (SYSDWX-01) ──
    ("trader_sug",    "SUG",    "strat_p2_sys",
      90000,    291,  0.0032,  0.0064,  0.0032,  -0.042, 0.58, 0.10,
     "pod_2", "SYSDWX", "SYSDWX-01"),

    ("trader_qbg",    "QBG",    "strat_p2_sys",
      90000,   1120,  0.0124,  0.0248,  0.0124,  -0.038, 0.62, 0.10,
     "pod_2", "SYSDWX", "SYSDWX-01"),

    ("trader_lsp",    "LSP",    "strat_p2_sys",
      81000,  -1049, -0.0129, -0.0258, -0.0129,  -0.098, 0.44, 0.09,
     "pod_2", "SYSDWX", "SYSDWX-01"),

    ("trader_qov",    "QOV",    "strat_p2_sys",
      81000,   -770, -0.0095, -0.0190, -0.0095,  -0.071, 0.49, 0.09,
     "pod_2", "SYSDWX", "SYSDWX-01"),

    ("trader_qabk",   "QABK",   "strat_p2_sys",
      81000,    344,  0.0042,  0.0084,  0.0042,  -0.028, 0.55, 0.09,
     "pod_2", "SYSDWX", "SYSDWX-01"),

    ("trader_cfz",    "CFZ",    "strat_p2_sys",
      72000,   2216,  0.0308,  0.0616,  0.0308,  -0.045, 0.66, 0.08,
     "pod_2", "SYSDWX", "SYSDWX-01"),

    ("trader_xaqp",   "XAQP",   "strat_p2_sys",
      72000,    252,  0.0035,  0.0070,  0.0035,  -0.031, 0.57, 0.08,
     "pod_2", "SYSDWX", "SYSDWX-01"),

    ("trader_fim",    "FIM",    "strat_p2_sys",
      63000,    -43, -0.0007, -0.0014, -0.0007,  -0.062, 0.51, 0.07,
     "pod_2", "SYSDWX", "SYSDWX-01"),

    ("trader_doq",    "DOQ",    "strat_p2_sys",
      63000,    197,  0.0031,  0.0062,  0.0031,  -0.039, 0.53, 0.07,
     "pod_2", "SYSDWX", "SYSDWX-01"),

    ("trader_dfbh",   "DFBH",   "strat_p2_sys",
      63000,    507,  0.0080,  0.0160,  0.0080,  -0.044, 0.60, 0.07,
     "pod_2", "SYSDWX", "SYSDWX-01"),

    ("trader_mqoh",   "MQOH",   "strat_p2_sys",
      54000,    428,  0.0079,  0.0158,  0.0079,  -0.055, 0.56, 0.06,
     "pod_2", "SYSDWX", "SYSDWX-01"),

    ("trader_ejl",    "EJL",    "strat_p2_sys",
      45000,    880,  0.0196,  0.0392,  0.0196,  -0.037, 0.63, 0.05,
     "pod_2", "SYSDWX", "SYSDWX-01"),

    ("trader_vajj",   "VAJJ",   "strat_p2_sys",
      27000,    569,  0.0211,  0.0422,  0.0211,  -0.029, 0.61, 0.03,
     "pod_2", "SYSDWX", "SYSDWX-01"),

    ("trader_imtz",   "IMTZ",   "strat_p2_sys",
      17975,   -276, -0.0154, -0.0308, -0.0154,  -0.088, 0.47, 0.02,
     "pod_2", "SYSDWX", "SYSDWX-01"),

    # ── Pod 3 GLOBAL — Global Macro (MACRO) ──
    ("trader_gm01",   "GM01",   "strat_p3_macro",
     350000,  18200,  0.0052,  0.0208,  0.0520,  -0.031, 0.71, None,
     "pod_3", "GLOBAL", "MACRO"),

    # Deeply negative — shows strong red
    ("trader_gm02",   "GM02",   "strat_p3_macro",
     280000,  -9800, -0.0035, -0.0140, -0.0350,  -0.112, 0.42, None,
     "pod_3", "GLOBAL", "MACRO"),

    ("trader_gm03",   "GM03",   "strat_p3_macro",
     200000,  11400,  0.0057,  0.0228,  0.0570,  -0.024, 0.68, None,
     "pod_3", "GLOBAL", "MACRO"),

    # Cross-pod: EJL also running under GLOBAL Macro — same name "EJL"
    ("trader_ejl_g",  "EJL",    "strat_p3_macro",
      40000,   1120,  0.0280,  0.0112,  0.0280,  -0.022, 0.65, None,
     "pod_3", "GLOBAL", "MACRO"),

    # ── Pod 3 GLOBAL — Fixed Income (FIXED) ──
    ("trader_fi01",   "FI01",   "strat_p3_fi",
     400000,   5200,  0.0013,  0.0052,  0.0130,  -0.008, 0.74, None,
     "pod_3", "GLOBAL", "FIXED"),

    ("trader_fi02",   "FI02",   "strat_p3_fi",
     320000,  -2400, -0.0008, -0.0032, -0.0075,  -0.014, 0.62, None,
     "pod_3", "GLOBAL", "FIXED"),
]

# ---------------------------------------------------------------------------
# Capital Events — full fund flow ledger
#
# event_type breakdown:
#   deposit        = external capital injected into fund
#   withdrawal     = external capital removed from fund
#   pod_allocation = internal — capital earmarked to a pod (no TWR period break)
#   pod_redemption = internal — capital returned from a pod (no TWR period break)
#
# Bank balance = Σ(deposits) − Σ(|withdrawals|)  [external only]
# TWR periods  = bounded by deposits and withdrawals only
# ---------------------------------------------------------------------------

CAPITAL_EVENTS_DATA = [
    {
        "event_id":   "EVT-001",
        "date":       "2024-01-01",
        "event_type": "deposit",
        "amount":     500_000.00,
        "pod_id":     None,
        "notes":      "Initial fund capitalisation"
    },
    {
        "event_id":   "EVT-002",
        "date":       "2024-04-01",
        "event_type": "pod_allocation",
        "amount":     200_000.00,
        "pod_id":     "ALPHA",
        "notes":      "Capital allocation — ALPHA pod launch"
    },
    {
        "event_id":   "EVT-003",
        "date":       "2024-07-01",
        "event_type": "deposit",
        "amount":     500_000.00,
        "pod_id":     None,
        "notes":      "Second capital injection — H2 scale-up"
    },
    {
        "event_id":   "EVT-004",
        "date":       "2024-09-15",
        "event_type": "pod_allocation",
        "amount":     300_000.00,
        "pod_id":     "SYSDWX",
        "notes":      "Capital allocation — SYSDWX pod expansion"
    },
    {
        "event_id":   "EVT-005",
        "date":       "2024-11-01",
        "event_type": "withdrawal",
        "amount":     -100_000.00,
        "pod_id":     None,
        "notes":      "Partial capital redemption — LP request"
    },
]

# ---------------------------------------------------------------------------
# Sub-Periods — bounded by external flows (deposits + withdrawals) only
#
# Period 1: 2024-01-01 → 2024-06-30
#   Start AUM : 500,000  (EVT-001 deposit applied)
#   End AUM   : 525,000
#   PnL       : +25,000
#   Return    : 25,000 / 500,000 = 5.00%
#
# Period 2: 2024-07-01 → 2024-10-31
#   Start AUM : 1,025,000  (525K + EVT-003 500K)
#   End AUM   : 1,075,000
#   PnL       : +50,000
#   Return    : 50,000 / 1,025,000 = 4.878%
#
# Period 3: 2024-11-01 → present
#   Start AUM : 975,000   (1,075K − EVT-005 100K)
#   End AUM   : 990,000
#   PnL       : +15,000
#   Return    : 15,000 / 975,000 = 1.538%
#
# TWR = (1.0500 × 1.04878 × 1.01538) − 1 ≈ +12.35%
# Total PnL  = 90,000
# Bank       = +500K + 500K − 100K = +900,000 net external
# ---------------------------------------------------------------------------

SUB_PERIODS_DATA = [
    {
        "period_num":         1,
        "start_date":         "2024-01-01",
        "end_date":           "2024-06-30",
        "start_aum":          500_000.00,
        "cash_flow_at_start": 500_000.00,
        "end_aum":            525_000.00,
        "pnl":                25_000.00,
        "period_return":      0.05000,        # 25,000 / 500,000
        "annualised_return":  0.10250,        # (1.05)^2 − 1  [~6 month period]
    },
    {
        "period_num":         2,
        "start_date":         "2024-07-01",
        "end_date":           "2024-10-31",
        "start_aum":          1_025_000.00,
        "cash_flow_at_start": 500_000.00,
        "end_aum":            1_075_000.00,
        "pnl":                50_000.00,
        "period_return":      0.04878,        # 50,000 / 1,025,000
        "annualised_return":  0.15100,        # annualised ~4 month period
    },
    {
        "period_num":         3,
        "start_date":         "2024-11-01",
        "end_date":           "2024-12-31",
        "start_aum":          975_000.00,
        "cash_flow_at_start": -100_000.00,
        "end_aum":            990_000.00,
        "pnl":                15_000.00,
        "period_return":      0.01538,        # 15,000 / 975,000
        "annualised_return":  0.09500,        # annualised ~2 month period
    },
]


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def ensure_demo_data(data_dir: str) -> None:
    """Create or refresh all data files if version file is missing or outdated."""
    version_path = os.path.join(data_dir, VERSION_FILE)
    try:
        with open(version_path) as fh:
            stored = fh.read().strip()
    except FileNotFoundError:
        stored = ""

    if stored == DEMO_VERSION:
        return

    os.makedirs(data_dir, exist_ok=True)
    rng = np.random.default_rng(RNG_SEED)

    # Build and write entity / snapshot / equity CSVs
    entities_df  = _build_entities()
    snapshots_df = _build_snapshots()
    equity_df    = _build_equity_curves(entities_df, snapshots_df, rng)

    entities_df.to_csv(os.path.join(data_dir, "entities.csv"),   index=False)
    snapshots_df.to_csv(os.path.join(data_dir, "snapshots.csv"), index=False)
    equity_df.to_csv(os.path.join(data_dir, "equity_curve.csv"), index=False)

    # Write capital events and sub-periods as JSON
    with open(os.path.join(data_dir, "capital_events.json"), "w") as fh:
        json.dump(CAPITAL_EVENTS_DATA, fh, indent=2)

    with open(os.path.join(data_dir, "sub_periods.json"), "w") as fh:
        json.dump(SUB_PERIODS_DATA, fh, indent=2)

    with open(version_path, "w") as fh:
        fh.write(DEMO_VERSION)

    print(f"[demo_service] v{DEMO_VERSION} written to {data_dir}")


# ---------------------------------------------------------------------------
# Entity tree
# ---------------------------------------------------------------------------

def _build_entities() -> pd.DataFrame:
    rows = []

    def e(entity_id, entity_type, parent_id, name,
          status="Active", trading_style="",
          pod_code="", strategy_code="", pod_color=""):
        rows.append(dict(
            entity_id=entity_id, entity_type=entity_type,
            parent_id=parent_id, name=name, status=status,
            trading_style=trading_style, pod_code=pod_code,
            strategy_code=strategy_code, pod_color=pod_color,
        ))

    # Portfolio root
    e("portfolio_main", "portfolio", "",
      "Chase Multi-Strategy Portfolio")

    # ── Pod 1: ALPHA ──
    e("pod_1", "pod", "portfolio_main", "ALPHA",
      pod_code="ALPHA", pod_color=POD_COLORS["pod_1"])
    e("strat_p1_day",   "strategy", "pod_1", "Day Trading",
      trading_style="intraday futures",
      pod_code="ALPHA", strategy_code="DAY",  pod_color=POD_COLORS["pod_1"])
    e("strat_p1_swing", "strategy", "pod_1", "Swing Trading",
      trading_style="multi-day trend",
      pod_code="ALPHA", strategy_code="SWG",  pod_color=POD_COLORS["pod_1"])
    e("strat_p1_opts",  "strategy", "pod_1", "Options Overlay",
      trading_style="systematic options",
      pod_code="ALPHA", strategy_code="OPT",  pod_color=POD_COLORS["pod_1"])

    # ── Pod 2: SYSDWX ──
    e("pod_2", "pod", "portfolio_main", "SYSDWX",
      pod_code="SYSDWX", pod_color=POD_COLORS["pod_2"])
    e("strat_p2_sys",   "strategy", "pod_2", "Darwinex Systematic",
      trading_style="systematic multi-strategy",
      pod_code="SYSDWX", strategy_code="SYSDWX-01", pod_color=POD_COLORS["pod_2"])

    # ── Pod 3: GLOBAL ──
    e("pod_3", "pod", "portfolio_main", "GLOBAL",
      pod_code="GLOBAL", pod_color=POD_COLORS["pod_3"])
    e("strat_p3_macro", "strategy", "pod_3", "Global Macro",
      trading_style="discretionary macro",
      pod_code="GLOBAL", strategy_code="MACRO", pod_color=POD_COLORS["pod_3"])
    e("strat_p3_fi",    "strategy", "pod_3", "Fixed Income",
      trading_style="rates and credit",
      pod_code="GLOBAL", strategy_code="FIXED", pod_color=POD_COLORS["pod_3"])

    # ── Traders ──
    style_map = {
        "strat_p1_day":   "intraday futures",
        "strat_p1_swing": "multi-day trend",
        "strat_p1_opts":  "systematic options",
        "strat_p2_sys":   "systematic",
        "strat_p3_macro": "discretionary macro",
        "strat_p3_fi":    "rates and credit",
    }
    for (eid, name, parent_strat, _invested, _pnl, _p1d, _p7d, _p30d,
         _dd, _wr, _alloc, pod_id, pod_code, strat_code) in TRADER_DEFS:
        e(eid, "trader", parent_strat, name,
          trading_style=style_map.get(parent_strat, ""),
          pod_code=pod_code, strategy_code=strat_code,
          pod_color=POD_COLORS[pod_id])

    # ── Venues ──
    venue_name_map = {
        "pod_1": "Alpha",
        "pod_2": "Darwinex",
        "pod_3": "Interactive Brokers",
    }
    for (eid, name, _parent, *_, pod_id, pod_code, strat_code) in TRADER_DEFS:
        e(f"venue_{eid}", "venue", eid, venue_name_map[pod_id],
          pod_code=pod_code, strategy_code=strat_code,
          pod_color=POD_COLORS[pod_id])

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Snapshots
# ---------------------------------------------------------------------------

def _build_snapshots() -> pd.DataFrame:
    ts   = datetime(2026, 3, 26, 0, 0, 0).isoformat()
    rows = []

    def _snap(eid, invested, open_pnl, p1d, p7d, p30d,
              dd, wr, alloc_pct=None):
        rows.append(dict(
            entity_id        = eid,
            timestamp        = ts,
            equity           = round(invested + open_pnl, 2),
            invested_capital = round(invested,             2),
            open_pnl         = round(open_pnl,             2),
            performance_1d   = round(p1d,                  6),
            performance_7d   = round(p7d,                  6),
            performance_30d  = round(p30d,                 6),
            max_drawdown     = round(dd,                   4),
            win_rate         = round(wr,                   4),
            allocation_pct   = alloc_pct,
        ))

    # Traders + mirrored venue rows
    for (eid, name, parent_strat, invested, open_pnl,
         p1d, p7d, p30d, dd, wr, alloc,
         pod_id, pod_code, strat_code) in TRADER_DEFS:
        _snap(eid, invested, open_pnl, p1d, p7d, p30d, dd, wr, alloc)
        rows.append({**rows[-1], "entity_id": f"venue_{eid}"})

    # Aggregate roll-ups
    def _agg(eid, child_ids):
        children = [r for r in rows if r["entity_id"] in child_ids]
        if not children:
            return
        total_inv = sum(c["invested_capital"] for c in children)
        total_eq  = sum(c["equity"]           for c in children)
        total_pnl = sum(c["open_pnl"]         for c in children)

        def wavg(f):
            if total_inv == 0:
                return 0.0
            return sum(c.get(f, 0) * c["invested_capital"]
                       for c in children) / total_inv

        rows.append(dict(
            entity_id        = eid,
            timestamp        = ts,
            equity           = round(total_eq,               2),
            invested_capital = round(total_inv,               2),
            open_pnl         = round(total_pnl,               2),
            performance_1d   = round(wavg("performance_1d"),  6),
            performance_7d   = round(wavg("performance_7d"),  6),
            performance_30d  = round(wavg("performance_30d"), 6),
            max_drawdown     = round(wavg("max_drawdown"),    4),
            win_rate         = round(wavg("win_rate"),        4),
            allocation_pct   = None,
        ))

    # Strategies
    strat_map = {
        "strat_p1_day":   [t[0] for t in TRADER_DEFS if t[2] == "strat_p1_day"],
        "strat_p1_swing": [t[0] for t in TRADER_DEFS if t[2] == "strat_p1_swing"],
        "strat_p1_opts":  [t[0] for t in TRADER_DEFS if t[2] == "strat_p1_opts"],
        "strat_p2_sys":   [t[0] for t in TRADER_DEFS if t[2] == "strat_p2_sys"],
        "strat_p3_macro": [t[0] for t in TRADER_DEFS if t[2] == "strat_p3_macro"],
        "strat_p3_fi":    [t[0] for t in TRADER_DEFS if t[2] == "strat_p3_fi"],
    }
    for sid, children in strat_map.items():
        _agg(sid, children)

    # Pods
    _agg("pod_1", ["strat_p1_day", "strat_p1_swing", "strat_p1_opts"])
    _agg("pod_2", ["strat_p2_sys"])
    _agg("pod_3", ["strat_p3_macro", "strat_p3_fi"])

    # Portfolio
    _agg("portfolio_main", ["pod_1", "pod_2", "pod_3"])

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Equity curves — every entity gets a full 85-day daily series
# ---------------------------------------------------------------------------

def _build_equity_curves(entities: pd.DataFrame,
                          snapshots: pd.DataFrame,
                          rng: np.random.Generator) -> pd.DataFrame:
    """
    GBM equity series anchored to snapshot equity.
    Drift biased by entity's actual 30d return — positive traders trend up,
    negative traders trend down, matching KPI numbers.
    """
    dates    = [CURVE_START + timedelta(days=i) for i in range(CURVE_DAYS + 1)]
    snap_map = snapshots.set_index("entity_id").to_dict("index")
    all_rows = []

    for eid in entities["entity_id"]:
        if eid not in snap_map:
            continue

        s            = snap_map[eid]
        final_equity = float(s["equity"])
        pct30d       = float(s.get("performance_30d", 0))

        is_agg = any(k in eid for k in
                     ("portfolio_main", "pod_1", "pod_2", "pod_3",
                      "strat_p1", "strat_p2", "strat_p3"))

        drift = pct30d / CURVE_DAYS
        vol   = rng.uniform(0.0004, 0.0009) if is_agg \
                else rng.uniform(0.0015, 0.0050)

        incs   = rng.normal(drift, vol, CURVE_DAYS)
        log_r  = np.concatenate([[0.0], np.cumsum(incs)])
        raw    = np.exp(log_r)
        # Pin last point exactly to snapshot equity
        series = raw * (final_equity / raw[-1])

        for i, d in enumerate(dates):
            all_rows.append(dict(
                timestamp = d.strftime("%Y-%m-%dT%H:%M:%S"),
                entity_id = eid,
                equity    = round(float(series[i]), 2),
            ))

    return pd.DataFrame(all_rows)