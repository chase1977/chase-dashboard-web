# backend/src/services/gtx_service.py
"""
GlobalGTX service — Supabase I/O for gtx_statements / gtx_settings, plus
glue to the parser and the stateless replay engine.

Tables: see sql/2026-09-29_gtx_statements.sql
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from src.services.supabase_service import get_client
from src.services.gtx_parser import parse_statement
from src.services.gtx_engine import replay, DEFAULT_SETTINGS
from src.services.gtx_books import replay_books, book_settings
from src.services.gtx_parser import parse_statement_books

T_STMT = "gtx_statements"
T_SETTINGS = "gtx_settings"
DEFAULT_ACCOUNT = "GTX0011-USD"


# ── settings ─────────────────────────────────────────────────────────
def get_settings() -> dict:
    res = get_client().table(T_SETTINGS).select("settings").eq("id", 1).execute()
    overrides = (res.data[0]["settings"] if res.data else {}) or {}
    return {**DEFAULT_SETTINGS, **overrides}


def save_settings(patch: dict) -> dict:
    allowed = {k: v for k, v in patch.items() if k in DEFAULT_SETTINGS}
    cur = get_client().table(T_SETTINGS).select("settings").eq("id", 1).execute()
    merged = {**((cur.data[0]["settings"] if cur.data else {}) or {}), **allowed}
    get_client().table(T_SETTINGS).upsert({
        "id": 1, "settings": merged,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).execute()
    return {**DEFAULT_SETTINGS, **merged}


# ── statements ───────────────────────────────────────────────────────
def list_statements(account: str = DEFAULT_ACCOUNT) -> list[dict]:
    res = (get_client().table(T_STMT)
           .select("id, account, stmt_date, parsed, raw_text, notes, created_at, updated_at")
           .eq("account", account).order("stmt_date").execute())
    return res.data or []


def get_statement_raw(stmt_id: int) -> Optional[dict]:
    res = get_client().table(T_STMT).select("*").eq("id", stmt_id).execute()
    return res.data[0] if res.data else None


def _to_engine(rows: list[dict]) -> list[dict]:
    return [{"date": r["stmt_date"], **r["parsed"]} for r in rows]


def parse_text(text: str) -> dict:
    """Parse and return account name + parsed payload. Raises ValueError."""
    parsed = parse_statement(text)
    return {"account": parsed["account"]["account"] or DEFAULT_ACCOUNT, "parsed": parsed}


def _book_inputs(rows: list[dict]) -> list[dict]:
    return [{"date": r["stmt_date"], "text": r["raw_text"]} for r in rows]


def preview(stmt_date: str, text: str) -> dict:
    """
    Replay existing statements + this candidate, per currency book
    (2026-10-13); return the candidate's recon row for every book.
    "recon" stays the USD row for backward compatibility.
    """
    p = parse_text(text)
    all_rows = list_statements(p["account"])
    rows = [r for r in all_rows if r["stmt_date"] != stmt_date]
    exists = len(rows) != len(all_rows)
    out = replay_books(_book_inputs(rows) + [{"date": stmt_date, "text": text}], get_settings())
    parsed_books = parse_statement_books(text)
    books = []
    for b in out["books"]:
        row = next((x for x in b["recon_log"] if x["date"] == stmt_date), None)
        if row is not None:
            pb = parsed_books.get(b["ccy"]) or {}
            books.append({"ccy": b["ccy"], "symbol": b["symbol"], "verified": b["verified"], "recon": row,
                          "account": (pb.get("account") or {}).get("account") or "",
                          "n_open": len(pb.get("open_positions") or []), "n_trades": len(pb.get("trades") or [])})
    later = [r["stmt_date"] for r in rows if r["stmt_date"] > stmt_date]
    return {
        "account": p["account"], "parsed": p["parsed"],
        "recon": next(b["recon"] for b in books if b["ccy"] == "USD"),
        "books": books, "ok": all(b["recon"]["ok"] for b in books),
        "exists": exists, "later_statements": later,
    }


def save_statement(stmt_date: str, text: str, notes: Optional[str], overwrite: bool) -> dict:
    p = parse_text(text)
    existing = (get_client().table(T_STMT).select("id")
                .eq("account", p["account"]).eq("stmt_date", stmt_date).execute()).data
    payload = {
        "account": p["account"], "stmt_date": stmt_date, "raw_text": text,
        "parsed": p["parsed"], "notes": notes,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if existing:
        if not overwrite:
            raise FileExistsError(stmt_date)
        res = get_client().table(T_STMT).update(payload).eq("id", existing[0]["id"]).execute()
    else:
        res = get_client().table(T_STMT).insert(payload).execute()
    return res.data[0] if res.data else payload


def delete_statement(stmt_id: int) -> None:
    get_client().table(T_STMT).delete().eq("id", stmt_id).execute()


# ── full state ───────────────────────────────────────────────────────
def get_state(account: str = DEFAULT_ACCOUNT) -> dict:
    """
    Per-currency books (2026-10-13). Top-level keys stay the USD book so
    existing callers keep working; "books" holds every active book (USD
    first, then EUR, GBP) and "recon_ok" covers all of them.
    """
    rows = list_statements(account)
    settings = get_settings()
    res = replay_books(_book_inputs(rows), settings)
    usd = next(b for b in res["books"] if b["ccy"] == "USD")
    out = {k: v for k, v in usd.items() if k not in ("ccy", "symbol", "verified")}
    out["books"] = res["books"]
    out["recon_ok"] = res["recon_ok"]
    # Effective settings for every book (incl. hidden GBP) — Settings modal form values.
    out["book_settings"] = {c: book_settings(settings, c) for c in ("USD", "EUR", "GBP")}
    out["account"] = account
    out["statements"] = [{"id": r["id"], "date": r["stmt_date"], "notes": r.get("notes")} for r in rows]
    return out
