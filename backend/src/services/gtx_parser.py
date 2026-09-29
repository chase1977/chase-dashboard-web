# backend/src/services/gtx_parser.py
"""
Parser for Global Trading X daily statement emails (pasted text).

Accepts either the whole email body or any single section. Each section is
located by its header row, so one paste box or three separate boxes both work.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

DT_FMT_MS = "%d-%m-%Y %H:%M:%S.%f"
DT_FMT = "%d-%m-%Y %H:%M:%S"
NO_DATA = "there is no data available"

ACCOUNT_HDR = ("account name", "balance")
OPEN_HDR = ("account", "instrument", "amount", "open price")
TRADES_HDR = ("account", "instrument", "operation", "date")


# ── helpers ──────────────────────────────────────────────────────────
def _cells(line: str) -> list[str]:
    """Split a pasted table row: tabs first, fallback 2+ spaces."""
    parts = line.split("\t") if "\t" in line else re.split(r"\s{2,}", line)
    return [p.strip() for p in parts if p.strip() != ""]


def _num(s: str) -> float:
    return float(s.replace(",", "").strip())


def _dt(s: str) -> datetime:
    s = s.strip()
    return datetime.strptime(s, DT_FMT_MS if "." in s else DT_FMT)


def _find_header(lines: list[str], keys: tuple[str, ...]) -> Optional[int]:
    for i, ln in enumerate(lines):
        c = [x.lower() for x in _cells(ln)]
        if len(c) >= len(keys) and tuple(c[: len(keys)]) == keys:
            return i
    return None


def _rows_after(lines: list[str], hdr_idx: int, n_cols: int) -> list[list[str]]:
    """Collect data rows after header until blank line / next section."""
    rows = []
    for ln in lines[hdr_idx + 1:]:
        if not ln.strip():
            if rows:
                break
            continue
        if NO_DATA in ln.lower():
            break
        c = _cells(ln)
        if len(c) < n_cols:
            break
        rows.append(c)
    return rows


# ── section parsers ──────────────────────────────────────────────────
def parse_account(text: str, currency: str = "USD") -> Optional[dict]:
    lines = text.splitlines()
    h = _find_header(lines, ACCOUNT_HDR)
    if h is None:
        return None
    hdr = [x.lower() for x in _cells(lines[h])]
    col = {name: i for i, name in enumerate(hdr)}
    for r in _rows_after(lines, h, len(hdr)):
        if r[col["account currency"]].upper() != currency:
            continue
        return {
            "account": r[col["account name"]],
            "balance": _num(r[col["balance"]]),
            "open_pl": _num(r[col["open gross p/l"]]),
            "projected_balance": _num(r[col["projected balance"]]),
            "available_funds": _num(r[col["available funds"]]),
            "margin_req": _num(r[col["initial margin req"]]),
            "today_realised": _num(r[col["today's realized p/l"]]),
            "currency": currency,
        }
    return None


def parse_open_positions(text: str) -> list[dict]:
    lines = text.splitlines()
    h = _find_header(lines, OPEN_HDR)
    if h is None:
        return []
    out = []
    for r in _rows_after(lines, h, 10):
        out.append({
            "account": r[0],
            "instrument": r[1],
            "qty": _num(r[2]),
            "open_px": _num(r[3]),
            "side": 1 if r[4].lower() == "buy" else -1,
            "open_dt": _dt(r[5]).isoformat(timespec="milliseconds"),
            "current_px": _num(r[6]),
            "profit": _num(r[7]),
            "currency": r[8],
            "margin": _num(r[9]),
        })
    return out


def parse_trades(text: str) -> list[dict]:
    lines = text.splitlines()
    h = _find_header(lines, TRADES_HDR)
    if h is None:
        return []
    out = []
    for r in _rows_after(lines, h, 7):
        out.append({
            "account": r[0],
            "instrument": r[1],
            "side": 1 if r[2].lower() == "buy" else -1,
            "dt": _dt(r[3]).isoformat(timespec="milliseconds"),
            "price": _num(r[4]),
            "qty": _num(r[5]),
            "profit": _num(r[6]),
        })
    return out


def parse_statement(text: str, currency: str = "USD") -> dict:
    """Full parse. Raises ValueError if account row missing."""
    acct = parse_account(text, currency)
    if acct is None:
        raise ValueError("Account Statement Report row not found for " + currency)
    return {
        "account": acct,
        "open_positions": parse_open_positions(text),
        "trades": parse_trades(text),
    }
