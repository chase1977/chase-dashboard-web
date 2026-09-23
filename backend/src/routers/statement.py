# backend/src/routers/statement.py
"""
Statement upload router.

Multi-account, multi-day redesign (2026-09-23) -- see README. A single PDF
(or a whole batch of daily PDFs, e.g. every trading day from 16-Feb through
today) can contain several accounts under one Client id, each isolated by
statement_service.py's per-page header tracking. Both endpoints below now
return the SAME shape: a token for the parsed-but-not-yet-downloaded rows,
plus a per-account breakdown so the frontend can show an account picker
before anything is written to disk -- "which account(s) do you want, as
separate files or one combined workbook."

POST /api/statement/upload
  — One PDF. Returns {batch_token, accounts, date_range, total_rows, skipped}

POST /api/statement/upload-batch
  — Any number of PDFs (e.g. a full history of daily statements). Same
    response shape as /upload, merged across every file. New accounts that
    only start appearing partway through the date range just show a later
    date_from in their breakdown -- no special-casing needed.

GET  /api/statement/batch/{batch_token}/download?accounts=47511,47512&mode=combined|separate
  — Download parsed rows for one or more accounts (or every account, when
    `accounts` is omitted/"all"). mode=combined (default) -> one workbook,
    every selected account tagged + totalled separately inside it.
    mode=separate with 2+ accounts selected -> ZIP of one workbook per
    account.

POST /api/statement/merge
  — Legacy: accepts multiple already-downloaded .xlsx statement files,
    returns one merged Excel. Superseded by upload-batch for PDFs, kept for
    merging old single-account Excel exports.
"""

import io
import time
import uuid
import zipfile
import tempfile
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, File, UploadFile, HTTPException, Query
from fastapi.responses import StreamingResponse

from src.services.statement_service import extract_statement
from src.services.excel_writer      import write_statement_excel
from src.services.merge_service     import merge_statements


router = APIRouter(prefix="/api/statement", tags=["statement"])

_OUT_DIR = Path(tempfile.gettempdir()) / "chase_statements"
_OUT_DIR.mkdir(exist_ok=True)

# In-memory cache of parsed rows awaiting an account-scoped download --
# mirrors analysis_service._cache's pattern (small, short-lived, trimmed by
# recency). Rows never touch disk until the user picks what to download.
_PARSED_CACHE: dict[str, dict] = {}
_CACHE_CAP = 40


def _trim_cache():
    if len(_PARSED_CACHE) > _CACHE_CAP:
        oldest = sorted(_PARSED_CACHE, key=lambda k: _PARSED_CACHE[k]["created_at"])[: len(_PARSED_CACHE) - _CACHE_CAP]
        for k in oldest:
            del _PARSED_CACHE[k]


def _summarize_accounts(rows: list[dict]) -> list[dict]:
    """
    Group parsed rows by (client, account) -> {row_count, date_from, date_to,
    currencies}. Accounts that only start appearing partway through a batch
    (e.g. opened mid-year) simply show a later date_from -- this is derived
    straight from the rows actually present, nothing assumed.
    """
    groups: dict = {}
    order: list = []
    for r in rows:
        key = (r.get("client") or "", r.get("account") or "")
        if key not in groups:
            groups[key] = {"client": key[0], "account": key[1], "row_count": 0, "dates": set(), "currencies": set()}
            order.append(key)
        g = groups[key]
        g["row_count"] += 1
        if r.get("trade_date"):
            g["dates"].add(r["trade_date"])
        if r.get("currency"):
            g["currencies"].add(r["currency"])

    out = []
    for key in order:
        g = groups[key]
        dates = sorted(g["dates"])
        out.append({
            "client":     g["client"],
            "account":    g["account"],
            "row_count":  g["row_count"],
            "date_from":  dates[0] if dates else None,
            "date_to":    dates[-1] if dates else None,
            "currencies": sorted(g["currencies"]),
        })
    out.sort(key=lambda a: a["account"] or "")
    return out


