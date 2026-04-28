// frontend/src/components/tables/BreakdownTable.jsx
/**
 * Sortable breakdown table used on all drill-down and hierarchy pages.
 *
 * Features:
 *   - Default sort A-Z by Name
 *   - Live search bar — filters rows by name in real time (no API call)
 *   - Row count + totals bar below the table (recalculates with filter)
 *   - Hover preview card — appears after 200ms on any row, shows key
 *     metrics and a synthetic sparkline built from pct_1d/7d/30d
 *   - Pod coloured dot in the Name cell and the Pod column
 *   - Strategy code tag
 *
 * Props:
 *   rows        {Array}     BreakdownRow objects from API
 *   onRowClick  {function}  called with entity_id on row click
 *   title       {string}    optional label shown above search bar
 */

import { useState, useRef, useCallback } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, Search, X } from 'lucide-react'

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function fmtMoney(v) {
  if (v == null) return '—'
  const abs = Math.abs(v), s = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${s}£${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${s}£${(abs / 1_000).toFixed(1)}K`
  return `${s}£${abs.toFixed(0)}`
}

function fmtPct(v, d = 2) {
  if (v == null) return '—'
  const p = (v * 100).toFixed(d)
  return v > 0 ? `+${p}%` : `${p}%`
}

function pctColor(v) {
  if (v > 0) return '#34D399'
  if (v < 0) return '#F87171'
  return '#94A3B8'
}


// ---------------------------------------------------------------------------
// Synthetic sparkline — builds a directional mini-chart from pct values
// Points represent: baseline → 30d level → 7d level → recent 1d amplified
// The SVG normalises min/max so even tiny moves are visible
// ---------------------------------------------------------------------------

function syntheticSparkline(row) {
  // Amplify 1d return x5 so short-term moves are readable in the tiny chart
  return [
    0,
    (row.pct_30d ?? 0) * 100 * 0.4,
    (row.pct_30d ?? 0) * 100,
    (row.pct_7d  ?? 0) * 100,
    (row.pct_1d  ?? 0) * 100 * 5,
  ]
}

function MiniSparkline({ data, color }) {
  if (!data || data.length < 2) return null
  const H = 28, W = 80
  const min = Math.min(...data), max = Math.max(...data)
  const rng = max - min || 0.001
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W
    const y = H - ((v - min) / rng) * (H - 3) - 1.5
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color}
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        vectorEffect="non-scaling-stroke" />
    </svg>
  )
}


// ---------------------------------------------------------------------------
// Pod chip and strategy tag
// ---------------------------------------------------------------------------

function PodChip({ podCode, podColor, size = 'md' }) {
  if (!podCode) return <span style={{ color: '#334155' }}>—</span>
  const dotSize = size === 'sm' ? 6 : 7
  const fs      = size === 'sm' ? 9 : 10
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: dotSize, height: dotSize, borderRadius: '50%',
        background: podColor || '#475569', flexShrink: 0 }} />
      <span style={{ fontSize: fs, fontWeight: 600, color: podColor || '#94A3B8',
        letterSpacing: '0.3px' }}>
        {podCode}
      </span>
    </div>
  )
}

function StrategyTag({ code }) {
  if (!code) return <span style={{ color: '#334155' }}>—</span>
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 10,
      fontSize: 10, fontWeight: 600,
      background: 'rgba(148,163,184,0.08)', color: '#64748B',
      border: '1px solid rgba(148,163,184,0.12)', letterSpacing: '0.3px',
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


// ---------------------------------------------------------------------------
// Hover preview card
// ---------------------------------------------------------------------------

function PreviewCard({ row, top }) {
  const spark      = syntheticSparkline(row)
  const trendColor = pctColor(row.pct_30d)

  return (
    <div style={{
      position:       'absolute',
      right:          8,
      top:            Math.max(top - 30, 8),
      width:          224,
      zIndex:         50,
      background:     '#0D1B2E',
      border:         '1px solid #1E3A5F',
      borderRadius:   10,
      padding:        '12px 14px',
      pointerEvents:  'none',   // never interferes with row hover
      boxShadow:      '0 8px 24px rgba(0,0,0,0.4)',
      animation:      'previewIn 0.12s ease-out both',
    }}>
      <style>{`@keyframes previewIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#F1F5F9' }}>{row.name}</div>
          <div style={{ marginTop: 3 }}>
            <PodChip podCode={row.pod_code} podColor={row.pod_color} size="sm" />
          </div>
        </div>
        <MiniSparkline data={spark} color={trendColor} />
      </div>

      <div style={{ height: 1, background: '#1E3A5F', margin: '8px 0' }} />

      {/* Metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 12px' }}>
        {[
          ['Initial',  fmtMoney(row.aum),                      '#94A3B8'],
          ['PnL',      fmtMoney(row.pnl),                       pctColor(row.pnl)],
          ['Equity',   fmtMoney((row.aum || 0) + (row.pnl || 0)), '#E2E8F0'],
          ['24h',      fmtPct(row.pct_1d),                       pctColor(row.pct_1d)],
          ['7d',       fmtPct(row.pct_7d),                       pctColor(row.pct_7d)],
          ['30d',      fmtPct(row.pct_30d),                      pctColor(row.pct_30d)],
          ['Max DD',   fmtPct(row.drawdown),                     row.drawdown < -0.05 ? '#F87171' : '#94A3B8'],
          ['Strategy', row.strategy_code || '—',                '#64748B'],
        ].map(([label, val, color]) => (
          <div key={label}>
            <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase',
              letterSpacing: '0.5px', marginBottom: 1 }}>
              {label}
            </div>
            <div style={{ fontSize: 11, fontWeight: 500, color }}>{val}</div>
          </div>
        ))}
      </div>
    </div>
  )
}


// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const COLUMNS = [
  { key: 'name',          label: 'Name',      align: 'left',  sortable: true  },
  { key: 'allocation_pct',label: 'Alloc %',   align: 'right', sortable: true  },
  { key: 'aum',           label: 'Initial',   align: 'right', sortable: true  },
  { key: 'pnl',           label: 'PnL',       align: 'right', sortable: true  },
  { key: 'equity',        label: 'Equity',    align: 'right', sortable: true  },
  { key: 'pct_1d',        label: '24h',       align: 'right', sortable: true  },
  { key: 'pct_7d',        label: '7d',        align: 'right', sortable: true  },
  { key: 'pct_30d',       label: '30d',       align: 'right', sortable: true  },
  { key: 'drawdown',      label: 'Max DD',    align: 'right', sortable: true  },
  { key: 'win_rate',      label: 'Win Rate',  align: 'right', sortable: true  },
  { key: 'pod_code',      label: 'Pod',       align: 'left',  sortable: true  },
  { key: 'strategy_code', label: 'Strategy',  align: 'left',  sortable: true  },
  { key: 'status',        label: 'Status',    align: 'left',  sortable: false },
]


// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function BreakdownTable({ rows = [], onRowClick, title }) {
  // Sort state — default A-Z by name
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')

  // Search filter
  const [search, setSearch] = useState('')

  // Hover preview
  const [hoveredRow, setHoveredRow]   = useState(null)
  const [previewTop, setPreviewTop]   = useState(0)
  const containerRef                  = useRef(null)
  const hoverTimerRef                 = useRef(null)

  // ---------------------------------------------------------------------------
  // Inject computed equity field (Initial + PnL) into each row
  // ---------------------------------------------------------------------------

  const rowsWithEquity = rows.map(r => ({
    ...r,
    equity: (r.aum || 0) + (r.pnl || 0),
  }))

  // ---------------------------------------------------------------------------
  // Sort
  // ---------------------------------------------------------------------------

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')   // always start A-Z when switching column
    }
  }

  // ---------------------------------------------------------------------------
  // Filter + sort pipeline
  // ---------------------------------------------------------------------------

  const filtered = rowsWithEquity.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase())
  )

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? ''
    const bv = b[sortKey] ?? ''
    if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc'
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av))
  })

  // ---------------------------------------------------------------------------
  // Totals (computed from filtered set)
  // ---------------------------------------------------------------------------

  const totalAum    = filtered.reduce((s, r) => s + (r.aum    || 0), 0)
  const totalPnl    = filtered.reduce((s, r) => s + (r.pnl    || 0), 0)
  const totalEquity = filtered.reduce((s, r) => s + (r.equity || 0), 0)

  // ---------------------------------------------------------------------------
  // Hover handlers
  // ---------------------------------------------------------------------------

  const handleRowEnter = useCallback((e, row) => {
    clearTimeout(hoverTimerRef.current)
    const el        = e.currentTarget
    const container = containerRef.current
    hoverTimerRef.current = setTimeout(() => {
      if (container) {
        const cRect = container.getBoundingClientRect()
        const rRect = el.getBoundingClientRect()
        setPreviewTop(rRect.top - cRect.top)
      }
      setHoveredRow(row)
    }, 200)     // 200ms delay prevents flicker on fast mouse moves
  }, [])

  const handleRowLeave = useCallback(() => {
    clearTimeout(hoverTimerRef.current)
    setHoveredRow(null)
  }, [])

  // ---------------------------------------------------------------------------
  // Cell renderer
  // ---------------------------------------------------------------------------

  function renderCell(col, row) {
    const v = row[col.key]
    switch (col.key) {
      case 'name':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {row.pod_color && (
              <div style={{ width: 6, height: 6, borderRadius: '50%',
                flexShrink: 0, background: row.pod_color }} />
            )}
            <span style={{ color: '#E2E8F0', fontWeight: 500 }}>{v || '—'}</span>
          </div>
        )
      case 'allocation_pct':
        return <span style={{ color: '#94A3B8' }}>{v != null ? `${v.toFixed(1)}%` : '—'}</span>
      case 'aum':
        return <span style={{ color: '#94A3B8' }}>{fmtMoney(v)}</span>
      case 'pnl':
        return <span style={{ color: pctColor(v) }}>{fmtMoney(v)}</span>
      case 'equity':
        return <span style={{ color: '#E2E8F0', fontWeight: 500 }}>{fmtMoney(v)}</span>
      case 'pct_1d':
      case 'pct_7d':
      case 'pct_30d':
        return <span style={{ color: pctColor(v) }}>{fmtPct(v)}</span>
      case 'drawdown':
        return <span style={{ color: v < -0.05 ? '#F87171' : '#94A3B8' }}>{fmtPct(v)}</span>
      case 'win_rate':
        return <span style={{ color: '#94A3B8' }}>{v != null ? `${(v * 100).toFixed(0)}%` : '—'}</span>
      case 'pod_code':
        return <PodChip podCode={row.pod_code} podColor={row.pod_color} />
      case 'strategy_code':
        return <StrategyTag code={v} />
      case 'status':
        return <StatusBadge status={v} />
      default:
        return <span style={{ color: '#CBD5E1' }}>{v || '—'}</span>
    }
  }

  function SortIcon({ col }) {
    if (!col.sortable) return null
    if (sortKey !== col.key)
      return <ArrowUpDown size={10} color="#334155" style={{ marginLeft: 3, flexShrink: 0 }} />
    return sortDir === 'asc'
      ? <ArrowUp   size={10} color="#0EA5E9" style={{ marginLeft: 3, flexShrink: 0 }} />
      : <ArrowDown size={10} color="#0EA5E9" style={{ marginLeft: 3, flexShrink: 0 }} />
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>

      {/* ── Search bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderBottom: '1px solid #162032',
        background: '#0D1B2E',
      }}>
        {/* Left: title + count */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {title && (
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B',
              textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              {title}
            </span>
          )}
          <span style={{
            fontSize: 10, padding: '1px 7px', borderRadius: 10,
            background: 'rgba(14,165,233,0.10)', color: '#38BDF8',
            border: '1px solid rgba(14,165,233,0.2)', fontWeight: 500,
          }}>
            {filtered.length === rowsWithEquity.length
              ? `${rowsWithEquity.length} ${rowsWithEquity.length === 1 ? 'row' : 'rows'}`
              : `${filtered.length} / ${rowsWithEquity.length}`}
          </span>
        </div>

        {/* Right: search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6,
          background: '#111C2B', border: '1px solid #1E3A5F',
          borderRadius: 6, padding: '4px 10px', width: 200 }}>
          <Search size={12} color="#475569" style={{ flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Filter by name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 11, color: '#E2E8F0',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, display: 'flex', color: '#475569' }}>
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1E3A5F' }}>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  onClick={() => col.sortable && handleSort(col.key)}
                  style={{
                    padding:       '7px 10px',
                    textAlign:     col.align,
                    fontWeight:    500,
                    fontSize:      10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.4px',
                    color:         sortKey === col.key ? '#38BDF8' : '#475569',
                    background:    '#0D1B2E',
                    cursor:        col.sortable ? 'pointer' : 'default',
                    whiteSpace:    'nowrap',
                    userSelect:    'none',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    {col.label}
                    <SortIcon col={col} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={row.entity_id}
                onClick={() => onRowClick?.(row.entity_id)}
                onMouseEnter={(e) => handleRowEnter(e, row)}
                onMouseLeave={handleRowLeave}
                style={{
                  borderBottom: '1px solid #162032',
                  background:   i % 2 === 0 ? '#0D1728' : 'transparent',
                  cursor:       onRowClick ? 'pointer' : 'default',
                  transition:   'background 0.1s',
                }}
                onMouseOver={e => { e.currentTarget.style.background = '#1A2D45' }}
                onMouseOut={e  => { e.currentTarget.style.background = i % 2 === 0 ? '#0D1728' : 'transparent' }}
              >
                {COLUMNS.map(col => (
                  <td
                    key={col.key}
                    style={{
                      padding:   '7px 10px',
                      textAlign: col.align,
                      whiteSpace: col.key === 'name' ? 'nowrap' : 'normal',
                    }}
                  >
                    {renderCell(col, row)}
                  </td>
                ))}
              </tr>
            ))}

            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} style={{
                  textAlign: 'center', padding: '28px 0',
                  color: '#334155', fontSize: 12,
                }}>
                  {search ? `No results for "${search}"` : 'No data'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Totals bar ── */}
      {sorted.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 20,
          padding: '8px 12px', borderTop: '1px solid #162032',
          background: '#0D1B2E',
        }}>
          <span style={{ fontSize: 10, color: '#334155' }}>
            Showing <span style={{ color: '#64748B', fontWeight: 500 }}>{sorted.length}</span>
            {filtered.length !== rowsWithEquity.length && (
              <span style={{ color: '#334155' }}> of {rowsWithEquity.length}</span>
            )}
          </span>
          <div style={{ display: 'flex', gap: 16, marginLeft: 'auto' }}>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#334155',
                textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Total Initial
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>
                {fmtMoney(totalAum)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#334155',
                textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Total PnL
              </span>
              <span style={{ fontSize: 11, fontWeight: 600,
                color: pctColor(totalPnl) }}>
                {fmtMoney(totalPnl)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              
              <span style={{ fontSize: 10, color: '#334155',
                textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Avg Alloc
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>
                {sorted.length > 0
                  ? `${(sorted.reduce((s, r) => s + (r.allocation_pct ?? 0), 0) / sorted.length).toFixed(1)}%`
                  : '—'}
              </span>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
