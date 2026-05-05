// frontend/src/components/PodStrategyManager.jsx
/**
 * PodStrategyManager — full CRUD modal for Pods and Strategies.
 *
 * Tabs:
 *   Pods       — add / edit / delete pods (name, code, color, date, status, notes)
 *   Strategies — add / edit / delete strategies (name, code, pod, initial_investment,
 *                date, status, notes; account_id for future linking)
 *
 * Confirm modal: green=confirm / red=cancel (default)
 *                red=confirm / grey=cancel (delete — inverted)
 *
 * Props:
 *   onClose  {function}   close the manager
 *   onSaved  {function}   called after any mutation so parent can refetch
 */

import { useState, useRef }    from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Plus, Pencil, Trash2, Check, XCircle } from 'lucide-react'
import {
  fetchPods, createPod, updatePod, deletePod,
  fetchStrategies, createStrategy, updateStrategy, deleteStrategy,
  fetchAccountIds, fetchNetDeployed,
} from '../services/api.js'
import ConfirmModal from './ConfirmModal.jsx'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUSES = ['Active', 'Inactive', 'Paused']

// Known brokerage accounts — must match internal_transfers account names
const BROKERAGE_ACCOUNTS = ['Chase1', 'Chase3xA', 'XPF2026']

const POD_COLORS_PRESET = [
  '#0EA5E9', '#F59E0B', '#34D399', '#A78BFA', '#F472B6',
  '#FB923C', '#38BDF8', '#4ADE80', '#E879F9', '#F43F5E',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function fmtMoney(v) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  if (abs >= 999_950) return `£${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)   return `£${(abs / 1_000).toFixed(2)}K`
  return `£${abs.toFixed(2)}`
}

// Shared input style
const INPUT = {
  width:        '100%',
  background:   '#111C2B',
  border:       '1px solid #1E3A5F',
  borderRadius: 7,
  padding:      '7px 10px',
  fontSize:     12,
  color:        '#E2E8F0',
  outline:      'none',
  boxSizing:    'border-box',
}

const LABEL_STYLE = {
  fontSize:      10,
  color:         '#64748B',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  display:       'block',
  marginBottom:  4,
}

function FormField({ label, children }) {
  return (
    <div>
      <label style={LABEL_STYLE}>{label}</label>
      {children}
    </div>
  )
}

// Comma-formatted amount input — stores raw numeric string, displays with separators
function AmountInput({ value, onChange, style }) {
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
    if (!isNaN(n) && n >= 0) onChange(n.toFixed(2))
  }
  return (
    <input type="text" inputMode="decimal"
      value={toDisplay(value)} onChange={handleChange} onBlur={handleBlur}
      style={style} placeholder="0.00" />
  )
}

// ---------------------------------------------------------------------------
// Color picker row
// ---------------------------------------------------------------------------

function ColorPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {POD_COLORS_PRESET.map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          style={{
            width:        20,
            height:       20,
            borderRadius: '50%',
            background:   c,
            border:       c === value ? '2px solid #fff' : '2px solid transparent',
            cursor:       'pointer',
            boxShadow:    c === value ? `0 0 0 1px ${c}` : 'none',
            padding:      0,
            flexShrink:   0,
          }}
        />
      ))}
      {/* Custom hex input */}
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: 26, height: 26, padding: 2,
          borderRadius: 6, border: '1px solid #1E3A5F',
          background: '#111C2B', cursor: 'pointer',
        }}
        title="Custom colour"
      />
      <span style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace' }}>{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pod Form (add / edit)
// ---------------------------------------------------------------------------

function PodForm({ initial, onSave, onCancel, saving, error }) {
  const [name,   setName]   = useState(initial?.name         ?? '')
  const [code,   setCode]   = useState(initial?.pod_code     ?? '')
  const [color,  setColor]  = useState(initial?.color        ?? '#0EA5E9')
  const [date,   setDate]   = useState(initial?.date_created ?? todayISO())
  const [status, setStatus] = useState(initial?.status       ?? 'Active')
  const [notes,  setNotes]  = useState(initial?.notes        ?? '')

  function handleSubmit(e) {
    e.preventDefault()
    onSave({ name, pod_code: code.toUpperCase(), color, date_created: date, status, notes })
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <FormField label="Pod Name">
          <input
            style={INPUT} required
            value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Alpha Pod"
          />
        </FormField>
        <FormField label="Pod Code (max 8 chars)">
          <input
            style={{ ...INPUT, textTransform: 'uppercase' }} required
            maxLength={8} value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. ALPHA"
          />
        </FormField>
        <FormField label="Date Created">
          <input type="date" style={INPUT} value={date} onChange={e => setDate(e.target.value)} />
        </FormField>
        <FormField label="Status">
          <select style={INPUT} value={status} onChange={e => setStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </FormField>
      </div>

      <FormField label="Pod Colour">
        <div style={{ marginTop: 4 }}>
          <ColorPicker value={color} onChange={setColor} />
        </div>
      </FormField>

      <div style={{ marginTop: 10 }}>
        <FormField label="Notes (optional)">
          <input style={INPUT} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Optional description" />
        </FormField>
      </div>

      {error && <p style={{ fontSize: 11, color: '#f87171', margin: '8px 0' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button
          type="submit" disabled={saving}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: 12, fontWeight: 600,
            background: '#22c55e', color: '#fff', opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : (initial ? 'Save Changes' : 'Create Pod')}
        </button>
        <button
          type="button" onClick={onCancel} disabled={saving}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none',
            cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: '#374151', color: '#E2E8F0',
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Strategy Form (add / edit)
// ---------------------------------------------------------------------------

function StrategyForm({ initial, pods, onSave, onCancel, saving, error }) {
  const [name,             setName]            = useState(initial?.name               ?? '')
  const [code,             setCode]            = useState(initial?.strategy_code      ?? '')
  const [podId,            setPodId]           = useState(initial?.pod_id             ?? '')
  const [date,             setDate]            = useState(initial?.date_created       ?? todayISO())
  const [status,           setStatus]          = useState(initial?.status             ?? 'Active')
  const [notes,            setNotes]           = useState(initial?.notes              ?? '')
  const [accountId,        setAccountId]       = useState(
    initial?.account_id != null ? String(initial.account_id) : ''
  )
  const [brokerageAccount, setBrokerageAccount] = useState(initial?.brokerage_account ?? '')

  // ── Live AccountIds from user_accounts_equity ──
  const { data: accountIds = [], isLoading: loadingAccIds } = useQuery({
    queryKey:  ['account_ids'],
    queryFn:   fetchAccountIds,
    staleTime: 60_000,
  })

  // ── Net deployed per brokerage account (from internal_transfers) ──
  const { data: netDeployed = {} } = useQuery({
    queryKey:  ['net_deployed'],
    queryFn:   fetchNetDeployed,
    staleTime: 60_000,
  })

  const computedInitial = netDeployed[brokerageAccount] ?? null

  function handleSubmit(e) {
    e.preventDefault()
    onSave({
      name,
      strategy_code:     code.toUpperCase(),
      pod_id:            podId !== '' ? parseInt(podId, 10) : null,
      date_created:      date,
      status,
      notes,
      brokerage_account: brokerageAccount || null,
      ...(accountId !== '' ? { account_id: parseInt(accountId, 10) } : {}),
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <FormField label="Strategy Name">
          <input
            style={INPUT} required
            value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Momentum EUR/USD"
          />
        </FormField>
        <FormField label="Strategy Code (max 12 chars)">
          <input
            style={{ ...INPUT, textTransform: 'uppercase' }} required
            maxLength={12} value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. MOM_EURUSD"
          />
        </FormField>
        <FormField label="Pod">
          <select style={INPUT} value={podId} onChange={e => setPodId(e.target.value)}>
            <option value="">— None —</option>
            {(pods ?? []).map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.pod_code})</option>
            ))}
          </select>
        </FormField>
        <FormField label="Brokerage Account">
          <select
            style={INPUT}
            value={brokerageAccount}
            onChange={e => setBrokerageAccount(e.target.value)}
          >
            <option value="">— None —</option>
            {BROKERAGE_ACCOUNTS.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          {/* Show computed net deployed for selected account */}
          {brokerageAccount && (
            <div style={{ marginTop: 4, fontSize: 10, color: computedInitial != null ? '#34D399' : '#475569' }}>
              {computedInitial != null
                ? `Net deployed: ${fmtMoney(computedInitial)} (auto-computed from transfers)`
                : 'No transfers recorded for this account yet'}
            </div>
          )}
        </FormField>
        <FormField label="Date Created">
          <input type="date" style={INPUT} value={date} onChange={e => setDate(e.target.value)} />
        </FormField>
        <FormField label="Status">
          <select style={INPUT} value={status} onChange={e => setStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </FormField>
      </div>

      {/* Account ID — live dropdown from user_accounts_equity */}
      <FormField label="Darwinex Account ID">
        <select
          style={INPUT}
          value={accountId}
          onChange={e => setAccountId(e.target.value)}
          disabled={loadingAccIds}
        >
          <option value="">— None —</option>
          {accountIds.map(a => (
            <option key={a.account_id} value={a.account_id}>
              {a.account_id}
              {a.equity > 0 ? `  ·  £${a.equity.toLocaleString('en-GB', { maximumFractionDigits: 0 })}` : '  ·  £0'}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 10, color: '#334155', marginTop: 3, display: 'block' }}>
          {loadingAccIds
            ? 'Loading accounts…'
            : `${accountIds.length} account${accountIds.length !== 1 ? 's' : ''} found in Supabase`}
        </span>
      </FormField>

      <div style={{ marginTop: 10 }}>
        <FormField label="Notes (optional)">
          <input style={INPUT} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Optional description" />
        </FormField>
      </div>

      {error && <p style={{ fontSize: 11, color: '#f87171', margin: '8px 0' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button
          type="submit" disabled={saving}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: 12, fontWeight: 600,
            background: '#22c55e', color: '#fff', opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : (initial ? 'Save Changes' : 'Create Strategy')}
        </button>
        <button
          type="button" onClick={onCancel} disabled={saving}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none',
            cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: '#374151', color: '#E2E8F0',
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Pods Tab
// ---------------------------------------------------------------------------

function PodsTab({ queryClient, onSaved }) {
  const { data: pods = [], isLoading, refetch } = useQuery({
    queryKey: ['mgmt_pods'],
    queryFn:  fetchPods,
    staleTime: 30_000,
  })

  const [mode,     setMode]     = useState(null)          // null | 'add' | { edit: pod }
  const [saving,   setSaving]   = useState(false)
  const [formErr,  setFormErr]  = useState(null)
  const [deleteId, setDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)

  async function handleSave(body) {
    setSaving(true); setFormErr(null)
    try {
      if (mode?.edit) await updatePod(mode.edit.id, body)
      else            await createPod(body)
      await refetch()
      onSaved?.()
      setMode(null)
    } catch (e) {
      setFormErr(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deletePod(deleteId)
      await refetch()
      onSaved?.()
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  const podToDelete = pods.find(p => p.id === deleteId)

  return (
    <>
      {/* Add Pod button */}
      {!mode && (
        <div style={{ marginBottom: 14 }}>
          <button
            onClick={() => { setMode('add'); setFormErr(null) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(14,165,233,0.25)',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: 'rgba(14,165,233,0.10)', color: '#38BDF8',
            }}
          >
            <Plus size={13} /> Add New Pod
          </button>
        </div>
      )}

      {/* Form */}
      {mode && (
        <div style={{
          background: '#111C2B', border: '1px solid #1E3A5F',
          borderRadius: 10, padding: 16, marginBottom: 14,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#38BDF8',
            textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 12 }}>
            {mode?.edit ? `Edit Pod — ${mode.edit.name}` : 'New Pod'}
          </div>
          <PodForm
            initial={mode?.edit ?? null}
            onSave={handleSave}
            onCancel={() => setMode(null)}
            saving={saving}
            error={formErr}
          />
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <p style={{ fontSize: 12, color: '#475569', padding: '20px 0' }}>Loading…</p>
      ) : pods.length === 0 ? (
        <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '28px 0' }}>
          No pods configured. Add one above.
        </p>
      ) : (
        <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1E3A5F' }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '28px 1fr 80px 90px 70px 80px',
            gap: 8, padding: '8px 12px',
            background: '#0D1B2E', borderBottom: '1px solid #1E3A5F',
          }}>
            {['', 'Name', 'Code', 'Date', 'Status', ''].map((h, i) => (
              <span key={i} style={{ fontSize: 10, fontWeight: 600, color: '#475569',
                textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                {h}
              </span>
            ))}
          </div>

          {pods.map((pod, i) => (
            <div
              key={pod.id}
              style={{
                display: 'grid', gridTemplateColumns: '28px 1fr 80px 90px 70px 80px',
                gap: 8, padding: '9px 12px', alignItems: 'center',
                background: i % 2 === 0 ? '#0D1728' : 'transparent',
                borderBottom: i < pods.length - 1 ? '1px solid #162032' : 'none',
              }}
            >
              {/* Colour dot */}
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: pod.color ?? '#475569', flexShrink: 0,
              }} />

              {/* Name */}
              <span style={{ fontSize: 12, color: '#E2E8F0', fontWeight: 500 }}>
                {pod.name}
                {pod.notes && (
                  <span style={{ fontSize: 10, color: '#475569', marginLeft: 6 }}>{pod.notes}</span>
                )}
              </span>

              {/* Code */}
              <span style={{
                fontSize: 10, fontWeight: 700, color: pod.color ?? '#94A3B8',
                letterSpacing: '0.4px',
              }}>
                {pod.pod_code}
              </span>

              {/* Date */}
              <span style={{ fontSize: 11, color: '#64748B' }}>{pod.date_created}</span>

              {/* Status */}
              <span style={{
                fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 10,
                background: pod.status === 'Active' ? 'rgba(52,211,153,0.10)' : 'rgba(245,158,11,0.10)',
                color:      pod.status === 'Active' ? '#34D399' : '#F59E0B',
                border:     `1px solid ${pod.status === 'Active' ? 'rgba(52,211,153,0.25)' : 'rgba(245,158,11,0.25)'}`,
              }}>
                {pod.status}
              </span>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => { setMode({ edit: pod }); setFormErr(null) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                    padding: 4, color: '#475569', transition: 'color 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#38BDF8' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#475569' }}
                  title="Edit pod"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => setDeleteId(pod.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                    padding: 4, color: '#475569', transition: 'color 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#f87171' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#475569' }}
                  title="Delete pod"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteId != null && (
        <ConfirmModal
          title="Delete Pod"
          message={`Permanently delete "${podToDelete?.name ?? ''}"? Strategies under this pod will be unlinked.`}
          variant="delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
          loading={deleting}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Strategies Tab
// ---------------------------------------------------------------------------

function StrategiesTab({ queryClient, onSaved }) {
  const { data: pods = [] } = useQuery({
    queryKey: ['mgmt_pods'],
    queryFn:  fetchPods,
    staleTime: 30_000,
  })
  const { data: strategies = [], isLoading, refetch } = useQuery({
    queryKey: ['mgmt_strategies'],
    queryFn:  () => fetchStrategies(),
    staleTime: 30_000,
  })
  const { data: netDeployed = {} } = useQuery({
    queryKey:  ['net_deployed'],
    queryFn:   fetchNetDeployed,
    staleTime: 60_000,
  })

  const [mode,     setMode]     = useState(null)
  const [saving,   setSaving]   = useState(false)
  const [formErr,  setFormErr]  = useState(null)
  const [deleteId, setDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)

  async function handleSave(body) {
    setSaving(true); setFormErr(null)
    try {
      if (mode?.edit) await updateStrategy(mode.edit.id, body)
      else            await createStrategy(body)
      await refetch()
      onSaved?.()
      setMode(null)
    } catch (e) {
      setFormErr(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteStrategy(deleteId)
      await refetch()
      onSaved?.()
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  const podMap = Object.fromEntries((pods ?? []).map(p => [p.id, p]))
  const stratToDelete = strategies.find(s => s.id === deleteId)

  return (
    <>
      {/* Add Strategy button */}
      {!mode && (
        <div style={{ marginBottom: 14 }}>
          <button
            onClick={() => { setMode('add'); setFormErr(null) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(14,165,233,0.25)',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: 'rgba(14,165,233,0.10)', color: '#38BDF8',
            }}
          >
            <Plus size={13} /> Add New Strategy
          </button>
        </div>
      )}

      {/* Form */}
      {mode && (
        <div style={{
          background: '#111C2B', border: '1px solid #1E3A5F',
          borderRadius: 10, padding: 16, marginBottom: 14,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#38BDF8',
            textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 12 }}>
            {mode?.edit ? `Edit Strategy — ${mode.edit.name}` : 'New Strategy'}
          </div>
          <StrategyForm
            initial={mode?.edit ?? null}
            pods={pods}
            onSave={handleSave}
            onCancel={() => setMode(null)}
            saving={saving}
            error={formErr}
          />
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <p style={{ fontSize: 12, color: '#475569', padding: '20px 0' }}>Loading…</p>
      ) : strategies.length === 0 ? (
        <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '28px 0' }}>
          No strategies configured. Add one above.
        </p>
      ) : (
        <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1E3A5F' }}>
          {/* Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 90px 110px 110px 90px 70px 72px',
            gap: 8, padding: '8px 12px',
            background: '#0D1B2E', borderBottom: '1px solid #1E3A5F',
          }}>
            {['Name', 'Code', 'Pod', 'Account / Net', 'Date', 'Status', ''].map((h, i) => (
              <span key={i} style={{ fontSize: 10, fontWeight: 600, color: '#475569',
                textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                {h}
              </span>
            ))}
          </div>

          {strategies.map((strat, i) => {
            const pod         = podMap[strat.pod_id]
            const acct        = strat.brokerage_account
            const netAmt      = acct ? (netDeployed[acct] ?? null) : null
            return (
              <div
                key={strat.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 90px 110px 110px 90px 70px 72px',
                  gap: 8, padding: '9px 12px', alignItems: 'center',
                  background: i % 2 === 0 ? '#0D1728' : 'transparent',
                  borderBottom: i < strategies.length - 1 ? '1px solid #162032' : 'none',
                }}
              >
                {/* Name + Darwinex account ID badge */}
                <div>
                  <span style={{ fontSize: 12, color: '#E2E8F0', fontWeight: 500 }}>
                    {strat.name}
                  </span>
                  {strat.account_id && (
                    <span style={{ fontSize: 10, color: '#475569', marginLeft: 6 }}>
                      #{strat.account_id}
                    </span>
                  )}
                </div>

                {/* Code */}
                <span style={{
                  fontSize: 10, fontWeight: 700, color: '#94A3B8',
                  letterSpacing: '0.4px',
                }}>
                  {strat.strategy_code}
                </span>

                {/* Pod chip */}
                {pod ? (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%',
                      background: pod.color ?? '#475569', flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 600, color: pod.color ?? '#94A3B8' }}>
                      {pod.pod_code}
                    </span>
                  </div>
                ) : (
                  <span style={{ fontSize: 11, color: '#334155' }}>—</span>
                )}

                {/* Brokerage account + computed net deployed */}
                <div>
                  {acct ? (
                    <>
                      <span style={{
                        fontSize: 10, fontWeight: 600, color: '#38BDF8',
                        letterSpacing: '0.3px',
                      }}>
                        {acct}
                      </span>
                      <div style={{ fontSize: 10, color: netAmt != null ? '#34D399' : '#475569',
                        fontFamily: 'ui-monospace, monospace', marginTop: 1 }}>
                        {netAmt != null ? fmtMoney(netAmt) : '—'}
                      </div>
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: '#334155' }}>—</span>
                  )}
                </div>

                {/* Date */}
                <span style={{ fontSize: 11, color: '#64748B' }}>{strat.date_created}</span>

                {/* Status */}
                <span style={{
                  fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 10,
                  background: strat.status === 'Active' ? 'rgba(52,211,153,0.10)' : 'rgba(245,158,11,0.10)',
                  color:      strat.status === 'Active' ? '#34D399' : '#F59E0B',
                  border:     `1px solid ${strat.status === 'Active' ? 'rgba(52,211,153,0.25)' : 'rgba(245,158,11,0.25)'}`,
                }}>
                  {strat.status}
                </span>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => { setMode({ edit: strat }); setFormErr(null) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer',
                      padding: 4, color: '#475569', transition: 'color 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#38BDF8' }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#475569' }}
                    title="Edit strategy"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => setDeleteId(strat.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer',
                      padding: 4, color: '#475569', transition: 'color 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#f87171' }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#475569' }}
                    title="Delete strategy"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {deleteId != null && (
        <ConfirmModal
          title="Delete Strategy"
          message={`Permanently delete "${stratToDelete?.name ?? ''}"?`}
          variant="delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
          loading={deleting}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function PodStrategyManager({ onClose, onSaved }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('pods') // 'pods' | 'strategies'

  // Close on Escape
  const handleKeyDown = (e) => { if (e.key === 'Escape') onClose?.() }

  const tabStyle = (active) => ({
    padding:     '7px 16px',
    borderRadius: 7,
    border:      'none',
    cursor:      'pointer',
    fontSize:    12,
    fontWeight:  600,
    background:  active ? '#1E3A5F' : 'transparent',
    color:       active ? '#38BDF8' : '#475569',
    transition:  'all 0.15s',
  })

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, background: 'rgba(0,0,0,0.70)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        style={{
          position:    'relative',
          width:       '100%',
          maxWidth:    820,
          maxHeight:   '88vh',
          background:  '#0D1B2E',
          border:      '1px solid #1E3A5F',
          borderRadius: 16,
          boxShadow:   '0 30px 80px rgba(0,0,0,0.55)',
          display:     'flex',
          flexDirection: 'column',
          overflow:    'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #1E3A5F', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#F1F5F9' }}>
              Manage Pods &amp; Strategies
            </div>
            <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
              Configure trading pods and strategies — changes reflected across portfolio
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8, border: 'none',
              background: 'rgba(71,85,105,0.30)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#94A3B8',
            }}
          >
            <X size={15} />
          </button>
        </div>

     
        {/* Tab navigation */}
        <div style={{
          display: 'flex', gap: 2, padding: '12px 20px 0',
          borderBottom: '1px solid #1E3A5F', flexShrink: 0,
        }}>
          <button style={tabStyle(tab === 'pods')}       onClick={() => setTab('pods')}>
            Pods
          </button>
          <button style={tabStyle(tab === 'strategies')} onClick={() => setTab('strategies')}>
            Strategies
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {tab === 'pods'       && <PodsTab       queryClient={queryClient} onSaved={onSaved} />}
          {tab === 'strategies' && <StrategiesTab  queryClient={queryClient} onSaved={onSaved} />}
        </div>

      </div>
    </div>
  )
}
