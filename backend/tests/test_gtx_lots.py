# backend/tests/test_gtx_lots.py
"""
Lot identity (2026-11-09): one order filled as two lots at the SAME timestamp
and different prices — real 06-11-2026 statement: ABIVAX 1,000 @ 86.50 and
1,000 @ 85.753, both 06-11 17:02:54.400. Keyed on time alone they merged
into one lot (one $60 fee, wrong open P/L + margin, false 10.15% rate).
Each must be its own lot: 2 × $60 fee, open P/L −770 and −23, margin 2 × 34,292.
Run from backend/:  python tests\\test_gtx_lots.py
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "services"))
from gtx_engine import replay, DEFAULT_SETTINGS
from gtx_books import book_settings

AB = "ABIVAX (CFD)"
def st(d, bal, real, opl, mg, pos, trades=()):
    return {"date": d, "account": {"account": "GTX0011-USD", "balance": bal, "open_pl": opl, "margin_req": mg,
                                   "today_realised": real}, "open_positions": pos, "trades": list(trades)}
def lot(px, profit):
    return {"instrument": AB, "side": 1, "qty": 1000.0, "open_px": px, "open_dt": "2026-11-06T17:02:54.400",
            "current_px": 85.73, "profit": profit, "margin": 34292.0, "account": "GTX0011-USD"}
def buy(px):
    return {"instrument": AB, "side": 1, "qty": 1000.0, "price": px, "dt": "2026-11-06T17:02:54.400", "profit": 0.0}

S = book_settings({**DEFAULT_SETTINGS, "swap_rate_long_pct": 7.9, "short_rate_verified": True}, "USD")  # ABIVAX $0.06, no swap
r = replay([st("2026-11-05", 10000.0, 0.0, 0.0, 0.0, []),
            st("2026-11-06", 10000.0 - 120.0, -120.0, -793.0, 68584.0, [lot(86.50, -770.0), lot(85.753, -23.0)],
               [buy(85.753), buy(86.50)])], S)
day = r["recon_log"][-1]
ok = (day["ok"] and len(r["open_positions"]) == 2 and abs(day["fees"] + 120.0) < 1e-9
      and not day["rate_inferred"] and sorted(p["open_px"] for p in r["open_positions"]) == [85.753, 86.5])
print(f"  checks {day['checks']} lots {[(p['qty'], p['open_px'], p['open_fee']) for p in r['open_positions']]} fees {day['fees']}")
print("\nSAME-TIMESTAMP LOTS KEPT SEPARATE ✓" if ok else "\nFAILURES ABOVE")
assert ok
