// frontend/src/components/CapitalOverview.jsx
/**
 * Capital & Performance Overview — 6-metric hero strip, Capital Flow Summary
 * table, Capital at a Glance chart, and narrative info box.
 *
 * Mirrors the model supplied by management:
 *   Total Capital Invested  — cumulative capital ever deployed (never reduces)
 *   Banked Profit            — profit physically withdrawn and returned
 *   Capital Allocated        — Total Capital Invested − Banked Profit
 *   Current Equity           — current value of the remaining economic interest
 *   Total P&L                — Current Equity + Banked Profit − Total Capital Invested
 *   Total ROI                — Total P&L ÷ Total Capital Invested × 100
 *
 * NOTE — Banked Profit is £0.00 everywhere until withdrawals are manually
 * reclassified as "profit distribution" vs "return of capital" (Phase 2).
 * Until then Capital Allocated == Total Capital Invested and the maths
 * still ties out exactly — nothing here is wrong, it's just conservative.
 */

import {
  Wallet, Landmark, PieChart, Activity, TrendingUp, TrendingDown, Percent, Info,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  ResponsiveContainer, ReferenceLine, LabelList,
} from 'recharts'

// ---------------------------------------------------------------------------
// Small-text palette — brightened ~40% off the app's muted greys so labels,
// captions, axis ticks and legends stay legible on the glass panels.
// ---------------------------------------------------------------------------

