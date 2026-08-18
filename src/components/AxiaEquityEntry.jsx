// src/components/AxiaEquityEntry.jsx
/**
 * AXIA Daily Equity Entry — NLV + CHG NLV recording for AXIA strategy.
 * - Client/Account selector (dropdown if multiple, defaults to 4751R/47511)
 * - Date picker (default today, allows backdating)
 * - Currency selector (default GBP)
 * - Equity input (formatted 2dp + commas)
 * - CHG NLV: auto-fetched from prev record, manual override if not found
 * - Confirm / Discard with popup
 * - Records table with inline edit + delete
 */

import { useState, useEffect, useRef, useCallback } from 'react'

const BASE = import.meta.env.VITE_API_BASE ?? ''

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const C = {
  bg:           '#0D1B2E',
  card:         '#111C2B',
  border:       '#1E3A5F',
  text:         '#F1F5F9',
  textSub:      '#64748B',
  textMid:      '#94A3B8',
  accent:       '#38BDF8',
  accentDim:    'rgba(14,165,233,0.12)',
  accentBorder: 'rgba(14,165,233,0.35)',
  neg:          '#F87171',
  pos:          '#34D399',
  negDim:       'rgba(248,113,113,0.10)',
  posDim:       'rgba(52,211,153,0.10)',
  negBorder:    'rgba(248,113,113,0.28)',
  posBorder:    'rgba(52,211,153,0.28)',
  rowEven:      'rgba(255,255,255,0.02)',
  colBorder:    'rgba(255,255,255,0.06)',
  warn:         '#F59E0B',
  warnDim:      'rgba(245,158,11,0.10)',
  warnBorder:   'rgba(245,158,11,0.30)',
}

const CURRENCIES = ['GBP', 'EUR', 'USD', 'JPY', 'CHF', 'CAD', 'HKD']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const todayISO = () => new Date().toISOString().slice(0, 10)

