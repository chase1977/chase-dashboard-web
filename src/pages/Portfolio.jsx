// frontend/src/pages/Portfolio.jsx
/**
 * Portfolio home page.
 *
 * Sections (top to bottom):
 *   1. Page header       — title + last updated timestamp
 *   2. Summary strip     — SummaryStrip: 4 equal cards (Money Allocated, AUM, TWR, PnL)
 *   3. Portfolio KPIs    — 7-card strip
 *   4. Pod overview      — one KPI strip per pod, clickable to drill down
 *   5. Charts row        — Equity curve | Allocation donut | PnL bars
 *   6. Hierarchy tabs    — Pods | Strategies | Traders | Venues
 */

import { useState, useEffect } from 'react'
import { useNavigate }         from 'react-router-dom'
import { useQuery }            from '@tanstack/react-query'
import { RefreshCw }           from 'lucide-react'

import { usePortfolio, useHierarchyTable } from '../hooks/usePortfolioData.js'
import KpiRow              from '../components/cards/KpiRow.jsx'
import EquityChart         from '../components/charts/EquityChart.jsx'
import { DonutChart }      from '../components/charts/DonutChart.jsx'
import PnlBarChart         from '../components/charts/PnlBarChart.jsx'
import BreakdownTable      from '../components/tables/BreakdownTable.jsx'
import SummaryStrip        from '../components/SummaryStrip.jsx'
import PodStrategyManager  from '../components/PodStrategyManager.jsx'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const POD_COLORS     = ['#0EA5E9', '#F59E0B', '#34D399', '#A78BFA', '#F472B6']
const HIERARCHY_TABS = ['pod', 'strategy', 'trader', 'venue']


// ---------------------------------------------------------------------------
// Small reusable sub-components
// ---------------------------------------------------------------------------

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

function ChartCard({ title, children, style = {} }) {
  return (
    <div style={{
      background: '#111C2B', border: '1px solid #1E3A5F',
      borderRadius: 8, padding: 16, ...style,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#94A3B8', marginBottom: 12 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

const TAB_LABELS = {
  pod:      'Pods',
  strategy: 'Strategies',
  trader:   'Traders',
  venue:    'Venues',
}

function TabButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: 6, fontSize: 12,
        fontWeight: 500, border: 'none', cursor: 'pointer',
        background: active ? '#1E3A5F' : 'transparent',
        color:      active ? '#38BDF8' : '#475569',
        transition: 'all 0.15s',
      }}
    >
      {TAB_LABELS[label] ?? label.charAt(0).toUpperCase() + label.slice(1) + 's'}
    </button>
  )
}

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#334155', gap: 8 }}>
      <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
      <span style={{ fontSize: 12 }}>Loading...</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function ErrorMsg({ message }) {
  return (
    <div style={{
      padding: 20, color: '#F87171', fontSize: 12, borderRadius: 8,
      background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.15)',
    }}>
      Error loading data: {message}
    </div>
  )
}


// ---------------------------------------------------------------------------
// Hierarchy tab — lazy-loads its own data per tab selection
// ---------------------------------------------------------------------------

function HierarchyTab({ entityType, onRowClick }) {
  const { data, isLoading, error } = useHierarchyTable(entityType)
  if (isLoading) return <Spinner />
  if (error)     return <ErrorMsg message={error.message} />
  return <BreakdownTable rows={data?.rows ?? []} onRowClick={onRowClick} />
}


// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function Portfolio({ timeRange, initialTab }) {
  const navigate  = useNavigate()
  const [activeTab,    setActiveTab]    = useState(initialTab || 'pod')
  const [showManager,  setShowManager]  = useState(false)

  // Sync tab when route changes (e.g. clicking Traders in navbar)
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab)
  }, [initialTab])

  const { data, isLoading, error } = usePortfolio(timeRange)

  // Fund ledger — capital events, TWR, bank balance
  const { data: fundLedger, isLoading: ledgerLoading } = useQuery({
    queryKey:        ['fund_ledger'],
    queryFn:         () =>
      fetch('/api/portfolio/fund_ledger').then(r => r.json()),
    refetchInterval: 60_000,
    staleTime:       30_000,
  })

  if (isLoading) return <div style={{ padding: 24 }}><Spinner /></div>
  if (error)     return <div style={{ padding: 24 }}><ErrorMsg message={error.message} /></div>

  const {
    portfolio_name, last_updated, kpis, pods,
    equity_curve, allocation, pnl_contribution,
  } = data

  const lastUpdatedStr = last_updated
    ? new Date(last_updated).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }) + ' UTC'
    : '—'

  return (
    <div style={{ padding: '16px 24px 48px' }}>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: '#F1F5F9', margin: 0 }}>
            {portfolio_name}
          </h1>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>
            Portfolio · All pods · {timeRange === 'SI' ? 'Since inception' : timeRange}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: '#475569', lineHeight: 1.6 }}>
          Last updated<br />
          <span style={{ color: '#64748B' }}>{lastUpdatedStr}</span>
        </div>
      </div>

      {/* ── Summary Strip — 4 equal metric cards ── */}
      <SectionLabel>Capital &amp; Performance Overview</SectionLabel>
      <div style={{ marginBottom: 20 }}>
        <SummaryStrip
          data={fundLedger}
          equityCurve={equity_curve}
          loading={ledgerLoading}
        />
      </div>

      {/* ── Divider ── */}
      <div style={{ height: 1, background: '#1E3A5F', margin: '0 0 16px' }} />

      {/* ── Portfolio KPI strip ── */}
      <SectionLabel>Portfolio Summary</SectionLabel>
      <KpiRow
        kpis={kpis}
        sparklineData={equity_curve.slice(-20).map(p => p.equity)}
        key={timeRange}
      />

      {/* ── Divider ── */}
      <div style={{ height: 1, background: '#1E3A5F', margin: '20px 0 16px' }} />

      {/* ── Pod overview ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10 }}>
        <SectionLabel>Pod Overview</SectionLabel>
        <button
          onClick={() => setShowManager(true)}
          style={{
            display:    'flex', alignItems: 'center', gap: 6,
            padding:    '6px 12px', borderRadius: 7, border: '1px solid rgba(14,165,233,0.25)',
            cursor:     'pointer', fontSize: 11, fontWeight: 600,
            background: 'rgba(14,165,233,0.08)', color: '#38BDF8',
            marginBottom: 10,
          }}
        >
          Manage Pods &amp; Strategies
        </button>
      </div>
      {pods.map((pod, idx) => (
        <div key={pod.entity_id} style={{ marginBottom: 16 }}>
          <div
            onClick={() => navigate(`/drilldown/${pod.entity_id}`)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 12, fontWeight: 600, color: '#94A3B8',
              marginBottom: 8, cursor: 'pointer',
            }}
          >
            <div style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: POD_COLORS[idx % POD_COLORS.length],
            }} />
            {pod.name}
            <span style={{ fontSize: 9, color: '#334155', marginLeft: 2 }}>
              click to drill down
            </span>
          </div>
          <KpiRow kpis={pod.kpis} small />
        </div>
      ))}

      {/* ── Divider ── */}
      <div style={{ height: 1, background: '#1E3A5F', margin: '20px 0 20px' }} />

      {/* ── Charts row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 28 }}>
        <ChartCard title="Equity (with drawdown)">
          <EquityChart data={equity_curve} height={300} />
        </ChartCard>
        <ChartCard title="Allocation by Pod">
          <DonutChart data={allocation} height={260} />
        </ChartCard>
        <ChartCard title="PnL Contribution (Pod)">
          <PnlBarChart data={pnl_contribution} height={260} />
        </ChartCard>
      </div>

      {/* ── Hierarchy tabs ── */}
      <div>
        <div style={{ display: 'flex', gap: 2, paddingBottom: 12, borderBottom: '1px solid #1E3A5F', marginBottom: 16 }}>
          {HIERARCHY_TABS.map(t => (
            <TabButton key={t} label={t} active={activeTab === t} onClick={() => setActiveTab(t)} />
          ))}
        </div>
        <HierarchyTab
          entityType={activeTab}
          onRowClick={id => navigate(`/drilldown/${id}`)}
        />
      </div>

      {/* ── Pod / Strategy Manager modal ── */}
      {showManager && (
        <PodStrategyManager
          onClose={() => setShowManager(false)}
          onSaved={() => {}}
        />
      )}

    </div>
  )
}