async def _parse_and_cache(files: List[UploadFile]) -> dict:
    all_rows: list = []
    skipped:  list = []

    for f in files:
        if not (f.filename or "").lower().endswith(".pdf"):
            skipped.append(f"{f.filename} (not a PDF)")
            continue

        pdf_bytes = await f.read()
        tmp_pdf   = _OUT_DIR / f"{uuid.uuid4()}.pdf"
        tmp_pdf.write_bytes(pdf_bytes)

        try:
            data = extract_statement(tmp_pdf)
        except Exception as exc:
            skipped.append(f"{f.filename} (parse error: {exc})")
            continue
        finally:
            tmp_pdf.unlink(missing_ok=True)

        if not data.get("rows"):
            skipped.append(f"{f.filename} (no trade data found)")
            continue

        all_rows.extend(data["rows"])

    if not all_rows:
        detail = "No valid PDFs could be parsed."
        if skipped:
            detail += " Skipped: " + "; ".join(skipped)
        raise HTTPException(status_code=422, detail=detail)

    token = uuid.uuid4().hex
    _PARSED_CACHE[token] = {"rows": all_rows, "created_at": time.monotonic()}
    _trim_cache()

    dates = sorted({r["trade_date"] for r in all_rows if r.get("trade_date")})
    return {
        "batch_token": token,
        "file_count":  len(files) - len(skipped),
        "skipped":     skipped,
        "date_range":  {"from": dates[0], "to": dates[-1]} if dates else None,
        "total_rows":  len(all_rows),
        "accounts":    _summarize_accounts(all_rows),
    }


@router.post("/upload")
async def upload_statement(file: UploadFile = File(...)):
    """Upload a single PDF daily detail statement. Returns the account breakdown + a batch_token to download from."""
    return await _parse_and_cache([file])


@router.post("/upload-batch")
async def upload_statement_batch(files: List[UploadFile] = File(...)):
    """Upload any number of PDF statements (e.g. a full date-range backfill). Returns the merged account breakdown + a batch_token to download from."""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")
    return await _parse_and_cache(files)


@router.get("/batch/{batch_token}/download")
def download_batch(
    batch_token: str,
    accounts:    str = Query(default="all", description="Comma-separated account numbers, or 'all'."),
    mode:        str = Query(default="combined", description="'combined' = one workbook, 'separate' = ZIP of one workbook per account."),
):
    entry = _PARSED_CACHE.get(batch_token)
    if not entry:
        raise HTTPException(status_code=404, detail="Parsed data not found or expired — please re-upload.")

    rows = entry["rows"]
    wanted = None if accounts.strip().lower() in ("", "all") else {a.strip() for a in accounts.split(",") if a.strip()}
    filtered = rows if wanted is None else [r for r in rows if (r.get("account") or "") in wanted]
    if not filtered:
        raise HTTPException(status_code=404, detail="No rows for the requested account(s).")

    selected_accounts = sorted({r.get("account") or "" for r in filtered})

    def _label_for(rs: list[dict]) -> str:
        dates = sorted({r["trade_date"] for r in rs if r.get("trade_date")})
        if not dates:
            return "unknown"
        return dates[0] if len(dates) == 1 else f"{dates[0]}_to_{dates[-1]}"

    if mode == "separate" and len(selected_accounts) > 1:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for acc in selected_accounts:
                acc_rows = [r for r in filtered if (r.get("account") or "") == acc]
                client   = acc_rows[0].get("client") or "UNKNOWN"
                label    = _label_for(acc_rows)
                xl_bytes = write_statement_excel({
                    "rows": acc_rows, "trade_date": label, "client": client, "account": acc,
                    "accounts": _summarize_accounts(acc_rows),
                })
                zf.writestr(f"AXIA-{client}-{acc}_{label}.xlsx", xl_bytes)
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=AXIA-Statements-By-Account.zip"},
        )

    client     = filtered[0].get("client") or "UNKNOWN"
    label      = _label_for(filtered)
    acct_label = selected_accounts[0] if len(selected_accounts) == 1 else "Combined"
    xl_bytes   = write_statement_excel({
        "rows": filtered, "trade_date": label, "client": client, "account": acct_label,
        "accounts": _summarize_accounts(filtered),
    })
    fname = f"AXIA-{client}-{acct_label}_{label}.xlsx"
    return StreamingResponse(
        io.BytesIO(xl_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


@router.post("/merge")
async def merge_statement_excels(files: List[UploadFile] = File(...)):
    """
    Legacy: upload multiple already-downloaded AXIA statement Excel files
    (current CLIENT/ACCOUNT schema). Returns a single merged Excel sorted
    chronologically, every account still correctly tagged and totalled.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    xl_paths = []
    try:
        for f in files:
            if not f.filename.lower().endswith(".xlsx"):
                raise HTTPException(
                    status_code=400,
                    detail=f"{f.filename} is not an .xlsx file.",
                )
            raw = await f.read()
            tmp = _OUT_DIR / f"{uuid.uuid4()}.xlsx"
            tmp.write_bytes(raw)
            xl_paths.append(tmp)

        merged_bytes = merge_statements(xl_paths)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Merge error: {exc}")
    finally:
        for p in xl_paths:
            p.unlink(missing_ok=True)

    return StreamingResponse(
        io.BytesIO(merged_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=AXIA-Merged-Statement.xlsx"},
    )
