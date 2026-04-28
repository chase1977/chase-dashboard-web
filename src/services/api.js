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
// Trader context — 3-tab breakdown (Venues | Pods | Strategies)
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

export function createCapitalEvent({ event_date, event_type, amount, notes = '' }) {
  return _post('/api/management/capital-events', { event_date, event_type, amount, notes })
}

export function deleteCapitalEvent(id) {
  return _delete(`/api/management/capital-events/${id}`)
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