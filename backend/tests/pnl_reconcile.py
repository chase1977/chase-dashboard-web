# backend/tests/pnl_reconcile.py
"""
Read-only diagnostic: why does Portfolio Total P&L differ by pennies from a
hand-summed figure? Prints, per strategy, the exact (unrounded) KPI inputs
and three ways of totalling P&L, so any 0.01-0.02 gap can be traced to the
strategy/rounding step causing it. Writes nothing.

Run from backend/ with the venv active:
    python tests\\pnl_reconcile.py
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.services import supabase_service as sb

pod_map = sb._build_pod_pfees_map()
hist    = sb.get_balance_history()
rows    = sb.get_strategies_with_kpis_fast(pod_pfees_map=pod_map, balance_hist=hist)
port    = sb.get_portfolio_kpis_fast(pod_map, hist, [])

print(f"{'Strategy':<22}{'Status':<9}{'Invested':>16}{'Equity':>16}{'Banked':>13}{'Card P&L':>14}{'Eq+Bk-Inv':>14}{'Card-diff':>11}")
s_inv = s_eq = s_bk = s_card = s_row = 0.0
for r in sorted(rows, key=lambda x: x["name"]):
    k = r["kpis"]
    inv, eq, bk, card = k["initial_investment"], k["current_equity"], k["banked_profit"], k["total_pnl"]
    row = eq + bk - inv
    s_inv += inv; s_eq += eq; s_bk += bk; s_card += card; s_row += round(row, 2)
    flag = "  <--" if abs(card - row) >= 0.005 else ""
    print(f"{r['name'][:21]:<22}{str(r.get('status',''))[:8]:<9}{inv:>16,.4f}{eq:>16,.4f}{bk:>13,.4f}{card:>14,.4f}{row:>14,.4f}{card-row:>11,.4f}{flag}")

print("\nTOTALS")
print(f"  Portfolio card Total P&L (dashboard)          {port['total_pnl']:>16,.2f}")
print(f"  = round(sum eq) + round(sum banked) - round(sum inv)")
print(f"      {round(s_eq,2):,.2f} + {round(s_bk,2):,.2f} - {round(s_inv,2):,.2f}")
print(f"  Sum of each strategy card's Total P&L         {s_card:>16,.2f}")
print(f"  Sum of each strategy's (Eq+Banked-Inv), 2dp   {s_row:>16,.2f}")
print(f"  Exact, unrounded (sum eq + sum bk - sum inv)  {s_eq + s_bk - s_inv:>16,.6f}")
