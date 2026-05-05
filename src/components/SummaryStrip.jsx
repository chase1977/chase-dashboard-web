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

import { useState, useEffect, useRef } from 'react'
import { X, ArrowDownLeft, ArrowUpRight, Calendar, ChevronRight, Info, Plus, Trash2, Pencil } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useQueryClient } from '@tanstack/react-query'
import { createCapitalEvent, updateCapitalEvent, deleteCapitalEvent } from '../services/api.js'
import ConfirmModal from './ConfirmModal.jsx'

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
  if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${sign}£${(abs / 1_000).toFixed(1)}K`
  return `${sign}£${abs.toFixed(0)}`
}

function formatCurrencyAbs(val) {
  if (val === null || val === undefined) return '—'
  const abs = Math.abs(val)
  if (abs >= 1_000_000) return `£${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `£${(abs / 1_000).toFixed(1)}K`
  return `£${abs.toFixed(0)}`
}

function fmtPct(val, decimals = 2) {
  if (val === null || val === undefined) return '—'
  const pct  = val * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(decimals)}%`
}

function fmtDate(str) {
  if (!str) return '—'
  const d = new Date(str + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtTimestamp(str) {
  if (!str) return '—'
  const d = new Date(str)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
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
// Modal 1 — Ledger (capital events) — with deposit/withdrawal entry
// ---------------------------------------------------------------------------

// Returns today as YYYY-MM-DD for default date value
function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// Convert YYYY-MM-DD → DD-MM-YYYY for display
function isoToDDMMYYYY(iso) {
  if (!iso) return ''
  return iso.split('-').reverse().join('-')
}

function LedgerModal({ data, onClose }) {
  const queryClient = useQueryClient()
  const events = data?.events ?? []

  // ── Shared input style ──
  const INPUT = {
    width:        '100%',
    background:   '#111C2B',
    border:       '1px solid #1E3A5F',
    borderRadius: 7,
    padding:      '8px 10px',
    fontSize:     12,
    color:        '#E2E8F0',
    outline:      'none',
    boxSizing:    'border-box',
  }

  const BTN_SM = {
    padding:      '7px 14px',
    borderRadius: 7,
    border:       'none',
    cursor:       'pointer',
    fontSize:     11,
    fontWeight:   600,
    color:        '#fff',
    transition:   'background 0.15s',
  }

  // ── Add form state ──
  const [showForm,   setShowForm]   = useState(false)
  const [formType,   setFormType]   = useState('deposit')
  const [formDate,   setFormDate]   = useState(todayISO)
  const [formAmount, setFormAmount] = useState('')
  const [formNotes,  setFormNotes]  = useState('')
  const [formError,  setFormError]  = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const dateInputRef                = useRef(null)

  // ── Edit form state ──
  const [editingEvent, setEditingEvent] = useState(null) // event object being edited
  const [editType,     setEditType]     = useState('deposit')
  const [editDate,     setEditDate]     = useState('')
  const [editAmount,   setEditAmount]   = useState('')
  const [editNotes,    setEditNotes]    = useState('')
  const [editError,    setEditError]    = useState(null)
  const [editSaving,   setEditSaving]   = useState(false)
  const editDateRef                     = useRef(null)

  // ── Delete confirm state ──
  const [deletingId, setDeletingId] = useState(null)
  const [deleting,   setDeleting]   = useState(false)

  // ── Add form handlers ──
  function openForm(type) {
    setEditingEvent(null)        // close edit if open
    setFormType(type)
    setFormDate(todayISO())
    setFormAmount('')
    setFormNotes('')
    setFormError(null)
    setShowForm(true)
  }

  function closeForm() { setShowForm(false); setFormError(null) }

  function handleAmountBlur() {
    const n = parseFloat(formAmount)
    if (!isNaN(n)) setFormAmount(n.toFixed(2))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setFormError(null)
    const amt = parseFloat(formAmount)
    if (isNaN(amt) || amt <= 0) { setFormError('Enter valid amount > 0'); return }
    if (!formDate)               { setFormError('Select a date');          return }
    setSubmitting(true)
    try {
      await createCapitalEvent({ event_date: formDate, event_type: formType,
        amount: parseFloat(amt.toFixed(2)), notes: formNotes.trim() })
      await queryClient.invalidateQueries({ queryKey: ['fund_ledger'] })
      closeForm()
    } catch (err) {
      setFormError(err.message ?? 'Failed to save event')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Edit form handlers ──
  function openEdit(ev) {
    setShowForm(false)           // close add form if open
    setEditingEvent(ev)
    setEditType(ev.event_type)
    setEditDate(ev.date)
    setEditAmount(String(Math.abs(ev.amount)))
    setEditNotes(ev.notes ?? '')
    setEditError(null)
  }

  function closeEdit() { setEditingEvent(null); setEditError(null) }

  function handleEditAmountBlur() {
    const n = parseFloat(editAmount)
    if (!isNaN(n)) setEditAmount(n.toFixed(2))
  }

  async function handleEditSubmit(e) {
    e.preventDefault()
    setEditError(null)
    const amt = parseFloat(editAmount)
    if (isNaN(amt) || amt <= 0) { setEditError('Enter valid amount > 0'); return }
    if (!editDate)               { setEditError('Select a date');          return }
    setEditSaving(true)
    try {
      await updateCapitalEvent(editingEvent.event_id ?? editingEvent.id, {
        event_date: editDate,
        event_type: editType,
        amount:     parseFloat(amt.toFixed(2)),
        notes:      editNotes.trim(),
      })
      await queryClient.invalidateQueries({ queryKey: ['fund_ledger'] })
      closeEdit()
    } catch (err) {
      setEditError(err.message ?? 'Failed to update event')
    } finally {
      setEditSaving(false)
    }
  }

  // ── Delete handler ──
  async function handleDelete() {
    if (!deletingId) return
    setDeleting(true)
    try {
      await deleteCapitalEvent(deletingId)
      await queryClient.invalidateQueries({ queryKey: ['fund_ledger'] })
    } finally {
      setDeleting(false)
      setDeletingId(null)
    }
  }

  // ── Inline form renderer (shared for add + edit) ──
  function renderForm({ isEdit }) {
    const type      = isEdit ? editType     : formType
    const date      = isEdit ? editDate     : formDate
    const amount    = isEdit ? editAmount   : formAmount
    const notes     = isEdit ? editNotes    : formNotes
    const error     = isEdit ? editError    : formError
    const saving    = isEdit ? editSaving   : submitting
    const setType   = isEdit ? setEditType  : setFormType
    const setDate   = isEdit ? setEditDate  : setFormDate
    const setAmount = isEdit ? setEditAmount: setFormAmount
    const setNotes  = isEdit ? setEditNotes : setFormNotes
    const onBlur    = isEdit ? handleEditAmountBlur : handleAmountBlur
    const onSubmit  = isEdit ? handleEditSubmit     : handleSubmit
    const onCancel  = isEdit ? closeEdit            : closeForm
    const ref       = isEdit ? editDateRef          : dateInputRef
    const isDeposit = type === 'deposit'

    return (
      <form
        onSubmit={onSubmit}
        style={{
          background:   isDeposit ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)',
          border:       `1px solid ${isDeposit ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`,
          borderRadius: 10,
          padding:      '14px 16px',
          marginBottom: 16,
        }}
      >
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700,
            color: isDeposit ? '#34d399' : '#f87171',
            textTransform: 'uppercase', letterSpacing: '0.7px' }}>
            {isEdit ? 'Edit Event' : `New ${isDeposit ? 'Deposit' : 'Withdrawal'}`}
          </span>
          {/* Type toggle — only for edit mode */}
          {isEdit && (
            <div style={{ display: 'flex', gap: 6 }}>
              {['deposit', 'withdrawal'].map(t => (
                <button key={t} type="button" onClick={() => setType(t)}
                  style={{
                    padding: '3px 10px', borderRadius: 6, border: 'none',
                    fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    background: type === t
                      ? (t === 'deposit' ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)')
                      : 'rgba(71,85,105,0.3)',
                    color: type === t
                      ? (t === 'deposit' ? '#34d399' : '#f87171')
                      : '#64748B',
                  }}>
                  {t === 'deposit' ? 'Deposit' : 'Withdrawal'}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          {/* Date */}
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Date (DD-MM-YYYY)</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={{ flex: 1, ...INPUT, paddingRight: 34, display: 'block',
                color: date ? '#E2E8F0' : '#475569' }}>
                {date ? isoToDDMMYYYY(date) : 'DD-MM-YYYY'}
              </span>
              <div style={{ position: 'absolute', right: 8 }}>
                <input ref={ref} type="date" value={date} onChange={e => setDate(e.target.value)}
                  style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
                <button type="button" onClick={() => ref.current?.showPicker()}
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                    padding: 2, display: 'flex', alignItems: 'center' }}>
                  <Calendar size={14} color="#475569" />
                </button>
              </div>
            </div>
          </div>
          {/* Amount */}
          <div>
            <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Amount (£)</label>
            <input type="number" min="0.01" step="0.01" placeholder="0.00"
              value={amount} onChange={e => setAmount(e.target.value)} onBlur={onBlur}
              style={INPUT} required />
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase',
            letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Notes (optional)</label>
          <input type="text" placeholder="e.g. Monthly top-up"
            value={notes} onChange={e => setNotes(e.target.value)} style={INPUT} />
        </div>

        {error && <p style={{ fontSize: 11, color: '#f87171', marginBottom: 10 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={saving}
            style={{ ...BTN_SM, background: isDeposit ? '#22c55e' : '#ef4444',
              opacity: saving ? 0.65 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : (isEdit ? 'Update Event' : `Save ${isDeposit ? 'Deposit' : 'Withdrawal'}`)}
          </button>
          <button type="button" onClick={onCancel} disabled={saving}
            style={{ ...BTN_SM, background: '#374151', opacity: saving ? 0.5 : 1 }}>
            Cancel
          </button>
        </div>
      </form>
    )
  }

  return (
    <>
      <Modal
        title="Money Allocated — Capital Ledger"
        subtitle={`${events.length} event${events.length !== 1 ? 's' : ''} · Inception ${fmtDate(data?.inception_date)}`}
        onClose={onClose}
        wide
      >
        {/* ── Action buttons ── */}
        {!editingEvent && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onClick={() => openForm('deposit')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: 'rgba(52,211,153,0.15)', color: '#34d399',
                border: '1px solid rgba(52,211,153,0.25)' }}>
              <Plus size={13} /> Record Deposit
            </button>
            <button onClick={() => openForm('withdrawal')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: 'rgba(248,113,113,0.12)', color: '#f87171',
                border: '1px solid rgba(248,113,113,0.25)' }}>
              <Plus size={13} /> Record Withdrawal
            </button>
          </div>
        )}

        {/* ── Add form ── */}
        {showForm && !editingEvent && renderForm({ isEdit: false })}

        {/* ── Edit form ── */}
        {editingEvent && renderForm({ isEdit: true })}

        {/* ── Summary bar ── */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Net Position',    value: formatCurrency(data?.bank_balance),      color: (data?.bank_balance ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400' },
            { label: 'Total Deposited', value: formatCurrencyAbs(data?.total_deposited), color: 'text-emerald-400' },
            { label: 'Total Withdrawn', value: formatCurrencyAbs(data?.total_withdrawn), color: 'text-rose-400'   },
          ].map(s => (
            <div key={s.label} className="rounded-xl bg-slate-800/40 border border-slate-700/30 px-4 py-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{s.label}</p>
              <p className={`text-base font-bold tabular-nums ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── Event table ── */}
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3">
          Event Log
        </p>
        {events.length === 0 ? (
          <p className="text-xs text-slate-600 text-center py-6">No events recorded</p>
        ) : (
          <div className="space-y-2">
            {events.map(ev => {
              const isDeposit    = ev.event_type === 'deposit'
              const isWithdrawal = ev.event_type === 'withdrawal'
              const isExternal   = isDeposit || isWithdrawal
              const bg       = isDeposit    ? 'bg-emerald-500/10 border-emerald-500/20'
                             : isWithdrawal ? 'bg-rose-500/10 border-rose-500/20'
                             :                'bg-slate-800/40 border-slate-700/30'
              const amtColor = isDeposit ? 'text-emerald-400' : isWithdrawal ? 'text-rose-400' : 'text-slate-400'
              const label    = isDeposit    ? 'Deposit'
                             : isWithdrawal ? 'Withdrawal'
                             : ev.event_type === 'pod_allocation' ? `→ ${ev.pod_id}` : `← ${ev.pod_id}`
              const Icon = isDeposit ? ArrowDownLeft : isWithdrawal ? ArrowUpRight : null

              return (
                <div
                  key={ev.event_id}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl border ${bg}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {Icon ? (
                      <div className={`flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center
                        ${isDeposit ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}>
                        <Icon size={13} className={amtColor} />
                      </div>
                    ) : (
                      <div className="flex-shrink-0 w-6 h-6 rounded-md bg-slate-500/20 flex items-center justify-center">
                        <span className="text-slate-400 text-[10px] font-bold">↔</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-slate-200 block truncate">{label}</span>
                      {ev.notes && (
                        <span className="text-[10px] text-slate-500 block truncate">{ev.notes}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                    <span className="text-[10px] text-slate-500 tabular-nums">{ev.date}</span>
                    <span className={`text-xs font-bold tabular-nums ${amtColor}`}>
                      {isExternal
                        ? formatCurrency(isWithdrawal ? -Math.abs(ev.amount) : ev.amount)
                        : formatCurrencyAbs(ev.amount)}
                    </span>
                    {/* Edit + Delete — only for user-managed events (deposit/withdrawal) */}
                    {isExternal && (
                      <>
                        <button
                          onClick={() => openEdit(ev)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            padding: 3, borderRadius: 5, display: 'flex', alignItems: 'center',
                            color: '#475569', transition: 'color 0.15s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#38BDF8' }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#475569' }}
                          title="Edit event"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => setDeletingId(ev.event_id ?? ev.id)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            padding: 3, borderRadius: 5, display: 'flex', alignItems: 'center',
                            color: '#475569', transition: 'color 0.15s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#f87171' }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#475569' }}
                          title="Delete event"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Modal>

      {/* ── Delete confirm ── */}
      {deletingId != null && (
        <ConfirmModal
          title="Delete Capital Event"
          message="Permanently delete this event? This will recalculate all TWR sub-periods."
          variant="delete"
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeletingId(null)}
          loading={deleting}
        />
      )}
    </>
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

export default function SummaryStrip({ data, equityCurve, loading }) {
  const [modal, setModal] = useState(null) // 'ledger' | 'twr' | 'equity' | null

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
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
      </div>
    )
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
    border:         '1px solid rgba(30,58,95,0.6)',
    background:     'rgba(13,17,23,0.80)',
    backdropFilter: 'blur(8px)',
    transition:     'all 0.2s',
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>

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

        {/* ── Card 2: Current AUM ── */}
        <div style={baseCard}>
          <div>
            <div style={LABEL_STYLE}>Current AUM</div>
            <div style={{ ...MAIN_VAL_BASE, color: '#F1F5F9' }}>
              {formatCurrencyAbs(animAum)}
            </div>
          </div>
          <div style={SUB_LINE}>Assets Under Management</div>
        </div>

        {/* ── Card 3: TWR ── */}
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
            <div style={LABEL_STYLE}>TWR</div>
            <div style={{ ...MAIN_VAL_BASE, color: isTWRPos ? '#34d399' : '#f87171' }}>
              {fmtPct(animTWR)}
            </div>
          </div>
          <div style={SUB_LINE}>Time-Weighted Return</div>
          <span style={HINT}>Breakdown ↗</span>
        </div>

        {/* ── Card 4: Total PnL ── */}
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

      </div>

      {modal === 'ledger' && <LedgerModal  data={data}         onClose={() => setModal(null)} />}
      {modal === 'twr'    && <TWRModal     data={data}         onClose={() => setModal(null)} />}
      {modal === 'equity' && <EquityModal  equityCurve={equityCurve} totalPnl={totalPnl} onClose={() => setModal(null)} />}
    </>
  )
}
