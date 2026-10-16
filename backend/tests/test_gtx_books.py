# backend/tests/test_gtx_books.py
"""
Multi-currency books regression (2026-10-13, broker terms 2026-10-14).
Real 12-10 + 13-10 statements: USD book (6 lots) + first EUR position
(Corbion 10,000, 30% margin) + empty GBP book; 13-10 has the $25,000 →
€22,347.37 transfer. Each currency must reconcile on its own, exactly as the
operations CSV books it:
  EUR 12-10 open fee 0.25% × 10,000 × 22.59346 = €564.8365, swap 7.875% = €49.30625
  EUR 13-10 swap 4.858% (broker mis-set) = €30.63; cash +€22,347.37
  USD 13-10 swaps 7.9% = $150.90; cash −$25,000.00
Run from backend/:  python tests\\test_gtx_books.py
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "services"))
from gtx_books import replay_books
from gtx_engine import replay, trunc2, DEFAULT_SETTINGS
from gtx_parser import parse_statement_books

FIX = os.path.join(os.path.dirname(__file__), "fixtures")
d2_text = open(os.path.join(FIX, "gtx_2026-10-12.txt")).read()
# Day 1 is the first statement, so it is charged no swap (base rate 0) and its
# balance is exact; 7.9% applies from 12-10 (dated change). The EUR book gets
# EUR / GBP use the code defaults (gtx_books.BOOK_DEFAULTS) — no overrides.
SETT = {**DEFAULT_SETTINGS, "swap_rate_long_pct": 0.0, "swap_rate_short_pct": 0.0,
        "swap_rate_schedule": [{"from": "2026-10-12", "long_pct": 7.9, "short_pct": 7.9}],
        "books": {},
        # synthetic day 1 (09-10) has no CHIPOTLE lot — keep the live USD
        # correction (gtx_books.BOOK_CORRECTIONS) out of this test
        "trade_corrections": []}

# Day 1 (09-10, Friday): the same USD book at 3.20 / 45.00, EUR + GBP empty.
# Its realised is taken from the engine so the replay starts in balance.
def day1_text(real, bal="1,358,974.32"):
    hdr, body = d2_text.split("Open Position Report GTX")
    acc = hdr.splitlines()
    usd = [l for l in acc if l.startswith("GTX0011-USD")][0].split("\t")
    usd[1], usd[7] = bal, f"{real:,.2f}"
    acc = [("\t".join(usd) if l.startswith("GTX0011-USD") else
            ("GTX0011-EUR\t0.00\t0.00\t0.00\t0.00\t0.00\t0.00\t0.00\tEUR\t0.00\t0.00\t2778\t0.00\t0.00\t0.00"
             if l.startswith("GTX0011-EUR") else l)) for l in acc]
    pos = [l for l in body.splitlines() if l.startswith("GTX0011-USD")]
    trades = "Trades Report GTX\nAccount\tInstrument\tOperation\tDate\tPrice\tAmount\tProfit\nThere is no data available\n"
    head = [l for l in body.splitlines() if l.startswith("Account\tInstrument\tAmount")][0]
    return "\n".join(acc) + "Open Position Report GTX\n" + head + "\n" + "\n".join(pos) + "\n\n\n" + trades

d3_text = open(os.path.join(FIX, "gtx_2026-10-13.txt")).read()
stmts = [{"date": "2026-10-09", "text": day1_text(0.0)},
         {"date": "2026-10-12", "text": d2_text},
         {"date": "2026-10-13", "text": d3_text}]

ok = True
res = replay_books(stmts, SETT)
books = {b["ccy"]: b for b in res["books"]}
ok &= list(books) == ["USD", "EUR"]                            # GBP empty -> hidden
for ccy, b in books.items():
    print(f"\n== {ccy} book (verified {b['verified']})")
    for r in b["recon_log"]:
        print(f"  {r['date']}: {'OK  ' if r['ok'] else 'FAIL'} bal {r['stmt_balance']:>14,.2f} real {r['stmt_realised']:>9,.2f} "
              f"fees {r['fees']:>10,.4f} swaps {r['swaps']:>9,.4f} cash {r['cash_flow']:>11,.2f} "
              f"rate {r['model_rate_pct']}% warn {r['warnings']}")
        ok &= r["ok"]
eur = {r["date"]: r for r in books["EUR"]["recon_log"]}
usd = {r["date"]: r for r in books["USD"]["recon_log"]}
ok &= abs(eur["2026-10-12"]["fees"] + 564.8365) < 1e-6                 # 0.25% of notional
ok &= abs(eur["2026-10-12"]["swaps"] + 49.30625) < 1e-6                # 7.875%
ok &= abs(eur["2026-10-13"]["swaps"] + 227000 * 0.04858 / 360) < 1e-6  # 4.858% (broker mis-set) = €30.63
ok &= abs(eur["2026-10-13"]["cash_flow"] - 22347.37) < 0.011
ok &= abs(usd["2026-10-13"]["cash_flow"] + 25000.0) < 0.011
ok &= usd["2026-10-12"]["fees"] == 0 and len(books["EUR"]["open_positions"]) == 1
ok &= not any(r["rate_inferred"] for r in eur.values())               # schedule, not inference
est = books["EUR"]["open_positions"][0]["est_close_fee"]
ok &= abs(est - 10000 * 22.70 * 0.0025) < 1e-6                         # close fee 25bps at current px
print(f"\n  EUR est. close fee €{est:,.2f} (0.25% × 10,000 × 22.70)")

print("\nALL BOOKS RECONCILED ✓" if ok else "\nFAILURES ABOVE")
assert ok
