# backend/src/services/oanda_service.py
"""
OANDA FX rate service — GBP/USD monthly-close candle lookups.

Used to convert USD-denominated fund statements (e.g. 12-FLAGS' Cayman NAV
administrator statement) to GBP for the Capital & Performance Overview.
The practice/demo API's pricing feed mirrors live market data, so it is
safe to use for historical monthly-close rates even though the account
itself is a demo account (no trading is ever placed on it — read-only
candle lookups only).

Credentials: read from environment variables (OANDA_TOKEN / OANDA_API_URL)
with a fallback to the practice values Nish supplied inline, so this works
out of the box. For production, set these in the backend's real
environment (.env / Railway config vars) instead of relying on the
fallback — never commit real secrets to source control.
"""

import os
from datetime import date, datetime, timedelta
from typing import Optional

import requests

OANDA_TOKEN   = os.environ.get(
    "OANDA_TOKEN",
    "37ee33b35f88e073a08d533849f7a24b-524c89ef15f36cfe532f0918a6aee4c2",
)
OANDA_API_URL = os.environ.get("OANDA_API_URL", "https://api-fxpractice.oanda.com/v3")
DEFAULT_PAIR  = "GBP_USD"   # 1 GBP = rate USD — matches the convention implied by
                            # the 12-FLAGS Ebury deposit (£485,981.31 / $650,000 ≈ 1.3376)


def get_monthly_close(period_end: date, instrument: str = DEFAULT_PAIR) -> Optional[dict]:
    """
    Fetch the FX rate for a statement's period end — the DAILY candle on (or,
    for a weekend/holiday period end, the last trading day before) that date.

    This is what "monthly close" actually means for FX reporting purposes —
    the rate on the last day of the period — and it's far more reliable than
    asking OANDA for an actual granularity="M" monthly candle: OANDA anchors
    monthly candles to its own broker-day boundary (~21:00-22:00 UTC,
    DST-dependent) and adjacent from/to month windows can straddle that
    boundary and silently return the SAME candle for two different months
    (confirmed happening here — two different 2026 period ends both came
    back "1.3484, 30-06-2026 close"). Daily granularity has no such boundary
    ambiguity: count=1&to=<period_end + 1 day> unambiguously returns the one
    trading day at or immediately before period_end.

    Returns {"rate": float, "candle_date": "YYYY-MM-DD", "instrument": str,
    "stale": bool} where rate is the GBP_USD close (1 GBP = rate USD) —
    convert USD -> GBP as gbp = usd / rate. "stale" is True when the candle
    returned is more than 10 days from period_end (daily candles should
    normally land within a few days, accounting for weekends) — this can
    still happen if period_end is a future date relative to OANDA's
    real-world market data: OANDA can only ever return its most recent REAL
    candle, so a genuinely future-dated period silently gets today's rate
    instead of a period-matching one. Callers should surface "stale" rather
    than presenting the rate as the true period-end close.

    Returns None on any failure (network, auth, no candle at all). Caller
    should persist fx_rate = null and allow a manual retry rather than
    block the statement entry itself.
    """
    params = {
        "granularity": "D",   # candle size: daily — see docstring for why not "M"
        "price":       "M",   # pricing type: midpoint (not bid/ask)
        "count":       1,
        "to":          f"{(period_end + timedelta(days=1)).isoformat()}T00:00:00Z",
    }
    url     = f"{OANDA_API_URL}/instruments/{instrument}/candles"
    headers = {"Authorization": f"Bearer {OANDA_TOKEN}"}

    try:
        resp = requests.get(url, params=params, headers=headers, timeout=10.0)
        resp.raise_for_status()
        candles = resp.json().get("candles") or []
        if not candles:
            return None
        candle = candles[-1]
        # OANDA's daily candle "time" is its OPEN timestamp in UTC, and the
        # broker day opens ~21:00-22:00 UTC the evening before (5pm New York
        # convention) — so a naive [:10] truncation labels the candle one
        # calendar day earlier than the trading day it actually represents
        # (e.g. Friday 31-07's close came back timestamped "2026-07-30").
        # +6h nudges any evening-UTC open past midnight into the correct
        # trading-day date without affecting candles that already open
        # during the UTC day.
        # OANDA returns nanosecond precision ("...21:00:00.000000000Z"),
        # which fromisoformat can't parse on Python < 3.11 — we only need
        # whole-second precision here, so strip the fractional part first.
        time_str    = candle["time"].split(".")[0] + "+00:00"
        candle_dt   = datetime.fromisoformat(time_str) + timedelta(hours=6)
        candle_date = candle_dt.date().isoformat()
        stale       = abs((date.fromisoformat(candle_date) - period_end).days) > 10
        return {
            "rate":        float(candle["mid"]["c"]),
            "candle_date": candle_date,
            "instrument":  instrument,
            "stale":       stale,
        }
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Live / per-day conversion rate — USD daily-feed entries (INVESTGTX), 2026-09-30
# ---------------------------------------------------------------------------

