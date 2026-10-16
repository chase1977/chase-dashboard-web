# backend/tests/test_gtx_history.py
"""
Full-history regression (2026-10-14): every emailed statement 17-09 → 15-10-2026
replayed per book, checked day by day AND against the broker's account
operations CSV (exported 13-10, covers to 12-10 17:00 + the 13-10 transfer).

CSV totals (USD): deposits 1,343,927.49 · fees −6,500.00 · swaps −2,376.431638
(+ 13-10 swaps −150.9010 not yet in the CSV) · trading +23,772.645 ·
transfer −25,000.00. EUR: fee −564.8365 · swap −49.30625 · transfer +22,347.37.
CHIPOTLE: statement 08-10 showed close 32.521965 (+8,842.47); the CSV books it
at 31.52197 (+3,842.50) and the balance fell the 4,999.975 on 09-10 — handled by
gtx_books.BOOK_CORRECTIONS, never a withdrawal.
Run from backend/:  python tests\\test_gtx_history.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "services"))
from gtx_history import statements
from gtx_books import replay_books
from gtx_engine import DEFAULT_SETTINGS

# Live USD settings: 8.45145% until 28-09, 7.9% (3.9 ref + 4) from 29-09.
SETT = {**DEFAULT_SETTINGS, "swap_rate_schedule": [{"from": "2026-09-29", "long_pct": 7.9, "short_pct": 0.1}]}
res = replay_books(statements(), SETT)
books = {b["ccy"]: b for b in res["books"]}
ok = list(books) == ["USD", "EUR"]
for ccy, b in books.items():
    print(f"\n== {ccy}")
    print(f"  {'date':10} {'stmt bal':>14} {'engine bal':>17} {'realised':>10} {'fees':>10} {'swaps':>10} {'gross':>10} {'cash':>11} {'corr':>10} rate")
    for r in b["recon_log"]:
        print(f"  {r['date']} {r['stmt_balance']:>14,.2f} {r['engine_balance']:>17,.4f} {r['stmt_realised']:>10,.2f} "
              f"{r['fees']:>10,.2f} {r['swaps']:>10,.4f} {r['gross_closed']:>10,.3f} {r['cash_flow']:>11,.2f} "
              f"{r['correction']:>10,.3f} {r['model_rate_pct']}  {'✓' if r['ok'] else '✗ ' + str(r['checks'])} {r['warnings'] or ''}")
        ok &= r["ok"] and not r["rate_inferred"]

u, e = books["USD"]["summary"], books["EUR"]["summary"]
# The CSV ends 13-10: compare the USD log summed to that date.
ulog = [r for r in books["USD"]["recon_log"] if r["date"] <= "2026-10-13"]
sm = lambda k: sum(r[k] for r in ulog)
csv_checks = {
    "USD fees = CSV":            abs(-sm("fees") - 6500.0) < 1e-6,
    "USD swaps = CSV + 13-10":   abs(-sm("swaps") - (2376.431638 + 150.9010)) < 0.001,
    "USD gross = CSV trading":   abs(sm("gross_closed") + sm("correction") - 23772.645) < 1e-6,
    "USD capital = deposits − transfer": abs(u["starting_balance"] - (1343927.49 - 25000.0)) < 1e-6,
    "USD correction CHIPOTLE":   abs(u["corrections_total"] + 4999.975) < 1e-6,
    "EUR fees = CSV":            abs(e["fees_total"] - 564.8365) < 1e-6,
    "EUR capital = transfer":    abs(e["starting_balance"] - 22347.37) < 1e-6,
}
chip = next(c for c in books["USD"]["closed_positions"] if c["instrument"].startswith("CHIPOLTE"))
csv_checks["CHIPOTLE gross 3,842.50"] = abs(chip["gross"] - 3842.5) < 1e-6
# 14-10 / 15-10 (statements only, 16-10-2026): ABIVAX $300 each way, no swap;
# QIAGEN sell 10,000 closes both 5,000 lots (06-10 + 07-10) in one order.
closed = books["USD"]["closed_positions"]
abv = next(c for c in closed if c["instrument"].startswith("ABIVAX"))
q15 = [c for c in closed if c["instrument"].startswith("QIAGEN") and c["close_dt"].startswith("2026-10-15")]
csv_checks["ABIVAX net 19,550.00 (gross 20,150 − 600 costs)"] = abs(abv["net"] - 19550.0) < 1e-6
csv_checks["QIAGEN 15-10 closes 2 lots, gross 10,704.85"] = len(q15) == 2 and abs(sum(c["gross"] for c in q15) - 10704.85) < 1e-6
csv_checks["EUR 14-10 / 15-10 at 6.429%"] = all(r["model_rate_pct"] == 6.429 for r in books["EUR"]["recon_log"][-2:])
print("\n  15-10 closes (USD net): " + ", ".join(f"{c['instrument'][:8]} {c['open_dt'][:10]} {c['net']:,.4f}"
                                              for c in closed if c["close_dt"].startswith("2026-10-15")))
print()
for k, v in csv_checks.items():
    print(f"  {'✓' if v else '✗'} {k}")
ok &= all(csv_checks.values())
print("\n  Closed (USD net):", ", ".join(f"{c['instrument'][:10]} {c['net']:,.2f}" for c in books["USD"]["closed_positions"]))
print("\nFULL HISTORY RECONCILED TO STATEMENTS + CSV ✓" if ok else "\nFAILURES ABOVE")
assert ok