const TXT_MUTED = '#9199A5'   // was #475569
const TXT_SOFT  = '#A2ABB9'   // was #64748B
const TXT_SUB   = '#BFC8D4'   // was #94A3B8

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const r = parseInt(full.substring(0, 2), 16)
  const g = parseInt(full.substring(2, 4), 16)
  const b = parseInt(full.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function fmtGBP(v) {
  if (v == null || Number.isNaN(v)) return '£0.00'
  const sign = v < 0 ? '-' : ''
  return `${sign}£${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtGBPSigned(v) {
  if (v == null || Number.isNaN(v)) return '£0.00'
  const sign = v < 0 ? '-£' : '+£'
  return `${sign}${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtGBPAxis(v) {
  const abs = Math.abs(v)
  if (abs >= 999_950) return `${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)   return `${(abs / 1_000).toFixed(0)}k`
  return `£${abs.toFixed(0)}`
}

export function fmtPctSigned(v) {
  if (v == null || Number.isNaN(v)) return '0.00%'
  const p = (v * 100).toFixed(2)
  return v >= 0 ? `+${p}%` : `${p}%`
}

// ---------------------------------------------------------------------------
// Core computation — shared by hero strip, pod cards and strategy cards
// kpis: { initial_investment, current_equity, total_pnl, performance, ... }
// ---------------------------------------------------------------------------

export function computeCapitalMetrics(kpis = {}) {
  const invested  = kpis.initial_investment || 0
  const equity    = kpis.current_equity     || 0
  // Banked Profit — pending manual withdrawal reclassification (Phase 2). Safe default: £0.
  const banked    = 0
  const allocated = invested - banked
  const pnl       = kpis.total_pnl != null ? kpis.total_pnl : (equity + banked - invested)
  const roi       = invested !== 0 ? pnl / invested : 0
  return { invested, banked, allocated, equity, pnl, roi }
}

// ---------------------------------------------------------------------------
// Hero card — big 6-box strip
// ---------------------------------------------------------------------------

function HeroCard({ icon: Icon, color, label, value, sub, onClick }) {
  return (
    <div
      className="ov-card cap-hero-card"
      style={{ '--accent': color, '--accent-soft': hexToRgba(color, 0.22), cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `radial-gradient(circle at 32% 28%, ${hexToRgba(color, 0.38)}, ${hexToRgba(color, 0.10)})`,
        border: `1px solid ${hexToRgba(color, 0.28)}`,
        boxShadow: `0 0 16px 1px ${hexToRgba(color, 0.18)}`,
        marginBottom: 14,
      }}>
        <Icon size={22} color={color} strokeWidth={2.1} />
      </div>
      <div style={{
        fontSize: 12, fontWeight: 600, color: TXT_SUB, marginBottom: 8,
        letterSpacing: '0.2px',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 24, fontWeight: 800, color, lineHeight: 1.15,
        fontVariantNumeric: 'tabular-nums', marginBottom: 8,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {value}
      </div>
      <div style={{ fontSize: 10.5, color: TXT_SOFT, lineHeight: 1.45 }}>
        {sub}
      </div>
    </div>
  )
}

export function CapitalOverviewHero({ kpis, isMobile }) {
  const { invested, banked, allocated, equity, pnl, roi } = computeCapitalMetrics(kpis)
  const pnlPos = pnl >= 0
  const roiPos = roi >= 0

  const cards = [
    {
      icon: Wallet, color: '#38BDF8', label: 'Total Capital Invested',
      value: fmtGBP(invested),
      sub: 'Total capital historically invested across the portfolio.',
    },
    {
      icon: Landmark, color: '#34D399', label: 'Banked Profit',
      value: fmtGBP(banked),
      sub: 'Profit withdrawn and returned to Chase.',
    },
    {
      icon: PieChart, color: '#F59E0B', label: 'Capital Allocated',
      value: fmtGBP(allocated),
      sub: "Chase's original capital still deployed across the portfolio.",
    },
    {
      icon: Activity, color: '#A78BFA', label: 'Current Equity',
      value: fmtGBP(equity),
      sub: "Current value of Chase's economic interest across all investments.",
    },
    {
      icon: pnlPos ? TrendingUp : TrendingDown, color: pnlPos ? '#34D399' : '#F87171', label: 'Total P&L',
      value: fmtGBPSigned(pnl),
      sub: 'Total profit or loss, including both banked and current performance.',
    },
    {
      icon: Percent, color: roiPos ? '#34D399' : '#F87171', label: 'Total ROI',
      value: fmtPctSigned(roi),
      sub: 'Total P&L as a percentage of total capital invested.',
    },
  ]

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? 'repeat(2, minmax(0,1fr))' : 'repeat(6, minmax(0,1fr))',
      gap: 12,
    }}>
      {cards.map(c => <HeroCard key={c.label} {...c} />)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Capital Flow Summary — table
// ---------------------------------------------------------------------------

export function CapitalFlowTable({ kpis }) {
  const { invested, banked, allocated, equity, pnl } = computeCapitalMetrics(kpis)
  const pct = v => invested !== 0 ? `${((v / invested) * 100).toFixed(2)}%` : '—'

  const rows = [
    { dot: '#38BDF8', label: 'Total Capital Invested',          amount: invested,  pct: pct(invested) },
    { dot: '#34D399', label: 'Banked Profit (Withdrawn)',       amount: banked,    pct: pct(banked) },
    { dot: '#F59E0B', label: 'Capital Allocated (Still Out)',   amount: allocated, pct: pct(allocated) },
    { dot: '#A78BFA', label: 'Current Equity (Economic Interest)', amount: equity, pct: pct(equity) },
    { dot: pnl >= 0 ? '#34D399' : '#F87171', label: 'Total P&L', amount: pnl, pct: pct(pnl), bold: true, signed: true },
  ]

  return (
    <div className="glass-table" style={{ padding: '16px 18px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#F1F5F9', marginBottom: 14 }}>
        Capital Flow Summary
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <th style={{ textAlign: 'left', padding: '0 0 8px', fontSize: 10, color: TXT_SOFT, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Description</th>
              <th style={{ textAlign: 'right', padding: '0 0 8px', fontSize: 10, color: TXT_SOFT, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Amount (£)</th>
              <th style={{ textAlign: 'right', padding: '0 0 8px', fontSize: 10, color: TXT_SOFT, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>% of Invested</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '10px 0' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: r.bold ? 700 : 500, color: r.bold ? '#F1F5F9' : '#CBD5E1' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.dot, flexShrink: 0 }} />
                    {r.label}
                  </span>
                </td>
                <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: r.bold ? 700 : 500, fontVariantNumeric: 'tabular-nums', color: r.bold ? (r.amount >= 0 ? '#34D399' : '#F87171') : '#E2E8F0' }}>
                  {r.signed ? fmtGBPSigned(r.amount) : fmtGBP(r.amount)}
                </td>
                <td style={{ padding: '10px 0', textAlign: 'right', color: TXT_SUB, fontVariantNumeric: 'tabular-nums' }}>
                  {r.pct}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Capital at a Glance — bar chart with dashed connector + interactive tooltip
// ---------------------------------------------------------------------------

function GlanceTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{
      background: 'rgba(13,27,46,0.95)', border: '1px solid rgba(255,255,255,0.1)',
      backdropFilter: 'blur(8px)', borderRadius: 8, padding: '9px 13px', fontSize: 11.5,
    }}>
      <div style={{ color: TXT_SUB, marginBottom: 4 }}>{d.fullName}</div>
      <div style={{ fontWeight: 700, color: d.amount >= 0 ? '#34D399' : '#F87171' }}>
        {fmtGBPSigned(d.amount)}
      </div>
    </div>
  )
}

// Multi-line, centre-aligned X-axis tick — wraps on '\n' instead of overlapping
function WrappedAxisTick({ x, y, payload }) {
  const lines = String(payload.value).split('\n')
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" fontSize={9.5} fill={TXT_SOFT}>
        {lines.map((line, i) => (
          <tspan key={i} x={0} dy={i === 0 ? 12 : 11}>{line}</tspan>
        ))}
      </text>
    </g>
  )
}

export function CapitalAtGlanceChart({ kpis, height = 300 }) {
  const { invested, banked, allocated, equity, pnl } = computeCapitalMetrics(kpis)

  const data = [
    { name: 'Total Capital\nInvested',       fullName: 'Total Capital Invested',        amount: invested,  color: '#38BDF8' },
    { name: 'Banked Profit\n(Withdrawn)',    fullName: 'Banked Profit (Withdrawn)',     amount: -banked,   color: '#F87171' },
    { name: 'Capital Allocated\n(Still Out)',fullName: 'Capital Allocated (Still Out)', amount: allocated, color: '#F59E0B' },
    { name: 'Current Equity\n(Economic Interest)', fullName: 'Current Equity (Economic Interest)', amount: equity, color: '#A78BFA' },
    { name: 'Total P&L',                     fullName: 'Total P&L',                     amount: pnl,       color: pnl >= 0 ? '#34D399' : '#F87171' },
  ]

  return (
    <div className="glass-table" style={{ padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#F1F5F9' }}>Capital at a Glance</div>
        <div style={{ display: 'flex', gap: 14, fontSize: 10.5, color: TXT_SUB }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: '#34D399', display: 'inline-block' }} /> Increase
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: '#F87171', display: 'inline-block' }} /> Decrease
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 20, right: 8, left: 0, bottom: 12 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#1E3A5F" strokeOpacity={0.4} />
          <XAxis
            dataKey="name" height={40}
            tick={<WrappedAxisTick />}
            axisLine={false} tickLine={false} interval={0}
          />
          <YAxis
            tickFormatter={fmtGBPAxis} tick={{ fill: TXT_MUTED, fontSize: 10 }}
            axisLine={false} tickLine={false} width={48}
          />
          <ReferenceLine y={0} stroke="#1E3A5F" strokeWidth={1} />
          <Tooltip content={<GlanceTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={64}>
            {data.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.88} />)}
            <LabelList
              dataKey="amount"
              position="top"
              formatter={fmtGBPSigned}
              style={{ fill: '#E0E6ED', fontSize: 10, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Narrative info box
// ---------------------------------------------------------------------------

export function CapitalInfoBox({ kpis }) {
  const { invested, banked, allocated, equity, pnl, roi } = computeCapitalMetrics(kpis)
  const pnlColor = pnl >= 0 ? '#34D399' : '#F87171'
  const roiColor = roi >= 0 ? '#34D399' : '#F87171'

  return (
    <div className="glass-panel" style={{
      padding: '14px 18px', display: 'flex', gap: 24, flexWrap: 'wrap',
      alignItems: 'flex-start',
    }}>
      <Info size={16} color="#38BDF8" style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', flex: 1 }}>
        <div style={{ fontSize: 12.5, color: TXT_SUB, lineHeight: 1.7, flex: '1 1 320px' }}>
          We invested <b style={{ color: '#38BDF8' }}>{fmtGBP(invested)}</b>. We have banked{' '}
          <b style={{ color: '#34D399' }}>{fmtGBP(banked)}</b> of profit.{' '}
          <b style={{ color: '#F59E0B' }}>{fmtGBP(allocated)}</b> of our original capital remains
          out and is currently worth <b style={{ color: '#A78BFA' }}>{fmtGBP(equity)}</b>.
        </div>
        <div style={{ fontSize: 12.5, color: TXT_SUB, lineHeight: 1.7, flex: '1 1 280px' }}>
          We have made a total profit of <b style={{ color: pnlColor }}>{fmtGBPSigned(pnl)}</b>,
          representing a <b style={{ color: roiColor }}>{fmtPctSigned(roi)}</b> return on our
          original capital.
        </div>
      </div>
    </div>
  )
}