def get_latest_minute_close(instrument: str = DEFAULT_PAIR) -> Optional[dict]:
    """
    Close of the most recent COMPLETE 1-minute GBP_USD midpoint candle.

    count=2 because OANDA's newest M1 candle is usually still forming
    (complete=False) — take the last one flagged complete. Returns
    {"rate", "rate_at" (ISO UTC, candle open), "instrument"} or None on any
    failure (caller must block the save, never guess a rate).
    """
    params  = {"granularity": "M1", "price": "M", "count": 2}
    url     = f"{OANDA_API_URL}/instruments/{instrument}/candles"
    headers = {"Authorization": f"Bearer {OANDA_TOKEN}"}
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=10.0)
        resp.raise_for_status()
        candles = [c for c in (resp.json().get("candles") or []) if c.get("complete")]
        if not candles:
            return None
        candle = candles[-1]
        rate_at = candle["time"].split(".")[0] + "+00:00"
        return {"rate": float(candle["mid"]["c"]), "rate_at": rate_at, "instrument": instrument}
    except Exception:
        return None


def get_conversion_rate(trade_date: date, instrument: str = DEFAULT_PAIR) -> Optional[dict]:
    """
    Rate used to convert a USD daily-feed entry to GBP (Nish, 2026-09-30):
      trade_date today (or later) -> live: last complete 1-minute candle close
      trade_date in the past      -> that day's GBP_USD daily close

    Returns {"rate", "source": "minute"|"daily", "rate_at" (ISO UTC or None),
    "candle_date" (YYYY-MM-DD), "stale": bool} or None on failure.
    gbp = usd / rate  (rate = USD per 1 GBP).
    """
    if trade_date >= datetime.utcnow().date():
        m = get_latest_minute_close(instrument)
        if not m:
            return None
        return {"rate": m["rate"], "source": "minute", "rate_at": m["rate_at"],
                "candle_date": m["rate_at"][:10], "stale": False}
    d = get_daily_close(trade_date, instrument)
    if not d:
        return None
    return {"rate": d["rate"], "source": "daily", "rate_at": None,
            "candle_date": d["candle_date"], "stale": d["stale"]}


def get_daily_close(trade_date: date, instrument: str = DEFAULT_PAIR) -> Optional[dict]:
    """
    GBP_USD daily close FOR trade_date itself (or the last trading day before
    it, for a weekend/holiday date).

    OANDA daily candles run 17:00 New York -> 17:00 New York, so trading day D
    OPENS at ~21:00/22:00 UTC on D-1. Asking for count=1 with to=D 12:00 UTC
    returns exactly the candle that opened the evening before and closes on D.
    (to=D+1 00:00 UTC — what get_monthly_close uses — returns the candle that
    opened on D's evening, i.e. D+1's close: one day late. Found 2026-09-30:
    23-09 came back as the 24-09 candle.)
    """
    params = {
        "granularity": "D", "price": "M", "count": 1,
        "to": f"{trade_date.isoformat()}T12:00:00Z",
    }
    url     = f"{OANDA_API_URL}/instruments/{instrument}/candles"
    headers = {"Authorization": f"Bearer {OANDA_TOKEN}"}
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=10.0)
        resp.raise_for_status()
        candles = resp.json().get("candles") or []
        if not candles:
            return None
        candle    = candles[-1]
        opened    = datetime.fromisoformat(candle["time"].split(".")[0] + "+00:00")
        close_day = (opened + timedelta(hours=6)).date()      # evening-UTC open -> next calendar day
        return {
            "rate":        float(candle["mid"]["c"]),
            "candle_date": close_day.isoformat(),
            "instrument":  instrument,
            "stale":       abs((close_day - trade_date).days) > 4,
        }
    except Exception:
        return None
