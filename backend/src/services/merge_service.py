# backend/src/services/merge_service.py
"""
Merge multiple AXIA statement Excel files into a single chronological workbook.

Reads data rows from each .xlsx (skips headers and TOTALS rows),
sorts by TRADE DATE then ACCOUNT, outputs via write_statement_excel.

Kept for legacy single-account Excels downloaded before the 2026-09-23
multi-account fix (see statement_service.py) -- the new batch-upload flow
in statement.py handles merging natively from parsed PDFs and should be
preferred going forward, but this still works correctly on any Excel that
carries the CLIENT/ACCOUNT columns (added 2026-09-23), current schema only.
"""

from datetime import datetime
from pathlib import Path
from typing import List

import openpyxl

from src.services.excel_writer import write_statement_excel

# Column index mapping (1-based) matching excel_writer.COLUMNS order
_COL = {
    "TRADE DATE":         1,
    "CLIENT":             2,
    "ACCOUNT":            3,
    "DELIVERY / PRODUCT": 4,
    "LONG":               5,
    "SHORT":              6,
    "REALIZED PnL":       7,
    "COMMISION FEES":     8,
    "MARKET FEES":        9,
    "NFA FEES":           10,
    "TOTAL COMMS":        11,
    "TOTAL PnL":          12,
    "CURRENCY":           13,
}


def _read_excel_rows(path: Path) -> list[dict]:
    """Read data rows from a single AXIA statement Excel file (current schema)."""
    wb = openpyxl.load_workbook(str(path), data_only=True)

    # Use the first sheet (Statement)
    ws = None
    for name in wb.sheetnames:
        if name.lower() != "info":
            ws = wb[name]
            break
    if ws is None:
        return []

    rows = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        # Skip empty rows
        if not any(row):
            continue

        trade_date = row[_COL["TRADE DATE"] - 1]
        # TOTALS rows leave TRADE DATE blank -- must have a valid date to be
        # a real trade row, skip footer/summary rows otherwise
        if trade_date is None:
            continue
        if isinstance(trade_date, str):
            # Try parse if stored as string
            try:
                trade_date = datetime.strptime(trade_date, "%Y-%m-%d")
            except ValueError:
                try:
                    trade_date = datetime.strptime(trade_date, "%d-%b-%Y")
                except ValueError:
                    continue  # unparseable -> skip

        td_str = trade_date.strftime("%Y-%m-%d") if isinstance(trade_date, datetime) else str(trade_date)

        rows.append({
            "trade_date":       td_str,
            "client":           row[_COL["CLIENT"] - 1] or "",
            "account":          row[_COL["ACCOUNT"] - 1] or "",
            "delivery_product": row[_COL["DELIVERY / PRODUCT"] - 1] or "",
            "long":             row[_COL["LONG"] - 1],
            "short":            row[_COL["SHORT"] - 1],
            "realized_pnl":     row[_COL["REALIZED PnL"] - 1],
            "commission_fees":  row[_COL["COMMISION FEES"] - 1],
            "market_fees":      row[_COL["MARKET FEES"] - 1],
            "nfa_fees":         row[_COL["NFA FEES"] - 1],
            "currency":         row[_COL["CURRENCY"] - 1],
        })
    return rows


def merge_statements(excel_paths: List[Path]) -> bytes:
    """
    Merge multiple AXIA statement Excel files.
    Returns merged Excel bytes sorted by trade_date ASC, then account.
    Every account present across the input files stays correctly tagged and
    gets its own TOTALS subtotal -- see excel_writer.write_statement_excel.
    """
    all_rows = []
    for path in excel_paths:
        all_rows.extend(_read_excel_rows(path))

    if not all_rows:
        raise ValueError("No data rows found in provided Excel files.")

    all_rows.sort(key=lambda r: (r["trade_date"], r.get("account") or ""))

    # Derive date range for merged filename hint
    dates      = [r["trade_date"] for r in all_rows]
    date_from  = min(dates)
    date_to    = max(dates)

    accounts_seen = sorted({r.get("account") or "" for r in all_rows if r.get("account")})
    clients_seen  = sorted({r.get("client") or "" for r in all_rows if r.get("client")})

    merged_data = {
        "trade_date": f"{date_from} to {date_to}",
        "client":     clients_seen[0] if len(clients_seen) == 1 else None,
        "account":    accounts_seen[0] if len(accounts_seen) == 1 else None,
        "rows":       all_rows,
    }

    return write_statement_excel(merged_data)
