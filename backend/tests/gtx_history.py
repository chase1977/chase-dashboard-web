# backend/tests/gtx_history.py
"""Builds the real emailed statements 17-09 → 13-10-2026 (fixtures) as raw text."""
import os
FIX = os.path.join(os.path.dirname(__file__), "fixtures")
ACC_HDR = "Account name\tBalance\tOpen gross P/L\tProjected balance\tAvailable funds\tInitial margin req\tMargin available\tToday's realized P/L\tAccount currency\tStop out value\tCredit value\tAccount ID\tBlocked for fixed income\tFixed income value\tFixed income orders req"
OP_HDR = "Account\tInstrument\tAmount\tOpen price\tBuy/Sell\tOpen date/time\tCurrent price\tProfit\tCurrency\tMargin"
TR_HDR = "Account\tInstrument\tOperation\tDate\tPrice\tAmount\tProfit"
Z = "\t".join(["0.00"] * 7)


def _email(a, ps, ts):
    blk = lambda rows: "\n".join("GTX0011-USD\t" + "\t".join(r[:7] + ["USD"] + r[7:] if len(r) == 8 else r) for r in rows) \
        if rows else "There is no data available"
    usd = "\t".join(a) + f"\tUSD\t{a[4]}\t0.00\t2776\t0.00\t0.00\t0.00"
    return (f"Login: GTX0011\n\n\n\nAccount Statement Report GTX\n{ACC_HDR}\nGTX0011-USD\t{usd}\n"
            f"GTX0011-GBP\t{Z}\tGBP\t0.00\t0.00\t2777\t0.00\t0.00\t0.00\n"
            f"GTX0011-EUR\t{Z}\tEUR\t0.00\t0.00\t2778\t0.00\t0.00\t0.00\n\n\n\n"
            f"Open Position Report GTX\n{OP_HDR}\n{blk(ps)}\n\n\n\nTrades Report GTX\n{TR_HDR}\n{blk(ts)}\n")


def statements() -> list[dict]:
    out, cur = [], None
    for line in open(os.path.join(FIX, "gtx_history_2026-09-17_to_10-09.txt"), encoding="utf-8"):
        line = line.rstrip("\n")
        if not line or line.startswith("#"):
            continue
        k, *v = line.split("|")
        if k == "D":
            cur = {"date": v[0], "a": None, "p": [], "t": []}; out.append(cur)
        elif k == "A":
            cur["a"] = v
        elif k == "P":
            cur["p"].append(v)
        elif k == "T":
            cur["t"].append(v)
    res = [{"date": d["date"], "text": _email(d["a"], d["p"], d["t"])} for d in out]
    for d in ("2026-10-12", "2026-10-13"):
        res.append({"date": d, "text": open(os.path.join(FIX, f"gtx_{d}.txt"), encoding="utf-8").read()})
    return res
