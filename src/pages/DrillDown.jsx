// frontend/src/pages/DrillDown.jsx
/**
 * Drill-down page — works for any entity level.
 *
 * For TRADER entities the layout is specialised:
 *   1. KPI strip (top)
 *   2. Trader info card (pod, strategy, style, status)
 *   3. Context overview — tabbed mini KPI strips for Venues / Pods / Strategies
 *   4. Charts — adaptive grid:
 *        Left (60%): Equity curve + drawdown
 *        Right (40%): Stacked donuts (Venue always, Pod if multi, Strategy if multi)
 *        Full width: PnL bar charts — one per dimension that has >1 slice
 *   5. Breakdown tables — 3-tab panel (Venues | Pods | Strategies)
 *
 * For all other entity types the layout is the standard:
 *   1. KPI strip
 *   2. Charts row (equity | donut | bars)
 *   3. Breakdown table
 */

import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { RefreshCw, ChevronRight, ChevronLeft } from 'lucide-react'

import { useDrillDown, useTraderContext } from '../hooks/usePortfolioData.js'
import KpiRow         from '../components/cards/KpiRow.jsx'
import KpiCard, { fmtMoney, fmtPct } from '../components/cards/KpiCard.jsx'
import EquityChart    from '../components/charts/EquityChart.jsx'
import { DonutChart } from '../components/charts/DonutChart.jsx'
import PnlBarChart    from '../components/charts/PnlBarChart.jsx'
import BreakdownTable from '../components/tables/BreakdownTable.jsx'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TYPE_COLORS = {
  portfolio: { bg: 'rgba(14,165,233,0.15)',  text: '#38BDF8' },
  pod:       { bg: 'rgba(245,158,11,0.15)',  text: '#F59E0B' },
  strategy:  { bg: 'rgba(167,139,250,0.15)', text: '#A78BFA' },
  trader:    { bg: 'rgba(52,211,153,0.15)',  text: '#34D399' },
  venue:     { bg: 'rgba(248,113,113,0.15)', text: '#F87171' },
}

const CHILD_LABEL = {
  portfolio: 'Pod',
  pod:       'Strategy',
  strategy:  'Trader',
  trader:    'Venue',
  venue:     'Venue',
}

const CONTEXT_TABS = [
  { key: 'venues',     label: 'Venues'     },
  { key: 'pods',       label: 'Pods'       },
  { key: 'strategies', label: 'Strategies' },
]

// ---------------------------------------------------------------------------
// Shared micro-components
// ---------------------------------------------------------------------------

function TypeBadge({ type }) {
  const c = TYPE_COLORS[type] ?? TYPE_COLORS.trader
  return (
    <span style={{
      padding: '2px 10px', borderRadius: 12,
      fontSize: 10, fontWeight: 600,
      background: c.bg, color: c.text,
      border: `1px solid ${c.text}40`,
      textTransform: 'uppercase', letterSpacing: '0.5px',
    }}>
      {type}
    </span>
  )
}

function PodTag({ podCode, podColor }) {
  if (!podCode) return null
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 9px', borderRadius: 12,
      background: `${podColor}18`, border: `1px solid ${podColor}40`,
    }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: podColor, flexShrink: 0 }} />
      <span style={{ fontSize: 10, fontWeight: 600, color: podColor, letterSpacing: '0.3px' }}>
        {podCode}
      </span>
    </div>
  )
}

function StratTag({ code }) {
  if (!code) return null
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 12,
      fontSize: 10, fontWeight: 600,
      background: 'rgba(148,163,184,0.10)', color: '#94A3B8',
      border: '1px solid rgba(148,163,184,0.18)', letterSpacing: '0.3px',
    }}>
      {code}
    </span>
  )
}

function StatusBadge({ status }) {
  const active = (status || '').toLowerCase() === 'active'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 500,
      background: active ? 'rgba(52,211,153,0.10)' : 'rgba(245,158,11,0.10)',
      color:      active ? '#34D399'                : '#F59E0B',
      border:     `1px solid ${active ? 'rgba(52,211,153,0.25)' : 'rgba(245,158,11,0.25)'}`,
    }}>
      {status || '—'}
    </span>
  )
}

