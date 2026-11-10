# backend/src/services/gtx_books.py
"""
GlobalGTX multi-currency books (2026-10-13).

The GTX login holds one sub-account per currency (USD / EUR / GBP), each
with its own balance, realised P/L, margin, fees and swap rates. Each
statement is split per currency (gtx_parser.parse_statement_books) and every
currency is replayed independently by the existing, unchanged gtx_engine —
so the USD book is byte-for-byte what it was before multi-currency support.

Settings: the top-level gtx_settings are the USD book. Other books use the
same values except swap_rate_schedule (starts empty — each currency's rate
history is its own), then BOOK_DEFAULTS[CCY] (broker-confirmed terms), then
settings["books"][CCY] saved from the Settings modal, e.g.
  {"EUR": {"fee_per_unit": 0.05, "swap_rate_long_pct": 6.0, "verified": false}}
"verified" = the book's fee/swap rules have been confirmed (CSV / broker);
until then the tab flags the book.
"""
from __future__ import annotations

try:                                   # package import (app) / flat import (tests)
    from src.services.gtx_engine import replay
    from src.services.gtx_parser import parse_statement_books, BOOK_ORDER
except ImportError:                    # pragma: no cover
    from gtx_engine import replay
    from gtx_parser import parse_statement_books, BOOK_ORDER

SYMBOL = {"USD": "$", "EUR": "€", "GBP": "£"}

# Broker-confirmed terms (Ben, InvestGTX, 14-10-2026) — code defaults for the
# non-USD books; anything saved in Settings → EUR / GBP overrides them.
#   Swap  : long = reference + 4% markup. Short (Ben, 06-11-2026): if the
#           reference rate is ABOVE the 4% charge rate the short is credited
#           the difference; if below, no charge and no credit → short charge
#           rate = min(0, 4 − ref) = 0 at today's USD/EUR/GBP references
#           (confirmed: Flutter short 03→04-11 charged nothing). % p.a. / 360.
#           USD ref 3.9 → 7.9% · EUR ref 2.429 → 6.429% · GBP ref 3.733 → 7.733%
#   Fee   : 0.25% of notional each way (50bps round trip).
#   EUR history (from the operations CSV + statements): 12-10 charged 7.875%;
#   13-10 charged 4.858% (broker mis-set, Ben 14-10); 6.429% from 14-10.
SWAP_MARKUP_PCT = 4.0
BOOK_DEFAULTS = {
    "EUR": {
        "fee_mode": "pct_notional", "fee_pct": 0.25,
        "swap_rate_long_pct": 7.875, "swap_rate_short_pct": 0.0,
        "swap_rate_schedule": [
            {"from": "2026-10-13", "long_pct": 4.858, "short_pct": 0.0},
            {"from": "2026-10-14", "long_pct": 6.429, "short_pct": 0.0},
        ],
        "verified": True,
    },
    "GBP": {
        "fee_mode": "pct_notional", "fee_pct": 0.25,
        "swap_rate_long_pct": 7.733, "swap_rate_short_pct": 0.0,
        "swap_rate_schedule": [],
        "verified": True,
    },
}


# Broker re-bookings of closed trades, per book (engine docstring). Verified
# against the operations CSV (14-10-2026): CSV books CHIPOTLE at CP=31.52197
# (+3,842.50); the 08-10 statement showed 32.521965 (+8,842.47); 08-10 → 09-10
# balance fell 4,999.98 more than 09-10 "Today's realized P/L".
# Used while the book's settings hold no "trade_corrections" of their own.
BOOK_CORRECTIONS = {
    "USD": [
        {"instrument": "CHIPOLTE MEXICAN (CFD)", "open_dt": "2026-10-05T13:43", "close_px": 31.52197,
         "booked": "2026-10-09", "note": "Broker re-booked close (CSV 07-10 19:00, CP 31.52197)"},
        # ABIVAX 1,000 @ 86.50 (06-11 17:02:54) left the 09-11 statement with no
        # trade and no P/L; broker system fault, rebooked 10-11 (Ben). Operations
        # CSV 10-11: order 35444 sold BOTH lots at 87.38138 — +881.38 and a $60
        # fee for this one. Balance moves on the next statement after 09-11.
        {"kind": "missing_close", "instrument": "ABIVAX (CFD)", "open_dt": "2026-11-06T17:02", "open_px": 86.5,
         "close_px": 87.38138, "close_dt": "2026-11-09T15:32:45.000", "stmt_date": "2026-11-09",
         "note": "Broker booked this close late (ops CSV 10-11, order 35444: +881.38, fee 60)"},
    ],
}


