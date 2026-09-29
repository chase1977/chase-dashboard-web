# backend/tests/test_gtx_replay.py
"""Replays 17-09 → 25-09-2026 statements (email paste format) and asserts recon."""
import sys, json
sys.path.insert(0, __import__("os").path.join(__import__("os").path.dirname(__file__), "..", "src", "services"))
from gtx_parser import parse_statement
from gtx_engine import replay

ACC_HDR = "Account name\tBalance\tOpen gross P/L\tProjected balance\tAvailable funds\tInitial margin req\tMargin available\tToday's realized P/L\tAccount currency\tStop out value\tCredit value\tAccount ID\tBlocked for fixed income\tFixed income value\tFixed income orders req"
OP_HDR = "Account\tInstrument\tAmount\tOpen price\tBuy/Sell\tOpen date/time\tCurrent price\tProfit\tCurrency\tMargin"
TR_HDR = "Account\tInstrument\tOperation\tDate\tPrice\tAmount\tProfit"
Z = "\t".join(["0.00"] * 7)

def email(acc, ops, trs):
    a = "\t".join(acc)
    def blk(rows): return "\n".join("GTX0011-USD\t" + r for r in rows) if rows else "There is no data available"
    return f"""Login: GTX0011



Account Statement Report GTX
{ACC_HDR}
GTX0011-USD\t{a}\tUSD\t{acc[5]}\t0.00\t2776\t0.00\t0.00\t0.00
GTX0011-GBP\t{Z}\tGBP\t0.00\t0.00\t2777\t0.00\t0.00\t0.00
GTX0011-EUR\t{Z}\tEUR\t0.00\t0.00\t2778\t0.00\t0.00\t0.00



Open Position Report GTX
{OP_HDR}
{blk(ops)}



Trades Report GTX
{TR_HDR}
{blk(trs)}
"""
Q, A, N = "QIAGEN (CFD)", "AMBARELLA INC (CFD)", "ENERGY VAULT HOLDINGS (CFD)"
flat = ["1,343,927.49","0.00","1,343,927.49","1,343,927.49","0.00","1,343,927.49","0.00"]
days = {
 "2026-09-17": (flat, [], []),
 "2026-09-18": (flat, [], []),
 "2026-09-21": (["1,343,459.51","6,509.65","1,349,969.17","1,151,956.67","198,012.50","1,151,956.67","-467.97"],
   [f"{Q}\t5,000.00\t44.218164\tBuy\t21-09-2026 10:26:05.214\t44.78\t2,809.18\tUSD\t111,950.00",
    f"{A}\t2,500.00\t67.36981\tBuy\t21-09-2026 16:00:30.351\t68.85\t3,700.47\tUSD\t86,062.50"],
   [f"{A}\tBuy\t21-09-2026 16:00:30.351\t67.36981\t2,500.00\t0.00",
    f"{Q}\tBuy\t21-09-2026 10:26:05.214\t44.218164\t5,000.00\t0.00"]),
 "2026-09-22": (["1,343,368.87","-3,415.34","1,339,953.53","1,146,903.53","193,050.00","1,146,903.53","-90.64"],
   [f"{Q}\t5,000.00\t44.218164\tBuy\t21-09-2026 10:26:05.214\t43.69\t-2,640.82\tUSD\t109,225.00",
    f"{A}\t2,500.00\t67.36981\tBuy\t21-09-2026 16:00:30.351\t67.06\t-774.52\tUSD\t83,825.00"], []),
 "2026-09-23": (["1,348,018.04","-2,540.82","1,345,477.22","1,236,202.22","109,275.00","1,236,202.22","4,649.16"],
   [f"{Q}\t5,000.00\t44.218164\tBuy\t21-09-2026 10:26:05.214\t43.71\t-2,540.82\tUSD\t109,275.00"],
   [f"{A}\tSell\t23-09-2026 14:58:22.000\t69.30\t2,500.00\t4,825.47"]),
 "2026-09-24": (["1,348,891.89","-373.60","1,348,518.29","1,273,268.29","75,250.00","1,273,268.29","873.84"],
   [f"{N}\t25,000.00\t4.347\tBuy\t24-09-2026 10:42:19.447\t4.30\t-1,175.00\tUSD\t53,750.00",
    f"{N}\t10,000.00\t4.21986\tBuy\t24-09-2026 12:10:03.117\t4.30\t801.40\tUSD\t21,500.00"],
   [f"{N}\tBuy\t24-09-2026 12:10:03.117\t4.21986\t10,000.00\t0.00",
    f"{N}\tBuy\t24-09-2026 10:42:19.447\t4.347\t25,000.00\t0.00",
    f"{Q}\tSell\t24-09-2026 10:39:28.000\t44.80\t5,000.00\t2,909.18"]),
 "2026-09-25": (["1,347,986.94","2,625.40","1,350,612.34","1,240,612.34","110,000.00","1,240,612.34","-904.94"],
   [f"{N}\t25,000.00\t4.347\tBuy\t24-09-2026 10:42:19.447\t4.40\t1,325.00\tUSD\t55,000.00",
    f"{N}\t10,000.00\t4.21986\tBuy\t24-09-2026 12:10:03.117\t4.40\t1,801.40\tUSD\t22,000.00",
    f"{N}\t15,000.00\t4.4334\tBuy\t25-09-2026 10:50:39.866\t4.40\t-501.00\tUSD\t33,000.00"],
   [f"{N}\tBuy\t25-09-2026 10:50:39.866\t4.4334\t15,000.00\t0.00"]),
}
stmts = [{"date": d, **parse_statement(email(*v))} for d, v in days.items()]
out = replay(stmts)

print(f"{'date':<11}{'stmtBal':>15}{'engBal':>15}{'diff':>7}{'real':>10}{'fees':>10}{'swaps':>10}{'cash':>14}{'impl%':>9}  checks")
for r in out["recon_log"]:
    ir = f"{r['implied_rate_pct']:.4f}" if r["implied_rate_pct"] else "-"
    print(f"{r['date']:<11}{r['stmt_balance']:>15,.2f}{r['engine_balance']:>15,.2f}{r['balance_diff']:>7.2f}"
          f"{r['engine_realised']:>10.2f}{r['fees']:>10.2f}{r['swaps']:>10.2f}{r['cash_flow']:>14,.2f}{ir:>9}  "
          f"{'✓' if r['ok'] else '✗ '+str(r['checks'])} {r['warnings'] or ''}")
print("\nSUMMARY"); [print(f"  {k:<22}{v:,.2f}" if isinstance(v,float) else f"  {k:<22}{v}") for k,v in out["summary"].items()]
print("\nCLOSED")
for l in out["closed_positions"]:
    print(f"  {l['instrument'][:14]:<15}{l['qty']:>7,.0f} gross {l['gross']:>9.2f} fees {-(l['open_fee']+l['close_fee']):>8.2f} swaps {l['swaps']:>8.2f} net {l['net']:>9.2f} days {l['days_held']}")
print("OPEN")
for l in out["open_positions"]:
    print(f"  {l['instrument'][:14]:<15}{l['qty']:>7,.0f} unrl {l['unrealised']:>9.2f} openfee {-l['open_fee']:>8.2f} swaps {l['swaps']:>8.2f} estClose {-l['est_close_fee']:>8.2f} netIfClosed {l['net_if_closed']:>9.2f}")
assert all(r["ok"] for r in out["recon_log"]), "RECON FAILED"
print("\nALL 7 STATEMENTS RECONCILED ✓")
