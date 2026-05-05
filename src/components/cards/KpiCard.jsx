// frontend/src/components/cards/KpiCard.jsx
/**
 * Single KPI card.
 *
 * Features:
 *  - Count-up animation from 0 to the target value on mount (large cards only)
 *  - Mini sparkline rendered at the bottom of the card (optional)
 *  - Performance glow on border — subtle green/red halo based on pct_1d direction
 *  - Fade-slide-in on mount for all cards
 *
 * Props:
 *   label       {string}                     e.g. "Current Equity"
 *   value       {string}                     pre-formatted fallback e.g. "£1.6M"
 *   rawValue    {number}                     raw number for count-up animation
 *   formatType  {'money'|'signed_money'|'signed_pct'|'none'}
 *   type        {'pos'|'neg'|'neu'|'default'}
 *   small       {boolean}                    smaller variant for pod strips
 *   sparkline   {number[]}                   normalised equity values (0–100 range)
 *   highlight   {'positive'|'negative'|null} border glow direction
 */

import { useState, useEffect, useRef } from 'react'

// ---------------------------------------------------------------------------
// Exported formatters (re-used by KpiRow and other components)
// ---------------------------------------------------------------------------

export function fmtMoney(val, compact = true) {
  if (val == null) return '—'
  const abs = Math.abs(val)
  const sign = val < 0 ? '-' : ''
  if (!compact || abs < 1000) return `${sign}£${Math.abs(val).toFixed(0)}`
  if (abs < 999_950)          return `${sign}£${(abs / 1_000).toFixed(1)}K`
  if (abs < 1_000_000_000)    return `${sign}£${(abs / 1_000_000).toFixed(2)}M`
  return `${sign}£${(abs / 1_000_000_000).toFixed(2)}B`
}

export function fmtPct(val, decimals = 2) {
  if (val == null) return '—'
  const p = (val * 100).toFixed(decimals)
  return val >= 0 ? `+${p}%` : `${p}%`
}


// ---------------------------------------------------------------------------
// Count-up hook
// Animates a number from 0 to `target` over `duration` ms (ease-out cubic).
// Only runs when `enabled` is true — disabled for small/pod strip cards.
// ---------------------------------------------------------------------------

function useCountUp(target, duration = 950, enabled = true) {
  const [value, setValue]  = useState(enabled ? 0 : target)
  const rafRef             = useRef(null)
  const startRef           = useRef(null)

  useEffect(() => {
    if (!enabled) {
      setValue(target)
      return
    }
    // Reset on every target change (e.g. time range switch)
    setValue(0)
    startRef.current = null

    const animate = (ts) => {
      if (!startRef.current) startRef.current = ts
      const progress = Math.min((ts - startRef.current) / duration, 1)
      const eased    = 1 - Math.pow(1 - progress, 3)   // ease-out cubic
      setValue(target * eased)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        setValue(target)   // snap to exact final value
      }
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, duration, enabled])

  return value
}


// ---------------------------------------------------------------------------
// Format an animated (mid-count) numeric value
// ---------------------------------------------------------------------------

function formatAnimValue(v, formatType) {
  switch (formatType) {
    case 'money': {
      const abs = Math.abs(v)
      const s   = v < 0 ? '-' : ''
      if (abs >= 999_950) return `${s}£${(abs / 1_000_000).toFixed(2)}M`
      if (abs >= 1_000)   return `${s}£${(abs / 1_000).toFixed(1)}K`
      return `${s}£${abs.toFixed(0)}`
    }
    case 'signed_money': {
      const abs  = Math.abs(v)
      const sign = v < 0 ? '-£' : '+£'
      if (abs >= 999_950) return `${sign}${(abs / 1_000_000).toFixed(2)}M`
      if (abs >= 1_000)   return `${sign}${(abs / 1_000).toFixed(1)}K`
      return `${sign}${abs.toFixed(0)}`
    }
    case 'signed_pct': {
      const p = (v * 100).toFixed(2)
      return v >= 0 ? `+${p}%` : `${p}%`
    }
    default:
      return String(v)
  }
}


// ---------------------------------------------------------------------------
// Sparkline — mini equity line rendered at the bottom of the card
// ---------------------------------------------------------------------------

function Sparkline({ data, color }) {
  if (!data || data.length < 2) return null

  const H   = 22
  const W   = 100    // viewBox units
  const min = Math.min(...data)
  const max = Math.max(...data)
  const rng = max - min || 1

  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W
    const y = H - ((v - min) / rng) * (H - 3) - 1.5
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')

  return (
    <svg
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: 'block', marginTop: 8, opacity: 0.55 }}
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function valueColor(type) {
  switch (type) {
    case 'pos': return '#34D399'
    case 'neg': return '#F87171'
    case 'neu': return '#0EA5E9'
    default:    return '#F1F5F9'
  }
}

function cardBorderAndGlow(highlight) {
  if (highlight === 'positive') return {
    border:    '1.5px solid rgba(52,211,153,0.70)',
    boxShadow: '0 0 10px rgba(52,211,153,0.18), 0 0 20px rgba(52,211,153,0.08)',
  }
  if (highlight === 'negative') return {
    border:    '1.5px solid rgba(248,113,113,0.70)',
    boxShadow: '0 0 10px rgba(248,113,113,0.18), 0 0 20px rgba(248,113,113,0.08)',
  }
  return { border: '1px solid #1E3A5F' }
}


// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function KpiCard({
  label,
  value,
  rawValue,
  formatType  = 'none',
  type        = 'default',
  small       = false,
  sparkline,
  highlight,
}) {
  // Count-up only on large cards where rawValue is provided
  const animated     = useCountUp(rawValue ?? 0, 2200, !small && rawValue != null)
  const displayValue = (!small && rawValue != null)
    ? formatAnimValue(animated, formatType)
    : value

  const color = valueColor(type)

  return (
    <div
      style={{
        background:   '#111C2B',
        borderRadius: 8,
        padding:      small ? '10px 12px' : '12px 14px',
        minHeight:    small ? 62 : sparkline ? 104 : 72,
        // Fade-slide-in on mount
        animation:    'kpiCardIn 0.35s ease-out both',
        ...cardBorderAndGlow(highlight),
      }}
    >
      <style>{`
        @keyframes kpiCardIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Label */}
      <div style={{
        fontSize:      10,
        fontWeight:    500,
        letterSpacing: '0.3px',
        textTransform: 'uppercase',
        color:         '#64748B',
        marginBottom:  small ? 4 : 5,
      }}>
        {label}
      </div>

      {/* Value */}
      <div style={{
        fontSize:    small ? 15 : 18,
        fontWeight:  600,
        color,
        lineHeight:  1.2,
        whiteSpace:  'nowrap',
        overflow:    'hidden',
        textOverflow:'ellipsis',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {displayValue}
      </div>

      {/* Sparkline — only on large cards when data is provided */}
      {!small && sparkline && sparkline.length > 1 && (
        <Sparkline data={sparkline} color={color} />
      )}
    </div>
  )
}