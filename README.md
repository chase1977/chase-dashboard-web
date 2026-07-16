# Chase Capital — Multi-Strategy Portfolio Dashboard (Web)

Institutional-grade portfolio monitoring dashboard for Chase Capital. React + Vite frontend, FastAPI backend, Supabase database. Deployed on Netlify (frontend) and Railway (backend).

---

## Table of Contents

- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [Backend](#backend)
  - [Routers](#routers)
  - [Services](#services)
  - [Models](#models)
  - [Environment Variables](#environment-variables)
- [Frontend](#frontend)
  - [Pages](#pages)
  - [Components](#components)
  - [Hooks & Services](#hooks--services)
- [Running Locally](#running-locally)
- [API Endpoints](#api-endpoints)
  - [Portfolio](#portfolio-endpoints)
  - [Reports](#reports-endpoints)
  - [Management](#management-endpoints)
- [Database (Supabase)](#database-supabase)
- [Deployment](#deployment)
  - [Frontend — Netlify](#frontend--netlify)
  - [Backend — Railway](#backend--railway)
- [Dependencies](#dependencies)

---

## Project Structure

```
chase-dashboard-web/
├── README.md
├── index.html                        # Vite HTML entry point
├── vite.config.js                    # Vite config (proxy /api → :8000 in dev)
├── tailwind.config.js
├── postcss.config.js
├── package.json
├── netlify.toml                      # Netlify build + API redirect config
│
├── public/
│   └── chase-logo.png
│
├── src/                              # React frontend source
│   ├── main.jsx                      # App entry — ReactDOM.createRoot
│   ├── App.jsx                       # Router + global timeRange state
│   ├── index.css                     # Global dark theme base styles
│   │
│   ├── pages/
│   │   ├── AuthPage.jsx              # Login / sign-up page
│   │   ├── HomePage.jsx              # Landing / redirect page
│   │   ├── Portfolio.jsx             # Main portfolio dashboard
│   │   ├── DrillDown.jsx             # Entity drill-down (pod/strategy/trader/venue)
│   │   └── Reports.jsx               # Reports: download + CSV upload
│   │
│   ├── components/
│   │   ├── BankCard.jsx              # Bank balance display card
│   │   ├── ConfirmModal.jsx          # Generic confirmation modal
│   │   ├── FundLedgerCard.jsx        # Fund ledger + TWR card
│   │   ├── Logo.jsx                  # Chase Capital logo component
│   │   ├── PodStrategyManager.jsx    # Pod/strategy CRUD management panel
│   │   ├── SummaryCards.jsx          # KPI summary card grid
│   │   ├── SummaryStrip.jsx          # Compact top summary strip
│   │   │
│   │   ├── auth/
│   │   │   ├── ProtectedRoute.jsx    # Auth guard — redirects unauthenticated users
│   │   │   └── UserMenu.jsx          # Authenticated user dropdown menu
│   │   │
│   │   ├── cards/
│   │   │   ├── KpiCard.jsx           # Individual KPI metric card
│   │   │   └── KpiRow.jsx            # Horizontal row of KPI cards
│   │   │
│   │   ├── charts/
│   │   │   ├── DonutChart.jsx        # Allocation donut chart (Recharts)
│   │   │   ├── EquityChart.jsx       # Equity curve line chart (Recharts)
│   │   │   └── PnlBarChart.jsx       # PnL contribution bar chart (Recharts)
│   │   │
│   │   ├── layout/
│   │   │   └── Navbar.jsx            # Top nav — logo, tabs, time range selector, user menu
│   │   │
│   │   └── tables/
│   │       └── BreakdownTable.jsx    # Hierarchy breakdown table (pods/strategies/traders/venues)
│   │
│   ├── hooks/
│   │   └── usePortfolioData.js       # React Query hooks wrapping all API calls
│   │
│   ├── services/
│   │   └── api.js                    # All fetch() calls — components never call fetch() directly
│   │
│   └── lib/
│       └── supabase.js               # Supabase client (anon key, public-safe)
│
└── backend/
    ├── requirements.txt              # Python dependencies
    ├── Procfile                      # Railway process definition
    ├── .env.example                  # Environment variable template
    │
    └── src/
        ├── __init__.py
        ├── main.py                   # FastAPI app, CORS, router registration
        │
        ├── routers/
        │   ├── __init__.py
        │   ├── portfolio.py          # /api/portfolio/* — all portfolio data
        │   ├── reports.py            # /api/reports/* + /api/upload — reports & CSV upload
        │   └── management.py        # /api/management/* — CRUD for capital events, pods, strategies
        │
        ├── services/
        │   ├── __init__.py
        │   ├── supabase_service.py   # All Supabase queries (live data)
        │   ├── data_service.py       # CSV/file data fallback layer
        │   ├── demo_service.py       # Demo/seed data generator
        │   └── report_service.py     # Excel + PDF report generation
        │
        └── models/
            ├── __init__.py
            └── schemas.py            # Pydantic response schemas
```

---

## Architecture Overview

```
Browser (React + Vite)
        │
        │  /api/* (dev: Vite proxy → :8000)
        │  /api/* (prod: Netlify redirect → Railway)
        ▼
FastAPI Backend (Railway)
        │
        ├── Supabase (PostgreSQL) — live portfolio data
        │       user_pfees_estimation, balance_history, capital_events,
        │       pods, strategies, internal_transfers, misc_events
        │
        └── Report generation — openpyxl + reportlab (in-memory, no disk)
```

**Dev:** Vite proxies `/api/*` to `localhost:8000` (configured in `vite.config.js`).
**Prod:** Netlify `netlify.toml` redirects `/api/*` to the Railway backend URL.

---

## Backend

### Routers

| File | Prefix | Purpose |
|------|--------|---------|
| `routers/portfolio.py` | `/api/portfolio` | Portfolio home, drill-downs, hierarchy tabs, fund ledger |
| `routers/reports.py` | `/api/reports`, `/api/upload` | Excel/PDF/CSV downloads, CSV data upload |
| `routers/management.py` | `/api/management` | CRUD — capital events, pods, strategies, transfers, misc events |

### Services

| File | Purpose |
|------|---------|
| `supabase_service.py` | All live Supabase queries. KPIs, equity curve, pods, allocation, PnL bars, fund metrics (TWR, sub-periods, bank balance), CRUD operations |
| `data_service.py` | CSV/file-based data layer. Fallback when Supabase is not configured |
| `demo_service.py` | Demo data generator for development/seeding |
| `report_service.py` | Builds `.xlsx` (openpyxl) and `.pdf` (reportlab) in memory, returns bytes |

### Models

`models/schemas.py` — Pydantic v2 response models:
- `KpiData`, `PodSummary`, `EquityPoint`, `AllocationSlice`
- `PnlBar`, `BreakdownRow`, `HierarchyTableResponse`
- `PortfolioPageResponse`, `DrillDownPageResponse`, `TraderContextResponse`
- `FundLedgerSummary`, `SubPeriod`, `CapitalEvent`

### Environment Variables

Copy `backend/.env.example` and fill in:

```env
DATA_DIR=                              # Optional: path to CSV data directory
CORS_ORIGINS=*                         # Comma-separated allowed origins (prod: your Netlify URL)

# Supabase — service role key (backend only, NEVER expose to frontend)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

Frontend uses `.env.local` at the project root:

```env
VITE_API_BASE=                         # Leave empty for dev (Vite proxy handles it)
                                       # Prod: set to Railway backend URL
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

---

## Frontend

### Pages

| File | Route | Purpose |
|------|-------|---------|
| `AuthPage.jsx` | `/auth` | Login + sign-up via Supabase Auth |
| `HomePage.jsx` | `/home` | Landing redirect |
| `Portfolio.jsx` | `/`, `/pods`, `/strategies`, `/traders`, `/venues` | Main dashboard: KPI strip, equity chart, allocation donut, PnL bars, hierarchy table, fund ledger |
| `DrillDown.jsx` | `/drilldown/:entityId` | Entity-level breakdown — charts, metrics, 3-tab trader context |
| `Reports.jsx` | `/reports` | Download Excel/PDF/CSV + upload data CSVs |

### Components

| Component | Purpose |
|-----------|---------|
| `Navbar.jsx` | Top bar — logo, page tabs, time range selector (1D/7D/30D/YTD/SI), user menu |
| `SummaryStrip.jsx` | Compact KPI row at top of Portfolio |
| `SummaryCards.jsx` | Full KPI card grid below the strip |
| `KpiCard.jsx` | Single KPI metric tile (value + label + delta) |
| `KpiRow.jsx` | Horizontal layout of KpiCards |
| `EquityChart.jsx` | Recharts area chart — equity curve with time range filter |
| `DonutChart.jsx` | Recharts pie chart — AUM allocation by pod |
| `PnlBarChart.jsx` | Recharts bar chart — PnL contribution by pod |
| `BreakdownTable.jsx` | Sortable hierarchy table (pods / strategies / traders / venues tabs) |
| `FundLedgerCard.jsx` | TWR, sub-periods, bank balance, capital events ledger |
| `BankCard.jsx` | Bank balance display |
| `PodStrategyManager.jsx` | Add/edit/delete pods and strategies (management panel) |
| `ConfirmModal.jsx` | Generic delete confirmation dialog |
| `Logo.jsx` | Chase Capital branded logo |
| `ProtectedRoute.jsx` | Auth guard — redirects to `/auth` if not signed in |
| `UserMenu.jsx` | Authenticated user dropdown (email, sign out) |

### Hooks & Services

| File | Purpose |
|------|---------|
| `hooks/usePortfolioData.js` | React Query hooks — `usePortfolio()`, `useDrillDown()`, `useHierarchyTable()`, `useTraderContext()`. 60s stale time. |
| `services/api.js` | Raw fetch wrappers — `fetchPortfolio()`, `fetchDrillDown()`, `fetchHierarchyTable()`, `fetchTraderContext()`, `downloadExcel()`, `downloadPdf()`, `downloadCsv()`, `uploadCsv()` |
| `lib/supabase.js` | Supabase browser client (anon key, safe for frontend) |

---

## Running Locally

Two terminals required.

### Terminal 1 — Backend

```powershell
cd C:\Users\ravil\PycharmProjects\Chase-Capital\chase-dashboard-web\backend
pip install -r requirements.txt
python -m uvicorn src.main:app --reload --port 8000
```

API available at: `http://localhost:8000`
Swagger docs at: `http://localhost:8000/docs`

### Terminal 2 — Frontend

```powershell
cd C:\Users\ravil\PycharmProjects\Chase-Capital\chase-dashboard-web
npm install
npm run dev
```

App available at: `http://localhost:5173`

> Vite automatically proxies `/api/*` requests to `localhost:8000` — no CORS config needed in dev.

---

## API Endpoints

### Portfolio Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/portfolio/` | Full portfolio home page data: KPIs, equity curve, pods, allocation, PnL bars |
| `GET` | `/api/portfolio/drilldown/{entity_id}` | Drill-down data for any entity (pod, strategy, trader, venue) |
| `GET` | `/api/portfolio/trader_context/{entity_id}` | 3-tab trader breakdown (Venues, Pods, Strategies) |
| `GET` | `/api/portfolio/hierarchy/{entity_type}` | Hierarchy table rows — `entity_type`: `pod`, `strategy`, `trader`, `venue` |
| `GET` | `/api/portfolio/fund_ledger` | TWR, sub-periods, bank balance, capital events |

Query params: `?time_range=` accepts `1D`, `7D`, `30D`, `YTD`, `SI`

### Reports Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/reports/excel` | Download institutional Excel workbook (.xlsx) |
| `GET` | `/api/reports/pdf` | Download investor PDF report |
| `GET` | `/api/reports/csv` | Download full raw data CSV |
| `POST` | `/api/upload` | Upload data CSV file (`entities.csv`, `snapshots.csv`, or `equity_curve.csv`) |

### Management Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/management/capital-events` | List all capital events |
| `POST` | `/api/management/capital-events` | Record deposit or withdrawal |
| `PATCH` | `/api/management/capital-events/{id}` | Update capital event |
| `DELETE` | `/api/management/capital-events/{id}` | Delete capital event |
| `GET` | `/api/management/pods` | List all pods |
| `POST` | `/api/management/pods` | Create pod |
| `PATCH` | `/api/management/pods/{id}` | Update pod |
| `DELETE` | `/api/management/pods/{id}` | Delete pod |
| `GET` | `/api/management/strategies` | List strategies (optional `?pod_id=`) |
| `POST` | `/api/management/strategies` | Create strategy |
| `PATCH` | `/api/management/strategies/{id}` | Update strategy |
| `DELETE` | `/api/management/strategies/{id}` | Delete strategy |
| `GET` | `/api/management/internal-transfers` | List internal transfers |
| `POST` | `/api/management/internal-transfers` | Create internal transfer |
| `PATCH` | `/api/management/internal-transfers/{id}` | Update internal transfer |
| `DELETE` | `/api/management/internal-transfers/{id}` | Delete internal transfer |
| `GET` | `/api/management/misc-events` | List misc events |
| `POST` | `/api/management/misc-events` | Create misc event |
| `PATCH` | `/api/management/misc-events/{id}` | Update misc event |
| `DELETE` | `/api/management/misc-events/{id}` | Delete misc event |

---

## Database (Supabase)

All live data is stored in Supabase (PostgreSQL). Key tables:

| Table | Purpose |
|-------|---------|
| `user_pfees_estimation` | Performance fee estimation snapshots — AUM, PnL per entity per date |
| `balance_history` | Fund equity curve — date + NAV/balance time series |
| `capital_events` | Deposits and withdrawals with timestamps |
| `pods` | Pod definitions (name, description, active status) |
| `strategies` | Strategies linked to pods |
| `internal_transfers` | Inter-entity fund transfers |
| `misc_events` | Miscellaneous fund events |

**Two Supabase clients:**
- `backend/src/services/supabase_service.py` — uses service role key. Full read/write. Never exposed to browser.
- `src/lib/supabase.js` — uses anon key. Auth only (sign in/out). No direct data queries from frontend.

---

## Deployment

### Frontend — Netlify

Configured in `netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from   = "/api/*"
  to     = "https://chase-dashboard-web-production.up.railway.app/api/:splat"
  status = 200
  force  = true

[[redirects]]
  from   = "/*"
  to     = "/index.html"
  status = 200
```

The second redirect handles client-side routing (React Router) — all paths fall back to `index.html`.

Set in Netlify environment variables:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

### Backend — Railway

Configured via `backend/Procfile`. Railway auto-detects the Python runtime from `requirements.txt`.

Set in Railway environment variables:
```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
CORS_ORIGINS=https://your-app.netlify.app
PORT=8000
```

---

## Dependencies

### Backend (`requirements.txt`)

| Package | Purpose |
|---------|---------|
| `fastapi` | Web framework |
| `uvicorn[standard]` | ASGI server |
| `pandas` | Data manipulation |
| `numpy` | Numerical computations |
| `openpyxl` | Excel report generation |
| `reportlab` | PDF report generation |
| `python-multipart` | Multipart file upload support |
| `python-dotenv` | `.env` file loading |
| `pydantic` | Request/response validation |
| `supabase` | Supabase Python client |

### Frontend (`package.json`)

| Package | Purpose |
|---------|---------|
| `react` + `react-dom` | UI framework |
| `react-router-dom` | Client-side routing |
| `recharts` | Charts (equity curve, donut, bar) |
| `lucide-react` | Icon set |
| `@tanstack/react-query` | Server state management + caching |
| `@supabase/supabase-js` | Supabase auth client |
| `jszip` | ZIP file handling |
| `papaparse` | CSV parsing |
| `vite` | Build tool + dev server |
| `tailwindcss` | Utility-first CSS |
