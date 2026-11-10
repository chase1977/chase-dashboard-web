# backend/tests/test_gtx_lots.py
"""
Lot identity (2026-11-09): one order filled as two lots at the SAME timestamp
and different prices — real 06-11-2026 statement: ABIVAX 1,000 @ 86.50 and
1,000 @ 85.753, both 06-11 17:02:54.400. Keyed on time alone they merged
into one lot (one $60 fee, wrong open P/L + margin, false 10.15% rate).
Each must be its own lot: 2 × $60 fee, open P/L −770 and −23, margin 2 × 34,292.
Run from backend/:  python tests\\test_gtx_lots.py
Also: the 09-11 broker missing close of the 86.50 lot (see below).
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

# Broker MISSING close (real 09-11-2026): both lots sold at 87.38138 but the
# statement showed only the 85.753 one; the 86.50 lot just vanished. Default
# BOOK_CORRECTIONS entry closes it on 09-11 (open P/L / margin reconcile) and
# moves the balance by +881.38 − 60 = +821.38 on the next statement, never as
# a deposit. Booked day 09-11 = 1,508.38 + 761.38 = 2,269.76.
def sell(px, profit):
    return {"instrument": AB, "side": -1, "qty": 1000.0, "price": px, "dt": "2026-11-09T15:32:45.000", "profit": profit}
b0 = 10000.0 - 120.0
b9 = round(b0 + 1628.38 - 60.0, 2)
r = replay([st("2026-11-05", 10000.0, 0.0, 0.0, 0.0, []),
            st("2026-11-06", b0, -120.0, -793.0, 68584.0, [lot(86.50, -770.0), lot(85.753, -23.0)], [buy(85.753), buy(86.50)]),
            st("2026-11-09", b9, 1568.38, 0.0, 0.0, [], [sell(87.38138, 1628.38)]),
            st("2026-11-10", round(b9 + 821.38, 2), 0.0, 0.0, 0.0, [])], S)
l9, l10 = r["recon_log"][-2], r["recon_log"][-1]
booked = {d["date"]: d["net_display"] for d in r["booked"]}
ok2 = (l9["ok"] and l10["ok"] and not r["cash_events"][1:] and abs(l10["correction"] - 821.38) < 1e-6
       and booked.get("2026-11-09") == 2269.76 and not r["open_positions"])
print(f"  09-11 {l9['checks']} notes {l9['corrections']}")
print(f"  10-11 {l10['checks']} correction {l10['correction']:+.2f} cash events {r['cash_events'][1:]} booked {booked}")
ok &= ok2
print("\nSAME-TIMESTAMP LOTS KEPT SEPARATE + MISSING CLOSE ✓" if ok else "\nFAILURES ABOVE")
assert ok
