// frontend/src/components/SummaryStrip.jsx
/**
 * SummaryStrip — 4 equal-sized metric cards replacing BankCard + FundLedgerCard.
 *
 * Cards:
 *   1. Money Allocated  — bank_balance (net), deposited / withdrawn sub-lines → Ledger modal
 *   2. Current AUM      — current_aum (display only)
 *   3. TWR              — time-weighted return → Sub-period breakdown modal
 *   4. Total PnL        — total_pnl since inception → Equity curve modal
 *
 * Props:
 *   data        {FundLedgerSummary}  from /api/portfolio/fund_ledger
 *   equityCurve {EquityPoint[]}      from Portfolio page (equity_curve)
 *   loading     {boolean}
 */

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { X, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Calendar, ChevronRight, Info, Plus, Trash2, Pencil, Wallet, Layers, TrendingUp, TrendingDown } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import {
  createCapitalEvent, updateCapitalEvent, deleteCapitalEvent,
  fetchInternalTransfers, createInternalTransfer, updateInternalTransfer, deleteInternalTransfer,
  fetchCapitalTransfers, createCapitalTransfer, updateCapitalTransfer, deleteCapitalTransfer,
  fetchPods, fetchStrategies,
  fetchMiscEvents, createMiscEvent, updateMiscEvent, deleteMiscEvent,
  fetchExpenses, createExpense, updateExpense, deleteExpense,
  fetchWages, createWage, updateWage, deleteWage,
} from '../services/api.js'
import ConfirmModal from './ConfirmModal.jsx'

// ---------------------------------------------------------------------------
// Account list — Darwinex investor accounts
// ---------------------------------------------------------------------------
const ACCOUNTS = ['Wallet', 'Chase1', 'Chase3xA', 'XPF2026']
const MISC_TYPES = ['Rebate', 'Service Cost', 'Fee', 'Commission', 'Interest', 'Other']

