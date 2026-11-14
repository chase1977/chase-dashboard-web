# backend/src/services/kpi_snapshot_service.py
"""
Portfolio KPI snapshots — headline figures recorded per DATA date.

Table: portfolio_kpi_snapshots (sql/2026-11-14_portfolio_kpi_snapshots.sql)
       one row per (snapshot_date, level, entity_id); level = portfolio | pod | strategy.

Rules (14-11-2026, Nish):
  - snapshot_date is the DATA date (trade_date / Date / event_date /
    period_end_date), never the upload date. "Close of Thursday 12-11" =
    snapshot_date 2026-11-11 when the 12th's statements only arrive on the 13th.
  - Values come from the SAME engine as the live Portfolio page
    (get_portfolio_kpis_fast / get_pods_with_kpis_fast /
    get_strategies_with_kpis_fast), run inside supabase_service.as_of_context.
  - Nightly 23:30 Europe/London: recompute the last RECOMPUTE_WEEKDAYS
    weekdays, so late uploads (Fri data loaded Mon) land on their own date.
    Upsert -> re-runs overwrite, never duplicate.
  - Known limit: strategy/pod master data (status, pod, watermark,
    profit share) is current, not historical.

Public:
  compute_snapshot(as_of)                 -> list[row dict]   (no write)
  save_snapshots(dates, source)           -> summary dict
  run_nightly()                           -> summary dict
  list_snapshots(date_from, date_to, level)
  export_xlsx(date_from, date_to)         -> bytes
  start_scheduler()                       -> background thread (idempotent)
"""

import io
import os
import threading
import time
import zlib
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from src.services import supabase_service as sb

TABLE              = "portfolio_kpi_snapshots"
LONDON             = ZoneInfo("Europe/London")
RUN_AT             = (23, 30)          # London wall-clock
RECOMPUTE_WEEKDAYS = 10
LEVELS             = ("portfolio", "pod", "strategy")

KPI_COLS = (
    "initial_investment", "active_capital_invested", "capital_allocated",
    "current_equity", "total_pnl", "banked_profit", "banked_profit_true",
    "performance", "pct_1d", "pct_7d", "pct_30d",
)
_MONEY = {"initial_investment", "active_capital_invested", "capital_allocated",
          "current_equity", "total_pnl", "banked_profit", "banked_profit_true"}

_run_lock = threading.RLock()          # one as-of run at a time (nightly / manual / preview)
_scheduler_started = False


# ---------------------------------------------------------------------------
# Compute
# ---------------------------------------------------------------------------

def _entity_num(entity_id: str) -> int:
    """'strategy_12' -> 12, 'pod_3' -> 3; non-numeric keys (darwin_xyz) -> stable crc32."""
    tail = str(entity_id).rsplit("_", 1)[-1]
    return int(tail) if tail.isdigit() else zlib.crc32(str(entity_id).encode()) % 2_000_000_000


def _num(v, money: bool):
    if v is None:
        return None
    try:
        return round(float(v), 2 if money else 6)
    except (TypeError, ValueError):
        return None


def _row(as_of: str, level: str, entity_num: int, name: str, pod: Optional[str],
         status: Optional[str], kpis: dict, extra: dict) -> dict:
    r = {
        "snapshot_date": as_of,
        "level":         level,
        "entity_id":     entity_num,
        "entity_name":   name,
        "pod_name":      pod,
        "status":        status,
        "kpis_json":     {**kpis, **extra},
    }
    for c in KPI_COLS:
        r[c] = _num(kpis.get(c), c in _MONEY)
    return r


def compute_snapshot(as_of: str) -> list[dict]:
    """Portfolio + pod + strategy KPI rows as of the close of data date `as_of`. Reads only."""
    with _run_lock, sb.as_of_context(as_of) as d:
        try:
            pmap   = sb._build_pod_pfees_map()
            bh     = sb.get_balance_history()
            ce     = sb.get_capital_events()
            port   = sb.get_portfolio_kpis_fast(pod_pfees_map=pmap, balance_hist=bh, capital_evts=ce)
            pods   = sb.get_pods_with_kpis_fast(pod_pfees_map=pmap, balance_hist=bh)
            strats = sb.get_strategies_with_kpis_fast(pod_pfees_map=pmap, balance_hist=bh)
        finally:
            sb.purge_as_of_cache()

    pod_names = {p.get("pod_code"): p.get("name") for p in pods if p.get("pod_code")}
    rows = [_row(d, "portfolio", 0, "Chase Capital", None, None, port, {})]
    for p in pods:
        rows.append(_row(d, "pod", _entity_num(p["entity_id"]), p.get("name"), p.get("name"),
                         p.get("status"), p.get("kpis") or {},
                         {"entity_key": p["entity_id"], "pod_code": p.get("pod_code")}))
    for s in strats:
        rows.append(_row(d, "strategy", _entity_num(s["entity_id"]), s.get("name"),
                         pod_names.get(s.get("pod_code"), s.get("pod_code")), s.get("status"),
                         s.get("kpis") or {},
                         {"entity_key": s["entity_id"], "strategy_code": s.get("strategy_code"),
                          "pod_code": s.get("pod_code"), "has_data": s.get("has_data")}))
    return rows


