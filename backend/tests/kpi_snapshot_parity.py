# backend/tests/kpi_snapshot_parity.py
"""
LIVE parity check (reads Supabase, writes nothing). Needs backend/.env.
1. As-of a far-future date must equal the live Portfolio page to the cent
   (portfolio, every pod, every strategy) -> proves as-of mode = live engine.
2. Prints the headline KPIs as of a data date (default 2026-11-11).
Run from backend/:  python tests\\kpi_snapshot_parity.py [YYYY-MM-DD]
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv
load_dotenv()
from src.services import supabase_service as sb
from src.services import kpi_snapshot_service as snap

AS_OF = sys.argv[1] if len(sys.argv) > 1 else "2026-11-11"

pmap = sb._build_pod_pfees_map(); bh = sb.get_balance_history(); ce = sb.get_capital_events()
live = {("portfolio", 0): sb.get_portfolio_kpis_fast(pmap, bh, ce)}
for p in sb.get_pods_with_kpis_fast(pmap, bh):
    live[("pod", snap._entity_num(p["entity_id"]))] = p["kpis"]
for s in sb.get_strategies_with_kpis_fast(pmap, bh):
    live[("strategy", snap._entity_num(s["entity_id"]))] = s["kpis"]

far = {(r["level"], r["entity_id"]): r for r in snap.compute_snapshot("2099-12-31")}
assert set(far) == set(live), f"entity mismatch: {set(far) ^ set(live)}"
bad = []
for k, kp in live.items():
    for c in snap.KPI_COLS:
        a, b = snap._num(kp.get(c), c in snap._MONEY), far[k][c]
        if a != b:
            bad.append((k, c, a, b))
assert not bad, "PARITY FAIL:\n" + "\n".join(map(str, bad[:30]))
assert not any("@" in k for k in sb._cache), "as-of cache not purged"
print(f"PARITY ✓  {len(live)} rows (1 portfolio + pods + strategies) identical to live")

rows = snap.compute_snapshot(AS_OF)
p = rows[0]
print(f"\nCHASE CAPITAL as of close of data date {AS_OF}")
for lbl, c in (("Capital Invested (all-time)", "initial_investment"), ("Capital Invested (Active)", "active_capital_invested"),
               ("Capital Allocated", "capital_allocated"), ("Current Equity", "current_equity"),
               ("Total P&L", "total_pnl"), ("Banked P/L", "banked_profit"), ("Banked P/L (True)", "banked_profit_true")):
    print(f"  {lbl:<28}{p[c]:>18,.2f}")
print(f"  {'Performance (TWR)':<28}{p['performance'] * 100:>17.2f}%")
print("\nLIVE (now) for comparison:")
for c in ("current_equity", "total_pnl"):
    print(f"  {c:<28}{live[('portfolio', 0)][c]:>18,.2f}")
