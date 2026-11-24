# backend/src/services/gtx_export.py
"""
GlobalGTX Closed Positions → Excel workbook (2026-11-24, Nish).

One sheet per currency book — USD, EUR, GBP — always all three, so the GBP
sheet is there (empty) until that book opens and then fills automatically.
Rows and figures are exactly the Closed Positions table on the GlobalGTX tab
(same engine output, `book["closed_positions"]`, one row per lot / partial
piece), with the same columns and sign convention:

  Instrument | Side | Qty | Opened | Open px | Closed | Close px | Gross P/L |
  Open fee | Close fee | Swaps | Net P/L | Nights

  - Instrument without the " (CFD)" suffix; Side BUY / SELL.
  - Open fee / Close fee shown negative, Swaps as booked, Net = Gross −
    fees + swaps — full precision in the cell, 2dp display (sums tie to the
    table total and the Daily Booked P/L card).
  - Opened / Closed are real Excel date-times (dd-mm-yyyy hh:mm display,
    seconds kept in the value).
  - Order: open time latest → oldest (then close time latest → oldest).

Public: export_closed_xlsx(account) -> bytes
"""
import io
from datetime import datetime
from zoneinfo import ZoneInfo

from src.services import gtx_service as svc

BOOKS = ("USD", "EUR", "GBP")
SYMBOL = {"USD": "$", "EUR": "€", "GBP": "£"}
LONDON = ZoneInfo("Europe/London")

COLS = [
    # header,      width, kind
    ("Instrument", 30, "text"),
    ("Side",        8, "text"),
    ("Qty",        12, "qty"),
    ("Opened",     18, "dt"),
    ("Open px",    14, "px"),
    ("Closed",     18, "dt"),
    ("Close px",   14, "px"),
    ("Gross P/L",  15, "money"),
    ("Open fee",   13, "money"),
    ("Close fee",  13, "money"),
    ("Swaps",      13, "money"),
    ("Net P/L",    15, "money"),
    ("Nights",      8, "int"),
]
MONEY_COLS = ("Gross P/L", "Open fee", "Close fee", "Swaps", "Net P/L")


def _short(inst: str) -> str:
    s = (inst or "").strip()
    return s[:-5].rstrip() if s.upper().endswith("(CFD)") else s


def _dt(iso):
    if not iso:
        return None
    return datetime.fromisoformat(str(iso).replace(" ", "T")[:26])


def closed_rows(book: dict) -> list[dict]:
    """Closed Positions rows for one book, in export order and table sign convention."""
    rows = sorted(book.get("closed_positions") or [],
                  key=lambda r: (str(r.get("open_dt") or ""), str(r.get("close_dt") or "")), reverse=True)
    out = []
    for r in rows:
        out.append({
            "Instrument": _short(r.get("instrument")),
            "Side":       "BUY" if r.get("side") == 1 else "SELL",
            "Qty":        float(r.get("qty") or 0),
            "Opened":     _dt(r.get("open_dt")),
            "Open px":    r.get("open_px"),
            "Closed":     _dt(r.get("close_dt")),
            "Close px":   r.get("close_px"),
            "Gross P/L":  float(r.get("gross") or 0),
            "Open fee":   -float(r.get("open_fee") or 0),
            "Close fee":  -float(r.get("close_fee") or 0),
            "Swaps":      float(r.get("swaps") or 0),
            "Net P/L":    float(r.get("net") or 0),
            "Nights":     int(r.get("days_held") or 0),
        })
    return out


def build_workbook(books: dict, account: str) -> bytes:
    """books: {ccy: book dict or None}. Returns .xlsx bytes."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    head_fill = PatternFill("solid", fgColor="1F2937")
    tot_fill = PatternFill("solid", fgColor="E5E7EB")
    band_fill = PatternFill("solid", fgColor="F9FAFB")
    thin = Side(style="thin", color="D1D5DB")
    stamp = datetime.now(LONDON).strftime("%d-%m-%Y %H:%M")
    base = account.rsplit("-", 1)[0]

    wb = Workbook()
    wb.remove(wb.active)
    for ccy in BOOKS:
        sym = SYMBOL[ccy]
        money_fmt = f'{sym}#,##0.00;[Red]-{sym}#,##0.00;{sym}0.00'
        ws = wb.create_sheet(ccy)
        book = books.get(ccy)
        rows = closed_rows(book) if book else []

        ws["A1"] = f"GlobalGTX · {ccy} book · Closed Positions"
        ws["A1"].font = Font(bold=True, size=14)
        ws["A2"] = (f"Account {base}-{ccy}  ·  {len(rows)} closed position(s)  ·  open time latest → oldest  ·  "
                    f"exported {stamp} London")
        ws["A2"].font = Font(size=10, color="6B7280")

        hr = 4
        for c, (h, w, kind) in enumerate(COLS, 1):
            cell = ws.cell(row=hr, column=c, value=h)
            cell.fill, cell.font = head_fill, Font(bold=True, color="FFFFFF")
            cell.alignment = Alignment(horizontal="left" if kind in ("text", "dt") else "right", vertical="center")
            ws.column_dimensions[get_column_letter(c)].width = w
        ws.row_dimensions[hr].height = 22

        r_i = hr
        for i, row in enumerate(rows):
            r_i += 1
            for c, (h, _, kind) in enumerate(COLS, 1):
                cell = ws.cell(row=r_i, column=c, value=row[h])
                cell.border = Border(bottom=thin)
                if i % 2:
                    cell.fill = band_fill
                if kind == "money":
                    cell.number_format = money_fmt
                elif kind == "dt":
                    cell.number_format = "dd-mm-yyyy hh:mm"
                    cell.alignment = Alignment(horizontal="left")
                elif kind == "qty":
                    cell.number_format = "#,##0.##"
                elif kind == "px":
                    cell.number_format = "0.00######"
                elif kind == "int":
                    cell.number_format = "0"
                if h == "Side":
                    cell.font = Font(bold=True, color="059669" if row[h] == "BUY" else "DC2626")
                if h == "Net P/L":
                    cell.font = Font(bold=True)

        if rows:
            t = r_i + 1
            ws.cell(row=t, column=1, value=f"Total ({len(rows)})").font = Font(bold=True)
            for c, (h, _, kind) in enumerate(COLS, 1):
                ws.cell(row=t, column=c).fill = tot_fill
                if h in MONEY_COLS:
                    L = get_column_letter(c)
                    cell = ws.cell(row=t, column=c, value=f"=SUM({L}{hr + 1}:{L}{r_i})")
                    cell.number_format, cell.font = money_fmt, Font(bold=True)
            ws.auto_filter.ref = f"A{hr}:{get_column_letter(len(COLS))}{r_i}"
        else:
            ws.cell(row=hr + 1, column=1, value="No closed positions yet.").font = Font(italic=True, color="6B7280")
        ws.freeze_panes = ws.cell(row=hr + 1, column=2)
        ws.sheet_view.showGridLines = False

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def export_closed_xlsx(account: str = svc.DEFAULT_ACCOUNT) -> bytes:
    """Replay every saved statement (same as the tab) and export Closed Positions per book."""
    state = svc.get_state(account)
    books = {b["ccy"]: b for b in state.get("books") or []}
    return build_workbook(books, account)
