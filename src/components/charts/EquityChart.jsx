// frontend/src/components/charts/EquityChart.jsx
/**
 * Equity curve chart with a drawdown sub-chart below.
 * No benchmark line — clean single equity line as requested.
 *
 * Props:
 *   data      {Array}   - [{timestamp, equity}, ...]  from API
 *   height    {number}  - total height of the combined chart area (default 320)
 */

import {
  ComposedChart, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart,
} from 'recharts'
import { useMemo } from 'react'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format axis tick for equity values */
function fmtEquityTick(v) {
  if (Math.abs(v) >= 999_950) return `${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000)   return `${(v / 1_000).toFixed(1)}K`
  return `${v}`
}

/** Format timestamp for axis ticks — show "Feb 8" style */
function fmtDateTick(ts) {
  const d = new Date(ts)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** Custom tooltip */
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = new Date(label)
  const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div style={{
      background:   '#0D1B2E',
      border:       '1px solid #1E3A5F',
      borderRadius: 6,
      padding:      '8px 12px',
      fontSize:     11,
      minWidth:     140,
    }}>
      <div style={{ color: '#64748B', marginBottom: 4 }}>{dateStr}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ color: '#94A3B8' }}>{p.name}</span>
          <span style={{ color: p.color, fontWeight: 500 }}>
            {p.dataKey === 'drawdown'
              ? `${(p.value * 100).toFixed(2)}%`
              : `£${Number(p.value).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`
            }
          </span>
        </div>
      ))}
    </div>
  )
}


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EquityChart({ data = [], height = 320 }) {

  // Compute drawdown series from equity data
  const enriched = useMemo(() => {
    let peak = -Infinity
    return data.map(pt => {
      if (pt.equity > peak) peak = pt.equity
      const dd = peak > 0 ? (pt.equity - peak) / peak : 0
      return { ...pt, drawdown: parseFloat(dd.toFixed(5)) }
    })
  }, [data])

  // Auto-scale Y-axis: tight bounds around data range with padding
  const equityDomain = useMemo(() => {
    if (!data.length) return ['auto', 'auto']
    const vals = data.map(d => d.equity).filter(v => v != null && isFinite(v))
    if (!vals.length) return ['auto', 'auto']
    const mn  = Math.min(...vals)
    const mx  = Math.max(...vals)
    const rng = mx - mn || mn * 0.01          // fallback if flat line
    const pad = rng * 0.15                    // 15% of range as bottom padding
    const lower = Math.floor((mn - pad) / 1000) * 1000
    return [lower, 'auto']
  }, [data])

  const equityHeight  = Math.round(height * 0.65)
  const ddHeight      = Math.round(height * 0.28)
  const dividerHeight = height - equityHeight - ddHeight

  if (!data.length) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: 12 }}>
        No data
      </div>
    )
  }

  const chartProps = {
    margin: { top: 4, right: 8, left: 4, bottom: 0 },
  }

  return (
    <div style={{ height }}>

      {/* ── Equity line chart ── */}
      <ResponsiveContainer width="100%" height={equityHeight}>
        <AreaChart data={enriched} {...chartProps}>
          <defs>
            <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#0EA5E9" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#0EA5E9" stopOpacity={0}    />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E3A5F" strokeOpacity={0.5} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={fmtDateTick}
            tick={{ fill: '#475569', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            minTickGap={60}
          />
          <YAxis
            domain={equityDomain}
            tickFormatter={fmtEquityTick}
            tick={{ fill: '#475569', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="equity"
            stroke="#0EA5E9"
            strokeWidth={2}
            fill="url(#equityGrad)"
            dot={false}
            activeDot={{ r: 4, fill: '#0EA5E9', strokeWidth: 0 }}
            name="Equity"
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* ── Divider label ── */}
      <div style={{
        height:      dividerHeight,
        display:     'flex',
        alignItems:  'center',
        borderTop:   '1px solid #1E3A5F',
        marginTop:   4,
        paddingLeft: 4,
      }}>
        <span style={{ fontSize: 9, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Drawdown (%)
        </span>
      </div>

      {/* ── Drawdown sub-chart ── */}
      <ResponsiveContainer width="100%" height={ddHeight}>
        <AreaChart data={enriched} {...chartProps}>
          <defs>
            <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#F87171" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#F87171" stopOpacity={0}   />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E3A5F" strokeOpacity={0.3} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={fmtDateTick}
            tick={{ fill: '#475569', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            minTickGap={60}
          />
          <YAxis
            tickFormatter={v => `${(v * 100).toFixed(1)}%`}
            tick={{ fill: '#475569', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={42}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0} stroke="#1E3A5F" strokeDasharray="4 2" />
          <Area
            type="monotone"
            dataKey="drawdown"
            stroke="#F87171"
            strokeWidth={1.5}
            fill="url(#ddGrad)"
            dot={false}
            activeDot={{ r: 3, fill: '#F87171', strokeWidth: 0 }}
            name="Drawdown"
          />
        </AreaChart>
      </ResponsiveContainer>

    </div>
  )
}
