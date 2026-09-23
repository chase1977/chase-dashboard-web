# backend/src/services/excel_writer.py
"""
Excel writer for AXIA statement extraction output.

Multi-account fix (2026-09-23): CLIENT and ACCOUNT columns added (B, C) so
a workbook holding multiple accounts (common -- one PDF can contain several,
see statement_service.py) keeps every row correctly attributed, and the
TOTALS block is grouped by (ACCOUNT, CURRENCY) instead of CURRENCY alone --
summing across accounts in one subtotal would silently mix two different
books' numbers back together, exactly the bug this whole fix removes.

Column layout:
  A: TRADE DATE       B: CLIENT               C: ACCOUNT
  D: DELIVERY/PRODUCT E: LONG                  F: SHORT
  G: REALIZED PnL     H: COMMISION FEES        I: MARKET FEES
  J: NFA FEES         K: TOTAL COMMS (formula) L: TOTAL PnL (formula)
  M: CURRENCY
"""

from io import BytesIO
from pathlib import Path
from typing import Optional

import openpyxl
from openpyxl.styles import (
    Font, PatternFill, Alignment, Border, Side,
)
from openpyxl.utils import get_column_letter


# ---------------------------------------------------------------------------
# Style constants
# ---------------------------------------------------------------------------

_HEADER_FILL   = PatternFill("solid", fgColor="1F3864")
_HEADER_FONT   = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
_HEADER_ALIGN  = Alignment(horizontal="center", vertical="center", wrap_text=True)

_ROW_FILL_ODD  = PatternFill("solid", fgColor="F2F2F2")
_ROW_FILL_EVEN = PatternFill("solid", fgColor="FFFFFF")
_ROW_FONT      = Font(name="Calibri", size=10)

_TOTAL_FILL    = PatternFill("solid", fgColor="D9E1F2")
_TOTAL_FONT    = Font(name="Calibri", bold=True, size=10)

_SECTION_FONT  = Font(name="Calibri", bold=True, size=11, color="1F3864")

_THIN   = Side(style="thin", color="BFBFBF")
_BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)

_FMT_DATE  = "DD-MMM-YYYY"
_FMT_INT   = "#,##0"
_FMT_NUM2  = "#,##0.00;[RED]-#,##0.00"


# ---------------------------------------------------------------------------
# Column definitions
# ---------------------------------------------------------------------------

COLUMNS = [
    ("TRADE DATE",          14, "center", _FMT_DATE),
    ("CLIENT",               9, "center", "@"),
    ("ACCOUNT",              9, "center", "@"),
    ("DELIVERY / PRODUCT",  26, "left",   "@"),
    ("LONG",                 9, "center", _FMT_INT),
    ("SHORT",                9, "center", _FMT_INT),
    ("REALIZED PnL",        14, "right",  _FMT_NUM2),
    ("COMMISION FEES",      14, "right",  _FMT_NUM2),
    ("MARKET FEES",         12, "right",  _FMT_NUM2),
    ("NFA FEES",            11, "right",  _FMT_NUM2),
    ("TOTAL COMMS",         12, "right",  _FMT_NUM2),
    ("TOTAL PnL",           12, "right",  _FMT_NUM2),
    ("CURRENCY",            10, "center", "@"),
]

_HDR = {col[0]: idx + 1 for idx, col in enumerate(COLUMNS)}


# ---------------------------------------------------------------------------
# Writer
# ---------------------------------------------------------------------------

