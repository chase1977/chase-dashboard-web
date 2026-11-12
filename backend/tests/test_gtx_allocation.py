# backend/tests/test_gtx_allocation.py
"""
Closing-trade allocation — every combination (2026-11-12). One closing trade
in the Trades Report can close: one lot whole or partly; several lots whole
(real 11-11-2026: ENERGY VAULT sell 100,000 @ 3.73192264 closed all 7 lots,
profit 14,642.72); several lots whole + one partly; lots on the short side;
two orders the same day; equal-price lots (FIFO). Each lot must stay its own
closed record, and balance / realised / open P/L / margin must reconcile.
Run from backend/:  python tests\\test_gtx_allocation.py
"""
import os, sys
from math import floor
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "services"))
from gtx_engine import replay, DEFAULT_SETTINGS

S = {**DEFAULT_SETTINGS, "swap_rate_long_pct": 0.0, "swap_rate_short_pct": 0.0, "short_rate_verified": True,
     "margin_pct": 0.0, "fee_per_unit": 0.05, "swap_rate_schedule": []}
t2 = lambda x: (-1 if x < 0 else 1) * floor(abs(x) * 100 + 1e-7) / 100

def lot(inst, qty, px, dt, side=1, cur=None):
    return {"instrument": inst, "side": side, "qty": float(qty), "open_px": px, "open_dt": dt,
            "current_px": cur if cur is not None else px, "profit": 0.0, "margin": 0.0, "account": "GTX0011-USD"}

def trade(inst, qty, px, dt, side, profit=0.0):
    return {"instrument": inst, "side": side, "qty": float(qty), "price": px, "dt": dt, "profit": profit}

def run(name, opens, closes, remaining, expect_pieces, gross=None):
    """opens: lots held after day 1; closes: day-2 closing trades (profit as the broker prints it, 2dp);
    remaining: day-2 open report; gross: the broker's full-precision gross (balance), default Σ profit."""
    new = [l for l in opens if l["open_dt"].startswith("2026-11-10")]       # older lots: carried in, fee already paid
    fee1 = sum(l["qty"] * 0.05 for l in new)
    bal1 = 1_000_000.0 - fee1
    gross = sum(c["profit"] for c in closes) if gross is None else gross
    fee2 = sum(c["qty"] * 0.05 for c in closes)
    real2 = gross - fee2
    opl2 = sum((l["current_px"] - l["open_px"]) * l["qty"] * l["side"] for l in remaining)
    days = [
        {"date": "2026-11-09", "account": {"balance": 1_000_000.0, "open_pl": 0.0, "margin_req": 0.0, "today_realised": 0.0},
         "open_positions": [], "trades": []},
        {"date": "2026-11-10", "account": {"balance": t2(bal1), "open_pl": 0.0, "margin_req": 0.0, "today_realised": t2(-fee1)},
         "open_positions": opens, "trades": [trade(l["instrument"], l["qty"], l["open_px"], l["open_dt"], l["side"]) for l in new]},
        {"date": "2026-11-11", "account": {"balance": t2(bal1 + real2), "open_pl": t2(opl2), "margin_req": 0.0, "today_realised": t2(real2)},
         "open_positions": remaining, "trades": closes},
    ]
    r = replay(days, S)
    d = r["recon_log"][-1]
    pieces = sorted((c["instrument"][:6], c["open_px"], round(c["qty"])) for c in r["closed_positions"])
    good = d["ok"] and not d["warnings"] and not d["rate_inferred"] and pieces == sorted(expect_pieces)
    print(f"  {'✓' if good else '✗'} {name}: checks {d['checks']} closed {pieces} warn {d['warnings']}")
    return good

EV = "ENERGY VAULT HOLDINGS (CFD)"
ok = True
# A. real 11-11: one sell closes all 7 EV lots (whole), profit 14,642.72
ev = [lot(EV, 10000, 4.21986, "2026-09-24T12:10:03.117"), lot(EV, 15000, 4.4334, "2026-09-25T10:50:39.866"),
      lot(EV, 25000, 3.61111, "2026-10-07T10:37:54.705"), lot(EV, 12500, 3.216776, "2026-10-28T14:04:24.972"),
      lot(EV, 12500, 3.2279754, "2026-10-28T16:06:26.342"), lot(EV, 12500, 3.2781262, "2026-10-29T16:08:44.201"),
      lot(EV, 12500, 3.0428978, "2026-11-02T17:08:57.033")]
