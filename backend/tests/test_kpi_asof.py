# backend/tests/test_kpi_asof.py
"""
KPI snapshots / as-of mode (14-11-2026) — offline, no Supabase.
Proves: live mode unchanged (raw client, raw cache keys); as-of mode adds
`<data_date_col> <= as_of` to every dated read, never to writes or undated
tables; cache keys isolated + purged; scheduler clock 23:30 London (DST);
weekday windows; Excel export builds.
Run from backend/:  python tests\\test_kpi_asof.py
"""
import io, os, sys
from datetime import datetime, date, timezone
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("SUPABASE_URL", "http://offline")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "offline")
from src.services import supabase_service as sb
from src.services import kpi_snapshot_service as snap

# ── fake postgrest client: records every call ──────────────────────────────
class Q:
    def __init__(self, log, table): self.log, self.table = log, table
    def __getattr__(self, name):
        def f(*a, **k):
            self.log.append((self.table, name, a)); return self
        return f
class FakeClient:
    def __init__(self): self.log = []
    def table(self, name): return Q(self.log, name)
FAKE = FakeClient()
sb.get_raw_client = lambda: FAKE

def lte_calls(table):
    return [a for t, n, a in FAKE.log if t == table and n == "lte"]

# 1. live mode = raw client, no filter
assert sb.get_client() is FAKE
sb.get_client().table("balance_history").select('"Date"').execute()
assert not lte_calls("balance_history"), "live read must not be filtered"

# 2. as-of mode: dated tables filtered on their data-date column
cases = {
    "user_pfees_estimation": "Date", "balance_history": "Date", "user_accounts_equity": "Date",
    "capital_events": "event_date", "capital_transfers": "transfer_date",
    "internal_transfers": "transfer_date", "axia_daily_equity": "trade_date",
    "ig_daily_equity": "trade_date", "investgtx_daily_equity": "trade_date",
    "fund_monthly_statements": "period_end_date", "aslan_monthly_statements": "period_end_date",
}
FAKE.log.clear()
with sb.as_of_context("2026-11-11") as d:
    assert d == "2026-11-11" and sb.current_as_of() == d
    for t in cases:
        sb.get_client().table(t).select("*").order("x").execute()
    sb.get_client().table("strategies").select("*").execute()               # undated
    sb.get_client().table("capital_events").insert({"a": 1}).execute()       # write
    sb.get_client().table("capital_events").update({"a": 1}).eq("id", 1).execute()
for t, col in cases.items():
    assert lte_calls(t) == [(col, "2026-11-11")], (t, lte_calls(t))
assert not lte_calls("strategies"), "undated table must be read whole"
assert lte_calls("capital_events") == [("event_date", "2026-11-11")], "writes must never be filtered"
assert sb.current_as_of() is None and sb.get_client() is FAKE, "context must reset"

# 3. cache isolation + purge
sb._cache.clear()
calls = []
v_live = sb._get_cached("k", lambda: calls.append("live") or "LIVE")
with sb.as_of_context("2026-11-11"):
    v_as = sb._get_cached("k", lambda: calls.append("asof") or "ASOF")
assert (v_live, v_as) == ("LIVE", "ASOF") and calls == ["live", "asof"]
assert set(sb._cache) == {"k", "k@2026-11-11"}
sb.purge_as_of_cache()
assert set(sb._cache) == {"k"} and not any("@" in k for k in sb._key_locks)
assert sb._get_cached("k", lambda: "NEW") == "LIVE", "live cache untouched by purge"

# 4. bad date rejected
try:
    with sb.as_of_context("2026-13-40"): pass
    raise AssertionError("bad date accepted")
except ValueError:
    pass

# 5. scheduler clock — 23:30 London in GMT and BST
assert snap.next_run_after(datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)).strftime("%Y-%m-%d %H:%M %Z") == "2026-11-14 23:30 GMT"
assert snap.next_run_after(datetime(2026, 11, 14, 23, 30, tzinfo=timezone.utc)).strftime("%Y-%m-%d %H:%M") == "2026-11-15 23:30"
assert snap.next_run_after(datetime(2026, 7, 1, 21, 0, tzinfo=timezone.utc)).strftime("%H:%M %Z") == "23:30 BST"
assert snap.next_run_after(datetime(2026, 7, 1, 22, 31, tzinfo=timezone.utc)).strftime("%Y-%m-%d %H:%M") == "2026-07-02 23:30"
os.environ.pop("KPI_SNAPSHOT_SCHEDULER", None); os.environ.pop("RAILWAY_ENVIRONMENT", None)
os.environ.pop("RAILWAY_ENVIRONMENT_NAME", None)
assert not snap.scheduler_enabled(), "local dev must not auto-schedule"
os.environ["RAILWAY_ENVIRONMENT"] = "production"; assert snap.scheduler_enabled()
os.environ["KPI_SNAPSHOT_SCHEDULER"] = "0";        assert not snap.scheduler_enabled()
os.environ.pop("KPI_SNAPSHOT_SCHEDULER"); os.environ.pop("RAILWAY_ENVIRONMENT")

# 6. weekday windows (data dates, weekends skipped)
w = snap.recent_weekdays(date(2026, 11, 16))          # Monday
assert len(w) == 10 and w[-1] == "2026-11-16" and w[0] == "2026-11-03" and "2026-11-14" not in w
assert snap.weekdays_between("2026-11-09", "2026-11-15") == [f"2026-11-{d:02d}" for d in range(9, 14)]
assert snap._entity_num("strategy_12") == 12 and snap._entity_num("pod_3") == 3
assert snap._entity_num("darwin_cfz") == snap._entity_num("darwin_cfz") > 0

# 7. Excel export
snap.list_snapshots = lambda f=None, t=None, level=None: [
    {"snapshot_date": "2026-11-11", "level": "portfolio", "entity_name": "Chase Capital", "pod_name": None,
     "status": None, "initial_investment": 1000000.0, "active_capital_invested": 900000.0,
     "capital_allocated": 1000000.0, "current_equity": 1010000.0, "total_pnl": 10000.0,
     "banked_profit": 0.0, "banked_profit_true": 0.0, "performance": 0.01, "pct_1d": -0.001,
     "pct_7d": 0.002, "pct_30d": 0.01, "source": "manual", "computed_at": "2026-11-14T12:00:00Z"},
    {"snapshot_date": "2026-11-11", "level": "strategy", "entity_name": "AXIA-JJ", "pod_name": "AXIA",
     "status": "Active", "initial_investment": 150000.0, "total_pnl": -633.46, "performance": None,
     "source": "manual", "computed_at": "2026-11-14T12:00:00Z"},
]
from openpyxl import load_workbook
wb = load_workbook(io.BytesIO(snap.export_xlsx("2026-11-11", "2026-11-11")))
assert wb.sheetnames == ["README", "Portfolio", "Pods", "Strategies"]
p = wb["Portfolio"]
assert p["A2"].value.date() == date(2026, 11, 11) and p["J2"].value == 10000.0 and p["J2"].number_format.startswith("#,##0.00")
assert wb["Strategies"]["J2"].value == -633.46 and wb["Pods"].max_row == 1
assert p["R2"].value == datetime(2026, 11, 14, 12, 0)                    # GMT in November
print("AS-OF FILTER + SNAPSHOT SCHEDULER + EXPORT ✓")
