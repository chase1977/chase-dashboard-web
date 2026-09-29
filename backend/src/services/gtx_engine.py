# backend/src/services/gtx_engine.py
"""
GlobalGTX reconciliation engine — stateless replay of daily statements.

Input : ordered list of parsed statements (see gtx_parser.parse_statement)
        + settings dict.
Output: summary KPIs, open lots, closed lots, per-night swap ledger,
        daily reconciliation log.

Broker rules (verified 29-09-2026 against CSV + 7 statements, exact to 1e-8):
  fee   = qty * fee_per_unit            (charged on open AND on close)
  swap  = qty * price * rate% / day_count, x3 on Friday
          charged if lot open at swap cutoff (17:00) that day
  gross = (close - open) * qty * side
Broker keeps full precision; statement DISPLAYS truncated 2dp.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, date
from decimal import Decimal, ROUND_DOWN

DEFAULT_SETTINGS = {
    "fee_per_unit": 0.05,
    "swap_rate_long_pct": 8.45145,
    "swap_rate_short_pct": 8.45145,      # UNVERIFIED — no short data yet
    "short_rate_verified": False,
    "day_count": 360,
    "swap_cutoff_hour": 17,
    "friday_multiplier": 3,
    "margin_pct": 50.0,
    "tolerance": 0.01,
}


# ── helpers ──────────────────────────────────────────────────────────
def trunc2(x: float) -> float:
    """Broker display convention: truncate toward zero at 2dp."""
    d = Decimal(repr(abs(x))).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    return float(d) if x >= 0 else -float(d)


def _d(iso: str) -> datetime:
    return datetime.fromisoformat(iso)


def _cutoff(d: date, hour: int) -> datetime:
    return datetime(d.year, d.month, d.day, hour)


# ── model ────────────────────────────────────────────────────────────
@dataclass
class Lot:
    lot_id: str
    instrument: str
    side: int
    qty: float
    open_px: float
    open_dt: str
    current_px: float | None = None
    close_px: float | None = None
    close_dt: str | None = None
    gross: float = 0.0            # realised gross (closed) — broker profit
    open_fee: float = 0.0
    close_fee: float = 0.0
    swaps: float = 0.0
    swap_ledger: list = field(default_factory=list)
    status: str = "open"

    def unrealised(self) -> float:
        if self.status != "open" or self.current_px is None:
            return 0.0
        return (self.current_px - self.open_px) * self.qty * self.side


def _lot_id(instrument: str, open_dt: str) -> str:
    return f"{instrument}|{open_dt}"


# ── engine ───────────────────────────────────────────────────────────
def replay(statements: list[dict], settings: dict | None = None) -> dict:
    """
    statements: [{"date": "YYYY-MM-DD", "account": {...},
                  "open_positions": [...], "trades": [...]}, ...]
    """
    s = {**DEFAULT_SETTINGS, **(settings or {})}
    stmts = sorted(statements, key=lambda x: x["date"])
    lots: dict[str, Lot] = {}
    log: list[dict] = []
    cash_events: list[dict] = []
    engine_bal = None
    prev_stmt_bal = None
    prev_date = None

    for st in stmts:
        d = date.fromisoformat(st["date"])
        acct = st["account"]
        warnings: list[str] = []
        fees_today = swaps_today = gross_today = 0.0
        swap_base = 0.0                       # Σ qty*price*mult for implied rate

        # gap check (weekday missing between statements)
        if prev_date is not None:
            gap = [x for x in range(1, (d - prev_date).days)
                   if date.fromordinal(prev_date.toordinal() + x).weekday() < 5]
            if gap:
                warnings.append(f"{len(gap)} weekday statement(s) missing before this date")

        # 1. opens — lots in Open Position Report not yet known
        today_ids = set()
        for p in st["open_positions"]:
            lid = _lot_id(p["instrument"], p["open_dt"])
            today_ids.add(lid)
            if lid not in lots:
                fee = p["qty"] * s["fee_per_unit"]
                lots[lid] = Lot(lid, p["instrument"], p["side"], p["qty"],
                                p["open_px"], p["open_dt"], open_fee=fee)
                if _d(p["open_dt"]).date() == d:
                    fees_today -= fee
                else:
                    warnings.append(f"Lot {p['instrument']} opened {p['open_dt'][:10]} first seen today")
            lots[lid].current_px = p["current_px"]

        # 2. closes — previously open lots now absent; match to Trades Report
        trades = list(st["trades"])
        used = set()
        for lid, lot in lots.items():
            if lot.status != "open" or lid in today_ids:
                continue
            best, best_err = None, None
            for i, t in enumerate(trades):
                if i in used or t["instrument"] != lot.instrument \
                        or t["side"] != -lot.side or abs(t["qty"] - lot.qty) > 1e-9:
                    continue
                err = abs((t["price"] - lot.open_px) * lot.qty * lot.side - t["profit"])
                if best is None or err < best_err:
                    best, best_err = i, err
            if best is None:
                warnings.append(f"Closed lot {lot.instrument} {lot.qty:,.0f} — no matching close in Trades Report")
                continue
            t = trades[best]; used.add(best)
            lot.status, lot.close_px, lot.close_dt = "closed", t["price"], t["dt"]
            lot.gross = (t["price"] - lot.open_px) * lot.qty * lot.side
            lot.close_fee = lot.qty * s["fee_per_unit"]
            lot.current_px = None
            fees_today -= lot.close_fee
            gross_today += lot.gross

        # 3. intraday round trips — open + close both inside today's trades
        rest = [(i, t) for i, t in enumerate(trades)
                if i not in used and not any(_lot_id(t["instrument"], t["dt"]) == k for k in today_ids)]
        opens_ = [(i, t) for i, t in rest if abs(t["profit"]) < 1e-9]
        closes_ = [(i, t) for i, t in rest if (i, t) not in opens_]
        for ci, c in closes_:
            match = next(((oi, o) for oi, o in opens_
                          if o["instrument"] == c["instrument"] and o["side"] == -c["side"]
                          and abs(o["qty"] - c["qty"]) < 1e-9 and oi not in used), None)
            if not match:
                warnings.append(f"Unmatched trade {c['instrument']} {c['dt']}")
                continue
            oi, o = match; used.update({oi, ci})
            lid = _lot_id(o["instrument"], o["dt"])
            fee = o["qty"] * s["fee_per_unit"]
            gross = (c["price"] - o["price"]) * o["qty"] * o["side"]
            lots[lid] = Lot(lid, o["instrument"], o["side"], o["qty"], o["price"], o["dt"],
                            close_px=c["price"], close_dt=c["dt"], gross=gross,
                            open_fee=fee, close_fee=fee, status="closed")
            fees_today -= 2 * fee
            gross_today += gross

        # 4. swaps — lots open at cutoff today
        cut = _cutoff(d, s["swap_cutoff_hour"])
        mult = s["friday_multiplier"] if d.weekday() == 4 else 1
        for lot in lots.values():
            if _d(lot.open_dt) > cut:
                continue
            if lot.close_dt and _d(lot.close_dt) <= cut:
                continue
            if lot.close_dt and _d(lot.close_dt).date() < d:
                continue
            px = lot.current_px if lot.status == "open" else lot.close_px
            est = lot.status != "open"
            if est:
                warnings.append(f"{lot.instrument} closed after cutoff — swap price estimated from close")
            rate = s["swap_rate_long_pct"] if lot.side == 1 else s["swap_rate_short_pct"]
            amt = -lot.qty * px * rate / 100 / s["day_count"] * mult
            lot.swaps += amt
            lot.swap_ledger.append({"date": d.isoformat(), "price": px, "mult": mult,
                                    "rate_pct": rate, "amount": amt, "estimated": est})
            swaps_today += amt
            swap_base += lot.qty * px * mult

        # 5. reconciliation
        eng_realised = fees_today + swaps_today + gross_today
        stmt_bal, stmt_real = acct["balance"], acct["today_realised"]
        cash = 0.0
        if prev_stmt_bal is None:
            cash = stmt_bal - stmt_real                    # opening capital
            engine_bal = 0.0
        else:
            cash = stmt_bal - prev_stmt_bal - stmt_real
            if abs(cash) < s["tolerance"]:
                cash = 0.0
        if cash:
            cash_events.append({"date": d.isoformat(), "amount": cash,
                                "type": "deposit" if cash > 0 else "withdrawal",
                                "opening": prev_stmt_bal is None})
        engine_bal += cash + eng_realised
        open_pl = sum(l.unrealised() for l in lots.values())
        margin = sum(l.qty * l.current_px * s["margin_pct"] / 100
                     for l in lots.values() if l.status == "open" and l.current_px)
        implied_swap = stmt_real - gross_today - fees_today
        implied_rate = (-implied_swap * s["day_count"] * 100 / swap_base) if swap_base else None

        checks = {
            "balance": trunc2(engine_bal) == stmt_bal,
            "realised": trunc2(eng_realised) == stmt_real,
            "open_pl": trunc2(open_pl) == acct["open_pl"],
            "margin": round(margin, 2) == acct["margin_req"],
        }
        log.append({
            "date": d.isoformat(),
            "stmt_balance": stmt_bal, "engine_balance": engine_bal,
            "balance_diff": trunc2(engine_bal) - stmt_bal,
            "stmt_realised": stmt_real, "engine_realised": eng_realised,
            "fees": fees_today, "swaps": swaps_today, "gross_closed": gross_today,
            "cash_flow": cash,
            "stmt_open_pl": acct["open_pl"], "engine_open_pl": open_pl,
            "stmt_margin": acct["margin_req"], "engine_margin": margin,
            "implied_swap": implied_swap, "implied_rate_pct": implied_rate,
            "checks": checks, "ok": all(checks.values()), "warnings": warnings,
        })
        prev_stmt_bal, prev_date = stmt_bal, d

    return _build_output(lots, log, cash_events, s)


def _build_output(lots, log, cash_events, s) -> dict:
    open_l = [l for l in lots.values() if l.status == "open"]
    closed = [l for l in lots.values() if l.status == "closed"]
    last = log[-1] if log else None

    starting = sum(c["amount"] for c in cash_events)
    balance = last["stmt_balance"] if last else 0.0
    open_pl = sum(l.unrealised() for l in open_l)
    fees_open = sum(l.open_fee for l in lots.values())
    fees_close = sum(l.close_fee for l in closed)
    sw_closed = sum(l.swaps for l in closed)
    sw_open = sum(l.swaps for l in open_l)
    wins = [l.gross for l in closed if l.gross > 0]
    losses = [l.gross for l in closed if l.gross <= 0]
    gross_real = sum(wins) + sum(losses)
    total_fees = fees_open + fees_close
    total_swaps = sw_closed + sw_open                       # negative
    net_realised_closed = gross_real - sum(l.open_fee + l.close_fee for l in closed) + sw_closed

    def lot_row(l: Lot) -> dict:
        r = asdict(l)
        r["days_held"] = len(l.swap_ledger)
        r["unrealised"] = l.unrealised()
        if l.status == "open":
            r["est_close_fee"] = l.qty * s["fee_per_unit"]
            r["net_if_closed"] = r["unrealised"] - l.open_fee - r["est_close_fee"] + l.swaps
            r["margin"] = l.qty * (l.current_px or 0) * s["margin_pct"] / 100
        else:
            r["net"] = l.gross - l.open_fee - l.close_fee + l.swaps
        return r

    summary = {
        "starting_balance": starting,
        "current_balance": balance,
        "open_pl": open_pl,
        "current_equity": balance + open_pl,
        "total_profit": sum(wins),
        "total_loss": sum(losses),
        "gross_realised": gross_real,
        "win_rate": (len(wins) / len(closed) * 100) if closed else None,
        "n_closed": len(closed), "n_open": len(open_l),
        "fees_total": total_fees, "fees_open": fees_open, "fees_close": fees_close,
        "swaps_total": -total_swaps, "swaps_closed": -sw_closed, "swaps_open": -sw_open,
        "total_costs": total_fees - total_swaps,
        "net_realised_closed": net_realised_closed,
        "running_realised": balance - starting,        # all realised incl. costs on open lots
        "net_pl_total": balance + open_pl - starting,
        "recon_ok": all(x["ok"] for x in log) if log else None,
        "last_statement": last["date"] if last else None,
        "last_implied_rate_pct": next((x["implied_rate_pct"] for x in reversed(log)
                                       if x["implied_rate_pct"] is not None), None),
    }
    return {
        "summary": summary,
        "open_positions": sorted((lot_row(l) for l in open_l), key=lambda r: r["open_dt"]),
        "closed_positions": sorted((lot_row(l) for l in closed), key=lambda r: r["close_dt"], reverse=True),
        "recon_log": log,
        "cash_events": cash_events,
        "settings": s,
    }
