// src/components/DataFeedManager.jsx
/**
 * Self-service "Data Feed" tab-builder — create/edit/delete rows in the
 * `data_feeds` registry (see backend/src/routers/data_feeds.py).
 *
 * Two-step creation flow (never runs SQL itself, confirmed with Nish
 * 2026-09-01):
 *   1. Fill in name/slug/cadence/currency/color -> "Generate SQL" calls
 *      POST /api/data-feeds/preview-sql (pure string templating, zero
 *      execution) -> exact CREATE TABLE text shown with a copy button.
 *   2. User runs that SQL once in Supabase, ticks "I've run this SQL" ->
 *      "Create Feed" fires POST /api/data-feeds, which only inserts the
 *      registry row (assumes the table(s) already exist).
 *
 * Once a feed exists it appears as a new colored tab in Data & Reports
 * (Reports.jsx) automatically, and as a selectable "Data Feed" in
 * PodStrategyManager.jsx to link a strategy to it.
 */

import { useState, useEffect } from 'react'
import {
  fetchDataFeeds, previewDataFeedSql, createDataFeed, updateDataFeed, deleteDataFeed,
} from '../services/api.js'

const C = {
  bg: '#0D1B2E', card: '#111C2B', border: '#1E3A5F', text: '#F1F5F9',
  textSub: '#64748B', textMid: '#94A3B8', accent: '#38BDF8',
  accentDim: 'rgba(14,165,233,0.12)', accentBorder: 'rgba(14,165,233,0.35)',
  neg: '#F87171', pos: '#34D399', negDim: 'rgba(248,113,113,0.10)',
  posDim: 'rgba(52,211,153,0.10)', negBorder: 'rgba(248,113,113,0.28)',
  posBorder: 'rgba(52,211,153,0.28)', warn: '#F59E0B',
}

const CURRENCIES = ['GBP', 'USD', 'EUR']
const SWATCHES = ['#38BDF8', '#a78bfa', '#fb923c', '#34D399', '#f472b6', '#f43f5e', '#facc15', '#22d3ee']

const slugify = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

function Label({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.7px', textTransform: 'uppercase', color: C.textSub, marginBottom: 6 }}>{children}</div>
}
function Field({ children, style }) { return <div style={{ display: 'flex', flexDirection: 'column', ...style }}>{children}</div> }
function Input(props) {
  const { style, ...rest } = props
  return <input {...rest} style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontSize: 13, color: C.text, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', ...style }} />
}
function Select(props) {
  const { style, children, ...rest } = props
  return <select {...rest} style={{ background: '#111C2B', border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontSize: 13, color: C.text, outline: 'none', width: '100%', boxSizing: 'border-box', cursor: 'pointer', ...style }}>{children}</select>
}
function Btn({ children, onClick, variant = 'default', disabled, style }) {
  const variants = {
    default: { bg: C.accentDim, border: C.accentBorder, color: C.accent },
    confirm: { bg: C.posDim, border: C.posBorder, color: C.pos },
    danger:  { bg: C.negDim, border: C.negBorder, color: C.neg },
    plain:   { bg: 'transparent', border: C.border, color: C.textSub },
  }
  const v = variants[variant] || variants.default
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
      border: `1px solid ${v.border}`, background: v.bg, color: disabled ? C.textSub : v.color,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, ...style,
    }}>{children}</button>
  )
}

