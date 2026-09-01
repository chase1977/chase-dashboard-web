// frontend/src/services/api.js
/**
 * All HTTP calls to the FastAPI backend.
 * Components never call fetch() directly — they use these functions.
 *
 * Base URL is empty in dev (Vite proxy /api → localhost:8000).
 * In production set VITE_API_BASE to your deployed backend URL.
 */

const BASE = import.meta.env.VITE_API_BASE ?? ''

async function get(path) {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${path} → ${res.status}: ${text}`)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

export function fetchPortfolio(timeRange = 'SI') {
  return get(`/api/portfolio/?time_range=${timeRange}`)
}

export function fetchDrillDown(entityId, timeRange = 'SI') {
  return get(`/api/portfolio/drilldown/${entityId}?time_range=${timeRange}`)
}

export function fetchHierarchyTable(entityType) {
  return get(`/api/portfolio/hierarchy/${entityType}`)
}

// ---------------------------------------------------------------------------
// Trader context — 2-tab breakdown (Pods | Strategies)
// ---------------------------------------------------------------------------

export function fetchTraderContext(entityId) {
  return get(`/api/portfolio/trader_context/${entityId}`)
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function downloadExcel(entityId = 'portfolio_main') {
  window.location.href = `${BASE}/api/reports/excel?entity_id=${entityId}`
}

export function downloadPdf() {
  window.location.href = `${BASE}/api/reports/pdf`
}

export function downloadCsv() {
  window.location.href = `${BASE}/api/reports/csv`
}

// ---------------------------------------------------------------------------
// CSV upload
// ---------------------------------------------------------------------------

export async function uploadCsv(file) {
  const form = new FormData()
  form.append('file', file, file.name)
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', body: form })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Upload failed (${res.status}): ${text}`)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Management — helpers
// ---------------------------------------------------------------------------

async function _post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!res.ok) { const t = await res.text(); throw new Error(t) }
  return res.json()
}

async function _patch(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!res.ok) { const t = await res.text(); throw new Error(t) }
  return res.json()
}

async function _delete(path) {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) { const t = await res.text(); throw new Error(t) }
}

// ---------------------------------------------------------------------------
// Management — Capital Events
// ---------------------------------------------------------------------------

export function fetchCapitalEvents() {
  return get('/api/management/capital-events')
}

export function createCapitalEvent({ event_date, event_type, amount, notes = '', reference = '' }) {
  return _post('/api/management/capital-events', { event_date, event_type, amount, notes, reference })
}

export function updateCapitalEvent(id, body) {
  return _patch(`/api/management/capital-events/${id}`, body)
}

export function deleteCapitalEvent(id) {
  return _delete(`/api/management/capital-events/${id}`)
}

export function fetchAccountIds() {
  return get('/api/management/account-ids')
}

export function fetchNetDeployed() {
  return get('/api/management/net-deployed')
}

// ---------------------------------------------------------------------------
// Management — Pods
// ---------------------------------------------------------------------------

export function fetchPods() {
  return get('/api/management/pods')
}

export function createPod(body) {
  return _post('/api/management/pods', body)
}

export function updatePod(id, body) {
  return _patch(`/api/management/pods/${id}`, body)
}

export function deletePod(id) {
  return _delete(`/api/management/pods/${id}`)
}

// ---------------------------------------------------------------------------
// Management — Strategies
// ---------------------------------------------------------------------------

export function fetchStrategies(podId) {
  return get(`/api/management/strategies${podId != null ? `?pod_id=${podId}` : ''}`)
}

export function createStrategy(body) {
  return _post('/api/management/strategies', body)
}

export function updateStrategy(id, body) {
  return _patch(`/api/management/strategies/${id}`, body)
}

export function deleteStrategy(id) {
  return _delete(`/api/management/strategies/${id}`)
}

// ---------------------------------------------------------------------------
// Management — Internal Transfers
// ---------------------------------------------------------------------------

export function fetchInternalTransfers() {
  return get('/api/management/internal-transfers')
}

export function createInternalTransfer(body) {
  return _post('/api/management/internal-transfers', body)
}

export function updateInternalTransfer(id, body) {
  return _patch(`/api/management/internal-transfers/${id}`, body)
}

export function deleteInternalTransfer(id) {
  return _delete(`/api/management/internal-transfers/${id}`)
}

// ---------------------------------------------------------------------------
// Management — Capital Transfers (Wallet / Pod / Strategy funding ledger)
// ---------------------------------------------------------------------------

export function fetchCapitalTransfers() {
  return get('/api/management/capital-transfers')
}

export function createCapitalTransfer(body) {
  return _post('/api/management/capital-transfers', body)
}

export function updateCapitalTransfer(id, body) {
  return _patch(`/api/management/capital-transfers/${id}`, body)
}

export function deleteCapitalTransfer(id) {
  return _delete(`/api/management/capital-transfers/${id}`)
}

