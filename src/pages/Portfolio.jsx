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
import useIsMobile         from '../hooks/useIsMobile.js'
import KpiRow              from '../components/cards/KpiRow.jsx'
import { fmtMoney, fmtPct } from '../components/cards/KpiCard.jsx'
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
    <div className="glass-panel" style={{ padding: 16, ...style }}>
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

// ---------------------------------------------------------------------------
// Overview card — glass, 4-box 2x2 mini-grid (Pod Overview / Strategies Overview)
// No 1D/7D/30D here — those live in the drill-down only.
// ---------------------------------------------------------------------------

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const r = parseInt(full.substring(0, 2), 16)
  const g = parseInt(full.substring(2, 4), 16)
  const b = parseInt(full.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function GlassStyles() {
  return (
    <style>{`
      .ov-card {
        position: relative;
        background: linear-gradient(155deg, #17273D 0%, #0F1D30 55%, #0B1522 100%);
        backdrop-filter: blur(18px) saturate(160%);
        -webkit-backdrop-filter: blur(18px) saturate(160%);
        border: 1px solid rgba(255,255,255,0.09);
        border-left: 3px solid var(--accent, #38BDF8);
        border-radius: 14px;
        padding: 18px 20px;
        cursor: pointer;
        overflow: hidden;
        transition: transform 0.25s cubic-bezier(.2,.8,.2,1), box-shadow 0.25s ease, border-color 0.25s ease, background 0.25s ease;
        box-shadow: 0 1px 0 rgba(255,255,255,0.05) inset, 0 10px 28px -14px rgba(0,0,0,0.7);
      }
      .ov-card::after {
        content: '';
        position: absolute; top: -60%; right: -30%;
        width: 70%; height: 180%;
        background: radial-gradient(circle, var(--accent-soft, rgba(56,189,248,0.14)) 0%, transparent 65%);
        opacity: 0.9; pointer-events: none;
      }
      .ov-card:hover {
        transform: translateY(-4px);
        border-color: var(--accent-soft, rgba(56,189,248,0.35));
        background: linear-gradient(155deg, #1A2C46 0%, #112036 55%, #0C1726 100%);
        box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset, 0 18px 36px -12px var(--accent-glow, rgba(56,189,248,0.35)), 0 10px 24px -14px rgba(0,0,0,0.8);
      }
      .ov-header {
        display: flex; align-items: center; gap: 9px;
        margin-bottom: 14px; padding-bottom: 12px;
        border-bottom: 1px solid rgba(255,255,255,0.07);
        position: relative;
      }
      .ov-dot {
        width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
        background: var(--accent, #38BDF8);
        box-shadow: 0 0 0 3px var(--accent-soft, rgba(56,189,248,0.18)), 0 0 12px 1px var(--accent-glow, rgba(56,189,248,0.5));
      }
      .ov-name { font-size: 13.5px; font-weight: 700; color: #F1F5F9; letter-spacing: 0.2px; }
      .ov-hint {
        font-size: 9.5px; color: #475569; margin-left: auto; font-weight: 600;
        opacity: 0; transform: translateX(-4px);
        transition: opacity 0.2s ease, transform 0.2s ease, color 0.2s ease;
      }
      .ov-card:hover .ov-hint { opacity: 1; transform: translateX(0); color: var(--accent, #38BDF8); }
      .stat-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
        position: relative;
      }
      .stat-box {
        position: relative;
        background: rgba(255,255,255,0.035);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 10px;
        padding: 11px 13px;
        transition: background 0.25s ease, border-color 0.25s ease;
      }
      .ov-card:hover .stat-box {
        background: rgba(255,255,255,0.06);
        border-color: rgba(255,255,255,0.12);
      }
      .stat-label {
        font-size: 9.5px; font-weight: 600; letter-spacing: 0.5px;
        text-transform: uppercase; color: #64748B; margin-bottom: 6px;
      }
      .stat-value {
        font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        display: flex; align-items: center; gap: 4px;
      }
      .ov-grid {
        display: grid; gap: 16px;
      }

      /* ── Lighter glass treatment — charts + breakdown table ── */
      .glass-panel {
        position: relative;
        background: linear-gradient(160deg, rgba(28,45,71,0.38) 0%, rgba(13,24,38,0.55) 100%);
        backdrop-filter: blur(12px) saturate(140%);
        -webkit-backdrop-filter: blur(12px) saturate(140%);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 12px;
        box-shadow: 0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 20px -14px rgba(0,0,0,0.55);
        transition: border-color 0.25s ease, box-shadow 0.25s ease;
      }
      .glass-panel:hover {
        border-color: rgba(56,189,248,0.16);
        box-shadow: 0 1px 0 rgba(255,255,255,0.05) inset, 0 10px 26px -14px rgba(56,189,248,0.14), 0 8px 20px -14px rgba(0,0,0,0.6);
      }
      .glass-table {
        position: relative;
        background: linear-gradient(160deg, rgba(24,39,62,0.35) 0%, rgba(11,20,32,0.55) 100%);
        backdrop-filter: blur(12px) saturate(140%);
        -webkit-backdrop-filter: blur(12px) saturate(140%);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 20px -14px rgba(0,0,0,0.55);
      }
      .glass-table .gt-bar {
        background: rgba(255,255,255,0.02) !important;
        backdrop-filter: blur(8px);
      }
      .glass-table thead th {
        background: rgba(15,23,42,0.55) !important;
        backdrop-filter: blur(8px);
      }
      .glass-table tbody tr:nth-child(odd) {
        background: rgba(255,255,255,0.02) !important;
      }
      .glass-table tbody tr:hover {
        background: rgba(56,189,248,0.07) !important;
      }
    `}</style>
  )
}

function StatBox({ label, value, tone = 'default' }) {
  const color = tone === 'pos' ? '#34D399' : tone === 'neg' ? '#F87171' : '#F1F5F9'
  const arrow = tone === 'pos' ? '▲' : tone === 'neg' ? '▼' : null
  return (
    <div className="stat-box">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>
        {arrow && <span style={{ fontSize: 9 }}>{arrow}</span>}
        {value}
      </div>
    </div>
  )
}

function OverviewCard({ name, color, kpis, onClick }) {
  const vars = {
    '--accent':       color,
    '--accent-soft':  hexToRgba(color, 0.20),
    '--accent-glow':  hexToRgba(color, 0.35),
  }
  return (
    <div className="ov-card" onClick={onClick} style={vars}>
      <div className="ov-header">
        <div className="ov-dot" />
        <div className="ov-name">{name}</div>
        <div className="ov-hint">Drill down →</div>
      </div>

      <div className="stat-grid">
        <StatBox label="Initial Invested" value={fmtMoney(kpis.initial_investment)} />
        <StatBox label="Current Equity"   value={fmtMoney(kpis.current_equity)} />
        <StatBox
          label="Total PnL"
          value={fmtMoney(kpis.total_pnl)}
          tone={kpis.total_pnl >= 0 ? 'pos' : 'neg'}
        />
        <StatBox
          label="Performance"
          value={fmtPct(kpis.performance)}
          tone={kpis.performance >= 0 ? 'pos' : 'neg'}
        />
      </div>
    </div>
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
  const isMobile  = useIsMobile()
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
    portfolio_name, last_updated, kpis, pods, strategies,
    equity_curve, allocation, pnl_contribution,
  } = data

  // UK convention: DD-MM-YYYY HH:MM
  const lastUpdatedStr = last_updated
    ? (() => {
        const s = new Date(last_updated).toLocaleString('en-GB', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })
        const [datePart, timePart] = s.split(', ')
        return `${datePart.replace(/\//g, '-')}${timePart ? ' ' + timePart : ''} UTC`
      })()
    : '—'

  return (
    <div style={{ padding: isMobile ? '14px 14px 40px' : '16px 24px 48px' }}>
      <GlassStyles />

      {/* ── Page header ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: isMobile ? 'flex-start' : 'flex-end',
        flexDirection: isMobile ? 'column' : 'row',
        gap: isMobile ? 8 : 0,
        marginBottom: 20,
      }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 19 : 22, fontWeight: 600, color: '#F1F5F9', margin: 0 }}>
            {portfolio_name}
          </h1>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>
            Portfolio · All pods · {timeRange === 'SI' ? 'Since inception' : timeRange}
          </div>
        </div>
        <div style={{ textAlign: isMobile ? 'left' : 'right', fontSize: 11, color: '#475569', lineHeight: 1.6 }}>
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
      <div className="ov-grid" style={{
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))',
        marginBottom: 26,
      }}>
        {pods.map((pod, idx) => (
          <OverviewCard
            key={pod.entity_id}
            name={pod.name}
            color={pod.pod_color || POD_COLORS[idx % POD_COLORS.length]}
            kpis={pod.kpis}
            onClick={() => navigate(`/drilldown/${pod.entity_id}`)}
          />
        ))}
      </div>

      {/* ── Divider ── */}
      <div style={{ height: 1, background: '#1E3A5F', margin: '0 0 16px' }} />

      {/* ── Strategies overview ── */}
      <SectionLabel>Strategies Overview</SectionLabel>
      <div className="ov-grid" style={{
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))',
        marginBottom: 26,
      }}>
        {(strategies ?? []).map((strat, idx) => (
          <OverviewCard
            key={strat.entity_id}
            name={strat.name}
            color={strat.pod_color || POD_COLORS[idx % POD_COLORS.length]}
            kpis={strat.kpis}
            onClick={() => navigate(`/drilldown/${strat.entity_id}`)}
          />
        ))}
      </div>

      {/* ── Divider ── */}
      <div style={{ height: 1, background: '#1E3A5F', margin: '0 0 20px' }} />

      {/* ── Charts row ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr',
        gap: 12, marginBottom: 28,
      }}>
        <ChartCard title="Equity (with drawdown)">
          <EquityChart data={equity_curve} height={isMobile ? 240 : 300} />
        </ChartCard>
        <ChartCard title="Allocation by Pod">
          <DonutChart data={allocation} height={isMobile ? 220 : 260} />
        </ChartCard>
        <ChartCard title="PnL Contribution (Pod)">
          <PnlBarChart data={pnl_contribution} height={isMobile ? 220 : 260} />
        </ChartCard>
      </div>

      {/* ── Hierarchy tabs ── */}
      <div className="glass-table">
        <div style={{
          display: 'flex', gap: 2, padding: '12px 12px 10px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          overflowX: 'auto', WebkitOverflowScrolling: 'touch',
        }}>
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