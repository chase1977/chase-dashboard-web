# backend/tests/test_gtx_export.py
"""
Closed Positions workbook (2026-11-24) — offline. Real 11-11 -> 17-11 replay
(NVIDIA 2,000 closed as 2 x 1,000). Proves: sheets USD / EUR / GBP always,
GBP empty until the book opens; columns + sign convention exactly as the
Closed Positions table; open time latest -> oldest; totals tie to the engine.
Run from backend/:  python tests\\test_gtx_export.py
"""
import io, os, sys
from datetime import datetime
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("SUPABASE_URL", "http://offline")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "offline")
from openpyxl import load_workbook
from src.services.gtx_engine import replay, DEFAULT_SETTINGS
from src.services.gtx_books import book_settings
from src.services import gtx_export as gx

S = book_settings({**DEFAULT_SETTINGS, "swap_rate_long_pct": 7.9, "short_rate_verified": True}, "USD")
NV, AM = "NVIDIA CORP (CFD)", "AMBARELLA INC (CFD)"
def st(d, bal, real, opl, mg, pos, trades=()):
    return {"date": d, "account": {"account": "GTX0011-USD", "balance": bal, "open_pl": opl, "margin_req": mg,
                                   "today_realised": real}, "open_positions": pos, "trades": list(trades)}
def opn(inst, qty, px, dt, cur, profit, mg):
    return {"instrument": inst, "side": 1, "qty": qty, "open_px": px, "open_dt": dt, "current_px": cur,
            "profit": profit, "margin": mg, "account": "GTX0011-USD"}
def tr(inst, side, qty, px, dt, profit=0.0):
    return {"instrument": inst, "side": side, "qty": qty, "price": px, "dt": dt, "profit": profit}

r = replay([st("2026-11-11", 1377990.74, 0.0, 0.0, 0.0, []),
            st("2026-11-16", 1377659.88, -330.85, -2774.65, 90230.0,
               [opn(NV, 2000.0, 157.5624825, "2026-11-16T15:48:20.811", 156.65, -1824.96, 62660.0),
                opn(AM, 1000.0, 56.089685, "2026-11-16T16:55:29.628", 55.14, -949.68, 27570.0)],
               [tr(AM, 1, 1000.0, 56.089685, "2026-11-16T16:55:29.628"), tr(NV, 1, 2000.0, 157.5624825, "2026-11-16T15:48:20.811")]),
            st("2026-11-17", 1381267.29, 3607.41, -2127.68, 40155.0,
               [opn(AM, 1000.0, 56.089685, "2026-11-16T16:55:29.628", 53.54, -2549.68, 26770.0),
                opn(AM, 500.0, 52.696, "2026-11-17T17:04:20.090", 53.54, 422.0, 13385.0)],
               [tr(NV, -1, 1000.0, 160.0, "2026-11-17T17:43:08.571", 2437.51), tr(NV, -1, 1000.0, 159.0, "2026-11-17T17:43:08.571", 1437.51),
                tr(AM, 1, 500.0, 52.696, "2026-11-17T17:04:20.090")])], S)
assert r["recon_log"][-1]["ok"]
usd = {**r, "ccy": "USD"}
# synthetic older EUR lot to prove ordering across days + € format
eur = {"ccy": "EUR", "closed_positions": [
    {"instrument": "CORBION (CFD)", "side": -1, "qty": 2254.0, "open_px": 25.0, "open_dt": "2026-10-21T08:19:35",
     "close_px": 24.0, "close_dt": "2026-10-28T11:18:45", "gross": 2254.0, "open_fee": 140.875, "close_fee": 135.24,
     "swaps": 0.0, "net": 1977.885, "days_held": 7},
    {"instrument": "CORBION (CFD)", "side": 1, "qty": 100.0, "open_px": 20.0, "open_dt": "2026-10-28T11:00:00",
     "close_px": 21.0, "close_dt": "2026-10-28T12:00:00", "gross": 100.0, "open_fee": 5.0, "close_fee": 5.25,
     "swaps": 0.0, "net": 89.75, "days_held": 0}]}

wb = load_workbook(io.BytesIO(gx.build_workbook({"USD": usd, "EUR": eur}, "GTX0011-USD")))
assert wb.sheetnames == ["USD", "EUR", "GBP"]
hdr = [c.value for c in wb["USD"][4]]
assert hdr == ["Instrument", "Side", "Qty", "Opened", "Open px", "Closed", "Close px", "Gross P/L",
               "Open fee", "Close fee", "Swaps", "Net P/L", "Nights"], hdr

u = wb["USD"]
rows = [[c.value for c in row] for row in u.iter_rows(min_row=5, max_row=u.max_row - 1)]
assert len(rows) == len(r["closed_positions"]) == 2                  # NVIDIA 2 pieces
for x in rows:
    assert x[0] == "NVIDIA CORP" and x[1] == "BUY" and x[2] == 1000 and x[3] == datetime(2026, 11, 16, 15, 48, 20, 811000)
    assert abs(x[8] + 100.0) < 1e-9 and abs(x[9] + 100.0) < 1e-9     # $0.10/unit, shown negative
    assert abs(x[7] + x[8] + x[9] + x[10] - x[11]) < 1e-6            # net = gross − fees + swaps
    assert x[12] == 1
eng_net = sum(p["net"] for p in r["closed_positions"])
assert abs(sum(x[11] for x in rows) - eng_net) < 1e-9
tot = [c.value for c in u[u.max_row]]
assert tot[0] == "Total (2)" and tot[11] == "=SUM(L5:L6)"
assert u["H5"].number_format.startswith("$#,##0.00") and u["D5"].number_format == "dd-mm-yyyy hh:mm"

e = wb["EUR"]
assert e["H5"].number_format.startswith("€") and [e["D5"].value, e["D6"].value] == [datetime(2026, 10, 28, 11, 0), datetime(2026, 10, 21, 8, 19, 35)]
assert e["B6"].value == "SELL" and e["I6"].value == -140.875
g = wb["GBP"]
assert g["A5"].value == "No closed positions yet." and g["A4"].value == "Instrument"
print(f"USD {len(rows)} rows net {eng_net:,.2f} · EUR 2 rows · GBP empty")
print("CLOSED POSITIONS WORKBOOK ✓")
