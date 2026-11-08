# backend/tests/test_gtx_cutoff.py
"""
Swap-run time + short rule (2026-11-08, Ben 06-11-2026 + operations CSV to 05-11).
- Run = 22:00 London on the statement's fixed UTC−4 clock: 17:00 while the UK
  is on BST, 18:00 on GMT (CSV swap rows 17:00 to 23-10, 18:00 from 26-10).
- EV 12,500 opened 02-11 17:08:57 IS charged that night (run 18:00).
- A short is charged nothing while the reference rate is below 4% (Flutter
  3,000 short 03-11 17:06 → 04-11 17:18: swap $0.00).
Run from backend/:  python tests\\test_gtx_cutoff.py
"""
import os, sys
from datetime import date, datetime
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "services"))
from gtx_engine import _cutoff_for, replay, DEFAULT_SETTINGS
from gtx_books import book_settings

ok = True
cases = {"2026-09-24": 17, "2026-10-23": 17, "2026-10-26": 18, "2026-11-02": 18, "2027-03-26": 18, "2027-03-29": 17}
for d, h in cases.items():
    got = _cutoff_for(date.fromisoformat(d), DEFAULT_SETTINGS)
    good = got == datetime.fromisoformat(f"{d}T{h:02d}:00:00")
    ok &= good
    print(f"  {'✓' if good else '✗'} {d} swap run {got.strftime('%H:%M')} (want {h}:00)")

# Minimal 2-day replay: a lot opened 17:08:57 on 02-11 is charged that night.
def st(d, bal, real, pos, trades=()):
    return {"date": d, "account": {"account": "GTX0011-USD", "balance": bal, "open_pl": 0.0, "margin_req": 0.0,
                                   "today_realised": real},
            "open_positions": pos, "trades": list(trades)}
lot = {"instrument": "EV (CFD)", "side": 1, "qty": 12500.0, "open_px": 3.0428978, "open_dt": "2026-11-02T17:08:57.033",
       "current_px": 3.0428978, "profit": 0.0, "margin": 0.0, "account": "GTX0011-USD"}
S = {**DEFAULT_SETTINGS, "swap_rate_long_pct": 7.9, "swap_rate_short_pct": 0.0, "short_rate_verified": True}
swap = 12500 * 3.0428978 * 0.079 / 360
r = replay([st("2026-10-30", 1000.0, 0.0, []),
            st("2026-11-02", 1000.0 - 625 - swap, -625 - swap, [lot],
               [{"instrument": "EV (CFD)", "side": 1, "qty": 12500.0, "price": 3.0428978, "dt": "2026-11-02T17:08:57.033", "profit": 0.0}])], S)
day = r["recon_log"][-1]
good = abs(day["swaps"] + swap) < 1e-9 and not day["rate_inferred"]
ok &= good
print(f"  {'✓' if good else '✗'} lot opened 17:08:57 charged on 02-11: swap {day['swaps']:.4f} (rate inferred: {day['rate_inferred']})")

for ccy in ("EUR", "GBP"):
    bs = book_settings(DEFAULT_SETTINGS, ccy)
    shorts = [bs["swap_rate_short_pct"]] + [e["short_pct"] for e in bs["swap_rate_schedule"]]
    good = all(x == 0.0 for x in shorts)
    ok &= good
    print(f"  {'✓' if good else '✗'} {ccy} short charge rate 0 (ref below 4%): {shorts}")

print("\nSWAP RUN + SHORT RULE ✓" if ok else "\nFAILURES ABOVE")
assert ok
