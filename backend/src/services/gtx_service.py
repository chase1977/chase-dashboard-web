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
           .select("id, account, stmt_date, parsed, notes, created_at, updated_at")
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


def preview(stmt_date: str, text: str) -> dict:
    """Replay existing statements + this candidate; return its recon row."""
    p = parse_text(text)
    rows = [r for r in list_statements(p["account"]) if r["stmt_date"] != stmt_date]
    exists = any(r["stmt_date"] == stmt_date for r in list_statements(p["account"]))
    engine_in = _to_engine(rows) + [{"date": stmt_date, **p["parsed"]}]
    out = replay(engine_in, get_settings())
    row = next(x for x in out["recon_log"] if x["date"] == stmt_date)
    later = [r["stmt_date"] for r in rows if r["stmt_date"] > stmt_date]
    return {
        "account": p["account"], "parsed": p["parsed"], "recon": row,
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
    rows = list_statements(account)
    out = replay(_to_engine(rows), get_settings())
    out["account"] = account
    out["statements"] = [{"id": r["id"], "date": r["stmt_date"], "notes": r.get("notes")} for r in rows]
    return out