# ---------------------------------------------------------------------------
# Save
# ---------------------------------------------------------------------------

def recent_weekdays(end: Optional[date] = None, n: int = RECOMPUTE_WEEKDAYS) -> list[str]:
    """Last n weekdays up to and including `end` (default: today London), oldest first."""
    d = end or datetime.now(LONDON).date()
    out: list[str] = []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d -= timedelta(days=1)
    return sorted(out)


def weekdays_between(date_from: str, date_to: str) -> list[str]:
    a, b = date.fromisoformat(date_from), date.fromisoformat(date_to)
    if b < a:
        a, b = b, a
    out, d = [], a
    while d <= b:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def save_snapshots(dates: list[str], source: str = "manual") -> dict:
    """Compute + upsert every date. One failed date never stops the others."""
    if source not in ("nightly", "manual", "backfill"):
        raise ValueError(f"bad source {source!r}")
    ok, failed = [], {}
    with _run_lock:
        for d in dates:
            try:
                rows = compute_snapshot(d)
                stamp = datetime.utcnow().isoformat() + "Z"
                for r in rows:
                    r["source"] = source
                    r["computed_at"] = stamp
                (sb.get_raw_client().table(TABLE)
                   .upsert(rows, on_conflict="snapshot_date,level,entity_id")
                   .execute())
                ok.append(d)
            except Exception as e:                      # noqa: BLE001 — log + continue
                failed[d] = f"{type(e).__name__}: {e}"
                print(f"[kpi_snapshot] {d} FAILED {failed[d]}")
    print(f"[kpi_snapshot] {source}: saved {len(ok)} date(s), failed {len(failed)}")
    return {"saved": ok, "failed": failed, "source": source}


def run_nightly() -> dict:
    return save_snapshots(recent_weekdays(), source="nightly")


# ---------------------------------------------------------------------------
# Read / export
# ---------------------------------------------------------------------------

def list_snapshots(date_from: Optional[str] = None, date_to: Optional[str] = None,
                   level: Optional[str] = None) -> list[dict]:
    out, start, page = [], 0, 1000
    while True:
        q = sb.get_raw_client().table(TABLE).select("*")
        if date_from:
            q = q.gte("snapshot_date", date_from)
        if date_to:
            q = q.lte("snapshot_date", date_to)
        if level:
            q = q.eq("level", level)
        rows = (q.order("snapshot_date", desc=False).order("id", desc=False)
                 .range(start, start + page - 1).execute().data or [])
        out.extend(rows)
        if len(rows) < page:
            break
        start += page
    lvl = {k: i for i, k in enumerate(LEVELS)}
    out.sort(key=lambda r: (r["snapshot_date"], lvl.get(r["level"], 9),
                            (r.get("pod_name") or ""), (r.get("entity_name") or "")))
    return out


_XLSX_COLS = [
    # header,                 key,                        width, format
    ("Data Date",             "snapshot_date",            12, "date"),
    ("Level",                 "level",                    11, None),
    ("Entity",                "entity_name",              30, None),
    ("Pod",                   "pod_name",                 18, None),
    ("Status",                "status",                   10, None),
    ("Capital Invested",      "initial_investment",       17, "money"),
    ("Active Capital Inv.",   "active_capital_invested",  17, "money"),
    ("Capital Allocated",     "capital_allocated",        17, "money"),
    ("Current Equity",        "current_equity",           17, "money"),
    ("Total P&L",             "total_pnl",                16, "money"),
    ("Banked P/L",            "banked_profit",            15, "money"),
    ("Banked P/L (True)",     "banked_profit_true",       16, "money"),
    ("Performance",           "performance",              12, "pct"),
    ("1D %",                  "pct_1d",                   9,  "pct"),
    ("7D %",                  "pct_7d",                   9,  "pct"),
    ("30D %",                 "pct_30d",                  9,  "pct"),
    ("Source",                "source",                   10, None),
    ("Computed (London)",     "computed_at",              18, "ts"),
]