def write_statement_excel(
    data: dict,
    output_path: Optional[str | Path] = None,
) -> bytes:
    """
    Write extracted statement data to an Excel file.

    Args:
        data:        Output of statement_service.extract_statement() (or a
                      {"rows": [...]} dict built from cached/filtered rows --
                      see statement.py's batch-download endpoint). Each row
                      must carry "client" and "account" (may be "" if truly
                      unknown, never omitted).
        output_path: Optional path to save. If None, returns bytes only.

    Returns:
        Raw Excel bytes (always).
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Statement"
    ws.freeze_panes = "A2"

    # ---- Header row ----
    for col_idx, (header, width, align, fmt) in enumerate(COLUMNS, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font      = _HEADER_FONT
        cell.fill      = _HEADER_FILL
        cell.alignment = _HEADER_ALIGN
        cell.border    = _BORDER
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    ws.row_dimensions[1].height = 30

    # ---- Data rows ----
    rows = data.get("rows", [])
    for row_idx, row in enumerate(rows, start=2):
        fill = _ROW_FILL_ODD if row_idx % 2 != 0 else _ROW_FILL_EVEN
        col  = _HDR

        def _cell(c, val, align="right", fmt=None):
            cell = ws.cell(row=row_idx, column=c, value=val)
            cell.font      = _ROW_FONT
            cell.fill      = fill
            cell.border    = _BORDER
            cell.alignment = Alignment(horizontal=align, vertical="center")
            if fmt:
                cell.number_format = fmt
            return cell

        from datetime import datetime
        td_raw = row.get("trade_date", "")
        try:
            td_val = datetime.strptime(td_raw, "%Y-%m-%d")
        except (ValueError, TypeError):
            td_val = td_raw

        _cell(col["TRADE DATE"],         td_val,                          "center", _FMT_DATE)
        _cell(col["CLIENT"],             row.get("client", "") or "",     "center", "@")
        _cell(col["ACCOUNT"],            row.get("account", "") or "",    "center", "@")
        _cell(col["DELIVERY / PRODUCT"], row.get("delivery_product", ""), "left",   "@")
        _cell(col["LONG"],               row.get("long"),                 "center", _FMT_INT)
        _cell(col["SHORT"],              row.get("short"),                "center", _FMT_INT)
        _cell(col["REALIZED PnL"],       row.get("realized_pnl"),        "right",  _FMT_NUM2)
        _cell(col["COMMISION FEES"],     row.get("commission_fees"),     "right",  _FMT_NUM2)
        _cell(col["MARKET FEES"],        row.get("market_fees"),         "right",  _FMT_NUM2)
        _cell(col["NFA FEES"],           row.get("nfa_fees"),            "right",  _FMT_NUM2)

        # TOTAL COMMS / TOTAL PnL written as literal computed values, NOT
        # formula strings (2026-09-23 fix). openpyxl never caches a formula's
        # result -- a workbook it wrote itself carries no cached value for
        # "=H2+I2+J2", so re-reading it with data_only=True (as
        # analysis_service.parse_statement does) gets back None for every
        # formula cell unless the file was opened+saved in real Excel first.
        # That silently zeroed out comms/PnL (and every chart derived from
        # them) whenever a parser-downloaded or merged workbook was fed
        # straight back into the Analysis tab. Computing the numbers here in
        # Python removes the dependency on Excel ever touching the file.
        comm_fees_val = float(row.get("commission_fees") or 0)
        market_fees_val = float(row.get("market_fees") or 0)
        nfa_fees_val = float(row.get("nfa_fees") or 0)
        realized_pnl_val = float(row.get("realized_pnl") or 0)
        total_comms_val = comm_fees_val + market_fees_val + nfa_fees_val
        total_pnl_val = realized_pnl_val + total_comms_val

        _cell(col["TOTAL COMMS"], total_comms_val, "right", _FMT_NUM2)
        _cell(col["TOTAL PnL"],   total_pnl_val,   "right", _FMT_NUM2)

        _cell(col["CURRENCY"], row.get("currency", ""), "center", "@")

    # ---- Totals block -- one row per (ACCOUNT, CURRENCY) pair (2026-09-23:
    # was CURRENCY-only, which would silently sum two different accounts'
    # numbers into one subtotal once a workbook holds more than one account) ----
    if rows:
        last_data_row = len(rows) + 1
        totals_row    = last_data_row + 2

        ws.cell(row=totals_row - 1, column=_HDR["DELIVERY / PRODUCT"],
                value="TOTALS BY ACCOUNT / CURRENCY").font = _SECTION_FONT

        from collections import defaultdict
        group_rows: dict = defaultdict(list)   # (account, currency) -> [row indices]
        group_order: list = []
        for r_idx, row in enumerate(rows, start=2):
            key = (row.get("account") or "", row.get("currency") or "")
            if key not in group_rows:
                group_order.append(key)
            group_rows[key].append(r_idx)

        offset = 0
        for key in group_order:
            acct, ccy = key
            r_idxs = group_rows[key]
            t_row  = totals_row + offset

            label_cell = ws.cell(row=t_row, column=_HDR["DELIVERY / PRODUCT"], value="TOTALS")
            acct_cell  = ws.cell(row=t_row, column=_HDR["ACCOUNT"],  value=acct)
            ccy_cell   = ws.cell(row=t_row, column=_HDR["CURRENCY"], value=ccy)
            for c in (label_cell, acct_cell, ccy_cell):
                c.font      = _TOTAL_FONT
                c.fill      = _TOTAL_FILL
                c.border    = _BORDER
                c.alignment = Alignment(horizontal="center", vertical="center")
            label_cell.alignment = Alignment(horizontal="left", vertical="center")

            # Literal computed sums, not formula strings -- same reasoning as
            # the per-row TOTAL COMMS/TOTAL PnL fix above: a formula written
            # by openpyxl has no cached value until opened in real Excel.
            _row_by_idx = {r_idx: rows[r_idx - 2] for r_idx in r_idxs}
            for col_name, source_key in (
                ("LONG",            "long"),
                ("SHORT",           "short"),
                ("REALIZED PnL",    "realized_pnl"),
                ("COMMISION FEES",  "commission_fees"),
                ("MARKET FEES",     "market_fees"),
                ("NFA FEES",        "nfa_fees"),
            ):
                col_idx = _HDR[col_name]
                fmt     = _FMT_INT if col_name in ("LONG", "SHORT") else _FMT_NUM2
                total   = sum(float(_row_by_idx[r].get(source_key) or 0) for r in r_idxs)
                tc = ws.cell(row=t_row, column=col_idx, value=total)
                tc.font          = _TOTAL_FONT
                tc.fill          = _TOTAL_FILL
                tc.border        = _BORDER
                tc.number_format = fmt
                tc.alignment     = Alignment(horizontal="right", vertical="center")

            total_comm_val = sum(
                float(_row_by_idx[r].get("commission_fees") or 0)
                + float(_row_by_idx[r].get("market_fees") or 0)
                + float(_row_by_idx[r].get("nfa_fees") or 0)
                for r in r_idxs
            )
            total_pnl_val = sum(
                float(_row_by_idx[r].get("realized_pnl") or 0)
                for r in r_idxs
            ) + total_comm_val

            for col_name, val in (("TOTAL COMMS", total_comm_val), ("TOTAL PnL", total_pnl_val)):
                col_idx = _HDR[col_name]
                tc = ws.cell(row=t_row, column=col_idx, value=val)
                tc.font          = _TOTAL_FONT
                tc.fill          = _TOTAL_FILL
                tc.border        = _BORDER
                tc.number_format = _FMT_NUM2
                tc.alignment     = Alignment(horizontal="right", vertical="center")

            offset += 1

    # ---- Info sheet -- overview + per-account breakdown table ----
    meta = wb.create_sheet("Info")
    meta["A1"] = "Trade Date"
    meta["B1"] = data.get("trade_date", "")
    meta["A2"] = "Client(s)"
    meta["B2"] = ", ".join(sorted({(r.get("client") or "") for r in rows if r.get("client")})) or data.get("client", "")
    meta["A3"] = "Account(s)"
    meta["B3"] = ", ".join(sorted({(r.get("account") or "") for r in rows if r.get("account")})) or data.get("account", "")
    meta["A4"] = "Rows Extracted"
    meta["B4"] = len(rows)
    for r in (1, 2, 3, 4):
        meta.cell(row=r, column=1).font = _TOTAL_FONT

    accounts_meta = data.get("accounts")
    if accounts_meta:
        hdr_row = 6
        headers = ["CLIENT", "ACCOUNT", "TRADE DATE", "ROWS", "CURRENCIES"]
        for c_idx, h in enumerate(headers, start=1):
            cell = meta.cell(row=hdr_row, column=c_idx, value=h)
            cell.font   = _HEADER_FONT
            cell.fill   = _HEADER_FILL
            cell.border = _BORDER
        for i, acc in enumerate(accounts_meta, start=hdr_row + 1):
            meta.cell(row=i, column=1, value=acc.get("client", "")).border   = _BORDER
            meta.cell(row=i, column=2, value=acc.get("account", "")).border  = _BORDER
            meta.cell(row=i, column=3, value=acc.get("trade_date", acc.get("date_from", ""))).border = _BORDER
            meta.cell(row=i, column=4, value=acc.get("row_count", 0)).border = _BORDER
            meta.cell(row=i, column=5, value=", ".join(acc.get("currencies", []))).border = _BORDER
        for c_idx, w in enumerate((10, 10, 14, 8, 20), start=1):
            meta.column_dimensions[get_column_letter(c_idx)].width = w

    # ---- Save ----
    buf = BytesIO()
    wb.save(buf)
    raw = buf.getvalue()

    if output_path:
        Path(output_path).write_bytes(raw)

    return raw