const fmtNum = (v) => {
  if (v == null || v === '') return '—'
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (isNaN(n)) return '—'
  return n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const parseNum = (s) => {
  if (!s) return null
  const cleaned = String(s).replace(/,/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

// Format raw number string with commas as user types (allow minus, digits, dot)
const formatInput = (raw) => {
  const clean = raw.replace(/[^0-9.\-]/g, '')
  const parts = clean.split('.')
  const int   = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.length > 1 ? `${int}.${parts[1].slice(0, 2)}` : int
}

const fmtDate = (d) => {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}-${m}-${y}`
}

const numColor = (v) => v == null ? C.textMid : v < 0 ? C.neg : v > 0 ? C.pos : C.textMid

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Label({ children }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.7px',
      textTransform: 'uppercase', color: C.textSub, marginBottom: 6 }}>
      {children}
    </div>
  )
}

function Field({ children, style }) {
  return <div style={{ display: 'flex', flexDirection: 'column', ...style }}>{children}</div>
}

function Input({ value, onChange, placeholder, style, type = 'text', ...rest }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      {...rest}
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: 13,
        color: C.text,
        outline: 'none',
        width: '100%',
        boxSizing: 'border-box',
        fontFamily: 'inherit',
        ...style,
      }}
    />
  )
}

function Select({ value, onChange, children, style }) {
  return (
    <select
      value={value}
      onChange={onChange}
      style={{
        background: '#111C2B',
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: 13,
        color: C.text,
        outline: 'none',
        width: '100%',
        boxSizing: 'border-box',
        cursor: 'pointer',
        ...style,
      }}
    >
      {children}
    </select>
  )
}

function Btn({ children, onClick, variant = 'default', disabled, style }) {
  const variants = {
    default:  { bg: C.accentDim,  border: C.accentBorder, color: C.accent },
    confirm:  { bg: C.posDim,     border: C.posBorder,    color: C.pos    },
    discard:  { bg: 'transparent',border: C.border,       color: C.textSub},
    danger:   { bg: C.negDim,     border: C.negBorder,    color: C.neg    },
    warn:     { bg: C.warnDim,    border: C.warnBorder,   color: C.warn   },
  }
  const v = variants[variant] || variants.default
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '8px 18px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        border: `1px solid ${v.border}`,
        background: v.bg,
        color: disabled ? C.textSub : v.color,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

function ConfirmPopup({ message, onConfirm, onCancel, variant = 'confirm' }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#111C2B', border: `1px solid ${C.border}`,
        borderRadius: 10, padding: 28, maxWidth: 420, width: '90%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ fontSize: 14, color: C.text, marginBottom: 20, lineHeight: 1.6 }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="discard" onClick={onCancel}>Cancel</Btn>
          <Btn variant={variant} onClick={onConfirm}>Confirm</Btn>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function AxiaEquityEntry() {
  // ---- State ----
  const [clients,  setClients]  = useState([])
  const [records,  setRecords]  = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [success,  setSuccess]  = useState(null)

  // Form
  const [selClient,  setSelClient]  = useState(null)   // { id, client, account, label }
  const [date,       setDate]       = useState(todayISO())
  const [currency,   setCurrency]   = useState('GBP')
  const [equityRaw,  setEquityRaw]  = useState('')      // formatted string
  const [chgNlv,     setChgNlv]     = useState(null)    // number or null
  const [chgOverride,setChgOverride]= useState('')      // manual override raw
  const [prevRecord, setPrevRecord] = useState(null)    // { trade_date, equity }
  const [prevLoading,setPrevLoading]= useState(false)

  // New client form
  const [showNewClient, setShowNewClient] = useState(false)
  const [newClient,  setNewClient]  = useState('')
  const [newAccount, setNewAccount] = useState('')
  const [newLabel,   setNewLabel]   = useState('')
  const [clientSaving, setClientSaving] = useState(false)

  // Popups
  const [confirmPopup, setConfirmPopup] = useState(null)  // { message, onConfirm, variant }

  // Edit
  const [editId,       setEditId]       = useState(null)
  const [editEquity,   setEditEquity]   = useState('')
  const [editChgNlv,   setEditChgNlv]   = useState('')
  const [editDate,     setEditDate]     = useState('')
  const [editCurrency, setEditCurrency] = useState('GBP')
  const [editNotes,    setEditNotes]    = useState('')

  // ---- Load clients ----
  useEffect(() => {
    loadClients()
  }, [])

  const loadClients = async () => {
    try {
      const res  = await fetch(`${BASE}/api/axia/clients`)
      const data = await res.json()
      setClients(data)
      // Default to first client
      if (data.length > 0 && !selClient) {
        setSelClient(data[0])
      }
    } catch { /* silent */ }
  }

  // ---- Load records when client changes ----
  useEffect(() => {
    if (selClient) loadRecords()
  }, [selClient])

  const loadRecords = async () => {
    if (!selClient) return
    setLoading(true)
    try {
      const res  = await fetch(
        `${BASE}/api/axia/equity?client=${selClient.client}&account=${selClient.account}&limit=60`
      )
      const data = await res.json()
      setRecords(data)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }

  // ---- Fetch prev record when date / client / currency changes ----
  useEffect(() => {
    if (!selClient || !date) return
    let cancelled = false
    const fetch_ = async () => {
      setPrevLoading(true)
      try {
        const res  = await fetch(
          `${BASE}/api/axia/equity/prev?client=${selClient.client}&account=${selClient.account}&date=${date}&currency=${currency}`
        )
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setPrevRecord(data)
        }
      } catch { /* silent */ }
      finally { if (!cancelled) setPrevLoading(false) }
    }
    fetch_()
    return () => { cancelled = true }
  }, [selClient, date, currency])

  // ---- Auto-calculate CHG NLV as equity is typed ----
  useEffect(() => {
    const eq = parseNum(equityRaw)
    if (eq != null && prevRecord?.equity != null) {
      setChgNlv(+(eq - prevRecord.equity).toFixed(2))
      setChgOverride('')
    } else {
      setChgNlv(null)
    }
  }, [equityRaw, prevRecord])

  // ---- Equity input: format with commas ----
  const onEquityChange = (e) => {
    const raw = e.target.value.replace(/,/g, '')
    if (raw === '' || raw === '-') { setEquityRaw(raw); return }
    const n = parseFloat(raw)
    if (!isNaN(n)) {
      setEquityRaw(formatInput(raw))
    }
  }

  // ---- Submit ----
  const handleSubmit = () => {
    const eq = parseNum(equityRaw)
    if (!eq && eq !== 0) { setError('Enter a valid equity value.'); return }
    if (!selClient)       { setError('Select a client/account.'); return }

    const finalChg = chgNlv ?? parseNum(chgOverride) ?? null

    setConfirmPopup({
      variant: 'confirm',
      message: (
        <>
          <strong style={{ color: C.accent }}>Confirm entry</strong>
          <br /><br />
          <span style={{ color: C.textMid }}>Client:</span>{' '}
          <strong>{selClient.client} / {selClient.account}</strong><br />
          <span style={{ color: C.textMid }}>Date:</span>{' '}
          <strong>{fmtDate(date)}</strong><br />
          <span style={{ color: C.textMid }}>Currency:</span>{' '}
          <strong>{currency}</strong><br />
          <span style={{ color: C.textMid }}>Equity (NLV):</span>{' '}
          <strong style={{ color: C.accent }}>{fmtNum(eq)}</strong><br />
          <span style={{ color: C.textMid }}>CHG NLV:</span>{' '}
          <strong style={{ color: numColor(finalChg) }}>{fmtNum(finalChg)}</strong>
        </>
      ),
      onConfirm: () => submitRecord(eq, finalChg),
    })
  }

  const submitRecord = async (eq, finalChg) => {
    setConfirmPopup(null)
    setLoading(true); setError(null); setSuccess(null)
    try {
      const res = await fetch(`${BASE}/api/axia/equity`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client:     selClient.client,
          account:    selClient.account,
          trade_date: date,
          currency,
          equity:     eq,
          chg_nlv:    finalChg,
        }),
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.detail || 'Submit failed')
      }
      setSuccess(`Saved — ${fmtDate(date)} ${currency} ${fmtNum(eq)}`)
      setEquityRaw('')
      setChgNlv(null)
      setChgOverride('')
      await loadRecords()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  // ---- Delete ----
  const handleDelete = (id, tradeDate) => {
    setConfirmPopup({
      variant: 'danger',
      message: `Delete record for ${fmtDate(tradeDate)}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmPopup(null)
        await fetch(`${BASE}/api/axia/equity/${id}`, { method: 'DELETE' })
        await loadRecords()
      },
    })
  }

  // ---- Edit ----
  const startEdit = (row) => {
    setEditId(row.id)
    setEditEquity(fmtNum(row.equity).replace(/,/g, ''))
    setEditChgNlv(row.chg_nlv != null ? String(row.chg_nlv) : '')
    setEditDate(row.trade_date)
    setEditCurrency(row.currency)
    setEditNotes(row.notes || '')
  }

  const cancelEdit = () => { setEditId(null) }

  const saveEdit = (row) => {
    const newEq  = parseNum(editEquity)
    const newChg = parseNum(editChgNlv)
    setConfirmPopup({
      variant: 'warn',
      message: `Update ${fmtDate(editDate)} ${editCurrency} — equity to ${fmtNum(newEq)}, CHG NLV to ${fmtNum(newChg)}?`,
      onConfirm: async () => {
        setConfirmPopup(null)
        try {
          await fetch(`${BASE}/api/axia/equity/${row.id}`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              trade_date: editDate,
              currency:   editCurrency,
              equity:     newEq,
              chg_nlv:    newChg,
              notes:      editNotes || null,
            }),
          })
          setEditId(null)
          await loadRecords()
        } catch (e) { setError(e.message) }
      },
    })
  }

  // ---- Add client ----
  const saveNewClient = async () => {
    if (!newClient || !newAccount) return
    setClientSaving(true)
    try {
      const res = await fetch(`${BASE}/api/axia/clients`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: newClient, account: newAccount, label: newLabel }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail) }
      await loadClients()
      setShowNewClient(false)
      setNewClient(''); setNewAccount(''); setNewLabel('')
    } catch (e) { setError(e.message) }
    finally { setClientSaving(false) }
  }

  // ---- Computed chg display ----
  const displayChg = chgNlv ?? parseNum(chgOverride) ?? null

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div style={{ padding: '20px clamp(14px, 4vw, 24px) 28px' }}>
      <style>{`
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.6); cursor: pointer; }
        input::placeholder { color: #475569; }
        select option { background: #111C2B; }
      `}</style>

      {/* ── Client selector ── */}
      <div style={{ marginBottom: 20 }}>
        <Label>Client / Account</Label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {clients.length === 0 ? (
            <div style={{ fontSize: 12, color: C.textSub }}>No clients — add one below.</div>
          ) : clients.length === 1 ? (
            <div style={{
              padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: C.accentDim, border: `1px solid ${C.accentBorder}`, color: C.accent,
            }}>
              {clients[0].client} / {clients[0].account}
              {clients[0].label ? ` — ${clients[0].label}` : ''}
            </div>
          ) : (
            <Select
              value={selClient ? `${selClient.client}|${selClient.account}` : ''}
              onChange={e => {
                const [cl, ac] = e.target.value.split('|')
                setSelClient(clients.find(c => c.client === cl && c.account === ac))
              }}
              style={{ maxWidth: 320 }}
            >
              {clients.map(c => (
                <option key={c.id} value={`${c.client}|${c.account}`}>
                  {c.client} / {c.account}{c.label ? ` — ${c.label}` : ''}
                </option>
              ))}
            </Select>
          )}

          <Btn variant="default" onClick={() => setShowNewClient(v => !v)}
            style={{ fontSize: 11, padding: '7px 14px' }}>
            {showNewClient ? '✕ Cancel' : '+ New Client'}
          </Btn>
        </div>

        {/* New client inline form */}
        {showNewClient && (
          <div style={{
            marginTop: 14, padding: '16px 18px', borderRadius: 8,
            background: 'rgba(14,165,233,0.05)', border: `1px solid ${C.accentBorder}`,
            display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end',
          }}>
            <Field>
              <Label>Client ID</Label>
              <Input value={newClient} onChange={e => setNewClient(e.target.value.toUpperCase())}
                placeholder="4751R" style={{ width: 100 }} />
            </Field>
            <Field>
              <Label>Account</Label>
              <Input value={newAccount} onChange={e => setNewAccount(e.target.value)}
                placeholder="47511" style={{ width: 110 }} />
            </Field>
            <Field style={{ flex: 1, minWidth: 160 }}>
              <Label>Label (optional)</Label>
              <Input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                placeholder="Chase Capital – AXIA" />
            </Field>
            <Btn variant="confirm" onClick={saveNewClient} disabled={clientSaving || !newClient || !newAccount}>
              {clientSaving ? 'Saving…' : 'Save Client'}
            </Btn>
          </div>
        )}
      </div>

      {/* ── Entry form ── */}
      <div style={{
        padding: '18px 20px', borderRadius: 8,
        background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`,
        marginBottom: 20,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px',
          textTransform: 'uppercase', color: C.textSub, marginBottom: 16 }}>
          New Entry
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {/* Date */}
          <Field>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={{ width: 150 }} />
          </Field>

          {/* Currency */}
          <Field>
            <Label>Currency</Label>
            <Select value={currency} onChange={e => setCurrency(e.target.value)} style={{ width: 100 }}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>

          {/* Equity NLV */}
          <Field style={{ flex: 1, minWidth: 180 }}>
            <Label>Equity (NLV)</Label>
            <Input
              value={equityRaw}
              onChange={onEquityChange}
              placeholder="525,141.53"
              style={{ fontFamily: 'monospace', fontSize: 14, letterSpacing: '0.3px' }}
            />
          </Field>

          {/* CHG NLV */}
          <Field style={{ minWidth: 160 }}>
            <Label>
              CHG NLV
              {prevLoading && <span style={{ color: C.textSub, fontWeight: 400 }}> fetching…</span>}
              {prevRecord && !prevLoading && (
                <span style={{ color: C.textSub, fontWeight: 400 }}>
                  {' '}(vs {fmtDate(prevRecord.trade_date)})
                </span>
              )}
              {!prevRecord && !prevLoading && equityRaw && (
                <span style={{ color: C.warn, fontWeight: 400 }}> no prev — enter manually</span>
              )}
            </Label>
            {chgNlv != null ? (
              <div style={{
                padding: '8px 12px', borderRadius: 6, fontSize: 14, fontFamily: 'monospace',
                fontWeight: 600, letterSpacing: '0.3px',
                background: chgNlv < 0 ? C.negDim : C.posDim,
                border: `1px solid ${chgNlv < 0 ? C.negBorder : C.posBorder}`,
                color: chgNlv < 0 ? C.neg : C.pos,
              }}>
                {chgNlv >= 0 ? '+' : ''}{fmtNum(chgNlv)}
              </div>
            ) : (
              <Input
                value={chgOverride}
                onChange={e => setChgOverride(e.target.value)}
                placeholder="Override (optional)"
                style={{ fontFamily: 'monospace' }}
              />
            )}
          </Field>
        </div>

        {/* Prev record hint */}
        {prevRecord && (
          <div style={{ marginTop: 12, fontSize: 11, color: C.textSub }}>
            Previous record: {fmtDate(prevRecord.trade_date)} —
            {' '}<span style={{ color: C.textMid, fontFamily: 'monospace' }}>{fmtNum(prevRecord.equity)}</span>
            {' '}{currency}
          </div>
        )}

        {/* Error / success */}
        {error && (
          <div style={{
            marginTop: 12, padding: '9px 14px', borderRadius: 6,
            background: C.negDim, border: `1px solid ${C.negBorder}`,
            fontSize: 12, color: C.neg,
          }}>⚠ {error}</div>
        )}
        {success && (
          <div style={{
            marginTop: 12, padding: '9px 14px', borderRadius: 6,
            background: C.posDim, border: `1px solid ${C.posBorder}`,
            fontSize: 12, color: C.pos,
          }}>✓ {success}</div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <Btn variant="confirm" onClick={handleSubmit} disabled={!equityRaw || !selClient || loading}>
            {loading ? 'Saving…' : 'Submit Entry'}
          </Btn>
          <Btn variant="discard" onClick={() => {
            setConfirmPopup({
              variant: 'danger',
              message: 'Discard this entry? All unsaved values will be cleared.',
              onConfirm: () => {
                setEquityRaw(''); setChgNlv(null); setChgOverride('')
                setDate(todayISO()); setCurrency('GBP')
                setError(null); setSuccess(null)
                setConfirmPopup(null)
              },
            })
          }} disabled={!equityRaw}>
            Discard
          </Btn>
        </div>
      </div>

      {/* ── Records table ── */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px',
        textTransform: 'uppercase', color: C.textSub, marginBottom: 10 }}>
        Recent Records
        {selClient && (
          <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 8, color: C.textSub }}>
            — {selClient.client} / {selClient.account}
          </span>
        )}
      </div>

      {loading && records.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textSub, padding: '12px 0' }}>Loading…</div>
      ) : records.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textSub, padding: '12px 0' }}>No records yet.</div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 8, border: `1px solid ${C.border}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                {['DATE', 'CCY', 'EQUITY (NLV)', 'CHG NLV', 'NOTES', ''].map(h => (
                  <th key={h} style={{
                    background: C.bg, color: C.textSub, padding: '9px 12px',
                    textAlign: h === 'EQUITY (NLV)' || h === 'CHG NLV' ? 'right' : 'left',
                    fontWeight: 600, fontSize: 10, letterSpacing: '0.5px', whiteSpace: 'nowrap',
                    borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.colBorder}`,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((row, i) => (
                <tr key={row.id} style={{ background: i % 2 === 0 ? C.rowEven : 'transparent' }}>
                  {editId === row.id ? (
                    // ---- Edit row ----
                    <>
                      <td style={tdStyle()}>
                        <input type="date" value={editDate}
                          onChange={e => setEditDate(e.target.value)}
                          style={{ ...inlineInputStyle(), width: 130 }} />
                      </td>
                      <td style={tdStyle()}>
                        <select value={editCurrency}
                          onChange={e => setEditCurrency(e.target.value)}
                          style={{ ...inlineInputStyle(), width: 70, background: '#111C2B' }}>
                          {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                        </select>
                      </td>
                      <td style={tdStyle('right')}>
                        <input value={editEquity} onChange={e => setEditEquity(e.target.value)}
                          style={{ ...inlineInputStyle(), textAlign: 'right', width: 130, fontFamily: 'monospace' }} />
                      </td>
                      <td style={tdStyle('right')}>
                        <input value={editChgNlv} onChange={e => setEditChgNlv(e.target.value)}
                          style={{ ...inlineInputStyle(), textAlign: 'right', width: 110, fontFamily: 'monospace' }} />
                      </td>
                      <td style={tdStyle()}>
                        <input value={editNotes} onChange={e => setEditNotes(e.target.value)}
                          placeholder="Notes…"
                          style={{ ...inlineInputStyle(), width: '100%' }} />
                      </td>
                      <td style={tdStyle()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Btn variant="confirm" onClick={() => saveEdit(row)}
                            style={{ padding: '5px 12px', fontSize: 10 }}>Save</Btn>
                          <Btn variant="discard" onClick={cancelEdit}
                            style={{ padding: '5px 10px', fontSize: 10 }}>✕</Btn>
                        </div>
                      </td>
                    </>
                  ) : (
                    // ---- Display row ----
                    <>
                      <td style={tdStyle()}>{fmtDate(row.trade_date)}</td>
                      <td style={{ ...tdStyle(), color: C.accent, fontWeight: 600 }}>{row.currency}</td>
                      <td style={{ ...tdStyle('right'), fontFamily: 'monospace', fontWeight: 600, color: C.text }}>
                        {fmtNum(row.equity)}
                      </td>
                      <td style={{ ...tdStyle('right'), fontFamily: 'monospace', fontWeight: 600, color: numColor(row.chg_nlv) }}>
                        {row.chg_nlv != null ? (row.chg_nlv >= 0 ? '+' : '') + fmtNum(row.chg_nlv) : '—'}
                      </td>
                      <td style={{ ...tdStyle(), color: C.textSub, fontSize: 10 }}>{row.notes || '—'}</td>
                      <td style={tdStyle()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Btn variant="default" onClick={() => startEdit(row)}
                            style={{ padding: '4px 10px', fontSize: 10 }}>Edit</Btn>
                          <Btn variant="danger" onClick={() => handleDelete(row.id, row.trade_date)}
                            style={{ padding: '4px 8px', fontSize: 10 }}>✕</Btn>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm popup */}
      {confirmPopup && (
        <ConfirmPopup
          message={confirmPopup.message}
          variant={confirmPopup.variant}
          onConfirm={confirmPopup.onConfirm}
          onCancel={() => setConfirmPopup(null)}
        />
      )}
    </div>
  )
}

// ---- Style helpers ----
const tdStyle = (align = 'left') => ({
  padding: '8px 12px', textAlign: align, fontSize: 12, color: C.text,
  borderBottom: `1px solid ${C.colBorder}`, borderRight: `1px solid ${C.colBorder}`,
  whiteSpace: 'nowrap',
})

const inlineInputStyle = () => ({
  background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`,
  borderRadius: 4, padding: '4px 8px', fontSize: 11, color: C.text,
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
})
