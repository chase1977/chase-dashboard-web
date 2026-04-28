// frontend/src/components/charts/DonutChart.jsx
/**
 * Allocation donut chart.
 * Props:
 *   data    {Array}   - [{name, aum, pct}, ...]
 *   height  {number}
 */

import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

// Pod / slice colour palette — consistent across all charts
const SLICE_COLORS = [
  '#0EA5E9',  // blue
  '#F59E0B',  // amber
  '#34D399',  // green
  '#A78BFA',  // purple
  '#F472B6',  // pink
  '#38BDF8',  // light blue
  '#FB923C',  // orange
  '#4ADE80',  // light green
  '#E879F9',  // violet
  '#FCD34D',  // yellow
  '#60A5FA',  // sky
  '#F87171',  // red
  '#2DD4BF',  // teal
  '#C084FC',  // lavender
]

function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{
      background: '#0D1B2E', border: '1px solid #1E3A5F',
      borderRadius: 6, padding: '7px 11px', fontSize: 11,
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 2 }}>{d.name}</div>
      <div style={{ color: '#F1F5F9', fontWeight: 500 }}>
        {d.pct?.toFixed(1)}% · ${(d.aum / 1000).toFixed(0)}K
      </div>
    </div>
  )
}

export function DonutChart({ data = [], height = 220 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="45%"
          innerRadius="52%"
          outerRadius="72%"
          paddingAngle={2}
          dataKey="aum"
          nameKey="name"
          strokeWidth={0}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<DonutTooltip />} />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={v => (
            <span style={{ fontSize: 10, color: '#64748B' }}>{v}</span>
          )}
          wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
