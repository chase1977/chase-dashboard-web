// frontend/src/components/cards/KpiRow.jsx
/**
 * 7-card KPI strip.
 *
 * Passes raw numeric values to each KpiCard so count-up animation works.
 * The "Current equity" card also receives:
 *   - sparkline data (last N equity curve points, normalised to 0-100)
 *   - highlight prop (positive/negative glow based on pct_1d direction)
 *
 * Props:
 *   kpis          {object}    API kpis object
 *   small         {boolean}   smaller variant — disables animation and sparkline
 *   sparklineData {number[]}  raw equity values (last N points) for sparkline
 *
 * Usage in Portfolio.jsx / DrillDown.jsx:
 *   const sparklineData = equity_curve.slice(-20).map(p => p.equity)
 *   <KpiRow kpis={kpis} sparklineData={sparklineData} key={timeRange} />
 *
 * The key={timeRange} prop on the parent forces remount when time range
 * changes, which re-triggers the count-up animation on every switch.
 */

import KpiCard, { fmtMoney, fmtPct } from './KpiCard.jsx'

// ---------------------------------------------------------------------------
// Normalise sparkline data to 0–100 range for the Sparkline SVG renderer
// ---------------------------------------------------------------------------

function normalise(arr) {
  if (!arr || arr.length < 2) return []
  const min = Math.min(...arr)
  const max = Math.max(...arr)
  const rng = max - min || 1
  return arr.map(v => ((v - min) / rng) * 100)
}


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function KpiRow({ kpis, small = false, sparklineData = [] }) {
  if (!kpis) return null

  const {
    initial_investment,
    current_equity,
    performance,
    total_pnl,
    pct_1d,
    pct_7d,
    pct_30d,
  } = kpis

  // Colour type for percentage-based values
  const pctType = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'default')

  // Normalised sparkline for the equity card
  const sparkline = normalise(sparklineData)

  // Derive glow direction from value type — every card glows, not just equity
  const glow = (type) => type === 'pos' ? 'positive' : type === 'neg' ? 'negative' : null

  const cards = [
    {
      label:      'Initial invested',
      value:      fmtMoney(initial_investment),
      rawValue:   initial_investment,
      formatType: 'money',
      type:       'neu',
      highlight:  null,
    },
    {
      label:      'Current equity',
      value:      fmtMoney(current_equity),
      rawValue:   current_equity,
      formatType: 'money',
      type:       'default',
      sparkline,
      highlight:  null,
    },
    {
      label:      'Performance',
      value:      fmtPct(performance),
      rawValue:   performance,
      formatType: 'signed_pct',
      type:       pctType(performance),
      highlight:  glow(pctType(performance)),
    },
    {
      label:      'Total PnL',
      value:      fmtMoney(total_pnl),
      rawValue:   total_pnl,
      formatType: 'signed_money',
      type:       pctType(total_pnl),
      highlight:  glow(pctType(total_pnl)),
    },
    {
      label:      '24h',
      value:      fmtPct(pct_1d),
      rawValue:   pct_1d,
      formatType: 'signed_pct',
      type:       pctType(pct_1d),
      highlight:  glow(pctType(pct_1d)),
    },
    {
      label:      '7d',
      value:      fmtPct(pct_7d),
      rawValue:   pct_7d,
      formatType: 'signed_pct',
      type:       pctType(pct_7d),
      highlight:  glow(pctType(pct_7d)),
    },
    {
      label:      '30d',
      value:      fmtPct(pct_30d),
      rawValue:   pct_30d,
      formatType: 'signed_pct',
      type:       pctType(pct_30d),
      highlight:  glow(pctType(pct_30d)),
    },
  ]

  return (
    <div style={{
      display:             'grid',
      gridTemplateColumns: 'repeat(7, 1fr)',
      gap:                 8,
    }}>
      {cards.map(c => (
        <KpiCard
          key={c.label}
          label={c.label}
          value={c.value}
          rawValue={c.rawValue}
          formatType={c.formatType}
          type={c.type}
          small={small}
          sparkline={c.sparkline}
          highlight={c.highlight}
        />
      ))}
    </div>
  )
}