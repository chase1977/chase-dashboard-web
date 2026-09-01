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

import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Plus, Pencil, Trash2, Check, XCircle } from 'lucide-react'
import {
  fetchPods, createPod, updatePod, deletePod,
  fetchStrategies, createStrategy, updateStrategy, deleteStrategy,
  fetchAccountIds, fetchNetDeployed, fetchAxiaClients, fetchIgClients,
  fetchDataFeeds, fetchDataFeedClients,
} from '../services/api.js'
import ConfirmModal from './ConfirmModal.jsx'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Active: running now, contributes normally. Inactive: paused, could
// restart — contributes 0 to the portfolio unless real data exists.
// Closed: wound down, money returned/banked. See README §14.
const STATUSES = ['Active', 'Inactive', 'Closed']

// Status badge colours — 3-state (Active=green, Inactive=amber, Closed=red)
const STATUS_COLOR = {
  Active:   '#34D399',
  Inactive: '#F59E0B',
  Closed:   '#F87171',
}
function statusStyle(status) {
  const c = STATUS_COLOR[status] || STATUS_COLOR.Inactive
  return {
    fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 10,
    background: `${c}1A`,
    color:      c,
    border:     `1px solid ${c}40`,
  }
}

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

// UK convention: DD-MM-YYYY — Supabase sends plain YYYY-MM-DD date strings
function fmtDate(d) {
  if (!d) return '—'
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d
}