def _corr_key(c: dict) -> tuple:
    return (c.get("kind", "reprice"), c.get("instrument"), (c.get("open_dt") or "").replace(" ", "T")[:16],
            c.get("open_px"), c.get("booked") or c.get("stmt_date"))


# Instruments whose broker terms differ from their book (engine
# "instrument_terms"). ABIVAX (USD book, 14→15-10-2026): its open and its
# close each cost exactly $300.00 on top of every other reconciled item
# (14-10 −447.70 = −147.71 book swaps −300.00; 15-10 close −300.00) — i.e.
# $0.06/unit fee and no overnight swap — confirmed by the operations CSV
# (21-10-2026: "Fee per unit=0.06", no ABIVAX swap rows).
BOOK_INSTRUMENT_TERMS = {
    "USD": {"ABIVAX (CFD)": {"fee_per_unit": 0.06, "swap_long_pct": 0.0,
                             "note": "Confirmed by operations CSV 21-10-2026: Fee per unit=0.06, no swap rows"}},
}


def book_settings(settings: dict, ccy: str) -> dict:
    """Effective engine settings for one currency book."""
    if ccy == "USD":
        out = dict(settings)
    else:
        override = (settings.get("books") or {}).get(ccy) or {}
        out = {**settings, "swap_rate_schedule": [], "short_rate_verified": False, "trade_corrections": None,
               "instrument_terms": None,
               **BOOK_DEFAULTS.get(ccy, {}), **override}
    # Saved corrections (⚙ Settings) + any known broker correction not in them —
    # a list saved before a new code default existed must not hide it.
    saved = [dict(c) for c in (out.get("trade_corrections") or [])]
    have = {_corr_key(c) for c in saved}
    out["trade_corrections"] = saved + [dict(c) for c in BOOK_CORRECTIONS.get(ccy, []) if _corr_key(c) not in have]
    if out.get("instrument_terms") is None:
        out["instrument_terms"] = {k: dict(v) for k, v in BOOK_INSTRUMENT_TERMS.get(ccy, {}).items()}
    return out


def _active(stmts: list[dict]) -> bool:
    """A book is shown once it has ever had a balance, a position or a trade."""
    return any(abs(s["account"]["balance"]) > 1e-9 or s["open_positions"] or s["trades"] for s in stmts)


def replay_books(statements: list[dict], settings: dict) -> dict:
    """
    statements: [{"date": "YYYY-MM-DD", "text": raw statement text}, ...]
    Returns {"books": [ {ccy, symbol, verified, **engine output}, ... ] in
    BOOK_ORDER (USD always first), "recon_ok": bool}.
    """
    per: dict[str, list[dict]] = {}
    for st in sorted(statements, key=lambda x: x["date"]):
        for ccy, book in parse_statement_books(st["text"]).items():
            per.setdefault(ccy, []).append({"date": st["date"], **book})
    per.setdefault("USD", [])  # USD always present (empty → "no statements yet")
    order = [c for c in BOOK_ORDER if c in per] + sorted(c for c in per if c not in BOOK_ORDER)
    books = []
    for ccy in order:
        stmts = per[ccy]
        if ccy != "USD" and not _active(stmts):
            continue
        s = book_settings(settings, ccy)
        out = replay(stmts, s)
        books.append({
            "ccy": ccy, "symbol": SYMBOL.get(ccy, ccy + " "),
            "verified": True if ccy == "USD" else bool(s.get("verified")),
            **out,
        })
    return {"books": books, "recon_ok": all(b["summary"]["recon_ok"] is not False for b in books)}
