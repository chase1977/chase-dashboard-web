// frontend/src/components/charts/PnlBarChart.jsx
/**
 * Horizontal bar chart showing PnL contribution per child entity.
 * Bars are green for positive PnL, red for negative.
 *
 * Props:
 *   data    {Array}   - [{name, pnl}, ...]  sorted desc by PnL
 *   height  {number}  - chart height in px (default 220)
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell, ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPnl(v) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : '+'
  if (abs >= 999_950) return `${sign}£${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)   return `${sign}£${(abs / 1_000).toFixed(2)}K`
  return `${sign}£${abs.toFixed(2)}`
}

function PnlTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{
      background: '#0D1B2E', border: '1px solid #1E3A5F',
      borderRadius: 6, padding: '7px 11px', fontSize: 11,
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 3 }}>{d.name}</div>
      <div style={{
        fontWeight: 500,
        color: d.pnl >= 0 ? '#34D399' : '#F87171',
      }}>
        {fmtPnl(d.pnl)}
      </div>
    </div>
  )
}


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PnlBarChart({ data = [], height = 220 }) {
  if (!data.length) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: 12 }}>
        No data
      </div>
    )
  }

  const truncate = (s, n = 12) => s.length > n ? s.slice(0, n) + '\u2026' : s
  const chartData = data.map(d => ({ ...d, _name: truncate(d.name) }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 4, right: 48, left: 8, bottom: 4 }}
        barCategoryGap="25%"
      >
        <CartesianGrid
          horizontal={false}
          strokeDasharray="3 3"
          stroke="#1E3A5F"
          strokeOpacity={0.5}
        />
        <XAxis
          type="number"
          tickFormatter={v => fmtPnl(v)}
          tick={{ fill: '#475569', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="_name"
          tick={{ fill: '#94A3B8', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={72}
        />
        <ReferenceLine x={0} stroke="#1E3A5F" strokeWidth={1} />
        <Tooltip content={<PnlTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <Bar dataKey="pnl" radius={[0, 3, 3, 0]}>
          {chartData.map((d, i) => (
            <Cell
              key={i}
              fill={d.pnl >= 0 ? '#34D399' : '#F87171'}
              fillOpacity={0.85}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