// ---------------------------------------------------------------------------
// CONFIGURABLE
// ---------------------------------------------------------------------------
const COUNT_DURATION_MS = 1800

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatCurrency(val) {
  if (val === null || val === undefined) return '—'
  const abs  = Math.abs(val)
  const sign = val < 0 ? '-' : val > 0 ? '+' : ''
  return `${sign}£${abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatCurrencyAbs(val) {
  if (val === null || val === undefined) return '—'
  const abs = Math.abs(val)
  return `£${abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPct(val, decimals = 2) {
  if (val === null || val === undefined) return '—'
  const pct  = val * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(decimals)}%`
}

// UK convention: DD-MM-YYYY
function fmtDate(str) {
  if (!str) return '—'
  const d = new Date(str + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')
}

// Compact axis-tick form — DD-MM, no year (space-constrained chart ticks only)
function fmtTimestamp(str) {
  if (!str) return '—'
  const d = new Date(str)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }).replace(/\//g, '-')
}

// ---------------------------------------------------------------------------
// Count-up animation hook
// ---------------------------------------------------------------------------

function useCountUp(target, duration = COUNT_DURATION_MS) {
  const [value, setValue] = useState(0)
  const rafRef = useRef(null)

  useEffect(() => {
    if (target === null || target === undefined) return
    const start = performance.now()
    const tick  = (now) => {
      const elapsed  = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased    = 1 - Math.pow(1 - progress, 3) // ease-out cubic
      setValue(target * eased)
      if (progress < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])

  return value
}

// ---------------------------------------------------------------------------
// useEscClose — close modal on Escape
// ---------------------------------------------------------------------------

function useEscClose(onClose) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])
}

// ---------------------------------------------------------------------------
// Modal Shell
// ---------------------------------------------------------------------------

function Modal({ title, subtitle, onClose, children, wide = false }) {
  useEscClose(onClose)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className={`relative z-10 w-full ${wide ? 'max-w-3xl' : 'max-w-2xl'} max-h-[85vh]
                    overflow-hidden bg-[#0d1117] border border-slate-700/50 rounded-2xl
                    shadow-[0_25px_80px_rgba(0,0,0,0.6)] flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/40 flex-shrink-0">
          <div>
            <h2 className="text-sm font-bold text-slate-100 tracking-wide">{title}</h2>
            {subtitle && (
              <p className="text-[10px] text-slate-500 mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-700/50 hover:bg-slate-600/50
                       flex items-center justify-center transition-colors flex-shrink-0"
          >
            <X size={14} className="text-slate-400" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 py-5
                        scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
          {children}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal 1 — Ledger (3-tab: Capital Events | Internal Transfers | Misc)
// ---------------------------------------------------------------------------

function todayISO() { return new Date().toISOString().slice(0, 10) }
function isoToDDMMYYYY(iso) { return iso ? iso.split('-').reverse().join('-') : '' }

// Shared input / button styles used across all 3 sub-forms
const INPUT_STYLE = {
  width: '100%', background: '#111C2B', border: '1px solid #1E3A5F',
  borderRadius: 7, padding: '8px 10px', fontSize: 12, color: '#E2E8F0',
  outline: 'none', boxSizing: 'border-box',
}
const BTN_SM_STYLE = {
  padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
  fontSize: 11, fontWeight: 600, color: '#fff', transition: 'background 0.15s',
}

// Reusable comma-formatted amount input
// Stores raw numeric string in state; displays with thousand separators
function AmountInput({ value, onChange, style, required }) {
  function toDisplay(raw) {
    if (!raw && raw !== 0) return ''
    const [intPart, decPart] = String(raw).split('.')
    const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return decPart !== undefined ? `${formatted}.${decPart}` : formatted
  }

  function handleChange(e) {
    let raw = e.target.value.replace(/,/g, '').replace(/[^0-9.]/g, '')
    const dots = raw.split('.')
    if (dots.length > 2) raw = dots[0] + '.' + dots.slice(1).join('')
    onChange(raw)
  }

  function handleBlur() {
    const n = parseFloat(value)
    if (!isNaN(n) && n > 0) onChange(n.toFixed(2))
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={toDisplay(value)}
      onChange={handleChange}
      onBlur={handleBlur}
      style={style}
      required={required}
      placeholder="0.00"
    />
  )
}

// Typable date field — DD-MM-YYYY, auto-inserts dashes while typing, validates
// on blur. Calendar-icon picker still available as an alternative to typing.
// `value`/`onChange` remain ISO "YYYY-MM-DD" (what the backend expects) —
// this component only changes what the user sees and types.
function DateField({ value, onChange, label }) {
  const ref = useRef(null)
  const [text, setText] = useState(value ? isoToDDMMYYYY(value) : '')

  // Keep display text in sync when value changes externally (e.g. picker, edit-open)
  useEffect(() => { setText(value ? isoToDDMMYYYY(value) : '') }, [value])

  function handleTextChange(e) {
    let digits = e.target.value.replace(/\D/g, '').slice(0, 8)
    let out = digits
    if (digits.length > 4) out = `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`
    else if (digits.length > 2) out = `${digits.slice(0, 2)}-${digits.slice(2)}`
    setText(out)
  }

  function commit() {
    const m = text.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/)
    if (m) {
      const [, dd, mm, yyyy] = m
      const iso = `${yyyy}-${mm}-${dd}`
      const d = new Date(iso + 'T00:00:00')
      const valid = !isNaN(d.getTime()) && d.getUTCDate() === Number(dd) && (d.getUTCMonth() + 1) === Number(mm)
      if (valid) { onChange(iso); return }
    }
    // Invalid or incomplete — snap back to last known-good value
    setText(value ? isoToDDMMYYYY(value) : '')
  }

  return (
    <div>
      <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
        letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>{label ?? 'Date (DD-MM-YYYY)'}</label>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          type="text"
          inputMode="numeric"
          placeholder="DD-MM-YYYY"
          value={text}
          onChange={handleTextChange}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
          style={{ flex: 1, ...INPUT_STYLE, paddingRight: 34 }}
        />
        <div style={{ position: 'absolute', right: 8 }}>
          <input ref={ref} type="date" value={value}
            onChange={e => { onChange(e.target.value); setText(isoToDDMMYYYY(e.target.value)) }}
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
          <button type="button" onClick={() => ref.current?.showPicker()}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              padding: 2, display: 'flex', alignItems: 'center' }}>
            <Calendar size={14} color="#475569" />
          </button>
        </div>
      </div>
    </div>
  )
}

// Row with edit + delete icons
// Icons stacked vertically (not side by side) — reclaims the dead space to
// the right of the date/amount column instead of stretching the card wider.
function EventRow({ children, onEdit, onDelete }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
        <button onClick={onEdit}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3,
            borderRadius: 5, display: 'flex', color: '#475569' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#38BDF8' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#475569' }}
          title="Edit">
          <Pencil size={12} />
        </button>
        <button onClick={onDelete}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3,
            borderRadius: 5, display: 'flex', color: '#475569' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#f87171' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#475569' }}
          title="Delete">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

// ── Tab 1: Capital Events ─────────────────────────────────────────────────

function CapitalEventsTab({ data, queryClient }) {
  const events = data?.events ?? []

  const [showForm,   setShowForm]   = useState(false)
  const [formType,   setFormType]   = useState('deposit')
  const [formDate,   setFormDate]   = useState(todayISO())
  const [formAmount, setFormAmount] = useState('')
  const [formRef,    setFormRef]    = useState('')
  const [formNotes,  setFormNotes]  = useState('')
  const [formError,  setFormError]  = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const [editEv,     setEditEv]     = useState(null)
  const [editType,   setEditType]   = useState('deposit')
  const [editDate,   setEditDate]   = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editRef,    setEditRef]    = useState('')
  const [editNotes,  setEditNotes]  = useState('')
  const [editError,  setEditError]  = useState(null)
  const [editSaving, setEditSaving] = useState(false)

  const [deletingId, setDeletingId] = useState(null)
  const [deleting,   setDeleting]   = useState(false)

  const formScrollRef = useRef(null)
  useEffect(() => {
    if (editEv) formScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editEv])

  function openAdd(type) {
    setEditEv(null); setFormType(type); setFormDate(todayISO())
    setFormAmount(''); setFormRef(''); setFormNotes(''); setFormError(null); setShowForm(true)
  }

  async function handleAdd(e) {
    e.preventDefault(); setFormError(null)
    const amt = parseFloat(formAmount)
    if (isNaN(amt) || amt <= 0) return setFormError('Enter valid amount > 0')
    if (!formDate) return setFormError('Select a date')
    setSubmitting(true)
    try {
      await createCapitalEvent({ event_date: formDate, event_type: formType,
        amount: parseFloat(amt.toFixed(2)), notes: formNotes.trim(), reference: formRef.trim() })
      await queryClient.invalidateQueries({ queryKey: ['fund_ledger'] })
      setShowForm(false)
    } catch (err) { setFormError(err.message ?? 'Failed') }
    finally { setSubmitting(false) }
  }

  function openEdit(ev) {
    setShowForm(false); setEditEv(ev); setEditType(ev.event_type)
    setEditDate(ev.date); setEditAmount(String(Math.abs(ev.amount)))
    setEditRef(ev.reference ?? ''); setEditNotes(ev.notes ?? ''); setEditError(null)
  }

  async function handleUpdate(e) {
    e.preventDefault(); setEditError(null)
    const amt = parseFloat(editAmount)
    if (isNaN(amt) || amt <= 0) return setEditError('Enter valid amount > 0')
    if (!editDate) return setEditError('Select a date')
    setEditSaving(true)
    try {
      await updateCapitalEvent(editEv.event_id ?? editEv.id, {
        event_date: editDate, event_type: editType,
        amount: parseFloat(amt.toFixed(2)), notes: editNotes.trim(), reference: editRef.trim(),
      })
      await queryClient.invalidateQueries({ queryKey: ['fund_ledger'] })
      setEditEv(null)
    } catch (err) { setEditError(err.message ?? 'Failed') }
    finally { setEditSaving(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteCapitalEvent(deletingId)
      await queryClient.invalidateQueries({ queryKey: ['fund_ledger'] })
    } finally { setDeleting(false); setDeletingId(null) }
  }

  function renderCapitalForm(isEdit) {
    const type      = isEdit ? editType   : formType
    const isDeposit = type === 'deposit'
    const setType   = isEdit ? setEditType   : setFormType
    const date      = isEdit ? editDate   : formDate
    const setDate   = isEdit ? setEditDate   : setFormDate
    const amount    = isEdit ? editAmount : formAmount
    const setAmount = isEdit ? setEditAmount : setFormAmount
    const reference = isEdit ? editRef    : formRef
    const setReference = isEdit ? setEditRef : setFormRef
    const notes     = isEdit ? editNotes  : formNotes
    const setNotes  = isEdit ? setEditNotes  : setFormNotes
    const error     = isEdit ? editError  : formError
    const saving    = isEdit ? editSaving : submitting
    const onSubmit  = isEdit ? handleUpdate : handleAdd
    const onCancel  = isEdit ? () => setEditEv(null) : () => setShowForm(false)

    return (
      <form ref={isEdit ? formScrollRef : null} onSubmit={onSubmit} style={{
        background: isDeposit ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)',
        border: `1px solid ${isDeposit ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`,
        borderRadius: 10, padding: '14px 16px', marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px',
            color: isDeposit ? '#34d399' : '#f87171' }}>
            {isEdit ? 'Edit Event' : `New ${isDeposit ? 'Deposit' : 'Withdrawal'}`}
          </span>
          {isEdit && (
            <div style={{ display: 'flex', gap: 6 }}>
              {['deposit','withdrawal'].map(t => (
                <button key={t} type="button" onClick={() => setType(t)} style={{
                  padding: '3px 10px', borderRadius: 6, border: 'none', fontSize: 10,
                  fontWeight: 600, cursor: 'pointer',
                  background: type === t ? (t==='deposit'?'rgba(52,211,153,0.25)':'rgba(248,113,113,0.25)') : 'rgba(71,85,105,0.3)',
                  color: type === t ? (t==='deposit'?'#34d399':'#f87171') : '#64748B',
                }}>{t==='deposit'?'Deposit':'Withdrawal'}</button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 10 }}>
          <DateField value={date} onChange={setDate} />
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Amount (£)</label>
            <AmountInput value={amount} onChange={setAmount} style={INPUT_STYLE} required />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
            letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Reference (optional)</label>
          <input type="text" placeholder="e.g. statement ref / txn ID"
            value={reference} onChange={e => setReference(e.target.value)} style={INPUT_STYLE} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
            letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Notes (optional)</label>
          <input type="text" placeholder="e.g. Monthly top-up"
            value={notes} onChange={e => setNotes(e.target.value)} style={INPUT_STYLE} />
        </div>
        {error && <p style={{ fontSize: 11, color: '#f87171', marginBottom: 10 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={saving} style={{ ...BTN_SM_STYLE,
            background: isDeposit ? '#22c55e' : '#ef4444', opacity: saving ? 0.65 : 1 }}>
            {saving ? 'Saving…' : isEdit ? 'Update' : `Save ${isDeposit ? 'Deposit' : 'Withdrawal'}`}
          </button>
          <button type="button" onClick={onCancel} disabled={saving}
            style={{ ...BTN_SM_STYLE, background: '#374151', opacity: saving ? 0.5 : 1 }}>Cancel</button>
        </div>
      </form>
    )
  }

  return (
    <>
      {/* Summary bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Net Position',    value: formatCurrency(data?.bank_balance),       color: (data?.bank_balance??0)>=0?'#34d399':'#f87171' },
          { label: 'Total Deposited', value: formatCurrencyAbs(data?.total_deposited),  color: '#34d399' },
          { label: 'Total Withdrawn', value: formatCurrencyAbs(data?.total_withdrawn),  color: '#f87171' },
        ].map(s => (
          <div key={s.label} style={{ background: 'rgba(30,41,59,0.4)', border: '1px solid rgba(51,65,85,0.3)',
            borderRadius: 10, padding: '10px 14px' }}>
            <p style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>{s.label}</p>
            <p style={{ fontSize: 15, fontWeight: 700, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      {!editEv && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button onClick={() => openAdd('deposit')} style={{ display: 'flex', alignItems: 'center',
            gap: 6, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
            fontWeight: 600, background: 'rgba(52,211,153,0.15)', color: '#34d399',
            border: '1px solid rgba(52,211,153,0.25)' }}>
            <Plus size={12} /> Record Deposit
          </button>
          <button onClick={() => openAdd('withdrawal')} style={{ display: 'flex', alignItems: 'center',
            gap: 6, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
            fontWeight: 600, background: 'rgba(248,113,113,0.12)', color: '#f87171',
            border: '1px solid rgba(248,113,113,0.25)' }}>
            <Plus size={12} /> Record Withdrawal
          </button>
        </div>
      )}

      {showForm && !editEv && renderCapitalForm(false)}
      {editEv && renderCapitalForm(true)}

      {/* Event list */}
      <p style={{ fontSize: 10, fontWeight: 600, color: '#475569', textTransform: 'uppercase',
        letterSpacing: '0.8px', marginBottom: 8 }}>Event Log</p>
      {events.length === 0
        ? <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '20px 0' }}>No events recorded</p>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {events.map(ev => {
              const isD = ev.event_type === 'deposit'
              const isW = ev.event_type === 'withdrawal'
              return (
                <div key={ev.event_id} style={{
                  background: isD ? 'rgba(52,211,153,0.07)' : isW ? 'rgba(248,113,113,0.07)' : 'rgba(30,41,59,0.4)',
                  border: `1px solid ${isD ? 'rgba(52,211,153,0.2)' : isW ? 'rgba(248,113,113,0.2)' : 'rgba(51,65,85,0.3)'}`,
                  borderRadius: 10, padding: '9px 12px',
                }}>
                  <EventRow onEdit={() => openEdit(ev)} onDelete={() => setDeletingId(ev.event_id ?? ev.id)}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                      {/* Left: icon + title + notes/reference */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0, flex: 1 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', flexShrink: 0,
                          background: isD ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)' }}>
                          {isD ? <ArrowDownLeft size={12} color="#34d399" /> : <ArrowUpRight size={12} color="#f87171" />}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#E2E8F0' }}>
                            {isD ? 'Deposit' : 'Withdrawal'}
                          </span>
                          {(ev.notes || ev.reference) && (
                            <div style={{ marginTop: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
                              {ev.notes && (
                                <span style={{ fontSize: 10, color: '#64748B' }}>{ev.notes}</span>
                              )}
                              {ev.reference && (
                                <span style={{ fontSize: 10, color: '#475569' }}>Ref: {ev.reference}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Right: date (bold, top) / amount (below) — stacked to fill vertical space */}
                      <div style={{ flexShrink: 0, textAlign: 'right' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#CBD5E1' }}>{fmtDate(ev.date)}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                          color: isD ? '#34d399' : '#f87171', marginTop: 3 }}>
                          {isD ? '+' : '-'}{formatCurrencyAbs(ev.amount)}
                        </div>
                      </div>
                    </div>
                  </EventRow>
                </div>
              )
            })}
          </div>
      }

      {deletingId != null && (
        <ConfirmModal
          title="Delete Capital Event"
          message="Permanently delete this event? TWR sub-periods will recalculate."
          variant="delete" confirmLabel="Delete"
          onConfirm={handleDelete} onCancel={() => setDeletingId(null)} loading={deleting}
        />
      )}
    </>
  )
}

// ── Tab 2: Internal Transfers ─────────────────────────────────────────────

function InternalTransfersTab({ queryClient, capitalData }) {
  const { data: transfers = [], isLoading } = useQuery({
    queryKey: ['internal_transfers'],
    queryFn:  fetchInternalTransfers,
    staleTime: 30_000,
  })

  const { data: miscList = [] } = useQuery({
    queryKey: ['misc_events'],
    queryFn:  fetchMiscEvents,
    staleTime: 30_000,
  })

  const [showForm,     setShowForm]     = useState(false)
  const [formDate,     setFormDate]     = useState(todayISO())
  const [formFrom,     setFormFrom]     = useState('Wallet')
  const [formTo,       setFormTo]       = useState('Chase1')
  const [formAmount,   setFormAmount]   = useState('')
  const [formNotes,    setFormNotes]    = useState('')
  const [formCapRet,   setFormCapRet]   = useState('')
  const [formProfLo,   setFormProfLo]   = useState('')
  const [formError,    setFormError]    = useState(null)
  const [submitting,   setSubmitting]   = useState(false)

  const [editRec,      setEditRec]      = useState(null)
  const [editDate,     setEditDate]     = useState('')
  const [editFrom,     setEditFrom]     = useState('Wallet')
  const [editTo,       setEditTo]       = useState('Chase1')
  const [editAmount,   setEditAmount]   = useState('')
  const [editNotes,    setEditNotes]    = useState('')
  const [editCapRet,   setEditCapRet]   = useState('')
  const [editProfLo,   setEditProfLo]   = useState('')
  const [editError,    setEditError]    = useState(null)
  const [editSaving,   setEditSaving]   = useState(false)

  const [deletingId,   setDeletingId]   = useState(null)
  const [deleting,     setDeleting]     = useState(false)

  const formScrollRef = useRef(null)
  useEffect(() => {
    if (editRec) formScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editRec])

  function openAdd() {
    setEditRec(null); setFormDate(todayISO()); setFormFrom('Wallet'); setFormTo('Chase1')
    setFormAmount(''); setFormNotes('')
    setFormCapRet(''); setFormProfLo(''); setFormError(null); setShowForm(true)
  }

  function openEdit(r) {
    setShowForm(false); setEditRec(r); setEditDate(r.transfer_date)
    setEditFrom(r.from_account); setEditTo(r.to_account)
    setEditAmount(String(r.amount)); setEditNotes(r.notes ?? '')
    setEditCapRet(r.capital_return_amount != null ? String(r.capital_return_amount) : '')
    setEditProfLo(r.profit_loss_amount != null ? String(r.profit_loss_amount) : '')
    setEditError(null)
  }

  // Outbound account→Wallet leg is the only place profit/loss is classified.
  function isClassifiableLeg(from, to) {
    return from !== 'Wallet' && to === 'Wallet'
  }

  function validateSplit(amt, capRet, profLo) {
    const crRaw = capRet.trim(), plRaw = profLo.trim()
    if (!crRaw && !plRaw) return { ok: true, cr: null, pl: null }
    if (!crRaw || !plRaw) return { ok: false, msg: 'Enter both Capital Return and Profit/Loss (or leave both blank)' }
    const cr = parseFloat(crRaw), pl = parseFloat(plRaw)
    if (isNaN(cr) || isNaN(pl)) return { ok: false, msg: 'Capital Return / Profit-Loss must be numbers' }
    if (Math.round((cr + pl) * 100) !== Math.round(amt * 100)) {
      return { ok: false, msg: `Capital Return + Profit/Loss (${(cr + pl).toFixed(2)}) must equal Amount (${amt.toFixed(2)})` }
    }
    return { ok: true, cr: parseFloat(cr.toFixed(2)), pl: parseFloat(pl.toFixed(2)) }
  }

  async function handleAdd(e) {
    e.preventDefault(); setFormError(null)
    const amt = parseFloat(formAmount)
    if (isNaN(amt) || amt <= 0) return setFormError('Enter valid amount > 0')
    if (!formDate) return setFormError('Select a date')
    const split = validateSplit(amt, formCapRet, formProfLo)
    if (!split.ok) return setFormError(split.msg)
    setSubmitting(true)
    try {
      await createInternalTransfer({ transfer_date: formDate, from_account: formFrom,
        to_account: formTo, amount: parseFloat(amt.toFixed(2)), notes: formNotes.trim(),
        capital_return_amount: split.cr, profit_loss_amount: split.pl })
      await queryClient.invalidateQueries({ queryKey: ['internal_transfers'] })
      setShowForm(false)
    } catch (err) { setFormError(err.message ?? 'Failed') }
    finally { setSubmitting(false) }
  }

  async function handleUpdate(e) {
    e.preventDefault(); setEditError(null)
    const amt = parseFloat(editAmount)
    if (isNaN(amt) || amt <= 0) return setEditError('Enter valid amount > 0')
    if (!editDate) return setEditError('Select a date')
    const split = validateSplit(amt, editCapRet, editProfLo)
    if (!split.ok) return setEditError(split.msg)
    setEditSaving(true)
    try {
      await updateInternalTransfer(editRec.id, { transfer_date: editDate, from_account: editFrom,
        to_account: editTo, amount: parseFloat(amt.toFixed(2)), notes: editNotes.trim(),
        capital_return_amount: split.cr, profit_loss_amount: split.pl })
      await queryClient.invalidateQueries({ queryKey: ['internal_transfers'] })
      setEditRec(null)
    } catch (err) { setEditError(err.message ?? 'Failed') }
    finally { setEditSaving(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteInternalTransfer(deletingId)
      await queryClient.invalidateQueries({ queryKey: ['internal_transfers'] })
    } finally { setDeleting(false); setDeletingId(null) }
  }

  function renderTransferForm(isEdit) {
    const date    = isEdit ? editDate   : formDate
    const from    = isEdit ? editFrom   : formFrom
    const to      = isEdit ? editTo     : formTo
    const amount  = isEdit ? editAmount : formAmount
    const notes   = isEdit ? editNotes  : formNotes
    const capRet  = isEdit ? editCapRet : formCapRet
    const profLo  = isEdit ? editProfLo : formProfLo
    const error   = isEdit ? editError  : formError
    const saving  = isEdit ? editSaving : submitting
    const setDate = isEdit ? setEditDate   : setFormDate
    const setFrom = isEdit ? setEditFrom   : setFormFrom
    const setTo   = isEdit ? setEditTo     : setFormTo
    const setAmt  = isEdit ? setEditAmount : setFormAmount
    const setNts  = isEdit ? setEditNotes  : setFormNotes
    const setCapRet = isEdit ? setEditCapRet : setFormCapRet
    const setProfLo = isEdit ? setEditProfLo : setFormProfLo
    const onSubmit = isEdit ? handleUpdate : handleAdd
    const onCancel = isEdit ? () => setEditRec(null) : () => setShowForm(false)
    const classifiable = isClassifiableLeg(from, to)
    const amtNum   = parseFloat(amount) || 0
    const splitSum = (parseFloat(capRet) || 0) + (parseFloat(profLo) || 0)
    const splitOk  = (!capRet.trim() && !profLo.trim()) || Math.round(splitSum * 100) === Math.round(amtNum * 100)

    return (
      <form ref={isEdit ? formScrollRef : null} onSubmit={onSubmit} style={{
        background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)',
        borderRadius: 10, padding: '14px 16px', marginBottom: 14,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.7px', color: '#38bdf8', display: 'block', marginBottom: 10 }}>
          {isEdit ? 'Edit Transfer' : 'New Internal Transfer'}
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 10 }}>
          <DateField value={date} onChange={setDate} />
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Amount (£)</label>
            <AmountInput value={amount} onChange={setAmt} style={INPUT_STYLE} required />
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>From Account</label>
            <select value={from} onChange={e => setFrom(e.target.value)} style={INPUT_STYLE}>
              {ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>To Account</label>
            <select value={to} onChange={e => setTo(e.target.value)} style={INPUT_STYLE}>
              {ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
            letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Notes (optional)</label>
          <input type="text" value={notes} onChange={e => setNts(e.target.value)}
            placeholder="e.g. Initial deployment to Chase1" style={INPUT_STYLE} />
        </div>

        {classifiable && (
          <div style={{
            background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.18)',
            borderRadius: 8, padding: '10px 12px', marginBottom: 12,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px',
              color: '#34d399', display: 'block', marginBottom: 8 }}>
              Withdrawal Classification — Capital Return vs Banked Profit/Loss
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <div>
                <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
                  letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Capital Return (£)</label>
                <AmountInput value={capRet} onChange={setCapRet} style={INPUT_STYLE} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
                  letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>
                  Profit / Loss (£, negative = loss)
                </label>
                <input type="text" inputMode="decimal" value={profLo} onChange={e => setProfLo(e.target.value)}
                  placeholder="e.g. -23776.74" style={INPUT_STYLE} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button type="button" onClick={() => setCapRet((amtNum - (parseFloat(profLo) || 0)).toFixed(2))}
                  style={{ ...BTN_SM_STYLE, background: '#374151', fontSize: 10, padding: '6px 10px' }}>
                  Fill Capital Return
                </button>
              </div>
            </div>
            <p style={{ fontSize: 10, color: splitOk ? '#64748B' : '#f87171', marginTop: 8 }}>
              {splitOk
                ? 'Leave both blank to record without classification (can be added later via Edit).'
                : `Must sum to Amount — currently ${splitSum.toFixed(2)} vs ${amtNum.toFixed(2)}`}
            </p>
          </div>
        )}

        {error && <p style={{ fontSize: 11, color: '#f87171', marginBottom: 10 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={saving} style={{ ...BTN_SM_STYLE, background: '#0ea5e9', opacity: saving ? 0.65 : 1 }}>
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Save Transfer'}
          </button>
          <button type="button" onClick={onCancel} disabled={saving}
            style={{ ...BTN_SM_STYLE, background: '#374151', opacity: saving ? 0.5 : 1 }}>Cancel</button>
        </div>
      </form>
    )
  }

  const totalOut    = transfers.filter(t => t.from_account === 'Wallet').reduce((s,t) => s + t.amount, 0)
  const totalBack   = transfers.filter(t => t.to_account   === 'Wallet').reduce((s,t) => s + t.amount, 0)
  const totalDeploy = totalOut - totalBack
  const totalDep    = capitalData?.total_deposited ?? 0
  const totalWith   = capitalData?.total_withdrawn ?? 0
  // Misc credits/debits land in the wallet — include net in wallet balance
  const miscNet     = miscList.reduce((s, m) => m.direction === 'credit' ? s + m.amount : s - m.amount, 0)
  const walletBal   = totalDep - totalWith - totalDeploy + miscNet

  return (
    <>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        <div style={{ background: walletBal >= 0 ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)',
          border: `1px solid ${walletBal >= 0 ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`,
          borderRadius: 10, padding: '10px 14px' }}>
          <p style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>
            Wallet Balance</p>
          <p style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
            color: walletBal >= 0 ? '#34d399' : '#f87171' }}>
            {formatCurrencyAbs(walletBal)}</p>
        </div>
        <div style={{ background: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.2)',
          borderRadius: 10, padding: '10px 14px' }}>
          <p style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>
            Total Deployed from Wallet</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#38bdf8', fontVariantNumeric: 'tabular-nums' }}>
            {formatCurrencyAbs(totalDeploy)}</p>
        </div>
      </div>

      {/* Add button */}
      {!editRec && (
        <div style={{ marginBottom: 14 }}>
          <button onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600,
            background: 'rgba(14,165,233,0.15)', color: '#38bdf8', border: '1px solid rgba(14,165,233,0.25)' }}>
            <Plus size={12} /> Record Transfer
          </button>
        </div>
      )}

      {showForm && !editRec && renderTransferForm(false)}
      {editRec && renderTransferForm(true)}

      {/* List */}
      <p style={{ fontSize: 10, fontWeight: 600, color: '#475569', textTransform: 'uppercase',
        letterSpacing: '0.8px', marginBottom: 8 }}>Transfer Log</p>
      {isLoading
        ? <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '20px 0' }}>Loading…</p>
        : transfers.length === 0
          ? <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '20px 0' }}>No transfers recorded</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {transfers.map(t => (
                <div key={t.id} style={{
                  background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.18)',
                  borderRadius: 10, padding: '9px 12px',
                }}>
                  <EventRow onEdit={() => openEdit(t)} onDelete={() => setDeletingId(t.id)}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                      {/* Left: icon + from→to + tag, notes stacked below */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <div style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(14,165,233,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <ArrowLeftRight size={12} color="#38bdf8" />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#E2E8F0' }}>
                            {t.from_account} → {t.to_account}
                          </span>
                          <ProfitLossTag capitalReturn={t.capital_return_amount} profitLoss={t.profit_loss_amount} />
                        </div>
                        {t.notes && (
                          <div style={{ marginLeft: 32 }}>
                            <span style={{ fontSize: 10, color: '#64748B' }}>{t.notes}</span>
                          </div>
                        )}
                      </div>
                      {/* Right: date (bold, top) / amount (below) */}
                      <div style={{ flexShrink: 0, textAlign: 'right' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#CBD5E1' }}>{fmtDate(t.transfer_date)}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                          color: '#38bdf8', marginTop: 3 }}>
                          {formatCurrencyAbs(t.amount)}
                        </div>
                      </div>
                    </div>
                  </EventRow>
                </div>
              ))}
            </div>
      }

      {deletingId != null && (
        <ConfirmModal
          title="Delete Transfer" message="Permanently delete this transfer record?"
          variant="delete" confirmLabel="Delete"
          onConfirm={handleDelete} onCancel={() => setDeletingId(null)} loading={deleting}
        />
      )}
    </>
  )
}

// ── Capital Transfers — Wallet ⇄ Pod ⇄ Strategy funding ledger ─────────────
// Separate from Darwinex Transfers above. This is the generic ledger used
// to record "we moved £X from the wallet into Strategy Y" (or Pod, or
// strategy-to-strategy rebalancing) — feeds each strategy's real Total
// Capital Invested figure on the Portfolio page.

function encodeEndpoint(type, id) { return type === 'wallet' ? 'wallet' : `${type}:${id}` }
function decodeEndpoint(val) {
  if (!val || val === 'wallet') return { type: 'wallet', id: null }
  const [type, id] = val.split(':')
  return { type, id: Number(id) }
}

function EndpointBadge({ type, id, podsById, strategiesById }) {
  if (type === 'wallet') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px',
        borderRadius: 8, fontSize: 11, fontWeight: 600, color: '#94A3B8',
        background: 'rgba(148,163,184,0.10)', border: '1px solid rgba(148,163,184,0.18)' }}>
        <Wallet size={11} /> Wallet
      </span>
    )
  }
  if (type === 'pod') {
    const pod = podsById[id]
    const color = pod?.color || '#6366f1'
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px',
        borderRadius: 8, fontSize: 11, fontWeight: 600, color,
        background: `${color}18`, border: `1px solid ${color}40` }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
        {pod?.name ?? `Pod ${id}`}
      </span>
    )
  }
  // strategy
  const strat = strategiesById[id]
  const pod   = strat ? podsById[strat.pod_id] : null
  const color = pod?.color || '#6366f1'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px',
      borderRadius: 8, fontSize: 11, fontWeight: 600, color,
      background: `${color}18`, border: `1px solid ${color}40` }}>
      <TrendingUp size={11} />
      {strat?.name ?? `Strategy ${id}`}
    </span>
  )
}

function ProfitLossTag({ capitalReturn, profitLoss }) {
  if (profitLoss == null) return null
  if (profitLoss === 0) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px',
        borderRadius: 8, fontSize: 10, fontWeight: 700, color: '#94A3B8',
        background: 'rgba(148,163,184,0.10)', border: '1px solid rgba(148,163,184,0.18)' }}>
        Capital Return {formatCurrencyAbs(capitalReturn)}
      </span>
    )
  }
  const isProfit = profitLoss > 0
  const color = isProfit ? '#34d399' : '#f87171'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px',
      borderRadius: 8, fontSize: 10, fontWeight: 700, color,
      background: `${color}18`, border: `1px solid ${color}40` }}>
      {isProfit ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {isProfit ? 'Profit' : 'Loss'} {formatCurrencyAbs(Math.abs(profitLoss))}
    </span>
  )
}

