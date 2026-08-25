# Chase Capital — Dashboard

Internal capital, performance, and ledger tracking system for Chase Capital.
React (Vite) frontend, FastAPI backend, Supabase (Postgres) database.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Data Model](#3-data-model)
4. [Capital & Performance Formulas](#4-capital--performance-formulas)
5. [Watermark / Profit-Share Model](#5-watermark--profit-share-model)
6. [Two-Leg Capital Movement Model](#6-two-leg-capital-movement-model)
7. [Ledger Tabs Reference](#7-ledger-tabs-reference)
8. [UI/UX Conventions](#8-uiux-conventions)
9. [Banked Profit/Loss Drill-Down](#9-banked-profitloss-drill-down)
10. [AXIA Daily Equity — Pagination](#10-axia-daily-equity--pagination)
11. [Fund Monthly Statements & OANDA FX Bridge (12-FLAGS)](#11-fund-monthly-statements--oanda-fx-bridge-12-flags)
12. [Darwinex Closed-Strategy P&L Bridge](#12-darwinex-closed-strategy-pl-bridge)
13. [Roadmap — Completed](#13-roadmap--completed)
14. [Roadmap — Outstanding](#14-roadmap--outstanding)
15. [Known Limitations](#15-known-limitations)
16. [Dev Workflow](#16-dev-workflow)

---

## 1. Overview

Chase Capital dashboard tracks:

- Portfolio → Pod → Strategy → Trader hierarchy
- Capital invested, allocated, withdrawn, banked profit/loss
- Live equity from AXIA (`user_pfees_estimation`) and Darwinex/manual strategies
- Watermark / profit-share adjusted equity where applicable
- Full capital movement ledger (bank ↔ wallet ↔ pod ↔ strategy)
- Expenses, wages/invoices, misc events
- Excel/PDF/CSV reporting

Deployed via Netlify (frontend) + Railway (backend), but all development and
testing is done against live Supabase data.

---

## 2. Architecture

```
chase-dashboard-web/
├── src/                        # React frontend (Vite)
│   ├── components/
│   │   ├── CapitalOverview.jsx     # Hero cards, Capital Flow Summary table, glance chart,
│   │   │                           #   Banked Profit/Loss drill-down modal (§9)
│   │   ├── SummaryStrip.jsx        # All ledger tabs (Capital Events, Transfers, Misc, Expenses, Wages)
│   │   ├── PodStrategyManager.jsx  # Pod/Strategy CRUD forms
│   │   ├── AxiaEquityEntry.jsx     # AXIA daily equity (NLV) entry + paginated history (§10)
│   │   ├── Flags12StatementEntry.jsx  # 12-FLAGS monthly NAV statement entry + OANDA FX (§11)
│   │   └── layout/Navbar.jsx
│   ├── pages/
│   │   ├── Portfolio.jsx           # Portfolio home — hero + pod/strategy overview cards + hierarchy tabs
│   │   ├── DrillDown.jsx           # Entity drill-down (pod/strategy/trader)
│   │   ├── HomePage.jsx
│   │   └── Reports.jsx             # AXIA equity entry + 12-FLAGS statement entry
│   ├── hooks/usePortfolioData.js   # React Query hooks
│   └── services/api.js             # All HTTP calls
│
└── backend/src/
    ├── routers/
    │   ├── portfolio.py            # /api/portfolio — KPIs, hierarchy, drilldown
    │   ├── management.py           # /api/management — CRUD for all ledger tables
    │   ├── axia_equity.py          # /api/axia — daily equity CRUD, paginated
    │   ├── axia_analysis.py        # /api/axia — analysis endpoints
    │   └── fund_statements.py      # /api/fund-statements — monthly NAV statement CRUD (§11)
    ├── services/
    │   ├── supabase_service.py     # All aggregation logic (2600+ lines)
    │   └── oanda_service.py        # OANDA GBP/USD daily-close FX lookups (§11)
    └── models/schemas.py           # Pydantic response models
```

**Data flow:** Supabase tables → `supabase_service.py` aggregation functions
→ Pydantic schemas → FastAPI routers → React Query hooks → components.

---

## 3. Data Model

### Core hierarchy tables

| Table | Purpose |
|---|---|
| `pods` | Top-level grouping (e.g. AXIA, Darwinex). Has `status` (Active/Inactive). |
| `strategies` | Belongs to a pod. Has `status`, `watermark`, `profit_share_pct`. |
| `user_pfees_estimation` | Daily equity/PnL snapshot per AXIA strategy (live feed). |
| `balance_history` | Portfolio-level equity curve snapshots. |
| `axia_daily_equity` | Manually-entered AXIA daily NLV, paginated 50/page (§10). |
| `fund_monthly_statements` | Manually-entered NAV-administrator monthly statements for fund strategies with no daily feed (e.g. 12-FLAGS), one row per `strategy_id` per `period_end_date` (§11). |

### Capital movement tables

| Table | Purpose |
|---|---|
| `capital_events` | External bank ⇄ wallet flows (deposits/withdrawals). No strategy linkage. |
| `capital_transfers` | Internal wallet ⇄ pod ⇄ strategy flows (AXIA/manual). Typed `from_type`/`to_type`/`from_id`/`to_id`. |
| `internal_transfers` | Darwinex-specific wallet ⇄ account flows. String-based `from_account`/`to_account`. |
| `misc_events` | Ad-hoc capital events not fitting the above. |
| `expenses` | Operating expenses. |
| `wages` | Wages/invoices. |

### Profit/loss classification columns (added Phase 1)

`capital_transfers` and `internal_transfers` both carry:

- `capital_return_amount` (numeric, nullable)
- `profit_loss_amount` (numeric, signed, nullable)

Constraint: both null (unclassified), or both set with
`round(capital_return_amount + profit_loss_amount, 2) = round(amount, 2)`.

### Watermark columns (added Phase 2)

`strategies` table:

- `watermark` (numeric, nullable) — equity level above which profit-share applies
- `profit_share_pct` (numeric 0–100, nullable) — % of excess-over-watermark retained by Chase

Both null = no watermark adjustment (pass-through).

---

## 4. Capital & Performance Formulas

All formulas implemented in `computeCapitalMetrics()`
(`src/components/CapitalOverview.jsx`) and cross-checked line-by-line
against the manager's spec.

### Total Capital Invested

Cumulative, monotonic. Never reduced by withdrawals.

```
Total Capital Invested = Σ all capital allocated in, ever
```

### Banked Profit / Loss

Signed sum of the profit/loss leg of every classified outbound transfer
(strategy/account → wallet). Can be negative (realised loss).

```
Banked Profit / Loss = Σ profit_loss_amount   (across all classified withdrawals)
```

### Capital Allocated (Still Out)

Total invested minus **everything withdrawn** — both the capital-return
portion and the profit/loss portion.

```
Total Withdrawn    = Σ (capital_return_amount + profit_loss_amount)
Capital Allocated  = Total Capital Invested − Total Withdrawn
```

> **Fixed bug (this project's Phase 4 audit):** formula previously only
> subtracted `capital_return_amount`, leaving Capital Allocated unchanged
> after a pure-profit withdrawal. Now correctly subtracts the full
> withdrawn amount.

### Current Equity (Economic Interest)

Chase's live economic interest in the strategy/pod, watermark-adjusted
where applicable (see [§5](#5-watermark--profit-share-model)).

### Total P&L

```
Total P&L = Current Equity + Banked Profit / Loss − Total Capital Invested
```

> **Fixed bug (this project's Phase 4 audit):** frontend previously used
> the backend's raw `kpis.total_pnl` field (a broker-snapshot PnL
> disconnected from banked profit). Now always computed via the formula
> above, at every level (strategy/pod/portfolio).
>
> **Note:** the manager's spec claims `Total P&L = Current Equity −
> Capital Allocated`. This only holds when there is **no capital-return
> withdrawal component**. Once one exists (e.g. Darwinex return-of-capital),
> the two forms diverge — the `Equity + Banked − Invested` form is the one
> implemented, and is the mathematically correct one in general.

### Total ROI

```
Total ROI = Total P&L / Total Capital Invested × 100
```

---

## 5. Watermark / Profit-Share Model

Applies at the **strategy** level. Given raw broker equity `E`, watermark
`W`, and profit-share % `S`:

```
if W is null or S is null:
    chase_equity = E                          # pass-through, no adjustment

elif E <= W:
    chase_equity = E                          # below watermark — 100% retained

else:
    chase_equity = W + (E − W) × (S / 100)    # above watermark — only S% of excess retained
```

Implemented in `_apply_watermark(strategy, raw_equity, baseline)`,
`backend/src/services/supabase_service.py`.

**Coverage:**

| Level | AXIA strategies | Non-AXIA (Darwinex/manual) strategies |
|---|---|---|
| Strategy | ✅ Applied | ✅ Applied |
| Pod | ✅ Applied (additive from adjusted strategy figures) | ⚠️ Not applied — see [§15](#15-known-limitations) |
| Portfolio | ✅ Applied | ⚠️ Not applied — see [§15](#15-known-limitations) |

---

## 6. Two-Leg Capital Movement Model

Institutional capital movements are split into two independent legs:

**External — `capital_events`**
Bank ⇄ Wallet. No strategy/pod linkage. Deposits and withdrawals only.

**Internal — `capital_transfers` (AXIA/manual) or `internal_transfers` (Darwinex)**
Wallet ⇄ Pod ⇄ Strategy. Typed endpoints. This is where profit/loss
classification (§3) is recorded — always on the **outbound** leg
(Strategy/Account → Wallet).

Darwinex uses a separate table (`internal_transfers`, string-based
`from_account`/`to_account`) rather than `capital_transfers`, by earlier
explicit design decision — kept fully separate from the AXIA/manual model.

### Recording a profit/loss withdrawal (worked example — AXIA-TW)

Real entries made this project, used as the reference pattern for all
future profit withdrawals:

| Date | Ref | Amount | Capital Return | Profit/Loss |
|---|---|---|---|---|
| 15-04-2026 | AXIA MARKET PRO | £156,000.00 | £0.00 | £156,000.00 |
| 06-07-2026 | AXIA MARKET PRO | £24,000.00 | £0.00 | £24,000.00 |

**Steps:**
1. Capital Transfers tab → New Transfer.
2. From = Strategy (AXIA-TW), To = Wallet.
3. Amount = withdrawal amount.
4. Classification box appears (outbound strategy→wallet leg only): enter
   Capital Return and Profit/Loss so they sum to Amount.
5. Reference + notes as normal.

---

## 7. Ledger Tabs Reference

| Tab | Table | Classifiable? |
|---|---|---|
| Capital Events | `capital_events` | No — external, no strategy linkage |
| Capital Transfers | `capital_transfers` | Yes — outbound Strategy→Wallet legs only |
| Darwinex (Internal) Transfers | `internal_transfers` | Yes — outbound Account→Wallet legs only |
| Misc Events | `misc_events` | No |
| Expenses | `expenses` | No |
| Wages / Invoices | `wages` | No |

All tabs use consistent formatting (§8).

---

## 8. UI/UX Conventions

- **Dates:** `DD-MM-YYYY` everywhere except chart axis ticks. Formatted via
  `fmtDate()` in `SummaryStrip.jsx`.
- **Money:** full 2dp `£` everywhere except chart axis ticks.
- **Event-log rows:** left side = icon/badges/arrows on top line,
  reference + notes stacked below; right side = bold date on top, amount
  below, right-aligned. Applied consistently across all 6 ledger tabs.
- **Number inputs (Profit/Loss, Profit Share %):** `type="text"
  inputMode="decimal"` — no spinner arrows, numeric keypad on mobile.
  Bounds still enforced server-side via Pydantic.
- **Overview cards (Pod/Strategy):** header row shows name, watermark
  badge (`WM £X · Y%`, purple, only if set), and a bold-caps
  green/red Active/Inactive status badge, right-aligned.
- **Capital Flow Summary table:** zebra/hover row shading via
  `.glass-table` CSS; cells carry horizontal (12–14px) and header
  top (10px) padding so shading doesn't run text to the table edges.
- **Responsive:** every view works on both desktop and mobile.

---

## 9. Banked Profit/Loss Drill-Down

Clicking the Banked Profit/Loss hero card, or its Capital Flow Summary
table row, opens a modal listing every classified withdrawal leg that
contributed to the total — same underlying data as the ledger tabs, no
separate backend endpoint.

**Implementation:** `BankedProfitModal` in `CapitalOverview.jsx`. Self-fetches
via React Query, reusing the exact same query keys the ledger tabs already
use (`['capital_transfers']`, `['internal_transfers']`, `['pods']`,
`['strategies_all']`) — so the modal is always cache-consistent with the
ledger tabs, with zero extra network calls beyond what's already loaded.

**Filter logic:** rows where `profit_loss_amount != null` (classified) and
the transfer direction is outbound (Strategy/Account → Wallet). Sorted
newest-first. Each row shows: strategy/pod name, capital-return amount,
signed profit/loss amount (green if ≥ 0, red if < 0), and date. A running
`netTotal` (only the net figure, not the full breakdown) is shown wherever
Banked Profit/Loss appears in preview form (hero card, table row) —
matching the "only net shown in the preview" requirement.

---

## 10. AXIA Daily Equity — Pagination

`GET /api/axia/equity` — paginated, `{rows, total}` shape, `limit`/`offset`
query params (default `limit=50`). Frontend (`AxiaEquityEntry.jsx`) shows
50 records per page with Previous/Next controls and a "Page X of Y"
indicator. Applies uniformly to every AXIA client, not just one.

> **Fixed bug (this project):** `PATCH /api/axia/equity/{id}` used to build
> its update payload with `{k: v for k, v in body.model_dump().items() if v
> is not None}` — which silently **dropped any field explicitly set to
> `null`**, so clearing the Notes field and hitting Save had no effect (the
> old note stayed in the DB). Fixed to `body.model_dump(exclude_unset=True)`
> — only fields genuinely absent from the request are skipped; an explicit
> `null` now saves correctly. This `exclude_unset` pattern was then applied
> proactively to `PATCH /api/fund-statements/{id}` (§11) from the start, to
> avoid the same class of bug there.

---

## 11. Fund Monthly Statements & OANDA FX Bridge (12-FLAGS)

### 11.1 What this is

Some strategies (currently: **12-FLAGS**, a Cayman feeder fund reported via
NAV Fund Services) have **no daily broker feed** — performance only exists
as a monthly Investor Statement (Beginning Balance, Ending Balance,
Additions, Redemptions, Net Income, Rate of Return), denominated in **USD**.
This is fundamentally different from AXIA (daily feed, GBP) and Darwinex
(daily feed via `internal_transfers`), so it gets its own table, service,
and entry UI — but bridges into the exact same strategy → pod → portfolio
KPI pipeline as every other strategy type.

Entry point: **Reports page → "12-FLAGS Monthly Statement (USD)"**, below
the AXIA Daily Equity section. One statement per calendar month.

### 11.2 Data entered vs data computed

You key in **one number** each month — the statement's **Ending Balance
(USD)**. Everything else is either auto-carried or computed server-side
(never trusted from the client):

| Field | Source |
|---|---|
| Period End Date | You enter (statement date) |
| Ending Balance (USD) | You enter — the only required manual figure |
| Beginning Balance | Auto-carried from the previous record's Ending Balance (first-ever record: manual, one-time) |
| Additions / Redemptions | You enter only if the statement shows any that period (collapsed by default) |
| Net Income | **Computed server-side** |
| Rate of Return % | **Computed server-side** |
| FX Rate + Date | **Fetched from OANDA server-side** |
| Ending Balance (GBP) | **Computed server-side** from Ending Balance ÷ FX Rate |

### 11.3 Formulas

```
Net Income      = Ending Balance − Beginning Balance − Additions + Redemptions
Rate of Return % = Net Income ÷ Beginning Balance × 100
```

Verified against the 12-FLAGS July 2026 statement: Beginning 648,756.57,
Ending 633,211.98 → Net Income = −15,544.59, Rate of Return = −2.3958% ≈
−2.40% (statement's own quoted figure).

**YTD** (shown as a column in the records table, and as the strategy-card
USD sub-line, §11.6) is **not** chain-linked/compounded — it's a plain
cumulative sum within the calendar year, matching the NAV administrator's
own ITD/YTD convention exactly:

```
YTD Net Income  = Σ Net Income for every record in the same calendar year as the latest record
YTD Return %    = YTD Net Income ÷ (that year's FIRST record's Beginning Balance) × 100
```

Verified: May→June (+... or −1,243.43) + June→July (−15,544.59) =
**−16,788.02**, matching the statement's own ITD Net Income exactly;
−16,788.02 ÷ 650,000 = **−2.58%**, matching the statement's own ITD Rate of
Return exactly.

### 11.4 OANDA FX conversion

**Why:** the statement is USD; the rest of the dashboard (Capital Invested,
Current Equity, Total P&L) is GBP. Each statement needs a GBP-converted
Ending Balance to feed into the strategy's Current Equity.

**Pair:** `GBP_USD` (base GBP, quote USD) — 1 GBP = `rate` USD.
Conversion: `GBP = USD ÷ rate`.

**Source:** OANDA practice/demo API (`https://api-fxpractice.oanda.com/v3`).
The practice API's pricing feed mirrors live market data — safe to use for
historical rate lookups even on a demo account (read-only candle queries
only, no trades ever placed).

**Candle selection — daily, not monthly:** `oanda_service.get_monthly_close()`
requests a **daily** (`granularity="D"`) candle, midpoint price
(`price="M"`), `count=1&to=<period_end + 1 day>` — this unambiguously
returns the one trading day at or immediately before the statement's period
end. An earlier version requested an actual `granularity="M"` monthly
candle with manual month-start/month-end bounds; this proved unreliable —
OANDA anchors monthly candles to its own broker-day boundary
(~21:00–22:00 UTC, DST-dependent), and adjacent from/to windows could
straddle that boundary and silently return the **same** candle for two
different statement months. Daily granularity has no such ambiguity.

**Broker-day date correction:** OANDA's daily candle `time` field is the
candle's **open** timestamp in UTC, and the broker day opens ~21:00–22:00
UTC the evening before (5pm New York convention) — so a naive date
truncation mislabels the candle one calendar day early (e.g. Friday
31-07-2026's close came back timestamped `2026-07-30T21:00:00Z`). Fixed
with a `+timedelta(hours=6)` correction before deriving the candle's
calendar date — verified: `2026-07-30T21:00:00Z + 6h → 2026-07-31`, correct.

**Staleness flag:** a fetched rate is flagged stale (⚠, orange, with a
manual "↻ re-fetch" button) if the candle date is more than 10 days from
the statement's period end — normally only happens for a genuinely
future-dated period (OANDA can only return its most recent *real* candle).
Same 10-day threshold enforced identically on both backend
(`oanda_service.py`) and frontend (`Flags12StatementEntry.jsx`'s
`isFxStale()`), kept in sync deliberately.

**Manual re-fetch:** every FX badge always shows a small "↻" button
(`POST /api/fund-statements/{id}/refetch-fx`), not just when stale/pending —
useful for re-pulling a rate that predates a fix, or forcing a fresh lookup.

### 11.5 Three-level strategy → pod → portfolio bridge

Mirrors the AXIA bridge pattern exactly, at all three levels:

```
strategy_id
  └─ fund_monthly_statements rows (sorted by period_end_date)
       └─ latest row's ending_balance_gbp  →  strategy's Current Equity
            └─ folded into the strategy's pod's pod_agg   →  pod's Current Equity
                 └─ folded into portfolio-wide current_equity / total_pnl
```

Implemented via `_fund_statement_strategy_agg(strategies)` in
`supabase_service.py` — returns `{strategy_id: {invested, pnl, baseline,
series}}`:

- **`invested`** = latest record's `ending_balance_gbp`. If the latest
  record's FX hasn't been fetched yet (`ending_balance_gbp is None` —
  pending OANDA fetch or failed lookup), the strategy is **excluded**
  entirely from `fund_agg` rather than fed a USD number mislabelled as GBP
  — it falls through to the strategy's existing `0.0` default until FX is
  fetched or manually retried.
- **`baseline`** = `capital_transfers` ledger inbound sum for that strategy
  if any exist, else the strategy's manual `initial_investment` field —
  same fallback chain as `_strategy_capital_invested()`, so Capital
  Invested stays consistent everywhere it's shown.
- **`pnl`** = `invested − baseline`.
- **`series`** = full sorted history — used to compute the YTD sub-line
  (§11.6) without a second DB round-trip.

Folded in at all three levels the AXIA pattern already establishes:

| Level | Function | Fold-in |
|---|---|---|
| Strategy | `get_strategies_with_kpis_fast` | `fund_contrib` branch (after the `axia_contrib` check) sets `agg = {invested, pnl}` directly from `fund_agg` |
| Pod | `_build_pod_pfees_map` → `pod_agg` | Same additive fold-in block as AXIA's, right after it |
| Portfolio | `get_portfolio_kpis_fast` | `current_equity`/`total_pnl` explicitly summed with `fund_agg` values (fund-statement strategies never appear in the `pfees` snapshot AXIA/Darwinex use, so this level needs an explicit add rather than inheriting from a shared snapshot sum) |
| Breakdown/Hierarchy table (strategy tab) | `get_hierarchy_rows` (`entity_type == "strategy"`) | Same `fund_contrib` branch added — **this was a gap found and fixed during the post-build bridge audit**: this function builds its own `darwin_agg`/`acct_agg` from the pfees snapshot independently of the strategy-KPI function above, and had no fund-statement awareness, so 12-FLAGS would have shown £0 AUM/PnL specifically in the Breakdown table (Portfolio page → Strategy tab) even though its own Strategy Overview card was already correct |

No double-counting: `get_portfolio_kpis_fast`'s `current_equity`/`total_pnl`
are computed from the raw `pfees` snapshot (`_snapshot`), **not** from
`pod_agg` — so the portfolio-level fund-statement fold-in and the pod-level
one are additive from two genuinely separate base sums, not the same
number added twice.

### 11.6 USD sub-line (GBP vs USD, and why they diverge)

The 12-FLAGS Strategy Overview card shows **Total P&L** and **Total ROI**
in GBP, like every other strategy — plus a small USD sub-line underneath
each, showing the fund's own YTD Net Income / Return % straight from the
statements (§11.3's YTD formula), un-translated.

**Why both are needed:** the GBP figures are correct, but they include a
genuine FX-translation effect on top of the fund's own USD performance,
because Capital Invested and Current Equity get converted at **two
different historical FX rates** — Capital Invested at the original deposit
date's rate (Ebury FX, 29-05-2026, implied ≈1.3375), Current Equity at the
latest statement's OANDA close rate (≈1.3484, a stronger GBP). A weaker USD
book translated at a stronger-GBP rate shows a larger GBP loss than the
fund's own USD-denominated loss — confirmed via direct calculation, not a
bug. The USD sub-line exists purely so this never reads as a discrepancy
against the fund's own quoted NAV statement numbers.

**Backend:** `KpiData.fund_usd_net_income` / `fund_usd_return_pct`
(`schemas.py`, both `Optional[float] = None`) — populated in
`get_strategies_with_kpis_fast` only when `fund_contrib is not None`, from
`fund_contrib["series"]`'s YTD computation (§11.3). `None` for every other
strategy type — AXIA and Darwinex never populate these fields.

**Frontend:** `StatBox` (`Portfolio.jsx`) takes an optional `subLine` prop;
`OverviewCard` passes a formatted "USD YTD: ..." string only when
`kpis.fund_usd_net_income`/`fund_usd_return_pct` are non-null.

### 11.7 Credentials

OANDA practice/demo token + API URL, read from environment variables
(`OANDA_TOKEN`, `OANDA_API_URL` in `backend/.env`), with an inline fallback
to the practice values supplied at setup — works out of the box, but
production should rely on the real `.env`/Railway config values, never the
inline fallback.

---

## 12. Darwinex Closed-Strategy P&L Bridge

### 12.1 The bug

Two Darwinex strategies — **DARWIN-1X** (`Chase1`, closed 22-05-2026) and
**DARWIN-3X** (`Chase3xA`, closed 27-07-2026) — are both `status: "Inactive"`
and have **no `user_pfees_estimation` feed at all** (Darwinex is tracked
purely through manually-entered `internal_transfers`, never had a daily
broker feed the way AXIA does). This exposed a real bug: when a strategy has
`brokerage_account` set but no live feed row matches it, the code treated
raw equity as **£0** and computed P&L as `0 − net_deployed` — wiping out the
**entire historical capital ever deployed** as "loss," not just whatever
was actually unrecovered. DARWIN-1X alone was showing roughly **−£899,950**
this way (its true realized loss, once fully closed, is only **−£12,007.75**)
— this single bug accounted for most of the −£2,731,618.31 / −75.61%
portfolio-wide P&L seen before this fix.

A second, subtler issue: even once every `internal_transfers` leg (including
the final close) is entered, `net_deployed` — a running **net** of
Wallet↔account flows — collapses toward the residual/loss amount once an
account is fully closed out. That breaks two things at once: "Capital
Invested" stops being the monotonic historical total the rest of the
dashboard promises (§4), and **Total ROI's denominator shrinks alongside its
numerator**, producing a nonsensical ≈ −100% instead of the true ≈ −1% of
capital actually lost.

### 12.2 The fix

`_darwinex_closed_strategy_agg(strategies)` in `supabase_service.py` — a
third bespoke aggregator alongside `_axia_strategy_agg` and
`_fund_statement_strategy_agg`. For every strategy with `status ==
"Inactive"` and a `brokerage_account`, it walks all `internal_transfers` for
that account and computes:

```
baseline (Capital Invested) = Σ all-time Wallet → account transfers   (frozen, never reduced)
current equity               = 0.0                                    (closed — nothing left open)
realized P&L                 = Σ all-time account → Wallet transfers − baseline
```

Account↔account rebalances (e.g. the £100,000 Chase1→Chase3xA reallocation
on 27-03-2026) are excluded from both sides — same convention
`_get_net_deployed_per_account()` already uses — they're a relocation, not a
Chase-level capital event.

Folded into the same three-level bridge AXIA and 12-FLAGS use (§11.5),
plus the Breakdown/Hierarchy table's strategy branch, plus
`_strategy_capital_invested()` (given top priority there, ahead of the
generic `brokerage_account → net_deployed` branch, specifically for closed
strategies) — and a watermark-reapplication guard fix in
`get_strategies_with_kpis_fast` (the existing `if axia_contrib is None:`
watermark pass-through would otherwise silently overwrite this aggregator's
correct output; now reads `if axia_contrib is None and fund_contrib is None
and darwinex_contrib is None:`).

**Verified** by extracting the aggregator logic and running it standalone
against the corrected `internal_transfers` rows (§12.3):

| Strategy | Capital Invested | Closing return | Realized P&L | ROI |
|---|---|---|---|---|
| DARWIN-1X (Chase1) | £900,000.00¹ | £887,942.25 | **−£12,007.75** | ≈ −1.33% |
| DARWIN-3X (Chase3xA) | £238,173.76 | £226,223.26 | **−£11,950.50** | ≈ −5.02% |

¹ £1,000,000.00 ever deployed to Chase1, less £100,000.00 rebalanced
straight through to Chase3xA on 27-03-2026 (§12.3) — not a withdrawal, a
same-day relocation between two Chase strategies, so it's excluded from
Chase1's own Capital Invested/ROI base. Chase1's realized P&L is unaffected
either way (the rebalance leg cancels out of the P&L formula regardless of
whether it's included).

Combined real Darwinex P&L: **−£23,958.25** — versus the −£999,950+ the bug
was contributing before the fix.

**Two independent display paths — both needed a fix, not just one.** The
Breakdown/Hierarchy table (`BreakdownTable.jsx`) reads `row.pnl` straight
from the backend — `_darwinex_closed_strategy_agg`'s output alone is enough
to make that view correct. But the Portfolio page's Strategy Overview cards
(`OverviewCard` → `computeCapitalMetrics()` in `CapitalOverview.jsx`)
**don't trust the backend's `total_pnl` field at all** — they deliberately
recompute `pnl = current_equity + banked_profit − initial_investment`
client-side (see §4's note on why `total_pnl` alone is unsafe: it's a raw
broker-snapshot figure that ignores already-withdrawn profit). For a closed
Darwinex strategy, `current_equity` is correctly 0.0 (from the backend fix
above) and `initial_investment` is correctly the frozen historical total —
but `banked_profit` comes from a **separate** function,
`_banked_profit_by_strategy()`, which only counts `internal_transfers` rows
that carry an explicit `profit_loss_amount` classification. Leave those
unclassified (as they are today) and the Portfolio page's own formula
computes `0 + 0 − 1,000,000 = −£1,000,000` — the exact same class of bug,
recreated entirely client-side, downstream of a backend that's already
correct. **Both paths have to be right independently** — there's no single
choke point that guarantees it. See §12.3 for the classification this
requires.

### 12.3 Data reconciliation

Reconstructed from the Darwinex platform's own wallet History export
against what was already logged in `internal_transfers`. All 6 existing
rows turned out to be genuine (an initial read of the first, partial
History export made the £1,000 opening leg on Chase1 look like test data —
the full export shows it's real: the first of three tranches funding Chase1
from the wallet's two external deposits, £500,000 + £500,000 = £1,000,000
on 17/18-03-2026):

- **Added:** DARWIN-1X's final closing leg (Chase1 → Wallet, £887,942.25,
  22-05-2026) — previously missing entirely, which is why the strategy still
  showed its full historical basis as an open loss.
- **Added:** DARWIN-3X's mid-life top-up (Wallet → Chase3xA, £138,173.76,
  25-06-2026) — previously missing, so Capital Invested understated the
  true amount ever deployed to that account.
- **Added:** DARWIN-3X's final closing leg (Chase3xA → Wallet, £226,223.26,
  27-07-2026) — entered as **4 separate rows**, matching the Darwinex
  platform's own History export exactly (£100,000.00 + £100,000.00 +
  £25,000.00 + £1,223.26, all same-day), not combined into one row.
- **Excluded:** two same-minute "DarwinexIndex" wallet legs (25-06-2026,
  £138,173.76 in then immediately back out) — net zero at the wallet, money
  passed through that wrapper and straight back out without ever being
  economically held there. Not treated as a third strategy.
- **Out of scope for the strategy P&L bridge** (internal_transfers only) but
  worth checking separately in Capital Events for ledger completeness: the
  two external Bank⇄Wallet legs implied by this history — £1,000,000 in
  (two £500,000 deposits, 17 & 18-03-2026) and £976,223.26 out (£750,000 on
  22-05-2026 + £226,223.26 on 27-07-2026, both "Withdrawal | Transfer" rows).

**One leg is a rebalance, not a return — handled in code, not classification.**
The 27-03-2026 £100,000 leg (Chase1 → Wallet) isn't Chase1 taking profit —
same day, that exact £100,000 was redeployed Wallet → Chase3xA (it's the
seed capital for DARWIN-3X). Classifying it as Profit/Loss would falsely
show Chase1 "earning" £100,000 it just handed to a sibling strategy. Since
Capital Invested is architecturally frozen (§4, never reduced by any
withdrawal, classified or not), the only place this can be corrected without
distorting Chase1's realized P&L is the backend aggregator itself:
`_darwinex_closed_strategy_agg` now detects same-day, same-amount
`X → Wallet` + `Wallet → Y` pairs and reduces **X's baseline only** (Capital
Invested) by the matched amount — Y's baseline is untouched (that £100,000
is genuine new capital to Chase3xA). `pnl = returned − deployed` uses the
*unreduced* deployed figure, so this is algebraically invariant on realized
P&L — Chase1's loss stays exactly −£12,007.75, only its Capital
Invested/ROI base shrinks (£1,000,000 → £900,000, ROI −1.20% → −1.33%,
reflecting that only £900,000 was ever truly at risk *within* Chase1 for
its full life — the other £100,000 was passed straight through to
Chase3xA). **This row stays unclassified in the ledger** — no
`capital_return_amount`, no `profit_loss_amount` — it's neither, it's a
relocation.

**Every other `→ Wallet` return leg (not part of a same-day matched pair)
does need classification**, for the reason given above: the Breakdown table
only needs the backend aggregator, but the Portfolio page's
`computeCapitalMetrics()` needs `banked_profit`, which comes from
`_banked_profit_by_strategy()` — and that function only counts
`internal_transfers` rows carrying an explicit `capital_return_amount` /
`profit_loss_amount` split. Convention: **Capital Return = £0.00,
Profit/Loss = the full leg amount**, on every genuine (non-rebalance)
return leg.

| `internal_transfers` row | Direction | Amount | Capital Return | Profit/Loss |
|---|---|---|---|---|
| 27-03-2026, id=4 (existing) | Chase1 → Wallet | £100,000.00 | — | — (unclassified — rebalance to Chase3xA, see above) |
| 14-04-2026, id=6 (existing — edit) | Chase1 → Wallet | £50.00 | £0.00 | £50.00 |
| 22-05-2026 (new) | Chase1 → Wallet | £887,942.25 | £0.00 | £887,942.25 |
| 27-07-2026 (new, leg 1/4) | Chase3xA → Wallet | £100,000.00 | £0.00 | £100,000.00 |
| 27-07-2026 (new, leg 2/4) | Chase3xA → Wallet | £100,000.00 | £0.00 | £100,000.00 |
| 27-07-2026 (new, leg 3/4) | Chase3xA → Wallet | £25,000.00 | £0.00 | £25,000.00 |
| 27-07-2026 (new, leg 4/4) | Chase3xA → Wallet | £1,223.26 | £0.00 | £1,223.26 |

Sum of Profit/Loss classified above = −£12,007.75 for DARWIN-1X (50 +
887,942.25 = £887,992.25 banked − £900,000.00 reduced-baseline invested)
and −£11,950.50 for DARWIN-3X (100,000 + 100,000 + 25,000 + 1,223.26 =
£226,223.26 returned − £238,173.76 invested) — matching §12.2's
verification table exactly. Inbound `Wallet →` legs (the £1,000 / £499,000 /
£500,000 deployments to Chase1, the £100,000 initial + £138,173.76 top-up
to Chase3xA) are **not** classified — they're capital going out, not
coming back.

### 12.4 Known caveat

**"Capital Allocated" still shows the small unrecovered residual (e.g.
£12,007.75 for DARWIN-1X) as "still allocated," even though the strategy is
fully closed with nothing actually outstanding.** This stat is computed via
a separate formula (`Capital Invested − Total Withdrawn`, §4), and even with
the §12.3 classification in place (Capital Return = £0.00 on every
classified leg), `Total Withdrawn` only ever sums to the amount actually
returned (£887,992.25 of £900,000.00 for DARWIN-1X) — the unrecovered
£12,007.75
necessarily remains "allocated" by this formula's definition, because it
was never returned. This is expected, not a bug: it's the realized loss
amount, correctly surfaced as the gap between what was invested and what
came back. Total P&L and Total ROI (the numbers that were actually broken)
are both correct. Not requested to be fixed further.

---

## 13. Roadmap — Completed

- [x] **Phase 1 — Profit/Loss classification on withdrawals**
  SQL columns + constraint, backend banked-profit aggregation, frontend
  split-entry UI, wired into Capital Overview + Pod/Strategy cards.
- [x] **Phase 2 — Watermark / profit-share**
  SQL columns, `_apply_watermark()`, Strategy form fields, inline
  watermark badge + status badge on overview cards.
- [x] **Phase 3a — AXIA-TW real profit withdrawals recorded**
  £156,000 (15-04-2026) + £24,000 (06-07-2026), both classified as pure
  profit under ref "AXIA MARKET PRO".
- [x] **Ledger-wide date/layout consistency pass**
  All 6 ledger tabs use `fmtDate()` + the standard bold-date/amount-below
  row layout.
- [x] **Capital Allocated formula fix**
  Now subtracts full withdrawn amount (capital return + profit/loss),
  not just capital return.
- [x] **Total P&L formula fix**
  Always computed as `Equity + Banked − Invested`, no longer reliant on
  backend's disconnected raw `total_pnl` field.
- [x] **Banked Profit → Banked Profit / Loss rename**
  Applied across hero card, table, chart, small print, sign-aware
  colour/icon.
- [x] **Phase 4 — Verification pass**
  Formula reconciliation, hand-reconciled numbers, build/compile checks,
  no-regression check on other pods/strategies.
- [x] **Venue concept fully removed**
  Frontend + backend, 11 files, zero remaining references (verified via
  grep sweep).
- [x] **Number input UX fix**
  Profit/Loss and Profit Share % fields — no spinner arrows.
- [x] **Capital Flow Summary table visual padding fix**
  Row shading no longer flush against cell edges (incl. header top
  padding).
- [x] **Banked Profit/Loss drill-down modal** (§9)
  Click-through from hero card / table row to the full classified-leg
  breakdown, reusing existing ledger query keys.
- [x] **AXIA Daily Equity — pagination** (§10)
  50/page, Previous/Next, applies to every AXIA client.
- [x] **AXIA notes-clearing PATCH bug fix** (§10)
  `exclude_unset=True` instead of an `is not None` filter — explicit
  `null` fields now save correctly.
- [x] **12-FLAGS Fund Monthly Statement + OANDA FX bridge — full build** (§11)
  SQL table, `oanda_service.py`, `fund_statements.py` router,
  `Flags12StatementEntry.jsx`, 3-level strategy/pod/portfolio KPI bridge,
  YTD column, USD sub-line on the strategy card.
- [x] **OANDA candle-selection + date-labelling bug fixes** (§11.4)
  Monthly→daily granularity switch (fixed two different months returning
  the same rate); `+6h` broker-day correction (fixed a Friday close
  showing as the day before); nanosecond-timestamp parsing made
  Python-version-safe.
- [x] **USD sub-line on 12-FLAGS strategy card** (§11.6)
  Total P&L / Total ROI stay GBP; a small USD YTD sub-line underneath
  each makes the FX-translation effect explicit instead of reading as a
  discrepancy against the statement's own quoted return.
- [x] **Post-build bridge audit — Breakdown/Hierarchy table gap fixed** (§11.5)
  `get_hierarchy_rows`'s `entity_type == "strategy"` branch had no
  fund-statement awareness (built its own darwin/account aggregation
  independently of the strategy-KPI function) — 12-FLAGS would have shown
  £0 AUM/PnL specifically in the Breakdown table despite its Strategy
  Overview card already being correct. Added the same `fund_contrib`
  branch used everywhere else. No double-counting found elsewhere —
  verified `get_portfolio_kpis_fast`'s current_equity/total_pnl sum from
  the raw pfees snapshot, not from `pod_agg`, so the portfolio- and
  pod-level fund fold-ins are additive from separate base sums.
- [x] **Phase 3b — Darwinex real data entry + closed-strategy P&L bridge** (§12)
  DARWIN-1X and DARWIN-3X `internal_transfers` reconciled against the
  Darwinex platform's own complete wallet History export (3 missing legs
  added via the Darwinex Transfers tab). Found and fixed the actual root
  cause of the portfolio's −£2,731,618.31 / −75.61% P&L: a closed strategy
  with no live feed had its entire historical capital wiped out as loss
  instead of just the realized shortfall. New
  `_darwinex_closed_strategy_agg()` aggregator, wired through the same
  3-level bridge + Breakdown table + a watermark reapplication-guard fix.
  Verified standalone: DARWIN-1X −£12,007.75, DARWIN-3X −£11,950.50 (both
  ≈ realistic single-digit-% losses, not −100%).

---

## 14. Roadmap — Outstanding

- [ ] **Pod/portfolio-level watermark adjustment for non-AXIA strategies**
  See [§15](#15-known-limitations) — documented gap, not yet requested.

---

## 15. Known Limitations

**Watermark not applied at pod/portfolio level for non-AXIA strategies.**
`get_pods_with_kpis_fast` / `get_portfolio_kpis_fast` aggregate Darwinex/
manual strategy equity via `_build_pod_pfees_map`'s `pod_agg`, which sums
raw `pfees` rows directly — before per-strategy watermark resolution. This
path isn't additively isolable per-strategy the way the AXIA path is, so
watermark adjustment currently only reaches the strategy level for
non-AXIA strategies. Flagged to Nish; not yet requested to be fixed.

**12-FLAGS capital transfer (Wallet → Strategy) not yet logged.** The
£485,981.31 Ebury deposit (29-05-2026, Ref 1087948) is recorded in the
external ledger (`capital_events`) but not yet as an internal
`capital_transfers` Wallet→Strategy leg — Capital Invested for 12-FLAGS
currently comes from the strategy's manual `initial_investment` field
(`_strategy_capital_invested`'s fallback chain, §11.5), not the ledger.
Functionally correct today; log the internal transfer when convenient so
12-FLAGS moves onto the same ledger-sourced baseline as every other
strategy.

---

## 16. Dev Workflow

```bash
# Frontend
cd chase-dashboard-web
npm install
npm run dev          # http://localhost:5173

# Backend
cd chase-dashboard-web/backend
pip install -r requirements.txt
uvicorn src.main:app --reload   # http://localhost:8000
```

**Rules in force for all changes to this project:**
- Never run SQL directly — always hand over exact SQL + verification steps.
- Schema changes are additive-only (no drops/renames on live tables).
- Never push to git/Netlify unless explicitly asked.
- No scope creep — confirm before adding anything not explicitly requested.
- All UI must work on desktop and mobile.