function fmtMoney(v) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  return `£${abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 10 }}>
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
  const [investment,       setInvestment]      = useState(initial?.initial_investment ?? '')
  const [date,             setDate]            = useState(initial?.date_created       ?? todayISO())
  const [status,           setStatus]          = useState(initial?.status             ?? 'Active')
  const [notes,            setNotes]           = useState(initial?.notes              ?? '')
  const [accountId,        setAccountId]       = useState(
    initial?.account_id != null ? String(initial.account_id) : ''
  )
  const [brokerageAccount, setBrokerageAccount] = useState(initial?.brokerage_account ?? '')
  const [axiaClientId,     setAxiaClientId]     = useState(initial?.axia_client_id ?? '')
  const [igClientId,       setIgClientId]       = useState(initial?.ig_client_id ?? '')
  const [dataFeedId,       setDataFeedId]       = useState(initial?.data_feed_id ?? '')
  const [dataFeedClientId, setDataFeedClientId] = useState(initial?.data_feed_client_id ?? '')
  const [watermark,        setWatermark]        = useState(initial?.watermark != null ? String(initial.watermark) : '')
  const [profitSharePct,   setProfitSharePct]   = useState(initial?.profit_share_pct != null ? String(initial.profit_share_pct) : '')

  // ── Live AccountIds from user_accounts_equity ──
  const { data: accountIds = [], isLoading: loadingAccIds } = useQuery({
    queryKey:  ['account_ids'],
    queryFn:   fetchAccountIds,
    staleTime: 60_000,
  })

  // ── AXIA clients — broker-statement NLV tracking, GBP only ──
  const { data: axiaClients = [], isLoading: loadingAxiaClients } = useQuery({
    queryKey:  ['axia_clients'],
    queryFn:   fetchAxiaClients,
    staleTime: 60_000,
  })

  // ── IG clients — separate table/router from AXIA (see ig_equity.py) ──
  const { data: igClients = [], isLoading: loadingIgClients } = useQuery({
    queryKey:  ['ig_clients'],
    queryFn:   fetchIgClients,
    staleTime: 60_000,
  })

  // ── Net deployed per brokerage account (from internal_transfers) ──
  const { data: netDeployed = {} } = useQuery({
    queryKey:  ['net_deployed'],
    queryFn:   fetchNetDeployed,
    staleTime: 60_000,
  })

  // ── Data Feeds registry — self-service tab-builder (see data_feeds.py) ──
  const { data: dataFeeds = [], isLoading: loadingDataFeeds } = useQuery({
    queryKey:  ['data_feeds'],
    queryFn:   fetchDataFeeds,
    staleTime: 60_000,
  })
  const selectedFeed = dataFeeds.find(f => f.id === dataFeedId) ?? null

  // ── Clients for the selected feed (daily cadence only) ──
  const { data: feedClients = [], isLoading: loadingFeedClients } = useQuery({
    queryKey:  ['data_feed_clients', selectedFeed?.slug],
    queryFn:   () => fetchDataFeedClients(selectedFeed.slug),
    enabled:   !!selectedFeed && selectedFeed.cadence === 'daily',
    staleTime: 60_000,
  })

  const computedInitial  = brokerageAccount ? (netDeployed[brokerageAccount] ?? null) : null
  // Auto mode = brokerage account OR AXIA/IG/Data-Feed client selected →
  // initial auto-computed (from transfers, or from that client's first
  // equity entry / statement) — manual Initial Investment only applies
  // when none is set.
  const isAutoMode = !!brokerageAccount || !!axiaClientId || !!igClientId || !!dataFeedId

  function handleSubmit(e) {
    e.preventDefault()
    onSave({
      name,
      strategy_code:      code.toUpperCase(),
      pod_id:             podId !== '' ? parseInt(podId, 10) : null,
      // In auto mode initial_investment is ignored by backend (computed from transfers).
      // In manual mode it's the source of truth for pod initial calculation.
      initial_investment: isAutoMode ? 0 : (parseFloat(investment) || 0),
      date_created:       date,
      status,
      notes,
      brokerage_account:  brokerageAccount || null,
      axia_client_id:     axiaClientId || null,
      ig_client_id:       igClientId || null,
      data_feed_id:            dataFeedId || null,
      data_feed_client_id:     (selectedFeed?.cadence === 'daily' ? (dataFeedClientId || null) : null),
      watermark:          watermark.trim()      !== '' ? parseFloat(watermark)      : null,
      profit_share_pct:   profitSharePct.trim() !== '' ? parseFloat(profitSharePct) : null,
      ...(accountId !== '' ? { account_id: parseInt(accountId, 10) } : {}),
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 10 }}>
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
            onChange={e => { setBrokerageAccount(e.target.value); setInvestment('') }}
          >
            <option value="">— None (manual) —</option>
            {BROKERAGE_ACCOUNTS.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          {!!brokerageAccount && (
            <div style={{ marginTop: 4, fontSize: 10, color: computedInitial != null ? '#34D399' : '#475569' }}>
              {computedInitial != null
                ? `Auto: ${fmtMoney(computedInitial)} net deployed`
                : 'No transfers recorded yet'}
            </div>
          )}
        </FormField>

        {/* Manual initial investment — only when no brokerage account set */}
        {!isAutoMode && (
          <FormField label="Initial Investment (£)">
            <AmountInput value={investment} onChange={setInvestment} style={INPUT} />
            <div style={{ marginTop: 4, fontSize: 10, color: '#475569' }}>
              Manual entry — for external / off-platform capital
            </div>
          </FormField>
        )}

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

      {/* AXIA Client — broker-statement NLV tracking, GBP only */}
      <div style={{ marginTop: 10 }}>
        <FormField label="AXIA Client / Account">
          <select
            style={INPUT}
            value={axiaClientId}
            onChange={e => setAxiaClientId(e.target.value)}
            disabled={loadingAxiaClients}
          >
            <option value="">— None —</option>
            {axiaClients.map(c => (
              <option key={c.id} value={c.id}>
                {c.client} / {c.account}{c.label ? ` — ${c.label}` : ''}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 10, color: '#334155', marginTop: 3, display: 'block' }}>
            {loadingAxiaClients
              ? 'Loading AXIA clients…'
              : axiaClients.length === 0
                ? 'No AXIA clients yet — add one on the AXIA Daily Equity tab (Data & Reports)'
                : 'Links this strategy to daily equity entered on the AXIA tab. AUM/PnL then computed from that equity, not manual Initial Investment.'}
          </span>
        </FormField>
      </div>

      {/* IG Client — separate table/router from AXIA (see ig_equity.py),
          same daily-equity mechanism, kept physically apart so each
          platform's history exports as its own clean spreadsheet. */}
      <div style={{ marginTop: 10 }}>
        <FormField label="IG Client / Account">
          <select
            style={INPUT}
            value={igClientId}
            onChange={e => setIgClientId(e.target.value)}
            disabled={loadingIgClients}
          >
            <option value="">— None —</option>
            {igClients.map(c => (
              <option key={c.id} value={c.id}>
                {c.client} / {c.account}{c.label ? ` — ${c.label}` : ''}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 10, color: '#334155', marginTop: 3, display: 'block' }}>
            {loadingIgClients
              ? 'Loading IG clients…'
              : igClients.length === 0
                ? 'No IG clients yet — add one on the IG Daily Equity tab (Data & Reports)'
                : 'Links this strategy to daily equity entered on the IG tab. AUM/PnL then computed from that equity, not manual Initial Investment.'}
          </span>
        </FormField>
      </div>

      {/* Data Feed — self-service tab-builder link (see data_feeds.py).
          Additive alongside AXIA/IG above — pick any registered feed (new
          or legacy-style) and, for daily-cadence feeds, the client/account
          created on that feed's tab in Data & Reports. Monthly-cadence
          feeds link directly by strategy — no client picker needed. */}
      <div style={{ marginTop: 10 }}>
        <FormField label="Data Feed">
          <select
            style={INPUT}
            value={dataFeedId}
            onChange={e => { setDataFeedId(e.target.value); setDataFeedClientId('') }}
            disabled={loadingDataFeeds}
          >
            <option value="">— None —</option>
            {dataFeeds.map(f => (
              <option key={f.id} value={f.id}>{f.name} ({f.cadence})</option>
            ))}
          </select>
          <span style={{ fontSize: 10, color: '#334155', marginTop: 3, display: 'block' }}>
            {loadingDataFeeds
              ? 'Loading Data Feeds…'
              : dataFeeds.length === 0
                ? 'No Data Feeds registered yet — create one via "Manage Data Feeds" on Data & Reports'
                : 'Links this strategy to a self-service Data Feed tab.'}
          </span>
        </FormField>
      </div>

      {selectedFeed?.cadence === 'daily' && (
        <div style={{ marginTop: 10 }}>
          <FormField label={`${selectedFeed.name} Client / Account`}>
            <select
              style={INPUT}
              value={dataFeedClientId}
              onChange={e => setDataFeedClientId(e.target.value)}
              disabled={loadingFeedClients}
            >
              <option value="">— None —</option>
              {feedClients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.client} / {c.account}{c.label ? ` — ${c.label}` : ''}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 10, color: '#334155', marginTop: 3, display: 'block' }}>
              {loadingFeedClients
                ? 'Loading clients…'
                : feedClients.length === 0
                  ? `No clients yet — add one on the ${selectedFeed.name} tab (Data & Reports)`
                  : 'AUM/PnL then computed from that equity, not manual Initial Investment.'}
            </span>
          </FormField>
        </div>
      )}

      {/* Watermark / Profit Share — general to any strategy type */}
      <div style={{
        marginTop: 12, background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.18)',
        borderRadius: 8, padding: '10px 12px',
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px',
          color: '#a78bfa', display: 'block', marginBottom: 8 }}>
          Watermark / Profit Share (optional)
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <FormField label="Watermark (£)">
            <AmountInput value={watermark} onChange={setWatermark} style={INPUT} />
          </FormField>
          <FormField label="Chase Profit Share Above Watermark (%)">
            <input type="text" inputMode="decimal" style={INPUT}
              value={profitSharePct} onChange={e => setProfitSharePct(e.target.value)} placeholder="e.g. 45" />
          </FormField>
        </div>
        <div style={{ marginTop: 6, fontSize: 10, color: '#475569' }}>
          Below watermark, Chase retains 100% of equity. Above it, Chase retains only this % of
          the excess — the rest is the trader's/counterparty's share. Leave both blank for no adjustment.
        </div>
      </div>

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

  const formScrollRef = useRef(null)
  useEffect(() => {
    if (mode?.edit) formScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [mode])

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
        <div ref={mode?.edit ? formScrollRef : null} style={{
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
        <div style={{ borderRadius: 8, border: '1px solid #1E3A5F', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '28px 1fr 80px 90px 70px 80px',
            gap: 8, padding: '8px 12px', minWidth: 460,
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
                gap: 8, padding: '9px 12px', alignItems: 'center', minWidth: 460,
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
              <span style={{ fontSize: 11, color: '#64748B' }}>{fmtDate(pod.date_created)}</span>

              {/* Status */}
              <span style={statusStyle(pod.status)}>
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
  const { data: axiaClients = [] } = useQuery({
    queryKey:  ['axia_clients'],
    queryFn:   fetchAxiaClients,
    staleTime: 60_000,
  })
  const axiaClientMap = Object.fromEntries(axiaClients.map(c => [c.id, c]))
  const { data: igClients = [] } = useQuery({
    queryKey:  ['ig_clients'],
    queryFn:   fetchIgClients,
    staleTime: 60_000,
  })
  const igClientMap = Object.fromEntries(igClients.map(c => [c.id, c]))
  const { data: dataFeeds = [] } = useQuery({
    queryKey:  ['data_feeds'],
    queryFn:   fetchDataFeeds,
    staleTime: 60_000,
  })
  const dataFeedMap = Object.fromEntries(dataFeeds.map(f => [f.id, f]))

  const [mode,     setMode]     = useState(null)
  const [saving,   setSaving]   = useState(false)
  const [formErr,  setFormErr]  = useState(null)
  const [deleteId, setDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const formScrollRef = useRef(null)
  useEffect(() => {
    if (mode?.edit) formScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [mode])

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
        <div ref={mode?.edit ? formScrollRef : null} style={{
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
        <div style={{ borderRadius: 8, border: '1px solid #1E3A5F', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {/* Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 90px 110px 110px 90px 70px 72px',
            gap: 8, padding: '8px 12px', minWidth: 640,
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
            const axiaClient  = strat.axia_client_id ? axiaClientMap[strat.axia_client_id] : null
            const igClient    = strat.ig_client_id   ? igClientMap[strat.ig_client_id]     : null
            const dataFeed    = strat.data_feed_id   ? dataFeedMap[strat.data_feed_id]     : null
            return (
              <div
                key={strat.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 90px 110px 110px 90px 70px 72px',
                  gap: 8, padding: '9px 12px', alignItems: 'center', minWidth: 640,
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

                {/* Brokerage account / AXIA client + computed net */}
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
                  ) : axiaClient ? (
                    <>
                      <span style={{
                        fontSize: 10, fontWeight: 600, color: '#c084fc',
                        letterSpacing: '0.3px',
                      }}>
                        AXIA · {axiaClient.client}/{axiaClient.account}
                      </span>
                      <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>
                        Daily equity feed
                      </div>
                    </>
                  ) : igClient ? (
                    <>
                      <span style={{
                        fontSize: 10, fontWeight: 600, color: '#fb923c',
                        letterSpacing: '0.3px',
                      }}>
                        IG · {igClient.client}/{igClient.account}
                      </span>
                      <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>
                        Daily equity feed
                      </div>
                    </>
                  ) : dataFeed ? (
                    <>
                      <span style={{
                        fontSize: 10, fontWeight: 600, color: dataFeed.color || '#38BDF8',
                        letterSpacing: '0.3px',
                      }}>
                        {dataFeed.name}
                      </span>
                      <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>
                        {dataFeed.cadence === 'daily' ? 'Daily equity feed' : 'Monthly statement'}
                      </div>
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: '#334155' }}>—</span>
                  )}
                </div>

                {/* Date */}
                <span style={{ fontSize: 11, color: '#64748B' }}>{fmtDate(strat.date_created)}</span>

                {/* Status */}
                <span style={statusStyle(strat.status)}>
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
          padding: 'clamp(12px, 4vw, 16px) clamp(14px, 4vw, 20px)', borderBottom: '1px solid #1E3A5F', flexShrink: 0,
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
        <div style={{ flex: 1, overflowY: 'auto', padding: 'clamp(14px, 4vw, 20px)' }}>
          {tab === 'pods'       && <PodsTab       queryClient={queryClient} onSaved={onSaved} />}
          {tab === 'strategies' && <StrategiesTab  queryClient={queryClient} onSaved={onSaved} />}
        </div>

      </div>
    </div>
  )
}