function EndpointSelect({ value, onChange, pods, strategies }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={INPUT_STYLE}>
      <option value="wallet">Wallet</option>
      {pods.map(pod => (
        <optgroup key={pod.id} label={pod.name}>
          <option value={`pod:${pod.id}`}>{pod.name} (Pod level)</option>
          {strategies.filter(s => s.pod_id === pod.id).map(s => (
            <option key={s.id} value={`strategy:${s.id}`}>{s.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

function CapitalTransfersTab({ queryClient }) {
  const { data: transfers = [], isLoading } = useQuery({
    queryKey: ['capital_transfers'],
    queryFn:  fetchCapitalTransfers,
    staleTime: 30_000,
  })
  const { data: pods = [] } = useQuery({
    queryKey: ['pods'], queryFn: fetchPods, staleTime: 60_000,
  })
  const { data: strategies = [] } = useQuery({
    queryKey: ['strategies_all'], queryFn: () => fetchStrategies(), staleTime: 60_000,
  })

  const podsById       = Object.fromEntries(pods.map(p => [p.id, p]))
  const strategiesById = Object.fromEntries(strategies.map(s => [s.id, s]))

  const [showForm,   setShowForm]   = useState(false)
  const [formDate,   setFormDate]   = useState(todayISO())
  const [formFrom,   setFormFrom]   = useState('wallet')
  const [formTo,     setFormTo]     = useState('wallet')
  const [formAmount, setFormAmount] = useState('')
  const [formRef,    setFormRef]    = useState('')
  const [formNotes,  setFormNotes]  = useState('')
  const [formCapRet, setFormCapRet] = useState('')
  const [formProfLo, setFormProfLo] = useState('')
  const [formError,  setFormError]  = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const [editRec,    setEditRec]    = useState(null)
  const [editDate,   setEditDate]   = useState('')
  const [editFrom,   setEditFrom]   = useState('wallet')
  const [editTo,     setEditTo]     = useState('wallet')
  const [editAmount, setEditAmount] = useState('')
  const [editRef,    setEditRef]    = useState('')
  const [editNotes,  setEditNotes]  = useState('')
  const [editCapRet, setEditCapRet] = useState('')
  const [editProfLo, setEditProfLo] = useState('')
  const [editError,  setEditError]  = useState(null)
  const [editSaving, setEditSaving] = useState(false)

  const [deletingId, setDeletingId] = useState(null)
  const [deleting,   setDeleting]   = useState(false)

  const formScrollRef = useRef(null)
  useEffect(() => {
    if (editRec) formScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editRec])

  function openAdd() {
    setEditRec(null); setFormDate(todayISO()); setFormFrom('wallet'); setFormTo('wallet')
    setFormAmount(''); setFormRef(''); setFormNotes('')
    setFormCapRet(''); setFormProfLo(''); setFormError(null); setShowForm(true)
  }

  function openEdit(r) {
    setShowForm(false); setEditRec(r); setEditDate(r.transfer_date)
    setEditFrom(encodeEndpoint(r.from_type, r.from_id)); setEditTo(encodeEndpoint(r.to_type, r.to_id))
    setEditAmount(String(r.amount)); setEditRef(r.reference ?? ''); setEditNotes(r.notes ?? '')
    setEditCapRet(r.capital_return_amount != null ? String(r.capital_return_amount) : '')
    setEditProfLo(r.profit_loss_amount != null ? String(r.profit_loss_amount) : '')
    setEditError(null)
  }

  function validateEndpoints(from, to) {
    if (from === to) return 'From and To cannot be the same'
    return null
  }

  // Outbound Strategy→Wallet leg is the only place profit/loss is classified —
  // it's the leg that actually carries strategy identity for Banked Profit.
  function isClassifiableLeg(from, to) {
    return decodeEndpoint(from).type === 'strategy' && decodeEndpoint(to).type === 'wallet'
  }

  function validateSplit(amt, capRet, profLo) {
    const crRaw = capRet.trim(), plRaw = profLo.trim()
    if (!crRaw && !plRaw) return { ok: true, cr: null, pl: null }
    if (!crRaw || !plRaw) return { ok: false, msg: 'Enter both Capital Return and Profit/Loss (or leave both blank)' }
    const cr = parseFloat(crRaw), pl = parseFloat(plRaw)
    if (isNaN(cr) || isNaN(pl)) return { ok: false, msg: 'Capital Return / Profit-Loss must be numbers' }
    if (Math.round((cr + pl) * 100) !== Math.round(amt * 100)) {
      return { ok: false, msg: `Capital Return + Profit/Loss (${(cr + pl).toFixed(2)}) must equal Amount (${amt.toFixed(2)})` }
    }
    return { ok: true, cr: parseFloat(cr.toFixed(2)), pl: parseFloat(pl.toFixed(2)) }
  }

  async function handleAdd(e) {
    e.preventDefault(); setFormError(null)
    const amt = parseFloat(formAmount)
    if (isNaN(amt) || amt <= 0) return setFormError('Enter valid amount > 0')
    if (!formDate) return setFormError('Select a date')
    const vErr = validateEndpoints(formFrom, formTo)
    if (vErr) return setFormError(vErr)
    const split = validateSplit(amt, formCapRet, formProfLo)
    if (!split.ok) return setFormError(split.msg)
    setSubmitting(true)
    try {
      const from = decodeEndpoint(formFrom), to = decodeEndpoint(formTo)
      await createCapitalTransfer({
        transfer_date: formDate, from_type: from.type, from_id: from.id,
        to_type: to.type, to_id: to.id, amount: parseFloat(amt.toFixed(2)),
        reference: formRef.trim(), notes: formNotes.trim(),
        capital_return_amount: split.cr, profit_loss_amount: split.pl,
      })
      await queryClient.invalidateQueries({ queryKey: ['capital_transfers'] })
      setShowForm(false)
    } catch (err) { setFormError(err.message ?? 'Failed') }
    finally { setSubmitting(false) }
  }

  async function handleUpdate(e) {
    e.preventDefault(); setEditError(null)
    const amt = parseFloat(editAmount)
    if (isNaN(amt) || amt <= 0) return setEditError('Enter valid amount > 0')
    if (!editDate) return setEditError('Select a date')
    const vErr = validateEndpoints(editFrom, editTo)
    if (vErr) return setEditError(vErr)
    const split = validateSplit(amt, editCapRet, editProfLo)
    if (!split.ok) return setEditError(split.msg)
    setEditSaving(true)
    try {
      const from = decodeEndpoint(editFrom), to = decodeEndpoint(editTo)
      await updateCapitalTransfer(editRec.id, {
        transfer_date: editDate, from_type: from.type, from_id: from.id,
        to_type: to.type, to_id: to.id, amount: parseFloat(amt.toFixed(2)),
        reference: editRef.trim(), notes: editNotes.trim(),
        capital_return_amount: split.cr, profit_loss_amount: split.pl,
      })
      await queryClient.invalidateQueries({ queryKey: ['capital_transfers'] })
      setEditRec(null)
    } catch (err) { setEditError(err.message ?? 'Failed') }
    finally { setEditSaving(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteCapitalTransfer(deletingId)
      await queryClient.invalidateQueries({ queryKey: ['capital_transfers'] })
    } finally { setDeleting(false); setDeletingId(null) }
  }

  function renderTransferForm(isEdit) {
    const date    = isEdit ? editDate   : formDate
    const from    = isEdit ? editFrom   : formFrom
    const to      = isEdit ? editTo     : formTo
    const amount  = isEdit ? editAmount : formAmount
    const ref     = isEdit ? editRef    : formRef
    const notes   = isEdit ? editNotes  : formNotes
    const capRet  = isEdit ? editCapRet : formCapRet
    const profLo  = isEdit ? editProfLo : formProfLo
    const error   = isEdit ? editError  : formError
    const saving  = isEdit ? editSaving : submitting
    const setDate = isEdit ? setEditDate   : setFormDate
    const setFrom = isEdit ? setEditFrom   : setFormFrom
    const setTo   = isEdit ? setEditTo     : setFormTo
    const setAmt  = isEdit ? setEditAmount : setFormAmount
    const setRf   = isEdit ? setEditRef    : setFormRef
    const setNts  = isEdit ? setEditNotes  : setFormNotes
    const setCapRet = isEdit ? setEditCapRet : setFormCapRet
    const setProfLo = isEdit ? setEditProfLo : setFormProfLo
    const onSubmit = isEdit ? handleUpdate : handleAdd
    const onCancel = isEdit ? () => setEditRec(null) : () => setShowForm(false)
    const classifiable = isClassifiableLeg(from, to)
    const amtNum  = parseFloat(amount) || 0
    const splitSum = (parseFloat(capRet) || 0) + (parseFloat(profLo) || 0)
    const splitOk  = (!capRet.trim() && !profLo.trim()) || Math.round(splitSum * 100) === Math.round(amtNum * 100)

    return (
      <form ref={isEdit ? formScrollRef : null} onSubmit={onSubmit} style={{
        background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)',
        borderRadius: 10, padding: '14px 16px', marginBottom: 14,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.7px', color: '#a78bfa', display: 'block', marginBottom: 10 }}>
          {isEdit ? 'Edit Capital Transfer' : 'New Capital Transfer'}
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 10 }}>
          <DateField value={date} onChange={setDate} />
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Amount (£)</label>
            <AmountInput value={amount} onChange={setAmt} style={INPUT_STYLE} required />
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>From</label>
            <EndpointSelect value={from} onChange={setFrom} pods={pods} strategies={strategies} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>To</label>
            <EndpointSelect value={to} onChange={setTo} pods={pods} strategies={strategies} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Reference (optional)</label>
            <input type="text" value={ref} onChange={e => setRf(e.target.value)}
              placeholder="e.g. Wire ref" style={INPUT_STYLE} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Notes (optional)</label>
            <input type="text" value={notes} onChange={e => setNts(e.target.value)}
              placeholder="e.g. Initial funding tranche" style={INPUT_STYLE} />
          </div>
        </div>

        {classifiable && (
          <div style={{
            background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.18)',
            borderRadius: 8, padding: '10px 12px', marginBottom: 12,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px',
              color: '#34d399', display: 'block', marginBottom: 8 }}>
              Withdrawal Classification — Capital Return vs Banked Profit/Loss
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <div>
                <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
                  letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Capital Return (£)</label>
                <AmountInput value={capRet} onChange={setCapRet} style={INPUT_STYLE} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
                  letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>
                  Profit / Loss (£, negative = loss)
                </label>
                <input type="text" inputMode="decimal" value={profLo} onChange={e => setProfLo(e.target.value)}
                  placeholder="e.g. -23776.74" style={INPUT_STYLE} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button type="button" onClick={() => setCapRet((amtNum - (parseFloat(profLo) || 0)).toFixed(2))}
                  style={{ ...BTN_SM_STYLE, background: '#374151', fontSize: 10, padding: '6px 10px' }}>
                  Fill Capital Return
                </button>
              </div>
            </div>
            <p style={{ fontSize: 10, color: splitOk ? '#64748B' : '#f87171', marginTop: 8 }}>
              {splitOk
                ? 'Leave both blank to record without classification (can be added later via Edit).'
                : `Must sum to Amount — currently ${splitSum.toFixed(2)} vs ${amtNum.toFixed(2)}`}
            </p>
          </div>
        )}

        {error && <p style={{ fontSize: 11, color: '#f87171', marginBottom: 10 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={saving} style={{ ...BTN_SM_STYLE, background: '#a78bfa', opacity: saving ? 0.65 : 1 }}>
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Save Transfer'}
          </button>
          <button type="button" onClick={onCancel} disabled={saving}
            style={{ ...BTN_SM_STYLE, background: '#374151', opacity: saving ? 0.5 : 1 }}>Cancel</button>
        </div>
      </form>
    )
  }

  const totalToStrategies  = transfers.filter(t => t.to_type === 'strategy').reduce((s, t) => s + t.amount, 0)
  const totalBetween       = transfers.filter(t => t.from_type === 'strategy' && t.to_type === 'strategy').reduce((s, t) => s + t.amount, 0)
  const totalReturned      = transfers.filter(t => (t.from_type === 'strategy' || t.from_type === 'pod') && t.to_type === 'wallet').reduce((s, t) => s + t.amount, 0)

  return (
    <>
      <div style={{
        background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.15)',
        borderRadius: 10, padding: '10px 14px', marginBottom: 14,
        display: 'flex', gap: 8, alignItems: 'flex-start',
      }}>
        <Info size={13} color="#38bdf8" style={{ flexShrink: 0, marginTop: 1 }} />
        <span style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.5 }}>
          Records where wallet capital actually goes — into a Pod, into a specific Strategy, or moved
          between strategies. Feeds each strategy's real Total Capital Invested figure on the Portfolio
          page. Separate from Darwinex Transfers, which stays broker-account based.
        </span>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        <div style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)',
          borderRadius: 10, padding: '10px 14px' }}>
          <p style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>
            Moved to Strategies</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#a78bfa', fontVariantNumeric: 'tabular-nums' }}>
            {formatCurrencyAbs(totalToStrategies)}</p>
        </div>
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
          borderRadius: 10, padding: '10px 14px' }}>
          <p style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>
            Between Strategies</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>
            {formatCurrencyAbs(totalBetween)}</p>
        </div>
        <div style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)',
          borderRadius: 10, padding: '10px 14px' }}>
          <p style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>
            Returned to Wallet</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>
            {formatCurrencyAbs(totalReturned)}</p>
        </div>
      </div>

      {/* Add button */}
      {!editRec && (
        <div style={{ marginBottom: 14 }}>
          <button onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600,
            background: 'rgba(167,139,250,0.15)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.25)' }}>
            <Plus size={12} /> Record Capital Transfer
          </button>
        </div>
      )}

      {showForm && !editRec && renderTransferForm(false)}
      {editRec && renderTransferForm(true)}

      {/* List */}
      <p style={{ fontSize: 10, fontWeight: 600, color: '#475569', textTransform: 'uppercase',
        letterSpacing: '0.8px', marginBottom: 8 }}>Transfer Log</p>
      {isLoading
        ? <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '20px 0' }}>Loading…</p>
        : transfers.length === 0
          ? <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '20px 0' }}>No capital transfers recorded</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {transfers.map(t => (
                <div key={t.id} style={{
                  background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.16)',
                  borderRadius: 10, padding: '9px 12px',
                }}>
                  <EventRow onEdit={() => openEdit(t)} onDelete={() => setDeletingId(t.id)}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                      {/* Left: From → To + tag, reference/notes stacked below */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <EndpointBadge type={t.from_type} id={t.from_id} podsById={podsById} strategiesById={strategiesById} />
                          <ArrowLeftRight size={12} color="#475569" />
                          <EndpointBadge type={t.to_type} id={t.to_id} podsById={podsById} strategiesById={strategiesById} />
                          <ProfitLossTag capitalReturn={t.capital_return_amount} profitLoss={t.profit_loss_amount} />
                        </div>
                        {(t.reference || t.notes) && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {t.reference && <span style={{ fontSize: 10, color: '#475569' }}>Ref: {t.reference}</span>}
                            {t.notes && <span style={{ fontSize: 10, color: '#64748B' }}>{t.notes}</span>}
                          </div>
                        )}
                      </div>
                      {/* Right: date (bold, top) / amount (below) */}
                      <div style={{ flexShrink: 0, textAlign: 'right' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#CBD5E1' }}>{fmtDate(t.transfer_date)}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                          color: '#a78bfa', marginTop: 3 }}>
                          {formatCurrencyAbs(t.amount)}
                        </div>
                      </div>
                    </div>
                  </EventRow>
                </div>
              ))}
            </div>
      }

      {deletingId != null && (
        <ConfirmModal
          title="Delete Capital Transfer" message="Permanently delete this transfer record?"
          variant="delete" confirmLabel="Delete"
          onConfirm={handleDelete} onCancel={() => setDeletingId(null)} loading={deleting}
        />
      )}
    </>
  )
}

