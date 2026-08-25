// src/components/Flags12StatementEntry.jsx
/**
 * 12-FLAGS Monthly Statement Entry — NAV Fund Services Investor Statement
 * (12 Flags Cayman Feeder Fund Limited), reported monthly in USD.
 *
 * Auto-resolves the linked strategy (strategy_code "12-FLAGS", pod "FUNDS
 * (External)") from Manage Pods & Strategies — no client picker needed,
 * unlike AXIA, since this is one statement stream per strategy.
 *
 * You key in ONE number each month: Ending Balance (USD) from the
 * statement's "Ending Balance" row. Beginning Balance auto-carries from
 * last month's Ending Balance (fetched from the previous record); Net
 * Income and Rate of Return % are computed live as you type, matching the
 * statement's own MTD figures exactly:
 *   Net Income     = Ending − Beginning − Additions + Redemptions
 *   Rate of Return = Net Income ÷ Beginning × 100
 *
 * GBP conversion happens server-side on save — OANDA GBP_USD monthly close
 * candle for the statement's period, GBP = USD ÷ rate. The latest record's
 * Ending Balance (GBP) feeds this strategy's Current Equity on the
 * Portfolio page (same mechanism as AXIA's daily equity, at pod/portfolio
 * level too) — automatically, no extra wiring needed once saved.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  fetchStrategies, fetchFundStatements, fetchFundStatementPrev,
  createFundStatement, updateFundStatement, deleteFundStatement, refetchFundStatementFx,
} from '../services/api.js'

// ---------------------------------------------------------------------------
// Theme — matches AxiaEquityEntry
// ---------------------------------------------------------------------------
const C = {
  bg: '#0D1B2E', card: '#111C2B', border: '#1E3A5F', text: '#F1F5F9',
  textSub: '#64748B', textMid: '#94A3B8', accent: '#38BDF8',
  accentDim: 'rgba(14,165,233,0.12)', accentBorder: 'rgba(14,165,233,0.35)',
  neg: '#F87171', pos: '#34D399', negDim: 'rgba(248,113,113,0.10)',
  posDim: 'rgba(52,211,153,0.10)', negBorder: 'rgba(248,113,113,0.28)',
  posBorder: 'rgba(52,211,153,0.28)', rowEven: 'rgba(255,255,255,0.02)',
  colBorder: 'rgba(255,255,255,0.06)', warn: '#F59E0B',
  warnDim: 'rgba(245,158,11,0.10)', warnBorder: 'rgba(245,158,11,0.30)',
}

const STRATEGY_CODE = '12-FLAGS'
const PAGE_SIZE = 50

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const todayISO = () => new Date().toISOString().slice(0, 10)

const fmtNum = (v, decimals = 2) => {
  if (v == null || v === '') return '—'
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (isNaN(n)) return '—'
  return n.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

const parseNum = (s) => {
  if (s === '' || s == null) return null
  const cleaned = String(s).replace(/,/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

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
// Sub-components — matches AxiaEquityEntry's style helpers
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
      type={type} value={value} onChange={onChange} placeholder={placeholder} {...rest}
      style={{
        background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`,
        borderRadius: 6, padding: '8px 12px', fontSize: 13, color: C.text,
        outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
        ...style,
      }}
    />
  )
}

function Btn({ children, onClick, variant = 'default', disabled, style }) {
  const variants = {
    default: { bg: C.accentDim, border: C.accentBorder, color: C.accent },
    confirm: { bg: C.posDim,    border: C.posBorder,    color: C.pos    },
    discard: { bg: 'transparent', border: C.border,     color: C.textSub},
    danger:  { bg: C.negDim,    border: C.negBorder,    color: C.neg    },
    warn:    { bg: C.warnDim,   border: C.warnBorder,   color: C.warn   },
  }
  const v = variants[variant] || variants.default
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '8px 18px', borderRadius: 6, fontSize: 12, fontWeight: 600,
      border: `1px solid ${v.border}`, background: v.bg,
      color: disabled ? C.textSub : v.color, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1, transition: 'all 0.15s', ...style,
    }}>
      {children}
    </button>
  )
}

function ConfirmPopup({ message, onConfirm, onCancel, variant = 'confirm' }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#111C2B', border: `1px solid ${C.border}`,
        borderRadius: 10, padding: 28, maxWidth: 440, width: '90%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ fontSize: 14, color: C.text, marginBottom: 20, lineHeight: 1.6 }}>{message}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="discard" onClick={onCancel}>Cancel</Btn>
          <Btn variant={variant} onClick={onConfirm}>Confirm</Btn>
        </div>
      </div>
    </div>
  )
}

// Daily candles should always land within a few days of period_end
// (weekends/holidays at most). > 10 days apart means OANDA couldn't return
// a genuine period-matching candle — usually a future-dated period.
function isFxStale(row) {
  if (!row.fx_rate_date) return false
  const diffDays = Math.abs((new Date(row.fx_rate_date) - new Date(row.period_end_date)) / 86400000)
  return diffDays > 10
}

// FX badge — shows the OANDA rate used, flags a stale/mismatched fetch, and
// always offers a manual refresh (e.g. to re-pull a rate saved before a
// fix, or before this period's real market data existed)
function FxBadge({ row, onRetry, retrying }) {
  if (row.currency !== 'USD') return null
  if (row.fx_rate != null) {
    const stale = isFxStale(row)
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: stale ? C.warn : C.textSub, fontFamily: 'monospace' }}>
            GBP/USD {fmtNum(row.fx_rate, 4)} ({fmtDate(row.fx_rate_date)} close)
          </span>
          <Btn variant={stale ? 'warn' : 'default'} onClick={onRetry} disabled={retrying} style={{ padding: '1px 7px', fontSize: 9 }}>
            {retrying ? '…' : '↻'}
          </Btn>
        </span>
        {stale && (
          <span style={{ fontSize: 9.5, color: C.warn }}>rate doesn't match this period — click ↻ to re-fetch</span>
        )}
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 10, color: C.warn }}>FX pending</span>
      <Btn variant="warn" onClick={onRetry} disabled={retrying} style={{ padding: '2px 8px', fontSize: 9 }}>
        {retrying ? 'Retrying…' : 'Retry'}
      </Btn>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function Flags12StatementEntry() {
  const [strategy,   setStrategy]   = useState(null)   // resolved 12-FLAGS strategy row
  const [strategyErr,setStrategyErr]= useState(null)
  const [records,    setRecords]    = useState([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [success,    setSuccess]    = useState(null)

  const [page,       setPage]       = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  // Form
  const [date,        setDate]        = useState(todayISO())
  const [endingRaw,    setEndingRaw]   = useState('')
  const [showExtras,   setShowExtras]  = useState(false)
  const [additionsRaw, setAdditionsRaw]= useState('')
  const [redemptionsRaw, setRedemptionsRaw] = useState('')
  const [beginOverride, setBeginOverride]   = useState('')   // manual, only when no prev record
  const [notes,        setNotes]       = useState('')
  const [prevRecord,   setPrevRecord]  = useState(null)
  const [prevLoading,  setPrevLoading] = useState(false)

  const [confirmPopup, setConfirmPopup] = useState(null)
  const [editId,       setEditId]       = useState(null)
  const [editEnding,   setEditEnding]   = useState('')
  const [editDate,     setEditDate]     = useState('')
  const [editNotes,    setEditNotes]    = useState('')
  const [deletingId,   setDeletingId]   = useState(null)
  const [retryingId,   setRetryingId]   = useState(null)

  // ---- Resolve the 12-FLAGS strategy ----
  useEffect(() => {
    (async () => {
      try {
        const strategies = await fetchStrategies()
        // Lenient match — ignores case, hyphens/spaces (so "12-FLAGS", "12 Flags",
        // "12FLAGS" all resolve) and checks both strategy_code and name.
        const norm  = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
        const target = norm(STRATEGY_CODE)
        const match = strategies.find(s => norm(s.strategy_code) === target || norm(s.name) === target)
        if (!match) {
          const available = strategies.map(s => `${s.name} (${s.strategy_code || 'no code'})`).join(', ') || 'none found'
          setStrategyErr(`No strategy matching "${STRATEGY_CODE}" found. Existing strategies: ${available}. Check the strategy_code field in Manage Pods & Strategies, or tell me the exact name/code to match.`)
          return
        }
        setStrategy(match)
      } catch (e) { setStrategyErr(e.message) }
    })()
  }, [])

  const loadRecords = useCallback(async (p = page) => {
    if (!strategy) return
    setLoading(true)
    try {
      const data = await fetchFundStatements(strategy.id, PAGE_SIZE, p * PAGE_SIZE)
      setRecords(data.rows ?? [])
      setTotalCount(data.total ?? 0)
    } catch { /* silent */ }
    finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy])

  useEffect(() => { if (strategy) { setPage(0); loadRecords(0) } }, [strategy]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (strategy) loadRecords(page) }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Fetch prev record when date changes — auto-carries Beginning Balance ----
  useEffect(() => {
    if (!strategy || !date) return
    let cancelled = false
    ;(async () => {
      setPrevLoading(true)
      try {
        const data = await fetchFundStatementPrev(strategy.id, date)
        if (!cancelled) setPrevRecord(data)
      } catch { /* silent */ }
      finally { if (!cancelled) setPrevLoading(false) }
    })()
    return () => { cancelled = true }
  }, [strategy, date])

  // ---- Live-computed preview ----
  const ending      = parseNum(endingRaw)
  const additions   = parseNum(additionsRaw) ?? 0
  const redemptions = parseNum(redemptionsRaw) ?? 0
  const beginning    = prevRecord ? prevRecord.ending_balance : parseNum(beginOverride)
  const netIncome    = (ending != null && beginning != null) ? +(ending - beginning - additions + redemptions).toFixed(2) : null
  const rateOfReturn = (netIncome != null && beginning) ? +(netIncome / beginning * 100).toFixed(2) : null

  const canSubmit = ending != null && beginning != null && strategy

  // ---- Submit ----
  const handleSubmit = () => {
    if (!canSubmit) { setError('Enter Ending Balance (and Beginning Balance if this is the first record).'); return }
    setConfirmPopup({
      variant: 'confirm',
      message: (
        <>
          <strong style={{ color: C.accent }}>Confirm 12-FLAGS entry</strong><br /><br />
          <span style={{ color: C.textMid }}>Period Ended:</span> <strong>{fmtDate(date)}</strong><br />
          <span style={{ color: C.textMid }}>Beginning Balance:</span> <strong>${fmtNum(beginning)}</strong><br />
          <span style={{ color: C.textMid }}>Ending Balance:</span> <strong style={{ color: C.accent }}>${fmtNum(ending)}</strong><br />
          <span style={{ color: C.textMid }}>Net Income:</span> <strong style={{ color: numColor(netIncome) }}>{netIncome >= 0 ? '+' : ''}${fmtNum(netIncome)}</strong><br />
          <span style={{ color: C.textMid }}>Rate of Return:</span> <strong style={{ color: numColor(rateOfReturn) }}>{rateOfReturn >= 0 ? '+' : ''}{fmtNum(rateOfReturn)}%</strong><br />
          <div style={{ marginTop: 10, fontSize: 11, color: C.textSub }}>
            GBP conversion (OANDA GBP/USD monthly close) is fetched automatically on save.
          </div>
        </>
      ),
      onConfirm: submitRecord,
    })
  }

  const submitRecord = async () => {
    setConfirmPopup(null)
    setLoading(true); setError(null); setSuccess(null)
    try {
      await createFundStatement({
        strategy_id:       strategy.id,
        period_end_date:   date,
        currency:          'USD',
        beginning_balance: beginning,
        additions,
        redemptions,
        ending_balance:    ending,
        notes:             notes.trim() || null,
      })
      setSuccess(`Saved — ${fmtDate(date)} $${fmtNum(ending)}`)
      setEndingRaw(''); setAdditionsRaw(''); setRedemptionsRaw(''); setBeginOverride(''); setNotes('')
      setPage(0)
      await loadRecords(0)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  // ---- Edit ----
  const startEdit = (row) => {
    setEditId(row.id)
    setEditEnding(fmtNum(row.ending_balance).replace(/,/g, ''))
    setEditDate(row.period_end_date)
    setEditNotes(row.notes || '')
  }
  const cancelEdit = () => setEditId(null)

  const saveEdit = (row) => {
    const newEnding = parseNum(editEnding)
    setConfirmPopup({
      variant: 'warn',
      message: `Update ${fmtDate(editDate)} — Ending Balance to $${fmtNum(newEnding)}? Net Income and Rate of Return recompute automatically.`,
      onConfirm: async () => {
        setConfirmPopup(null)
        try {
          await updateFundStatement(row.id, {
            period_end_date: editDate, ending_balance: newEnding, notes: editNotes || null,
          })
          setEditId(null)
          await loadRecords()
        } catch (e) { setError(e.message) }
      },
    })
  }

  // ---- Delete ----
  const handleDelete = (id, periodDate) => {
    setConfirmPopup({
      variant: 'danger',
      message: `Delete the ${fmtDate(periodDate)} statement entry? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmPopup(null)
        setDeletingId(id)
        try { await deleteFundStatement(id); await loadRecords() }
        finally { setDeletingId(null) }
      },
    })
  }

  // ---- Retry FX ----
  const handleRetryFx = async (id) => {
    setRetryingId(id)
    try { await refetchFundStatementFx(id); await loadRecords() }
    finally { setRetryingId(null) }
  }

  // ---------------------------------------------------------------------------
  if (strategyErr) {
    return (
      <div style={{ padding: '20px clamp(14px, 4vw, 24px) 28px' }}>
        <div style={{ padding: '12px 16px', borderRadius: 8, background: C.warnDim,
          border: `1px solid ${C.warnBorder}`, fontSize: 12, color: C.warn }}>
          ⚠ {strategyErr}
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px clamp(14px, 4vw, 24px) 28px' }}>
      <style>{`
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.6); cursor: pointer; }
        input::placeholder { color: #475569; }
      `}</style>

      {/* ── Linked strategy banner ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18,
        padding: '8px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600,
        background: 'rgba(168,85,247,0.10)', border: '1px solid rgba(168,85,247,0.28)', color: '#c084fc',
      }}>
        Linked to strategy: {strategy?.name ?? STRATEGY_CODE} ({STRATEGY_CODE}) — Pod: FUNDS (External)
      </div>

      {/* ── Entry form ── */}
      <div style={{ padding: '18px 20px', borderRadius: 8, background: 'rgba(255,255,255,0.02)',
        border: `1px solid ${C.border}`, marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase',
          color: C.textSub, marginBottom: 16 }}>
          New Monthly Statement
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field>
            <Label>Period End Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 160 }} />
          </Field>

          <Field style={{ flex: 1, minWidth: 200 }}>
            <Label>Ending Balance (USD)</Label>
            <Input
              value={endingRaw}
              onChange={e => {
                const raw = e.target.value.replace(/,/g, '')
                if (raw === '' || raw === '-') { setEndingRaw(raw); return }
                if (!isNaN(parseFloat(raw))) setEndingRaw(formatInput(raw))
              }}
              placeholder="633,211.98"
              style={{ fontFamily: 'monospace', fontSize: 14, letterSpacing: '0.3px' }}
            />
          </Field>

          <Field style={{ minWidth: 200 }}>
            <Label>
              Beginning Balance (USD)
              {prevLoading && <span style={{ color: C.textSub, fontWeight: 400 }}> fetching…</span>}
              {prevRecord && !prevLoading && (
                <span style={{ color: C.textSub, fontWeight: 400 }}> (from {fmtDate(prevRecord.period_end_date)})</span>
              )}
              {!prevRecord && !prevLoading && (
                <span style={{ color: C.warn, fontWeight: 400 }}> no prior record — enter manually</span>
              )}
            </Label>
            {prevRecord ? (
              <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: 14, fontFamily: 'monospace',
                fontWeight: 600, background: 'rgba(148,163,184,0.06)', border: `1px solid ${C.border}`, color: C.textMid }}>
                ${fmtNum(prevRecord.ending_balance)}
              </div>
            ) : (
              <Input value={beginOverride} onChange={e => setBeginOverride(formatInput(e.target.value.replace(/,/g, '')))}
                placeholder="e.g. 650,000.00 (first record)" style={{ fontFamily: 'monospace' }} />
            )}
          </Field>
        </div>

        {/* Additions / Redemptions — optional, collapsed by default */}
        <div style={{ marginTop: 12 }}>
          <button onClick={() => setShowExtras(v => !v)} style={{
            background: 'none', border: 'none', color: C.accent, fontSize: 11, fontWeight: 600,
            cursor: 'pointer', padding: 0,
          }}>
            {showExtras ? '− Hide' : '+ Add'} Additions / Redemptions (only if the statement shows any this period)
          </button>
          {showExtras && (
            <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
              <Field style={{ minWidth: 160 }}>
                <Label>Additions (USD)</Label>
                <Input value={additionsRaw} onChange={e => setAdditionsRaw(formatInput(e.target.value.replace(/,/g, '')))}
                  placeholder="0.00" style={{ fontFamily: 'monospace' }} />
              </Field>
              <Field style={{ minWidth: 160 }}>
                <Label>Redemptions (USD)</Label>
                <Input value={redemptionsRaw} onChange={e => setRedemptionsRaw(formatInput(e.target.value.replace(/,/g, '')))}
                  placeholder="0.00" style={{ fontFamily: 'monospace' }} />
              </Field>
            </div>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <Label>Notes (optional)</Label>
          <Input type="text" value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="e.g. NAV Fund Services statement, Investor No. 1005" />
        </div>

        {/* Live preview — auto-computed as you type */}
        {(netIncome != null) && (
          <div style={{ marginTop: 14, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ padding: '10px 14px', borderRadius: 6, minWidth: 160,
              background: netIncome < 0 ? C.negDim : C.posDim, border: `1px solid ${netIncome < 0 ? C.negBorder : C.posBorder}` }}>
              <div style={{ fontSize: 9.5, color: C.textSub, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Net Income (auto)</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: numColor(netIncome) }}>
                {netIncome >= 0 ? '+' : ''}${fmtNum(netIncome)}
              </div>
            </div>
            <div style={{ padding: '10px 14px', borderRadius: 6, minWidth: 160,
              background: rateOfReturn < 0 ? C.negDim : C.posDim, border: `1px solid ${rateOfReturn < 0 ? C.negBorder : C.posBorder}` }}>
              <div style={{ fontSize: 9.5, color: C.textSub, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Rate of Return (auto)</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: numColor(rateOfReturn) }}>
                {rateOfReturn >= 0 ? '+' : ''}{fmtNum(rateOfReturn)}%
              </div>
            </div>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, padding: '9px 14px', borderRadius: 6, background: C.negDim,
            border: `1px solid ${C.negBorder}`, fontSize: 12, color: C.neg }}>⚠ {error}</div>
        )}
        {success && (
          <div style={{ marginTop: 12, padding: '9px 14px', borderRadius: 6, background: C.posDim,
            border: `1px solid ${C.posBorder}`, fontSize: 12, color: C.pos }}>✓ {success}</div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <Btn variant="confirm" onClick={handleSubmit} disabled={!canSubmit || loading}>
            {loading ? 'Saving…' : 'Submit Entry'}
          </Btn>
          <Btn variant="discard" onClick={() => {
            setEndingRaw(''); setAdditionsRaw(''); setRedemptionsRaw(''); setBeginOverride('')
            setNotes(''); setDate(todayISO()); setError(null); setSuccess(null)
          }} disabled={!endingRaw}>
            Discard
          </Btn>
        </div>
      </div>

      {/* ── Records table ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: C.textSub }}>
          All Statements — {STRATEGY_CODE}
        </div>
        {totalCount > 0 && (
          <div style={{ fontSize: 10.5, color: C.textSub }}>{totalCount} total record{totalCount === 1 ? '' : 's'}</div>
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
                {['PERIOD END', 'BEGINNING ($)', 'ENDING ($)', 'NET INCOME ($)', 'RETURN %', 'YTD ($ / %)', 'FX / ENDING (£)', 'NOTES', ''].map(h => (
                  <th key={h} style={{
                    background: C.bg, color: C.textSub, padding: '9px 12px',
                    textAlign: ['BEGINNING ($)', 'ENDING ($)', 'NET INCOME ($)', 'RETURN %', 'YTD ($ / %)'].includes(h) ? 'right' : 'left',
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
                    <>
                      <td style={tdStyle()}>
                        <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                          style={{ ...inlineInputStyle(), width: 130 }} />
                      </td>
                      <td style={tdStyle('right')}>{fmtNum(row.beginning_balance)}</td>
                      <td style={tdStyle('right')}>
                        <input value={editEnding} onChange={e => setEditEnding(e.target.value)}
                          style={{ ...inlineInputStyle(), textAlign: 'right', width: 120, fontFamily: 'monospace' }} />
                      </td>
                      <td style={tdStyle('right')} colSpan={2}>— recomputes on save —</td>
                      <td style={tdStyle('right')}>—</td>
                      <td style={tdStyle()}>—</td>
                      <td style={tdStyle()}>
                        <input value={editNotes} onChange={e => setEditNotes(e.target.value)}
                          placeholder="Notes…" style={{ ...inlineInputStyle(), width: '100%' }} />
                      </td>
                      <td style={tdStyle()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Btn variant="confirm" onClick={() => saveEdit(row)} style={{ padding: '5px 12px', fontSize: 10 }}>Save</Btn>
                          <Btn variant="discard" onClick={cancelEdit} style={{ padding: '5px 10px', fontSize: 10 }}>✕</Btn>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={tdStyle()}>{fmtDate(row.period_end_date)}</td>
                      <td style={{ ...tdStyle('right'), fontFamily: 'monospace', color: C.textMid }}>{fmtNum(row.beginning_balance)}</td>
                      <td style={{ ...tdStyle('right'), fontFamily: 'monospace', fontWeight: 600, color: C.text }}>{fmtNum(row.ending_balance)}</td>
                      <td style={{ ...tdStyle('right'), fontFamily: 'monospace', fontWeight: 600, color: numColor(row.net_income) }}>
                        {row.net_income >= 0 ? '+' : ''}{fmtNum(row.net_income)}
                      </td>
                      <td style={{ ...tdStyle('right'), fontFamily: 'monospace', fontWeight: 600, color: numColor(row.rate_of_return_pct) }}>
                        {row.rate_of_return_pct >= 0 ? '+' : ''}{fmtNum(row.rate_of_return_pct)}%
                      </td>
                      <td style={{ ...tdStyle('right'), fontFamily: 'monospace' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
                          <span style={{ fontWeight: 600, color: numColor(row.ytd_net_income) }}>
                            {row.ytd_net_income >= 0 ? '+' : ''}{fmtNum(row.ytd_net_income)}
                          </span>
                          <span style={{ fontSize: 10, color: numColor(row.ytd_return_pct) }}>
                            {row.ytd_return_pct >= 0 ? '+' : ''}{fmtNum(row.ytd_return_pct)}%
                          </span>
                        </div>
                      </td>
                      <td style={tdStyle()}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <FxBadge row={row} retrying={retryingId === row.id} onRetry={() => handleRetryFx(row.id)} />
                          {row.ending_balance_gbp != null && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: C.text, fontFamily: 'monospace' }}>
                              £{fmtNum(row.ending_balance_gbp)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ ...tdStyle(), color: C.textSub, fontSize: 10 }}>{row.notes || '—'}</td>
                      <td style={tdStyle()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Btn variant="default" onClick={() => startEdit(row)} style={{ padding: '4px 10px', fontSize: 10 }}>Edit</Btn>
                          <Btn variant="danger" onClick={() => handleDelete(row.id, row.period_end_date)}
                            disabled={deletingId === row.id} style={{ padding: '4px 8px', fontSize: 10 }}>✕</Btn>
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

      {/* Pagination */}
      {totalCount > PAGE_SIZE && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: 11, color: C.textSub }}>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Btn variant="default" disabled={page === 0 || loading} onClick={() => setPage(p => Math.max(0, p - 1))}
              style={{ padding: '6px 14px', fontSize: 11 }}>← Previous</Btn>
            <div style={{ fontSize: 11, color: C.textMid, minWidth: 90, textAlign: 'center' }}>
              Page {page + 1} of {Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}
            </div>
            <Btn variant="default" disabled={(page + 1) * PAGE_SIZE >= totalCount || loading} onClick={() => setPage(p => p + 1)}
              style={{ padding: '6px 14px', fontSize: 11 }}>Next →</Btn>
          </div>
        </div>
      )}

      {confirmPopup && (
        <ConfirmPopup message={confirmPopup.message} variant={confirmPopup.variant}
          onConfirm={confirmPopup.onConfirm} onCancel={() => setConfirmPopup(null)} />
      )}
    </div>
  )
}

// ---- Style helpers ----
const tdStyle = (align = 'left') => ({
  padding: '8px 12px', textAlign: align, fontSize: 12, color: C.text,
  borderBottom: `1px solid ${C.colBorder}`, borderRight: `1px solid ${C.colBorder}`, whiteSpace: 'nowrap',
})

const inlineInputStyle = () => ({
  background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, borderRadius: 4,
  padding: '4px 8px', fontSize: 11, color: C.text, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
})