function ChartCard({ title, children, style = {} }) {
  return (
    <div style={{
      background: '#111C2B', border: '1px solid #1E3A5F',
      borderRadius: 8, padding: 14, ...style,
    }}>
      {title && (
        <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B',
          marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {title}
        </div>
      )}
      {children}
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.8px',
      textTransform: 'uppercase', color: '#475569', paddingBottom: 10,
    }}>
      {children}
    </div>
  )
}

function Spinner({ full = false }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: full ? 300 : 100, color: '#334155', gap: 8,
    }}>
      <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
      <span style={{ fontSize: 12 }}>Loading...</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function ErrorMsg({ message }) {
  return (
    <div style={{
      padding: 16, color: '#F87171', fontSize: 12, borderRadius: 8,
      background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.15)',
    }}>
      Error: {message}
    </div>
  )
}


// ---------------------------------------------------------------------------
// Trader info card — compact horizontal strip
// ---------------------------------------------------------------------------

function InfoPill({ label, children }) {
  return (
    <div style={{ padding: '0 16px' }}>
      <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase',
        letterSpacing: '0.5px', marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function TraderInfoCard({ podCode, podColor, strategyCode, tradingStyle, entityStatus }) {
  return (
    <div style={{
      background: '#0D1B2E', border: '1px solid #1E3A5F', borderRadius: 8,
      padding: '10px 0', marginBottom: 14,
      display: 'flex', alignItems: 'center', flexWrap: 'wrap',
    }}>
      <InfoPill label="Pod"><PodTag podCode={podCode} podColor={podColor} /></InfoPill>
      <div style={{ width: 1, height: 30, background: '#1E3A5F' }} />
      <InfoPill label="Strategy"><StratTag code={strategyCode} /></InfoPill>
      {tradingStyle && (
        <>
          <div style={{ width: 1, height: 30, background: '#1E3A5F' }} />
          <InfoPill label="Style">
            <span style={{ fontSize: 12, color: '#94A3B8' }}>{tradingStyle}</span>
          </InfoPill>
        </>
      )}
      <div style={{ width: 1, height: 30, background: '#1E3A5F' }} />
      <InfoPill label="Status"><StatusBadge status={entityStatus} /></InfoPill>
    </div>
  )
}


// ---------------------------------------------------------------------------
// Context overview — mini KPI strips for each venue/pod/strategy
// Same visual language as the pod overview on the Portfolio home page
// ---------------------------------------------------------------------------

function MiniKpiStrip({ row }) {
  const pctType = v => v > 0 ? 'pos' : v < 0 ? 'neg' : 'default'

  const cards = [
    { label: 'Invested',    value: fmtMoney(row.aum),     type: 'neu'            },
    { label: 'PnL',         value: fmtMoney(row.pnl),     type: pctType(row.pnl) },
    { label: '24h',         value: fmtPct(row.pct_1d),    type: pctType(row.pct_1d)  },
    { label: '7d',          value: fmtPct(row.pct_7d),    type: pctType(row.pct_7d)  },
    { label: '30d',         value: fmtPct(row.pct_30d),   type: pctType(row.pct_30d) },
    { label: 'Max DD',      value: fmtPct(row.drawdown),  type: row.drawdown < -0.05 ? 'neg' : 'default' },
    { label: 'Win Rate',    value: row.win_rate != null ? `${(row.win_rate * 100).toFixed(0)}%` : '—', type: 'default' },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
      {cards.map(c => (
        <KpiCard key={c.label} label={c.label} value={c.value} type={c.type} small />
      ))}
    </div>
  )
}

function ContextOverview({ ctx }) {
  const [activeTab, setActiveTab] = useState('venues')

  const rows = ctx?.[activeTab] ?? []

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionLabel>Allocation overview</SectionLabel>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 2, marginBottom: 12,
        borderBottom: '1px solid #1E3A5F', paddingBottom: 10,
      }}>
        {CONTEXT_TABS.map(tab => {
          const count  = ctx?.[tab.key]?.length ?? 0
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', borderRadius: 6,
                fontSize: 12, fontWeight: 500, border: 'none',
                cursor: 'pointer',
                background: active ? '#1E3A5F' : 'transparent',
                color:      active ? '#38BDF8' : '#475569',
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
              <span style={{
                fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 8,
                background: active ? 'rgba(14,165,233,0.2)' : 'rgba(148,163,184,0.1)',
                color:      active ? '#38BDF8'              : '#475569',
              }}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Mini KPI strips — one per item in the active tab */}
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: '#334155', padding: '12px 0' }}>No data</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map(row => (
            <div key={row.entity_id + row.name}>
              {/* Row header — name + pod dot + strategy tag */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                marginBottom: 7, fontSize: 12, fontWeight: 600, color: '#94A3B8',
              }}>
                {row.pod_color && (
                  <div style={{ width: 7, height: 7, borderRadius: '50%',
                    background: row.pod_color, flexShrink: 0 }} />
                )}
                <span>{row.name}</span>
                {row.pod_code && activeTab !== 'pods' && (
                  <PodTag podCode={row.pod_code} podColor={row.pod_color} />
                )}
                {row.strategy_code && activeTab !== 'strategies' && (
                  <StratTag code={row.strategy_code} />
                )}
                {row.allocation_pct != null && (
                  <span style={{ fontSize: 10, color: '#334155', marginLeft: 2 }}>
                    {row.allocation_pct.toFixed(1)}% of {activeTab.slice(0, -1)}
                  </span>
                )}
              </div>
              <MiniKpiStrip row={row} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


// ---------------------------------------------------------------------------
// Smart adaptive charts for trader pages
//
// Donuts and PnL bars auto-appear/hide based on whether the trader has
// data in multiple pods, strategies or venues:
//   - By Venue:    always shown (every trader has at least 1 venue)
//   - By Pod:      only if trader appears in >1 pod
//   - By Strategy: only if trader appears in >1 strategy
// ---------------------------------------------------------------------------

function buildAllocationSlices(rows) {
  const total = rows.reduce((s, r) => s + (r.aum || 0), 0)
  return rows.map(r => ({
    name: r.name,
    aum:  r.aum || 0,
    pct:  total > 0 ? +((r.aum / total) * 100).toFixed(2) : 0,
  }))
}

function buildPnlBars(rows) {
  return rows
    .map(r => ({ name: r.name, pnl: r.pnl || 0 }))
    .sort((a, b) => b.pnl - a.pnl)
}

function SmartTraderCharts({ entityId, equityCurve, ctx }) {
  const venues     = ctx?.venues     ?? []
  const pods       = ctx?.pods       ?? []
  const strategies = ctx?.strategies ?? []

  const multiPod      = pods.length > 1
  const multiStrategy = strategies.length > 1

  // Build chart data sets
  const venueAlloc    = buildAllocationSlices(venues)
  const podAlloc      = buildAllocationSlices(pods)
  const stratAlloc    = buildAllocationSlices(strategies)
  const venuePnl      = buildPnlBars(venues)
  const podPnl        = buildPnlBars(pods)
  const stratPnl      = buildPnlBars(strategies)

  // How many donut charts to stack on the right?
  const donutCharts = [
    { key: 'venue',    label: 'Allocation by Venue',    data: venueAlloc,    always: true  },
    { key: 'pod',      label: 'Allocation by Pod',      data: podAlloc,      always: false, show: multiPod      },
    { key: 'strategy', label: 'Allocation by Strategy', data: stratAlloc,    always: false, show: multiStrategy },
  ].filter(d => d.always || d.show)

  // Donut height adapts to how many are stacked
  const donutH = donutCharts.length === 1 ? 220 : donutCharts.length === 2 ? 180 : 140

  // PnL bar charts — one column per dimension with data
  const barCharts = [
    { key: 'venue',    label: 'PnL by Venue',    data: venuePnl,   always: true  },
    { key: 'pod',      label: 'PnL by Pod',      data: podPnl,     always: false, show: multiPod      },
    { key: 'strategy', label: 'PnL by Strategy', data: stratPnl,   always: false, show: multiStrategy },
  ].filter(d => d.always || d.show)

  const barH = 120 + Math.max(...barCharts.map(b => b.data.length)) * 26

  return (
    <>
      {/* ── Row 1: Equity + stacked donuts ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `3fr ${donutCharts.length > 1 ? '1.1fr' : '1fr'}`,
        gap: 10,
        marginBottom: 10,
      }}>
        {/* Equity chart */}
        <ChartCard title="Equity (with drawdown)">
          <EquityChart data={equityCurve} height={donutCharts.length > 1 ? donutCharts.length * donutH + (donutCharts.length - 1) * 10 : donutH + 40} />
        </ChartCard>

        {/* Stacked donut charts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {donutCharts.map(d => (
            <ChartCard key={d.key} title={d.label}>
              <DonutChart data={d.data} height={donutH} />
            </ChartCard>
          ))}
        </div>
      </div>

      {/* ── Row 2: PnL bar charts ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${barCharts.length}, 1fr)`,
        gap: 10,
        marginBottom: 20,
      }}>
        {barCharts.map(b => (
          <ChartCard key={b.key} title={b.label}>
            <PnlBarChart data={b.data} height={barH} />
          </ChartCard>
        ))}
      </div>
    </>
  )
}


// ---------------------------------------------------------------------------
// Trader 3-tab breakdown tables panel (bottom of trader page)
// ---------------------------------------------------------------------------

function ContextTabButton({ label, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 14px', borderRadius: 6,
        fontSize: 12, fontWeight: 500, border: 'none', cursor: 'pointer',
        background: active ? '#1E3A5F' : 'transparent',
        color:      active ? '#38BDF8' : '#475569',
        transition: 'all 0.15s',
      }}
    >
      {label}
      {count != null && (
        <span style={{
          fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 8,
          background: active ? 'rgba(14,165,233,0.2)' : 'rgba(148,163,184,0.1)',
          color:      active ? '#38BDF8'              : '#475569',
        }}>
          {count}
        </span>
      )}
    </button>
  )
}

function TraderBreakdownPanel({ entityId, ctx, navigate }) {
  const [activeTab, setActiveTab] = useState('venues')
  return (
    <div>
      <SectionLabel>Breakdown</SectionLabel>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 2, paddingBottom: 12,
        borderBottom: '1px solid #1E3A5F', marginBottom: 14,
      }}>
        {CONTEXT_TABS.map(tab => (
          <ContextTabButton
            key={tab.key}
            label={tab.label}
            count={ctx?.[tab.key]?.length}
            active={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
          />
        ))}
      </div>

      <div style={{ background: '#111C2B', border: '1px solid #1E3A5F', borderRadius: 8, overflow: 'clip' }}>
        <BreakdownTable
          key={activeTab}
          rows={ctx?.[activeTab] ?? []}
          onRowClick={id => navigate(`/drilldown/${id}`)}
          title={CONTEXT_TABS.find(t => t.key === activeTab)?.label}
        />
      </div>
    </div>
  )
}


// ---------------------------------------------------------------------------
// Main DrillDown component
// ---------------------------------------------------------------------------

export default function DrillDown({ timeRange }) {
  const { entityId } = useParams()
  const navigate     = useNavigate()

  const { data, isLoading, error }               = useDrillDown(entityId, timeRange)
  const { data: ctx, isLoading: ctxLoading }     = useTraderContext(
    data?.entity_type === 'trader' ? entityId : null
  )

  if (isLoading) return <div style={{ padding: 24 }}><Spinner full /></div>
  if (error)     return <div style={{ padding: 24 }}><ErrorMsg message={error.message} /></div>

  const {
    entity_name, entity_type, breadcrumb,
    pod_code, pod_color, strategy_code,
    trading_style, entity_status,
    kpis, equity_curve, allocation, pnl_contribution, breakdown,
  } = data

  const isTrader      = entity_type === 'trader'
  const showPodTag    = ['trader', 'strategy', 'venue'].includes(entity_type)
  const childLabel    = CHILD_LABEL[entity_type] ?? 'Child'
  const sparklineData = equity_curve.slice(-20).map(p => p.equity)

  return (
    <div style={{ padding: '16px 24px 48px' }}>

      {/* ── Back + breadcrumb ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 14, flexWrap: 'wrap' }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            display: 'flex', alignItems: 'center', gap: 3,
            background: 'none', border: '1px solid #1E3A5F', borderRadius: 6,
            padding: '4px 10px', fontSize: 11, fontWeight: 500,
            color: '#64748B', cursor: 'pointer', marginRight: 12, flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#94A3B8'; e.currentTarget.style.borderColor = '#2E5280' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#64748B'; e.currentTarget.style.borderColor = '#1E3A5F' }}
        >
          <ChevronLeft size={12} />
          Back
        </button>
        <div style={{ width: 1, height: 14, background: '#1E3A5F', marginRight: 12 }} />
        {breadcrumb.map((crumb, idx) => {
          const isLast = idx === breadcrumb.length - 1
          return (
            <div key={crumb.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {crumb.pod_color && !['portfolio', 'pod'].includes(crumb.type) && (
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: crumb.pod_color, flexShrink: 0 }} />
              )}
              <span
                onClick={() => !isLast && navigate(crumb.type === 'portfolio' ? '/' : `/drilldown/${crumb.id}`)}
                style={{
                  fontSize: 12, fontWeight: isLast ? 500 : 400,
                  color: isLast ? '#94A3B8' : '#38BDF8',
                  cursor: isLast ? 'default' : 'pointer',
                }}
                onMouseEnter={e => { if (!isLast) e.currentTarget.style.color = '#7DD3FC' }}
                onMouseLeave={e => { if (!isLast) e.currentTarget.style.color = '#38BDF8' }}
              >
                {crumb.name}
              </span>
              {!isLast && <ChevronRight size={12} color="#334155" />}
            </div>
          )
        })}
      </div>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: '#F1F5F9', margin: 0 }}>{entity_name}</h1>
          <TypeBadge type={entity_type} />
          {showPodTag && pod_code  && <PodTag   podCode={pod_code} podColor={pod_color} />}
          {showPodTag && strategy_code && <StratTag code={strategy_code} />}
        </div>
        <div style={{ fontSize: 11, color: '#475569', flexShrink: 0 }}>
          {timeRange === 'SI' ? 'Since inception' : timeRange}
        </div>
      </div>

      {/* ── KPI strip — ALWAYS AT TOP ── */}
      <KpiRow kpis={kpis} sparklineData={sparklineData} key={entityId + timeRange} />

      <div style={{ height: 1, background: '#1E3A5F', margin: '16px 0' }} />

      {/* ══════════════════════════════════════════
          TRADER-SPECIFIC LAYOUT
      ══════════════════════════════════════════ */}
      {isTrader ? (
        <>
          {/* Trader info card */}
          <TraderInfoCard
            podCode={pod_code} podColor={pod_color}
            strategyCode={strategy_code}
            tradingStyle={trading_style}
            entityStatus={entity_status}
          />

          {ctxLoading ? (
            <Spinner />
          ) : (
            <>
              {/* Context overview — tabbed mini KPI strips */}
              <ContextOverview ctx={ctx} />

              <div style={{ height: 1, background: '#1E3A5F', margin: '4px 0 18px' }} />

              {/* Smart adaptive charts */}
              <SmartTraderCharts
                entityId={entityId}
                equityCurve={equity_curve}
                ctx={ctx}
              />

              {/* 3-tab breakdown tables */}
              <TraderBreakdownPanel
                entityId={entityId}
                ctx={ctx}
                navigate={navigate}
              />
            </>
          )}
        </>

      ) : (
      /* ══════════════════════════════════════════
          STANDARD LAYOUT (pod / strategy / venue)
      ══════════════════════════════════════════ */
        <>
          {/* Charts row */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 28 }}>
            <ChartCard title="Equity (with drawdown)">
              <EquityChart data={equity_curve} height={300} />
            </ChartCard>
            <ChartCard title={`Allocation by ${childLabel}`}>
              <DonutChart data={allocation} height={260} />
            </ChartCard>
            <ChartCard title={`PnL Contribution (${childLabel})`}>
              <PnlBarChart data={pnl_contribution} height={260} />
            </ChartCard>
          </div>

          {/* Breakdown table */}
          {breakdown.length > 0 && (
            <div>
              <SectionLabel>Breakdown — {childLabel}s</SectionLabel>
              <div style={{ background: '#111C2B', border: '1px solid #1E3A5F', borderRadius: 8, overflow: 'clip' }}>
                <BreakdownTable
                  rows={breakdown}
                  onRowClick={id => navigate(`/drilldown/${id}`)}
                  title={`${childLabel}s`}
                />
              </div>
            </div>
          )}
        </>
      )}

    </div>
  )
}