export default function DataFeedManager({ onChanged }) {
  const [feeds, setFeeds] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [showNew, setShowNew] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [cadence, setCadence] = useState('daily')
  const [currency, setCurrency] = useState('GBP')
  const [color, setColor] = useState(SWATCHES[0])
  const [sortOrder, setSortOrder] = useState(0)

  const [sql, setSql] = useState(null)          // { slug, sql, ... } from preview
  const [ranSql, setRanSql] = useState(false)
  const [creating, setCreating] = useState(false)

  const [editId, setEditId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [editCurrency, setEditCurrency] = useState('')

  const load = async () => {
    setLoading(true)
    try { setFeeds(await fetchDataFeeds()) } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const resetForm = () => {
    setName(''); setSlug(''); setSlugTouched(false); setCadence('daily')
    setCurrency('GBP'); setColor(SWATCHES[0]); setSortOrder(0)
    setSql(null); setRanSql(false); setError(null)
  }

  const handleGenerateSql = async () => {
    setError(null)
    try {
      const body = { name: name.trim(), slug: slug.trim() || undefined, cadence }
      const res = await previewDataFeedSql(body)
      setSql(res)
      setRanSql(false)
    } catch (e) { setError(e.message) }
  }

  const handleCreate = async () => {
    if (!sql) return
    setCreating(true); setError(null)
    try {
      await createDataFeed({
        name: name.trim(), slug: sql.slug, cadence, currency, color, sort_order: Number(sortOrder) || 0,
      })
      resetForm()
      setShowNew(false)
      await load()
      onChanged?.()
    } catch (e) { setError(e.message) }
    finally { setCreating(false) }
  }

  const startEdit = (f) => {
    setEditId(f.id); setEditName(f.name); setEditColor(f.color); setEditCurrency(f.currency)
  }
  const saveEdit = async (f) => {
    try {
      await updateDataFeed(f.id, { name: editName, color: editColor, currency: editCurrency })
      setEditId(null)
      await load()
      onChanged?.()
    } catch (e) { setError(e.message) }
  }
  const handleDelete = async (f) => {
    if (!window.confirm(`Delete Data Feed "${f.name}"? Physical tables are kept — only the tab/registry entry is removed. Blocked if any strategy is still linked.`)) return
    try {
      await deleteDataFeed(f.id)
      await load()
      onChanged?.()
    } catch (e) { setError(e.message) }
  }

  return (
    <div style={{ padding: '18px 20px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: C.textSub }}>
          Data Feeds — Registered Tabs
        </div>
        <Btn onClick={() => { setShowNew(v => !v); if (showNew) resetForm() }} style={{ fontSize: 11, padding: '6px 14px' }}>
          {showNew ? '✕ Cancel' : '+ New Data Feed'}
        </Btn>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: '9px 14px', borderRadius: 6, background: C.negDim, border: `1px solid ${C.negBorder}`, fontSize: 12, color: C.neg }}>⚠ {error}</div>
      )}

      {/* ── New feed form ── */}
      {showNew && (
        <div style={{ marginBottom: 18, padding: '16px 18px', borderRadius: 8, background: 'rgba(14,165,233,0.05)', border: `1px solid ${C.accentBorder}` }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <Field style={{ flex: 1, minWidth: 180 }}>
              <Label>General Name</Label>
              <Input value={name} onChange={e => {
                setName(e.target.value)
                if (!slugTouched) setSlug(slugify(e.target.value))
              }} placeholder="e.g. INVESTGTX" />
            </Field>
            <Field style={{ minWidth: 160 }}>
              <Label>Slug (table prefix)</Label>
              <Input value={slug} onChange={e => { setSlug(slugify(e.target.value)); setSlugTouched(true) }} placeholder="investgtx" />
            </Field>
            <Field style={{ minWidth: 130 }}>
              <Label>Cadence</Label>
              <Select value={cadence} onChange={e => { setCadence(e.target.value); setSql(null) }}>
                <option value="daily">Daily (broker/CFD NLV)</option>
                <option value="monthly">Monthly (NAV statement)</option>
              </Select>
            </Field>
            <Field style={{ minWidth: 100 }}>
              <Label>Currency</Label>
              <Select value={currency} onChange={e => setCurrency(e.target.value)}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field style={{ minWidth: 90 }}>
              <Label>Sort Order</Label>
              <Input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} />
            </Field>
          </div>

          <Field style={{ marginBottom: 12 }}>
            <Label>Tab Colour</Label>
            <div style={{ display: 'flex', gap: 8 }}>
              {SWATCHES.map(sw => (
                <button key={sw} onClick={() => setColor(sw)} style={{
                  width: 26, height: 26, borderRadius: 6, background: sw, cursor: 'pointer',
                  border: color === sw ? `2px solid ${C.text}` : '2px solid transparent',
                }} />
              ))}
            </div>
          </Field>

          {!sql ? (
            <Btn variant="default" onClick={handleGenerateSql} disabled={!name.trim()}>
              Generate SQL
            </Btn>
          ) : (
            <div>
              <Label>Run this once in Supabase SQL editor</Label>
              <pre style={{
                background: '#050B14', border: `1px solid ${C.border}`, borderRadius: 6,
                padding: '12px 14px', fontSize: 11, color: '#94A3B8', overflowX: 'auto',
                whiteSpace: 'pre', marginBottom: 10,
              }}>{sql.sql}</pre>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                <Btn variant="plain" onClick={() => navigator.clipboard?.writeText(sql.sql)} style={{ fontSize: 11 }}>
                  Copy SQL
                </Btn>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textMid, cursor: 'pointer' }}>
                  <input type="checkbox" checked={ranSql} onChange={e => setRanSql(e.target.checked)} />
                  I've run this SQL in Supabase
                </label>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <Btn variant="confirm" onClick={handleCreate} disabled={!ranSql || creating}>
                  {creating ? 'Creating…' : 'Create Feed'}
                </Btn>
                <Btn variant="plain" onClick={() => setSql(null)}>Back</Btn>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Existing feeds list ── */}
      {loading ? (
        <div style={{ fontSize: 12, color: C.textSub }}>Loading…</div>
      ) : feeds.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textSub }}>No Data Feeds registered yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {feeds.map(f => (
            <div key={f.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px',
              borderRadius: 6, border: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.02)',
            }}>
              {editId === f.id ? (
                <>
                  <button onClick={() => {}} style={{ width: 14, height: 14, borderRadius: 4, background: editColor, border: 'none', flexShrink: 0 }} />
                  <Input value={editName} onChange={e => setEditName(e.target.value)} style={{ maxWidth: 180 }} />
                  <Select value={editCurrency} onChange={e => setEditCurrency(e.target.value)} style={{ maxWidth: 90 }}>
                    {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </Select>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {SWATCHES.map(sw => (
                      <button key={sw} onClick={() => setEditColor(sw)} style={{
                        width: 18, height: 18, borderRadius: 4, background: sw, cursor: 'pointer',
                        border: editColor === sw ? `2px solid ${C.text}` : '2px solid transparent',
                      }} />
                    ))}
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <Btn variant="confirm" onClick={() => saveEdit(f)} style={{ padding: '5px 12px', fontSize: 10 }}>Save</Btn>
                    <Btn variant="plain" onClick={() => setEditId(null)} style={{ padding: '5px 10px', fontSize: 10 }}>✕</Btn>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ width: 14, height: 14, borderRadius: 4, background: f.color, flexShrink: 0 }} />
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{f.name}</div>
                  <div style={{ fontSize: 10, color: C.textSub, fontFamily: 'monospace' }}>{f.slug}</div>
                  <div style={{ fontSize: 10, color: C.textMid, textTransform: 'uppercase' }}>{f.cadence}</div>
                  <div style={{ fontSize: 10, color: C.textMid }}>{f.currency}</div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <Btn variant="default" onClick={() => startEdit(f)} style={{ padding: '4px 10px', fontSize: 10 }}>Edit</Btn>
                    <Btn variant="danger" onClick={() => handleDelete(f)} style={{ padding: '4px 10px', fontSize: 10 }}>Delete</Btn>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