pa = 3.73192264
ok &= run("A one sell → 7 whole lots (EV 11-11)", ev, [trade(EV, 100000, pa, "2026-11-11T11:47:20.648", -1, 14642.72)], [],
          [(EV[:6], l["open_px"], l["qty"]) for l in ev],
          gross=sum((pa - l["open_px"]) * l["qty"] for l in ev))     # 14,642.7175 — broker balance is full precision
# B. several whole + one partly: sell 45,000 @ 4.0 = 20k lot whole + 25k of the 30k lot (5k stays open)
B = [lot("ACME", 10000, 1.0, "2026-11-10T09:00:00.000"), lot("ACME", 20000, 2.0, "2026-11-10T09:01:00.000"),
     lot("ACME", 30000, 3.0, "2026-11-10T09:02:00.000")]
prof = (4.0 - 2.0) * 20000 + (4.0 - 3.0) * 25000
ok &= run("B whole + partial in one order", B, [trade("ACME", 45000, 4.0, "2026-11-11T10:00:00.000", -1, prof)],
          [B[0], {**B[2], "qty": 5000.0}], [("ACME", 2.0, 20000), ("ACME", 3.0, 25000)])
# C. two orders same day, each across lots; shorts closed by Buy
C = [lot("SHRT", 4000, 50.0, "2026-11-10T09:00:00.000", -1), lot("SHRT", 6000, 52.0, "2026-11-10T09:05:00.000", -1),
     lot("SHRT", 5000, 51.0, "2026-11-10T09:10:00.000", -1)]
c1 = trade("SHRT", 10000, 49.0, "2026-11-11T10:00:00.000", 1, (50 - 49) * 4000 + (52 - 49) * 6000)
c2 = trade("SHRT", 5000, 48.5, "2026-11-11T11:00:00.000", 1, (51 - 48.5) * 5000)
ok &= run("C two orders, short lots, multi-lot each", C, [c1, c2], [], [("SHRT", 50.0, 4000), ("SHRT", 52.0, 6000), ("SHRT", 51.0, 5000)])
# D. equal-price lots, partial → FIFO (oldest closed)
D = [lot("SAME", 1000, 10.0, "2026-11-10T09:00:00.000"), lot("SAME", 1000, 10.0, "2026-11-10T09:30:00.000")]
ok &= run("D equal prices, one lot closed → oldest", D, [trade("SAME", 1000, 11.0, "2026-11-11T10:00:00.000", -1, 1000.0)],
          [D[1]], [("SAME", 10.0, 1000)])
# E. one lot partly (classic partial), others untouched
E = [lot("PART", 8000, 20.0, "2026-11-10T09:00:00.000"), lot("PART", 2000, 21.0, "2026-11-10T09:01:00.000")]
ok &= run("E single lot partly closed", E, [trade("PART", 3000, 22.0, "2026-11-11T10:00:00.000", -1, 6000.0)],
          [{**E[0], "qty": 5000.0}, E[1]], [("PART", 20.0, 3000)])
# F. profit decides between a single lot and two smaller lots of the same total qty
F = [lot("PICK", 2000, 5.0, "2026-11-10T09:00:00.000"), lot("PICK", 1000, 4.0, "2026-11-10T09:01:00.000"),
     lot("PICK", 1000, 6.0, "2026-11-10T09:02:00.000")]
ok &= run("F two small lots beat one big lot on profit", F, [trade("PICK", 2000, 7.0, "2026-11-11T10:00:00.000", -1, 3000.0 + 1000.0)],
          [F[0]], [("PICK", 4.0, 1000), ("PICK", 6.0, 1000)])
print("\nALL CLOSE ALLOCATIONS RECONCILED ✓" if ok else "\nFAILURES ABOVE")
assert ok