// ---------------------------------------------------------------------------
// Management — Miscellaneous Events
// ---------------------------------------------------------------------------

export function fetchMiscEvents() {
  return get('/api/management/misc-events')
}

export function createMiscEvent(body) {
  return _post('/api/management/misc-events', body)
}

export function updateMiscEvent(id, body) {
  return _patch(`/api/management/misc-events/${id}`, body)
}

export function deleteMiscEvent(id) {
  return _delete(`/api/management/misc-events/${id}`)
}

// ---------------------------------------------------------------------------
// Management — Expenses
// ---------------------------------------------------------------------------

export function fetchExpenses() {
  return get('/api/management/expenses')
}

export function createExpense(body) {
  return _post('/api/management/expenses', body)
}

export function updateExpense(id, body) {
  return _patch(`/api/management/expenses/${id}`, body)
}

export function deleteExpense(id) {
  return _delete(`/api/management/expenses/${id}`)
}

// ---------------------------------------------------------------------------
// Management — Wages/Invoices
// ---------------------------------------------------------------------------

export function fetchWages() {
  return get('/api/management/wages')
}

export function createWage(body) {
  return _post('/api/management/wages', body)
}

export function updateWage(id, body) {
  return _patch(`/api/management/wages/${id}`, body)
}

export function deleteWage(id) {
  return _delete(`/api/management/wages/${id}`)
}

// ---------------------------------------------------------------------------
// AXIA Clients (Daily Equity — for Strategy linking)
// ---------------------------------------------------------------------------

export function fetchAxiaClients() {
  return get('/api/axia/clients')
}

// ---------------------------------------------------------------------------
// IG Clients (Daily Equity — for Strategy linking)
// Separate table/router from AXIA (see ig_equity.py) — same shape and
// purpose as fetchAxiaClients, just IG's own client/account pairs.
// ---------------------------------------------------------------------------

export function fetchIgClients() {
  return get('/api/ig/clients')
}

// ---------------------------------------------------------------------------
// Fund Monthly Statements (12-FLAGS and other NAV-administrator-reported
// funds with no daily broker feed) — linked directly to a strategy_id.
// ---------------------------------------------------------------------------

export function fetchFundStatements(strategyId, limit = 50, offset = 0) {
  return get(`/api/fund-statements?strategy_id=${strategyId}&limit=${limit}&offset=${offset}`)
}

export function fetchFundStatementPrev(strategyId, beforeDate) {
  return get(`/api/fund-statements/prev?strategy_id=${strategyId}&before_date=${beforeDate}`)
}

export function createFundStatement(body) {
  return _post('/api/fund-statements', body)
}

export function updateFundStatement(id, body) {
  return _patch(`/api/fund-statements/${id}`, body)
}

export function deleteFundStatement(id) {
  return _delete(`/api/fund-statements/${id}`)
}

export function refetchFundStatementFx(id) {
  return _post(`/api/fund-statements/${id}/refetch-fx`, {})
}

// ---------------------------------------------------------------------------
// Data Feeds — self-service tab-builder registry (see data_feeds.py).
// One row per user-created Data Feed tab. Daily-cadence feeds reuse
// AxiaEquityEntry.jsx via apiPrefix=`/api/data-feeds/{slug}`; monthly-cadence
// feeds use the generic statements CRUD below (mirrors fund-statements).
// ---------------------------------------------------------------------------

export function fetchDataFeeds() {
  return get('/api/data-feeds')
}

export function previewDataFeedSql(body) {
  return _post('/api/data-feeds/preview-sql', body)
}

export function createDataFeed(body) {
  return _post('/api/data-feeds', body)
}

export function updateDataFeed(id, body) {
  return _patch(`/api/data-feeds/${id}`, body)
}

export function deleteDataFeed(id) {
  return _delete(`/api/data-feeds/${id}`)
}

export function fetchDataFeedClients(slug) {
  return get(`/api/data-feeds/${slug}/clients`)
}

export function fetchDataFeedStatements(slug, strategyId, limit = 50, offset = 0) {
  return get(`/api/data-feeds/${slug}/statements?strategy_id=${strategyId}&limit=${limit}&offset=${offset}`)
}

export function fetchDataFeedStatementPrev(slug, strategyId, beforeDate) {
  return get(`/api/data-feeds/${slug}/statements/prev?strategy_id=${strategyId}&before_date=${beforeDate}`)
}

export function createDataFeedStatement(slug, body) {
  return _post(`/api/data-feeds/${slug}/statements`, body)
}

export function updateDataFeedStatement(slug, id, body) {
  return _patch(`/api/data-feeds/${slug}/statements/${id}`, body)
}

export function deleteDataFeedStatement(slug, id) {
  return _delete(`/api/data-feeds/${slug}/statements/${id}`)
}

export function refetchDataFeedStatementFx(slug, id) {
  return _post(`/api/data-feeds/${slug}/statements/${id}/refetch-fx`, {})
}