def export_xlsx(date_from: Optional[str] = None, date_to: Optional[str] = None) -> bytes:
    """Workbook: README + Portfolio / Pods / Strategies sheets, one row per data date."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    rows = list_snapshots(date_from, date_to)
    wb = Workbook()
    head_fill = PatternFill("solid", fgColor="1F2937")
    head_font = Font(bold=True, color="FFFFFF")
    band_fill = PatternFill("solid", fgColor="F3F4F6")
    thin = Side(style="thin", color="D1D5DB")
    money_fmt = '#,##0.00;[Red]-#,##0.00'
    pct_fmt = '0.00%;[Red]-0.00%'

    info = wb.active
    info.title = "README"
    lines = [
        ("Chase Capital — Portfolio KPI Snapshots", True),
        (f"Range: {date_from or 'first'} → {date_to or 'latest'}   ·   Exported "
         f"{datetime.now(LONDON):%d-%m-%Y %H:%M} London", False),
        ("", False),
        ("Data Date = close of that data date (statement / trade date), never upload date.", False),
        ("Saved nightly 23:30 London; last 10 weekdays recomputed so late uploads update their own date.", False),
        ("Total P&L = Current Equity + Banked P/L − Capital Invested (same engine as Portfolio page).", False),
        ("Performance: portfolio = TWR; pod / strategy = Total P&L ÷ Capital Invested.", False),
        ("Strategy status / pod / watermark are current master data, not historical.", False),
    ]
    for i, (t, bold) in enumerate(lines, 1):
        info.cell(row=i, column=1, value=t).font = Font(bold=bold, size=14 if i == 1 else 11)
    info.column_dimensions["A"].width = 100

    for title, lvl in (("Portfolio", "portfolio"), ("Pods", "pod"), ("Strategies", "strategy")):
        ws = wb.create_sheet(title)
        for c, (h, _, w, _) in enumerate(_XLSX_COLS, 1):
            cell = ws.cell(row=1, column=c, value=h)
            cell.fill, cell.font = head_fill, head_font
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            ws.column_dimensions[get_column_letter(c)].width = w
        ws.row_dimensions[1].height = 30
        r_i, prev_date, band = 1, None, False
        for r in (x for x in rows if x["level"] == lvl):
            r_i += 1
            if r["snapshot_date"] != prev_date:
                band, prev_date = not band, r["snapshot_date"]
            for c, (_, key, _, fmt) in enumerate(_XLSX_COLS, 1):
                v = r.get(key)
                if fmt == "date" and v:
                    v = date.fromisoformat(str(v)[:10])
                elif fmt == "ts" and v:
                    v = (datetime.fromisoformat(str(v).replace("Z", "+00:00"))
                         .astimezone(LONDON).replace(tzinfo=None))
                elif fmt in ("money", "pct") and v is not None:
                    v = float(v)
                cell = ws.cell(row=r_i, column=c, value=v)
                cell.border = Border(bottom=thin)
                if band:
                    cell.fill = band_fill
                if fmt == "money":
                    cell.number_format = money_fmt
                elif fmt == "pct":
                    cell.number_format = pct_fmt
                elif fmt == "date":
                    cell.number_format = "dd-mm-yyyy"
                elif fmt == "ts":
                    cell.number_format = "dd-mm-yyyy hh:mm"
        ws.freeze_panes = "D2"
        ws.auto_filter.ref = f"A1:{get_column_letter(len(_XLSX_COLS))}{max(r_i, 1)}"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Scheduler — plain daemon thread, no extra dependency
# ---------------------------------------------------------------------------

def scheduler_enabled() -> bool:
    """KPI_SNAPSHOT_SCHEDULER=1/0 forces it; unset -> on only on Railway (never a local dev run)."""
    flag = os.getenv("KPI_SNAPSHOT_SCHEDULER")
    if flag is not None:
        return flag.strip() == "1"
    return bool(os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAILWAY_ENVIRONMENT_NAME"))


def next_run_after(now: datetime) -> datetime:
    """Next 23:30 London strictly after `now` (aware). DST-safe."""
    local = now.astimezone(LONDON)
    target = local.replace(hour=RUN_AT[0], minute=RUN_AT[1], second=0, microsecond=0)
    if target <= local:
        target = (local + timedelta(days=1)).replace(hour=RUN_AT[0], minute=RUN_AT[1],
                                                    second=0, microsecond=0)
    return target


def _loop() -> None:
    while True:
        try:
            nxt = next_run_after(datetime.now(LONDON))
            print(f"[kpi_snapshot] next nightly run {nxt:%Y-%m-%d %H:%M %Z}")
            while datetime.now(LONDON) < nxt:
                time.sleep(min(60, max(1, (nxt - datetime.now(LONDON)).total_seconds())))
            run_nightly()
        except Exception as e:                          # noqa: BLE001 — never kill the thread
            print(f"[kpi_snapshot] scheduler error {type(e).__name__}: {e}")
            time.sleep(300)


def start_scheduler() -> bool:
    """Start the nightly thread once per process. Returns True if running."""
    global _scheduler_started
    if _scheduler_started or not scheduler_enabled():
        return _scheduler_started
    threading.Thread(target=_loop, name="kpi-snapshot-nightly", daemon=True).start()
    _scheduler_started = True
    return True