// ── Tab 3: Miscellaneous Events ───────────────────────────────────────────

function MiscellaneousTab({ queryClient }) {
  const { data: miscList = [], isLoading } = useQuery({
    queryKey: ['misc_events'],
    queryFn:  fetchMiscEvents,
    staleTime: 30_000,
  })

  const [showForm,   setShowForm]   = useState(false)
  const [formDate,   setFormDate]   = useState(todayISO())
  const [formEType,  setFormEType]  = useState('Rebate')
  const [formDir,    setFormDir]    = useState('credit')
  const [formAmount, setFormAmount] = useState('')
  const [formNotes,  setFormNotes]  = useState('')
  const [formError,  setFormError]  = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const [editRec,    setEditRec]    = useState(null)
  const [editDate,   setEditDate]   = useState('')
  const [editEType,  setEditEType]  = useState('Rebate')
  const [editDir,    setEditDir]    = useState('credit')
  const [editAmount, setEditAmount] = useState('')
  const [editNotes,  setEditNotes]  = useState('')
  const [editError,  setEditError]  = useState(null)
  const [editSaving, setEditSaving] = useState(false)

  const [deletingId, setDeletingId] = useState(null)
  const [deleting,   setDeleting]   = useState(false)

  const formScrollRef = useRef(null)
  useEffect(() => {
    if (editRec) formScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editRec])

  function openAdd() {
    setEditRec(null); setFormDate(todayISO()); setFormEType('Rebate'); setFormDir('credit')
    setFormAmount(''); setFormNotes(''); setFormError(null); setShowForm(true)
  }

  function openEdit(r) {
    setShowForm(false); setEditRec(r); setEditDate(r.event_date); setEditEType(r.event_type)
    setEditDir(r.direction); setEditAmount(String(r.amount)); setEditNotes(r.notes ?? ''); setEditError(null)
  }

  async function handleAdd(e) {
    e.preventDefault(); setFormError(null)
    const amt = parseFloat(formAmount)
    if (isNaN(amt) || amt <= 0) return setFormError('Enter valid amount > 0')
    setSubmitting(true)
    try {
      await createMiscEvent({ event_date: formDate, event_type: formEType, direction: formDir,
        amount: parseFloat(amt.toFixed(2)), notes: formNotes.trim() })
      await queryClient.invalidateQueries({ queryKey: ['misc_events'] })
      setShowForm(false)
    } catch (err) { setFormError(err.message ?? 'Failed') }
    finally { setSubmitting(false) }
  }

  async function handleUpdate(e) {
    e.preventDefault(); setEditError(null)
    const amt = parseFloat(editAmount)
    if (isNaN(amt) || amt <= 0) return setEditError('Enter valid amount > 0')
    setEditSaving(true)
    try {
      await updateMiscEvent(editRec.id, { event_date: editDate, event_type: editEType,
        direction: editDir, amount: parseFloat(amt.toFixed(2)), notes: editNotes.trim() })
      await queryClient.invalidateQueries({ queryKey: ['misc_events'] })
      setEditRec(null)
    } catch (err) { setEditError(err.message ?? 'Failed') }
    finally { setEditSaving(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteMiscEvent(deletingId)
      await queryClient.invalidateQueries({ queryKey: ['misc_events'] })
    } finally { setDeleting(false); setDeletingId(null) }
  }

  function renderMiscForm(isEdit) {
    const date    = isEdit ? editDate   : formDate
    const etype   = isEdit ? editEType  : formEType
    const dir     = isEdit ? editDir    : formDir
    const amount  = isEdit ? editAmount : formAmount
    const notes   = isEdit ? editNotes  : formNotes
    const error   = isEdit ? editError  : formError
    const saving  = isEdit ? editSaving : submitting
    const setDate = isEdit ? setEditDate   : setFormDate
    const setEt   = isEdit ? setEditEType  : setFormEType
    const setDir  = isEdit ? setEditDir    : setFormDir
    const setAmt  = isEdit ? setEditAmount : setFormAmount
    const setNts  = isEdit ? setEditNotes  : setFormNotes
    const onSubmit = isEdit ? handleUpdate : handleAdd
    const onCancel = isEdit ? () => setEditRec(null) : () => setShowForm(false)
    const isCredit = dir === 'credit'

    return (
      <form ref={isEdit ? formScrollRef : null} onSubmit={onSubmit} style={{
        background: isCredit ? 'rgba(168,85,247,0.06)' : 'rgba(245,158,11,0.06)',
        border: `1px solid ${isCredit ? 'rgba(168,85,247,0.2)' : 'rgba(245,158,11,0.2)'}`,
        borderRadius: 10, padding: '14px 16px', marginBottom: 14,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.7px', color: isCredit ? '#c084fc' : '#fbbf24', display: 'block', marginBottom: 10 }}>
          {isEdit ? 'Edit Misc Event' : 'New Misc Event'}
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 10 }}>
          <DateField value={date} onChange={setDate} />
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Amount (£)</label>
            <AmountInput value={amount} onChange={setAmt} style={INPUT_STYLE} required />
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Event Type</label>
            <select value={etype} onChange={e => setEt(e.target.value)} style={INPUT_STYLE}>
              {MISC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Direction</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {['credit','debit'].map(d => (
                <button key={d} type="button" onClick={() => setDir(d)} style={{
                  flex: 1, padding: '7px 0', borderRadius: 7, border: 'none', fontSize: 11,
                  fontWeight: 600, cursor: 'pointer',
                  background: dir===d ? (d==='credit'?'rgba(168,85,247,0.3)':'rgba(245,158,11,0.3)') : 'rgba(71,85,105,0.3)',
                  color: dir===d ? (d==='credit'?'#c084fc':'#fbbf24') : '#64748B',
                }}>{d==='credit'?'Credit (+)':'Debit (-)'}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
            letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Notes (optional)</label>
          <input type="text" value={notes} onChange={e => setNts(e.target.value)}
            placeholder="e.g. Q2 rebate from Darwinex" style={INPUT_STYLE} />
        </div>
        {error && <p style={{ fontSize: 11, color: '#f87171', marginBottom: 10 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={saving} style={{ ...BTN_SM_STYLE,
            background: isCredit ? '#9333ea' : '#d97706', opacity: saving ? 0.65 : 1 }}>
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Save Event'}
          </button>
          <button type="button" onClick={onCancel} disabled={saving}
            style={{ ...BTN_SM_STYLE, background: '#374151', opacity: saving ? 0.5 : 1 }}>Cancel</button>
        </div>
      </form>
    )
  }

  const totalCredits = miscList.filter(m => m.direction==='credit').reduce((s,m) => s + m.amount, 0)
  const totalDebits  = miscList.filter(m => m.direction==='debit' ).reduce((s,m) => s + m.amount, 0)

  return (
    <>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Total Credits', value: formatCurrencyAbs(totalCredits), color: '#c084fc' },
          { label: 'Total Debits',  value: formatCurrencyAbs(totalDebits),  color: '#fbbf24' },
        ].map(s => (
          <div key={s.label} style={{ background: 'rgba(30,41,59,0.4)', border: '1px solid rgba(51,65,85,0.3)',
            borderRadius: 10, padding: '10px 14px' }}>
            <p style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>{s.label}</p>
            <p style={{ fontSize: 15, fontWeight: 700, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Add button */}
      {!editRec && (
        <div style={{ marginBottom: 14 }}>
          <button onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600,
            background: 'rgba(168,85,247,0.15)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.25)' }}>
            <Plus size={12} /> Record Misc Event
          </button>
        </div>
      )}

      {showForm && !editRec && renderMiscForm(false)}
      {editRec && renderMiscForm(true)}

      {/* List */}
      <p style={{ fontSize: 10, fontWeight: 600, color: '#475569', textTransform: 'uppercase',
        letterSpacing: '0.8px', marginBottom: 8 }}>Misc Log</p>
      {isLoading
        ? <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '20px 0' }}>Loading…</p>
        : miscList.length === 0
          ? <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '20px 0' }}>No misc events recorded</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {miscList.map(m => {
                const isCredit = m.direction === 'credit'
                return (
                  <div key={m.id} style={{
                    background: isCredit ? 'rgba(168,85,247,0.06)' : 'rgba(245,158,11,0.06)',
                    border: `1px solid ${isCredit ? 'rgba(168,85,247,0.18)' : 'rgba(245,158,11,0.18)'}`,
                    borderRadius: 10, padding: '9px 12px',
                  }}>
                    <EventRow onEdit={() => openEdit(m)} onDelete={() => setDeletingId(m.id)}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                        {/* Left: icon + title + notes */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0, flex: 1 }}>
                          <div style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            background: isCredit ? 'rgba(168,85,247,0.2)' : 'rgba(245,158,11,0.2)' }}>
                            <span style={{ fontSize: 11, fontWeight: 800, color: isCredit ? '#c084fc' : '#fbbf24' }}>
                              {isCredit ? '+' : '-'}
                            </span>
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#E2E8F0' }}>{m.event_type}</span>
                            {m.notes && (
                              <div style={{ marginTop: 3 }}>
                                <span style={{ fontSize: 10, color: '#64748B' }}>{m.notes}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        {/* Right: date (bold, top) / amount (below) */}
                        <div style={{ flexShrink: 0, textAlign: 'right' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#CBD5E1' }}>{fmtDate(m.event_date)}</div>
                          <div style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                            color: isCredit ? '#c084fc' : '#fbbf24', marginTop: 3 }}>
                            {isCredit ? '+' : '-'}{formatCurrencyAbs(m.amount)}
                          </div>
                        </div>
                      </div>
                    </EventRow>
                  </div>
                )
              })}
            </div>
      }

      {deletingId != null && (
        <ConfirmModal
          title="Delete Misc Event" message="Permanently delete this record?"
          variant="delete" confirmLabel="Delete"
          onConfirm={handleDelete} onCancel={() => setDeletingId(null)} loading={deleting}
        />
      )}
    </>
  )
}

// ── Tab 4: Expenses — tracked record only, no calc impact ────────────────

function ExpensesTab({ queryClient }) {
  const { data: expenseList = [], isLoading } = useQuery({
    queryKey: ['expenses'],
    queryFn:  fetchExpenses,
    staleTime: 30_000,
  })

  const [showForm,     setShowForm]     = useState(false)
  const [formDate,     setFormDate]     = useState(todayISO())
  const [formDesc,     setFormDesc]     = useState('')
  const [formAmount,   setFormAmount]   = useState('')
  const [formRef,      setFormRef]      = useState('')
  const [formRecur,    setFormRecur]    = useState('one_time')
  const [formError,    setFormError]    = useState(null)
  const [submitting,   setSubmitting]   = useState(false)

  const [editRec,      setEditRec]      = useState(null)
  const [editDate,     setEditDate]     = useState('')
  const [editDesc,     setEditDesc]     = useState('')
  const [editAmount,   setEditAmount]   = useState('')
  const [editRef,      setEditRef]      = useState('')
  const [editRecur,    setEditRecur]    = useState('one_time')
  const [editError,    setEditError]    = useState(null)
  const [editSaving,   setEditSaving]   = useState(false)

  const [deletingId,   setDeletingId]   = useState(null)
  const [deleting,     setDeleting]     = useState(false)

  const formScrollRef = useRef(null)
  useEffect(() => {
    if (editRec) formScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editRec])

  function openAdd() {
    setEditRec(null); setFormDate(todayISO()); setFormDesc(''); setFormAmount('')
    setFormRef(''); setFormRecur('one_time'); setFormError(null); setShowForm(true)
  }

  function openEdit(r) {
    setShowForm(false); setEditRec(r); setEditDate(r.expense_date); setEditDesc(r.description)
    setEditAmount(String(r.amount)); setEditRef(r.reference ?? ''); setEditRecur(r.recurrence ?? 'one_time')
    setEditError(null)
  }

  async function handleAdd(e) {
    e.preventDefault(); setFormError(null)
    const amt = parseFloat(formAmount)
    if (isNaN(amt) || amt <= 0) return setFormError('Enter valid amount > 0')
    if (!formDesc.trim()) return setFormError('Enter expense description')
    if (!formDate) return setFormError('Select a date')
    setSubmitting(true)
    try {
      await createExpense({ expense_date: formDate, description: formDesc.trim(),
        amount: parseFloat(amt.toFixed(2)), recurrence: formRecur, reference: formRef.trim() })
      await queryClient.invalidateQueries({ queryKey: ['expenses'] })
      setShowForm(false)
    } catch (err) { setFormError(err.message ?? 'Failed') }
    finally { setSubmitting(false) }
  }

  async function handleUpdate(e) {
    e.preventDefault(); setEditError(null)
    const amt = parseFloat(editAmount)
    if (isNaN(amt) || amt <= 0) return setEditError('Enter valid amount > 0')
    if (!editDesc.trim()) return setEditError('Enter expense description')
    if (!editDate) return setEditError('Select a date')
    setEditSaving(true)
    try {
      await updateExpense(editRec.id, { expense_date: editDate, description: editDesc.trim(),
        amount: parseFloat(amt.toFixed(2)), recurrence: editRecur, reference: editRef.trim() })
      await queryClient.invalidateQueries({ queryKey: ['expenses'] })
      setEditRec(null)
    } catch (err) { setEditError(err.message ?? 'Failed') }
    finally { setEditSaving(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteExpense(deletingId)
      await queryClient.invalidateQueries({ queryKey: ['expenses'] })
    } finally { setDeleting(false); setDeletingId(null) }
  }

  function renderExpenseForm(isEdit) {
    const date    = isEdit ? editDate   : formDate
    const desc    = isEdit ? editDesc   : formDesc
    const amount  = isEdit ? editAmount : formAmount
    const ref     = isEdit ? editRef    : formRef
    const recur   = isEdit ? editRecur  : formRecur
    const error   = isEdit ? editError  : formError
    const saving  = isEdit ? editSaving : submitting
    const setDate = isEdit ? setEditDate   : setFormDate
    const setDsc  = isEdit ? setEditDesc   : setFormDesc
    const setAmt  = isEdit ? setEditAmount : setFormAmount
    const setRef  = isEdit ? setEditRef    : setFormRef
    const setRec  = isEdit ? setEditRecur  : setFormRecur
    const onSubmit = isEdit ? handleUpdate : handleAdd
    const onCancel = isEdit ? () => setEditRec(null) : () => setShowForm(false)

    return (
      <form ref={isEdit ? formScrollRef : null} onSubmit={onSubmit} style={{
        background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)',
        borderRadius: 10, padding: '14px 16px', marginBottom: 14,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.7px', color: '#38bdf8', display: 'block', marginBottom: 10 }}>
          {isEdit ? 'Edit Expense' : 'New Expense'}
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 10 }}>
          <DateField value={date} onChange={setDate} />
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Amount (£)</label>
            <AmountInput value={amount} onChange={setAmt} style={INPUT_STYLE} required />
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Recurrence</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[{ id: 'one_time', label: 'One-time' }, { id: 'recurring', label: 'Recurring' }].map(o => (
                <button key={o.id} type="button" onClick={() => setRec(o.id)} style={{
                  flex: 1, padding: '7px 0', borderRadius: 7, border: 'none', fontSize: 11,
                  fontWeight: 600, cursor: 'pointer',
                  background: recur===o.id ? 'rgba(56,189,248,0.3)' : 'rgba(71,85,105,0.3)',
                  color: recur===o.id ? '#38bdf8' : '#64748B',
                }}>{o.label}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
            letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Expense</label>
          <input type="text" value={desc} onChange={e => setDsc(e.target.value)}
            placeholder="e.g. Data feed subscription" style={INPUT_STYLE} required />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
            letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Reference (optional)</label>
          <input type="text" value={ref} onChange={e => setRef(e.target.value)}
            placeholder="e.g. statement/transaction reference" style={INPUT_STYLE} />
        </div>
        {error && <p style={{ fontSize: 11, color: '#f87171', marginBottom: 10 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={saving} style={{ ...BTN_SM_STYLE,
            background: '#0284c7', opacity: saving ? 0.65 : 1 }}>
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Save Expense'}
          </button>
          <button type="button" onClick={onCancel} disabled={saving}
            style={{ ...BTN_SM_STYLE, background: '#374151', opacity: saving ? 0.5 : 1 }}>Cancel</button>
        </div>
      </form>
    )
  }

  const totalExpenses = expenseList.reduce((s, x) => s + x.amount, 0)
  const recurringCount = expenseList.filter(x => x.recurrence === 'recurring').length

  return (
    <>
      {/* Info box */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 14,
        background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)',
        borderRadius: 10, padding: '10px 14px' }}>
        <Info size={13} color="#38bdf8" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
          Expenses — tracked record only. Does not affect Net Position, AUM or TWR.
          Add a new entry each month for recurring expenses.
        </p>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Total Expenses', value: formatCurrencyAbs(totalExpenses), color: '#38bdf8' },
          { label: 'Recurring Items', value: String(recurringCount), color: '#94a3b8' },
        ].map(s => (
          <div key={s.label} style={{ background: 'rgba(30,41,59,0.4)', border: '1px solid rgba(51,65,85,0.3)',
            borderRadius: 10, padding: '10px 14px' }}>
            <p style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>{s.label}</p>
            <p style={{ fontSize: 15, fontWeight: 700, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Add button */}
      {!editRec && (
        <div style={{ marginBottom: 14 }}>
          <button onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600,
            background: 'rgba(56,189,248,0.15)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.25)' }}>
            <Plus size={12} /> Record Expense
          </button>
        </div>
      )}

      {showForm && !editRec && renderExpenseForm(false)}
      {editRec && renderExpenseForm(true)}

      {/* List */}
      <p style={{ fontSize: 10, fontWeight: 600, color: '#475569', textTransform: 'uppercase',
        letterSpacing: '0.8px', marginBottom: 8 }}>Expense Log</p>
      {isLoading
        ? <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '20px 0' }}>Loading…</p>
        : expenseList.length === 0
          ? <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '20px 0' }}>No expenses recorded</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {expenseList.map(x => {
                const isRecurring = x.recurrence === 'recurring'
                return (
                  <div key={x.id} style={{
                    background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.18)',
                    borderRadius: 10, padding: '9px 12px',
                  }}>
                    <EventRow onEdit={() => openEdit(x)} onDelete={() => setDeletingId(x.id)}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                        {/* Left: icon + title + notes/ref */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0, flex: 1 }}>
                          <div style={{ width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center',
                            justifyContent: 'center', flexShrink: 0, background: 'rgba(56,189,248,0.2)' }}>
                            <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8' }}>-</span>
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#E2E8F0' }}>{x.description}</span>
                            <div style={{ marginTop: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ fontSize: 10, color: '#64748B' }}>
                                {isRecurring ? 'Recurring' : 'One-time'}
                              </span>
                              {x.reference && (
                                <span style={{ fontSize: 10, color: '#475569' }}>Ref: {x.reference}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* Right: date (bold, top) / amount (below) */}
                        <div style={{ flexShrink: 0, textAlign: 'right' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#CBD5E1' }}>{fmtDate(x.expense_date)}</div>
                          <div style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                            color: '#38bdf8', marginTop: 3 }}>
                            -{formatCurrencyAbs(x.amount)}
                          </div>
                        </div>
                      </div>
                    </EventRow>
                  </div>
                )
              })}
            </div>
      }

      {deletingId != null && (
        <ConfirmModal
          title="Delete Expense" message="Permanently delete this expense record?"
          variant="delete" confirmLabel="Delete"
          onConfirm={handleDelete} onCancel={() => setDeletingId(null)} loading={deleting}
        />
      )}
    </>
  )
}

// ── Tab 5: Wages/Invoices — tracked record only, no calc impact ──────────

function WagesTab({ queryClient }) {
  const { data: wageList = [], isLoading } = useQuery({
    queryKey: ['wages'],
    queryFn:  fetchWages,
    staleTime: 30_000,
  })

  const [showForm,     setShowForm]     = useState(false)
  const [formDate,     setFormDate]     = useState(todayISO())
  const [formEmp,      setFormEmp]      = useState('')
  const [formAmount,   setFormAmount]   = useState('')
  const [formRef,      setFormRef]      = useState('')
  const [formRecur,    setFormRecur]    = useState('one_time')
  const [formError,    setFormError]    = useState(null)
  const [submitting,   setSubmitting]   = useState(false)

  const [editRec,      setEditRec]      = useState(null)
  const [editDate,     setEditDate]     = useState('')
  const [editEmp,      setEditEmp]      = useState('')
  const [editAmount,   setEditAmount]   = useState('')
  const [editRef,      setEditRef]      = useState('')
  const [editRecur,    setEditRecur]    = useState('one_time')
  const [editError,    setEditError]    = useState(null)
  const [editSaving,   setEditSaving]   = useState(false)

  const [deletingId,   setDeletingId]   = useState(null)
  const [deleting,     setDeleting]     = useState(false)

  const formScrollRef = useRef(null)
  useEffect(() => {
    if (editRec) formScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editRec])

  function openAdd() {
    setEditRec(null); setFormDate(todayISO()); setFormEmp(''); setFormAmount('')
    setFormRef(''); setFormRecur('one_time'); setFormError(null); setShowForm(true)
  }

  function openEdit(r) {
    setShowForm(false); setEditRec(r); setEditDate(r.wage_date); setEditEmp(r.employee)
    setEditAmount(String(r.amount)); setEditRef(r.reference ?? ''); setEditRecur(r.recurrence ?? 'one_time')
    setEditError(null)
  }

  async function handleAdd(e) {
    e.preventDefault(); setFormError(null)
    const amt = parseFloat(formAmount)
    if (isNaN(amt) || amt <= 0) return setFormError('Enter valid amount > 0')
    if (!formEmp.trim()) return setFormError('Enter employee name')
    if (!formDate) return setFormError('Select a date')
    setSubmitting(true)
    try {
      await createWage({ wage_date: formDate, employee: formEmp.trim(),
        amount: parseFloat(amt.toFixed(2)), recurrence: formRecur, reference: formRef.trim() })
      await queryClient.invalidateQueries({ queryKey: ['wages'] })
      setShowForm(false)
    } catch (err) { setFormError(err.message ?? 'Failed') }
    finally { setSubmitting(false) }
  }

  async function handleUpdate(e) {
    e.preventDefault(); setEditError(null)
    const amt = parseFloat(editAmount)
    if (isNaN(amt) || amt <= 0) return setEditError('Enter valid amount > 0')
    if (!editEmp.trim()) return setEditError('Enter employee name')
    if (!editDate) return setEditError('Select a date')
    setEditSaving(true)
    try {
      await updateWage(editRec.id, { wage_date: editDate, employee: editEmp.trim(),
        amount: parseFloat(amt.toFixed(2)), recurrence: editRecur, reference: editRef.trim() })
      await queryClient.invalidateQueries({ queryKey: ['wages'] })
      setEditRec(null)
    } catch (err) { setEditError(err.message ?? 'Failed') }
    finally { setEditSaving(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteWage(deletingId)
      await queryClient.invalidateQueries({ queryKey: ['wages'] })
    } finally { setDeleting(false); setDeletingId(null) }
  }

  function renderWageForm(isEdit) {
    const date    = isEdit ? editDate   : formDate
    const emp     = isEdit ? editEmp    : formEmp
    const amount  = isEdit ? editAmount : formAmount
    const ref     = isEdit ? editRef    : formRef
    const recur   = isEdit ? editRecur  : formRecur
    const error   = isEdit ? editError  : formError
    const saving  = isEdit ? editSaving : submitting
    const setDate = isEdit ? setEditDate   : setFormDate
    const setEmp  = isEdit ? setEditEmp    : setFormEmp
    const setAmt  = isEdit ? setEditAmount : setFormAmount
    const setRef  = isEdit ? setEditRef    : setFormRef
    const setRec  = isEdit ? setEditRecur  : setFormRecur
    const onSubmit = isEdit ? handleUpdate : handleAdd
    const onCancel = isEdit ? () => setEditRec(null) : () => setShowForm(false)

    return (
      <form ref={isEdit ? formScrollRef : null} onSubmit={onSubmit} style={{
        background: 'rgba(244,114,182,0.06)', border: '1px solid rgba(244,114,182,0.2)',
        borderRadius: 10, padding: '14px 16px', marginBottom: 14,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.7px', color: '#f472b6', display: 'block', marginBottom: 10 }}>
          {isEdit ? 'Edit Wage/Invoice' : 'New Wage/Invoice'}
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 10 }}>
          <DateField value={date} onChange={setDate} />
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Amount (£)</label>
            <AmountInput value={amount} onChange={setAmt} style={INPUT_STYLE} required />
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Recurrence</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[{ id: 'one_time', label: 'One-time' }, { id: 'recurring', label: 'Recurring' }].map(o => (
                <button key={o.id} type="button" onClick={() => setRec(o.id)} style={{
                  flex: 1, padding: '7px 0', borderRadius: 7, border: 'none', fontSize: 11,
                  fontWeight: 600, cursor: 'pointer',
                  background: recur===o.id ? 'rgba(244,114,182,0.3)' : 'rgba(71,85,105,0.3)',
                  color: recur===o.id ? '#f472b6' : '#64748B',
                }}>{o.label}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
            letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Employee</label>
          <input type="text" value={emp} onChange={e => setEmp(e.target.value)}
            placeholder="e.g. J. Smith" style={INPUT_STYLE} required />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
            letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Reference (optional)</label>
          <input type="text" value={ref} onChange={e => setRef(e.target.value)}
            placeholder="e.g. statement/invoice reference" style={INPUT_STYLE} />
        </div>
        {error && <p style={{ fontSize: 11, color: '#f87171', marginBottom: 10 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={saving} style={{ ...BTN_SM_STYLE,
            background: '#db2777', opacity: saving ? 0.65 : 1 }}>
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Save Wage/Invoice'}
          </button>
          <button type="button" onClick={onCancel} disabled={saving}
            style={{ ...BTN_SM_STYLE, background: '#374151', opacity: saving ? 0.5 : 1 }}>Cancel</button>
        </div>
      </form>
    )
  }

  const totalWages     = wageList.reduce((s, w) => s + w.amount, 0)
  const recurringCount = wageList.filter(w => w.recurrence === 'recurring').length

  return (
    <>
      {/* Info box */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 14,
        background: 'rgba(244,114,182,0.06)', border: '1px solid rgba(244,114,182,0.2)',
        borderRadius: 10, padding: '10px 14px' }}>
        <Info size={13} color="#f472b6" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
          Wages &amp; invoices — tracked record only. Does not affect Net Position, AUM or TWR.
          Add a new entry each month for recurring wages/invoices.
        </p>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Total Wages/Invoices', value: formatCurrencyAbs(totalWages), color: '#f472b6' },
          { label: 'Recurring Items', value: String(recurringCount), color: '#94a3b8' },
        ].map(s => (
          <div key={s.label} style={{ background: 'rgba(30,41,59,0.4)', border: '1px solid rgba(51,65,85,0.3)',
            borderRadius: 10, padding: '10px 14px' }}>
            <p style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>{s.label}</p>
            <p style={{ fontSize: 15, fontWeight: 700, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Add button */}
      {!editRec && (
        <div style={{ marginBottom: 14 }}>
          <button onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600,
            background: 'rgba(244,114,182,0.15)', color: '#f472b6', border: '1px solid rgba(244,114,182,0.25)' }}>
            <Plus size={12} /> Record Wage/Invoice
          </button>
        </div>
      )}

      {showForm && !editRec && renderWageForm(false)}
      {editRec && renderWageForm(true)}

      {/* List */}
      <p style={{ fontSize: 10, fontWeight: 600, color: '#475569', textTransform: 'uppercase',
        letterSpacing: '0.8px', marginBottom: 8 }}>Wages/Invoices Log</p>
      {isLoading
        ? <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '20px 0' }}>Loading…</p>
        : wageList.length === 0
          ? <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '20px 0' }}>No wages/invoices recorded</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {wageList.map(w => {
                const isRecurring = w.recurrence === 'recurring'
                return (
                  <div key={w.id} style={{
                    background: 'rgba(244,114,182,0.06)', border: '1px solid rgba(244,114,182,0.18)',
                    borderRadius: 10, padding: '9px 12px',
                  }}>
                    <EventRow onEdit={() => openEdit(w)} onDelete={() => setDeletingId(w.id)}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                        {/* Left: icon + title + notes/ref */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0, flex: 1 }}>
                          <div style={{ width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center',
                            justifyContent: 'center', flexShrink: 0, background: 'rgba(244,114,182,0.2)' }}>
                            <span style={{ fontSize: 11, fontWeight: 800, color: '#f472b6' }}>-</span>
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#E2E8F0' }}>{w.employee}</span>
                            <div style={{ marginTop: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ fontSize: 10, color: '#64748B' }}>
                                {isRecurring ? 'Recurring' : 'One-time'}
                              </span>
                              {w.reference && (
                                <span style={{ fontSize: 10, color: '#475569' }}>Ref: {w.reference}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* Right: date (bold, top) / amount (below) */}
                        <div style={{ flexShrink: 0, textAlign: 'right' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#CBD5E1' }}>{fmtDate(w.wage_date)}</div>
                          <div style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                            color: '#f472b6', marginTop: 3 }}>
                            -{formatCurrencyAbs(w.amount)}
                          </div>
                        </div>
                      </div>
                    </EventRow>
                  </div>
                )
              })}
            </div>
      }

      {deletingId != null && (
        <ConfirmModal
          title="Delete Wage/Invoice" message="Permanently delete this record?"
          variant="delete" confirmLabel="Delete"
          onConfirm={handleDelete} onCancel={() => setDeletingId(null)} loading={deleting}
        />
      )}
    </>
  )
}

// ── LedgerModal — 5-tab shell ─────────────────────────────────────────────

function LedgerModal({ data, onClose }) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('capital')

  const TABS = [
    { id: 'capital',       label: 'Capital Events',       count: data?.events?.length ?? 0 },
    { id: 'transfers',     label: 'Darwinex Transfers',   count: null },
    { id: 'capxfer',       label: 'Capital Transfers',    count: null },
    { id: 'misc',          label: 'Miscellaneous',        count: null },
    { id: 'expenses',      label: 'Expenses',             count: null },
    { id: 'wages',         label: 'Wages/Invoices',       count: null },
  ]

  return (
    <Modal
      title="Fund Ledger — Audit Trail"
      subtitle={`Inception ${fmtDate(data?.inception_date)} · Full capital record`}
      onClose={onClose}
      wide
    >
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid rgba(51,65,85,0.4)', paddingBottom: 0 }}>
        {TABS.map(tab => {
          const active = activeTab === tab.id
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              padding: '8px 14px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600, transition: 'all 0.15s',
              background: active ? 'rgba(56,189,248,0.12)' : 'transparent',
              color: active ? '#38bdf8' : '#475569',
              borderBottom: active ? '2px solid #38bdf8' : '2px solid transparent',
            }}>
              {tab.label}
              {tab.count !== null && (
                <span style={{ marginLeft: 6, fontSize: 10, background: active ? 'rgba(56,189,248,0.2)' : 'rgba(71,85,105,0.3)',
                  color: active ? '#38bdf8' : '#64748B', padding: '1px 6px', borderRadius: 10 }}>
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'capital'   && <CapitalEventsTab    data={data}         queryClient={queryClient} />}
      {activeTab === 'transfers' && <InternalTransfersTab capitalData={data}  queryClient={queryClient} />}
      {activeTab === 'capxfer'   && <CapitalTransfersTab                     queryClient={queryClient} />}
      {activeTab === 'misc'      && <MiscellaneousTab                        queryClient={queryClient} />}
      {activeTab === 'expenses'  && <ExpensesTab                             queryClient={queryClient} />}
      {activeTab === 'wages'     && <WagesTab                                queryClient={queryClient} />}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Modal 2 — TWR Sub-period breakdown
// ---------------------------------------------------------------------------

function TWRModal({ data, onClose }) {
  const periods = data?.periods ?? []

  return (
    <Modal
      title="Time-Weighted Return — Period Breakdown"
      subtitle={`${data?.num_periods ?? 0} sub-period${(data?.num_periods ?? 0) !== 1 ? 's' : ''} · Chain-linked`}
      onClose={onClose}
      wide
    >
      {/* TWR headline */}
      <div className="flex items-center gap-4 mb-5 p-4 rounded-xl bg-slate-800/40 border border-slate-700/30">
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-0.5">Total TWR (ITD)</p>
          <p className={`text-3xl font-black tabular-nums ${(data?.twr ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {fmtPct(data?.twr)}
          </p>
        </div>
        <div className="flex items-start gap-2 ml-auto max-w-xs">
          <Info size={11} className="text-sky-500/60 mt-0.5 flex-shrink-0" />
          <p className="text-[10px] text-slate-500 leading-relaxed">
            <span className="text-sky-400/80 font-semibold">TWR</span> — chain-links sub-period returns,
            eliminating cash flow timing distortion. Industry-standard metric.
          </p>
        </div>
      </div>

      {/* Sub-period rows */}
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3">
        Sub-Period Breakdown
      </p>
      <div className="space-y-3">
        {periods.map((p) => {
          const pos      = p.pnl >= 0
          const pnlColor = pos ? 'text-emerald-400' : 'text-rose-400'
          const badge    = pos
            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
            : 'bg-rose-500/15 text-rose-400 border-rose-500/25'
          const cfColor  = p.cash_flow_at_start >= 0 ? 'text-sky-400' : 'text-amber-400'

          return (
            <div key={p.period_num}
              className="rounded-xl border border-slate-700/40 bg-slate-800/30 overflow-hidden">
              {/* Period header */}
              <div className="flex items-center justify-between px-4 py-3 bg-slate-700/20 border-b border-slate-700/30">
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded-lg bg-slate-600/40 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-slate-300">P{p.period_num}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Calendar size={11} className="text-slate-500" />
                    <span className="text-[11px] font-semibold text-slate-300">{fmtDate(p.start_date)}</span>
                    <ChevronRight size={10} className="text-slate-600" />
                    <span className="text-[11px] font-semibold text-slate-300">{fmtDate(p.end_date)}</span>
                  </div>
                </div>
                <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${badge}`}>
                  {fmtPct(p.period_return)}
                </span>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-4 divide-x divide-slate-700/30">
                {[
                  { label: 'Start AUM',  value: formatCurrencyAbs(p.start_aum),        color: 'text-slate-200' },
                  { label: 'Cash Flow',  value: formatCurrency(p.cash_flow_at_start),   color: cfColor          },
                  { label: 'End AUM',    value: formatCurrencyAbs(p.end_aum),           color: 'text-slate-200' },
                  { label: 'PnL',        value: (p.pnl >= 0 ? '+' : '') + formatCurrencyAbs(p.pnl), color: pnlColor },
                ].map(s => (
                  <div key={s.label} className="px-4 py-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{s.label}</p>
                    <p className={`text-sm font-bold tabular-nums ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Annualised */}
              {p.annualised_return != null && (
                <div className="px-4 py-2 bg-slate-700/10 border-t border-slate-700/20 flex items-center gap-2">
                  <Info size={10} className="text-slate-600" />
                  <span className="text-[10px] text-slate-500">
                    Annualised:{' '}
                    <span className={`font-semibold ${pnlColor}`}>{fmtPct(p.annualised_return)}</span>
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Totals */}
      <div className="mt-4 rounded-xl border border-sky-500/25 bg-sky-500/5 overflow-hidden">
        <div className="px-4 py-2.5 bg-sky-500/10 border-b border-sky-500/20">
          <span className="text-[10px] font-bold text-sky-400 uppercase tracking-widest">
            Fund Total — Since Inception
          </span>
        </div>
        <div className="grid grid-cols-4 divide-x divide-sky-500/15">
          {[
            { label: 'Initial AUM',  value: formatCurrencyAbs(data?.initial_aum),  color: 'text-slate-200' },
            { label: 'Current AUM',  value: formatCurrencyAbs(data?.current_aum),  color: 'text-slate-200' },
            { label: 'Total PnL',    value: formatCurrency(data?.total_pnl),       color: (data?.total_pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400' },
            { label: 'TWR',          value: fmtPct(data?.twr),                     color: (data?.twr ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400' },
          ].map(s => (
            <div key={s.label} className="px-4 py-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{s.label}</p>
              <p className={`text-sm font-bold tabular-nums ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Modal 3 — Equity Curve (Total PnL since inception)
// ---------------------------------------------------------------------------

function EquityModal({ equityCurve, totalPnl, onClose }) {
  // Convert equity → PnL since inception (equity[i] − equity[0])
  const base    = equityCurve?.[0]?.equity ?? 0
  const series  = (equityCurve ?? []).map(pt => ({
    date: fmtTimestamp(pt.timestamp),
    pnl:  parseFloat((pt.equity - base).toFixed(2)),
  }))

  const last   = series[series.length - 1]?.pnl ?? 0
  const peak   = series.length ? Math.max(...series.map(d => d.pnl)) : 0
  const trough = series.length ? Math.min(...series.map(d => d.pnl)) : 0
  const isPos  = last >= 0
  const lineColor = isPos ? '#34d399' : '#f87171'

  return (
    <Modal
      title="Total PnL — Equity Curve Since Inception"
      subtitle={`${series.length} data points`}
      onClose={onClose}
      wide
    >
      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Current PnL', value: formatCurrency(last),   color: isPos ? 'text-emerald-400' : 'text-rose-400' },
          { label: 'Peak PnL',    value: formatCurrencyAbs(peak), color: 'text-sky-400'   },
          { label: 'Trough PnL',  value: formatCurrency(trough),  color: 'text-amber-400' },
        ].map(s => (
          <div key={s.label} className="rounded-xl bg-slate-800/40 border border-slate-700/30 px-4 py-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{s.label}</p>
            <p className={`text-base font-bold tabular-nums ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="date"
              tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => formatCurrencyAbs(v)}
              width={64}
            />
            <Tooltip
              contentStyle={{
                background: '#0d1117',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: 'rgba(255,255,255,0.5)' }}
              formatter={v => [formatCurrency(v), 'PnL']}
            />
            <Line
              type="monotone"
              dataKey="pnl"
              stroke={lineColor}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: lineColor }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Skeleton card
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div className="bg-[#0d1117]/80 backdrop-blur-sm border border-slate-700/40
                    rounded-2xl p-5 animate-pulse h-[152px]">
      <div className="h-3 bg-slate-700/50 rounded w-24 mb-4" />
      <div className="h-8 bg-slate-700/50 rounded w-32 mb-3" />
      <div className="h-2.5 bg-slate-700/30 rounded w-20 mb-1.5" />
      <div className="h-2.5 bg-slate-700/30 rounded w-16" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// SummaryStrip — main export
// ---------------------------------------------------------------------------

const SummaryStrip = forwardRef(function SummaryStrip({ data, equityCurve, loading, cardsVisible = true }, ref) {
  const [modal, setModal] = useState(null) // 'ledger' | 'twr' | 'equity' | null

  useImperativeHandle(ref, () => ({
    openLedger: () => setModal('ledger'),
    openEquity: () => setModal('equity'),
    openTwr:    () => setModal('twr'),
  }))

  // Animated values
  const bankBalance    = data?.bank_balance    ?? 0
  const totalDeposited = data?.total_deposited ?? 0
  const totalWithdrawn = data?.total_withdrawn ?? 0
  const currentAum     = data?.current_aum     ?? 0
  const twr            = data?.twr             ?? 0
  const totalPnl       = data?.total_pnl       ?? 0

  const animBalance  = useCountUp(bankBalance)
  const animAum      = useCountUp(currentAum)
  const animTWR      = useCountUp(twr)
  const animPnl      = useCountUp(totalPnl)

  if (loading) {
    return cardsVisible ? (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
        {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
      </div>
    ) : null
  }

  // ── Shared card styles ──
  const CARD_H = 152 // px — all 4 cards same height

  const baseCard = {
    height:         CARD_H,
    display:        'flex',
    flexDirection:  'column',
    justifyContent: 'space-between',
    padding:        '18px 20px 16px',
    borderRadius:   16,
    border:         '1px solid rgba(255,255,255,0.08)',
    background:     'linear-gradient(160deg, rgba(28,45,71,0.42) 0%, rgba(13,24,38,0.68) 100%)',
    backdropFilter:       'blur(14px) saturate(150%)',
    WebkitBackdropFilter: 'blur(14px) saturate(150%)',
    boxShadow:      '0 1px 0 rgba(255,255,255,0.05) inset, 0 8px 20px -14px rgba(0,0,0,0.55)',
    transition:     'transform 0.22s cubic-bezier(.2,.8,.2,1), box-shadow 0.22s ease, border-color 0.22s ease',
    position:       'relative',
    overflow:       'hidden',
  }

  const clickableCard = {
    ...baseCard,
    cursor: 'pointer',
  }

  const LABEL_STYLE = {
    fontSize:      10,
    fontWeight:    600,
    letterSpacing: '0.8px',
    textTransform: 'uppercase',
    color:         '#475569',
    marginBottom:  6,
  }

  const MAIN_VAL_BASE = {
    fontSize:    26,
    fontWeight:  800,
    fontVariantNumeric: 'tabular-nums',
    lineHeight:  1.1,
  }

  const SUB_LINE = {
    fontSize:   11,
    fontFamily: 'ui-monospace, monospace',
    color:      'rgba(148,163,184,0.7)',
    lineHeight: 1.6,
  }

  const HINT = {
    position:      'absolute',
    bottom:        14,
    right:         16,
    fontSize:      9,
    fontWeight:    600,
    letterSpacing: '0.6px',
    textTransform: 'uppercase',
    color:         '#334155',
  }

  const isBalPos = bankBalance >= 0
  const isTWRPos = twr        >= 0
  const isPnlPos = totalPnl   >= 0

  return (
    <>
      {cardsVisible && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>

        {/* ── Card 1: Money Allocated ── */}
        <div
          style={{
            ...clickableCard,
            borderColor: isBalPos ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)',
            boxShadow:   isBalPos
              ? '0 0 20px rgba(52,211,153,0.07)'
              : '0 0 20px rgba(248,113,113,0.07)',
          }}
          onClick={() => setModal('ledger')}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = isBalPos ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.4)'
            e.currentTarget.style.transform   = 'scale(1.01)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = isBalPos ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'
            e.currentTarget.style.transform   = 'scale(1)'
          }}
        >
          <div>
            <div style={LABEL_STYLE}>Money Allocated</div>
            <div style={{ ...MAIN_VAL_BASE, color: isBalPos ? '#34d399' : '#f87171' }}>
              {formatCurrency(animBalance)}
            </div>
          </div>
          <div>
            <div style={SUB_LINE}>
              <span style={{ color: '#34d399' }}>↑ Deposited</span>
              {'  '}
              {formatCurrencyAbs(totalDeposited)}
            </div>
            <div style={SUB_LINE}>
              <span style={{ color: '#f87171' }}>↓ Withdrawn</span>
              {'  '}
              {formatCurrencyAbs(totalWithdrawn)}
            </div>
          </div>
          <span style={HINT}>Ledger ↗</span>
        </div>

        {/* ── Card 2: Current Equity ── */}
        <div style={baseCard}>
          <div>
            <div style={LABEL_STYLE}>Current Equity</div>
            <div style={{ ...MAIN_VAL_BASE, color: '#F1F5F9' }}>
              {formatCurrencyAbs(animAum)}
            </div>
          </div>
          <div style={SUB_LINE}>Assets Under Management</div>
        </div>

        {/* ── Card 3: Total PnL ── */}
        <div
          style={{
            ...clickableCard,
            borderColor: isPnlPos ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)',
            boxShadow:   isPnlPos
              ? '0 0 20px rgba(52,211,153,0.07)'
              : '0 0 20px rgba(248,113,113,0.07)',
          }}
          onClick={() => setModal('equity')}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = isPnlPos ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.4)'
            e.currentTarget.style.transform   = 'scale(1.01)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = isPnlPos ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'
            e.currentTarget.style.transform   = 'scale(1)'
          }}
        >
          <div>
            <div style={LABEL_STYLE}>Total PnL</div>
            <div style={{ ...MAIN_VAL_BASE, color: isPnlPos ? '#34d399' : '#f87171' }}>
              {formatCurrency(animPnl)}
            </div>
          </div>
          <div style={SUB_LINE}>Since inception</div>
          <span style={HINT}>Equity curve ↗</span>
        </div>

        {/* ── Card 4: Performance (TWR) ── */}
        <div
          style={{
            ...clickableCard,
            borderColor: isTWRPos ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)',
            boxShadow:   isTWRPos
              ? '0 0 20px rgba(52,211,153,0.07)'
              : '0 0 20px rgba(248,113,113,0.07)',
          }}
          onClick={() => setModal('twr')}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = isTWRPos ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.4)'
            e.currentTarget.style.transform   = 'scale(1.01)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = isTWRPos ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'
            e.currentTarget.style.transform   = 'scale(1)'
          }}
        >
          <div>
            <div style={LABEL_STYLE}>Performance</div>
            <div style={{ ...MAIN_VAL_BASE, color: isTWRPos ? '#34d399' : '#f87171' }}>
              {fmtPct(animTWR)}
            </div>
          </div>
          <div style={SUB_LINE}>Time-Weighted Return</div>
          <span style={HINT}>Breakdown ↗</span>
        </div>

      </div>
      )}

      {modal === 'ledger' && <LedgerModal  data={data}         onClose={() => setModal(null)} />}
      {modal === 'twr'    && <TWRModal     data={data}         onClose={() => setModal(null)} />}
      {modal === 'equity' && <EquityModal  equityCurve={equityCurve} totalPnl={totalPnl} onClose={() => setModal(null)} />}
    </>
  )
})

export default SummaryStrip
