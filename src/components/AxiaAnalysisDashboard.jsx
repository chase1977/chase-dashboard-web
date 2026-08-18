// src/components/AxiaAnalysisDashboard.jsx
/**
 * AXIA Trade Analysis Dashboard
 * Full quantitative P&L attribution dashboard.
 * Charts: Recharts. Export: html2canvas + JSZip.
 */

import { useState, useMemo, useRef, useCallback } from 'react'
import useIsMobile from '../hooks/useIsMobile.js'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import JSZip from 'jszip'
import html2canvas from 'html2canvas'

// ─── Theme ───────────────────────────────────────────────────────────────────
const C = {
  bg:      '#0D1B2E',
  card:    '#0F2236',
  surface: '#132030',
  border:  '#1E3A5F',
  accent:  '#38BDF8',
  pos:     '#22C55E',
  neg:     '#EF4444',
  warn:    '#F59E0B',
  text:    '#F1F5F9',
  dim:     '#94A3B8',
  muted:   '#64748B',
  navy:    '#1F3864',
}

const CCY_COLOR = {
  USD: '#38BDF8', EUR: '#A78BFA', GBP: '#34D399',
  JPY: '#FB923C', CAD: '#F59E0B', CHF: '#EC4899',
  HKD: '#6EE7B7', CNH: '#FCA5A5',
}

const INST_PALETTE = [
  '#38BDF8','#A78BFA','#34D399','#FB923C','#F59E0B','#EC4899',
  '#6EE7B7','#FCA5A5','#818CF8','#FDE68A','#6EE7B7','#F9A8D4',
  '#67E8F9','#BBF7D0','#FED7AA','#C4B5FD','#FCA5A5','#86EFAC',
]

const PIE_COLORS = ['#38BDF8','#A78BFA','#34D399','#FB923C']

const CHART_TIP = {
  contentStyle: { background:'#0F2236', border:'1px solid #1E3A5F', color:'#F1F5F9', fontSize:12, borderRadius:8, padding:'8px 12px' },
  labelStyle:   { color:'#94A3B8', marginBottom:4 },
  itemStyle:    { color:'#F1F5F9' },
  wrapperStyle: { outline:'none', zIndex:1000 },
  cursor:       { fill:'rgba(56,189,248,0.05)' },
}

const AXIS = { tick:{ fill:C.muted, fontSize:11 }, axisLine:{ stroke:C.border }, tickLine:false }
const GRID = { stroke:'#1E3A5F', strokeDasharray:'3 3' }

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n, dp=2) =>
  n == null ? '—' : Number(n).toLocaleString('en-GB', { minimumFractionDigits:dp, maximumFractionDigits:dp })

// UK convention: DD-MM-YYYY — backend sends plain YYYY-MM-DD date strings
const fmtDate = d => {
  if (!d) return '—'
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d
}

const pnlColor  = n => n == null ? C.muted : n >= 0 ? C.pos : C.neg
const ccyColor  = c => CCY_COLOR[c] || C.accent
const instColor = i => INST_PALETTE[i % INST_PALETTE.length]

// ─── Atoms ───────────────────────────────────────────────────────────────────
function Card({ children, style={}, id }) {
  return (
    <div id={id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:20, ...style }}>
      {children}
    </div>
  )
}
function SectionLabel({ children }) {
  return (
    <div style={{ fontSize:10, fontWeight:700, color:C.muted, letterSpacing:'1.2px', textTransform:'uppercase', marginBottom:16, paddingBottom:8, borderBottom:`1px solid ${C.border}` }}>
      {children}
    </div>
  )
}
function KpiCard({ label, value, sub, color=C.accent }) {
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:'16px 20px', flex:1, minWidth:140 }}>
      <div style={{ fontSize:10, color:C.muted, textTransform:'uppercase', letterSpacing:'0.8px', marginBottom:8 }}>{label}</div>
      <div style={{ fontSize:22, fontWeight:700, color, lineHeight:1.1 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:C.dim, marginTop:6 }}>{sub}</div>}
    </div>
  )
}

// ─── Tooltips ─────────────────────────────────────────────────────────────────
function PnlTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value ?? 0
  const ccy = payload[0]?.payload?.ccy ?? ''
  return (
    <div style={{ background:'#0F2236', border:'1px solid #1E3A5F', borderRadius:8, padding:'8px 14px', fontSize:12 }}>
      <div style={{ color:'#94A3B8', marginBottom:4 }}>{label}</div>
      <div style={{ color:val >= 0 ? C.pos : C.neg, fontWeight:700, fontSize:13 }}>
        {ccy && <span style={{ fontSize:10, fontWeight:600, marginRight:4, opacity:0.75 }}>{ccy}</span>}
        {fmt(val)}
      </div>
    </div>
  )
}

// ─── P&L by Instrument ────────────────────────────────────────────────────────
function AssetPnlChart({ assets, gbpMode }) {
  const data = [...assets].sort((a,b) => a.net_pnl - b.net_pnl).map(a => ({
    name: gbpMode
      ? `${a.instrument} [${a.original_currency || a.currency}]`
      : `${a.instrument} (${a.currency})`,
    pnl: Math.round(a.net_pnl*100)/100,
    ccy: gbpMode ? 'GBP' : a.currency,
  }))
  const h    = Math.max(320, assets.length * 38 + 60)
  return (
    <ResponsiveContainer width="99%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top:5, right:80, bottom:5, left:190 }}>
        <CartesianGrid {...GRID} horizontal={false} />
        <XAxis type="number" {...AXIS} tickFormatter={v => fmt(v,0)} />
        <YAxis type="category" dataKey="name" width={185} tick={{ fill:'#F1F5F9', fontSize:11 }} axisLine={{ stroke:C.border }} tickLine={false} />
        <Tooltip content={<PnlTooltip />} cursor={{ fill:'rgba(56,189,248,0.05)' }} />
        <ReferenceLine x={0} stroke={C.border} strokeWidth={2} />
        <Bar dataKey="pnl" name="Net P&L" radius={[0,4,4,0]} isAnimationActive={false}>
          {data.map((e,i) => <Cell key={i} fill={e.pnl >= 0 ? C.pos : C.neg} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Daily P&L bars ───────────────────────────────────────────────────────────
function DailyPnlChart({ byDate, currencies }) {
  return (
    <ResponsiveContainer width="99%" height={260}>
      <BarChart data={byDate} margin={{ top:5, right:20, bottom:5, left:70 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" {...AXIS} tickFormatter={d => d.slice(5)} />
        <YAxis {...AXIS} tickFormatter={v => fmt(v,0)} />
        <Tooltip {...CHART_TIP} formatter={(v,n) => [fmt(v), n.replace('_pnl','')]} />
        <Legend wrapperStyle={{ color:C.text, fontSize:11 }} />
        <ReferenceLine y={0} stroke={C.border} strokeWidth={2} />
        {currencies.map(c => (
          <Bar key={c} dataKey={`${c}_pnl`} name={c} fill={ccyColor(c)} radius={[3,3,0,0]} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Cumulative equity by currency ────────────────────────────────────────────
function CumulativeChart({ byDate, currencies }) {
  return (
    <ResponsiveContainer width="99%" height={260}>
      <LineChart data={byDate} margin={{ top:5, right:20, bottom:5, left:70 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" {...AXIS} tickFormatter={d => d.slice(5)} />
        <YAxis {...AXIS} tickFormatter={v => fmt(v,0)} />
        <Tooltip {...CHART_TIP} formatter={(v,n) => [fmt(v), n.replace('_cum',' Cumulative')]} />
        <Legend wrapperStyle={{ color:C.text, fontSize:11 }} />
        <ReferenceLine y={0} stroke={C.border} strokeWidth={2} />
        {currencies.map(c => (
          <Line key={c} type="monotone" dataKey={`${c}_cum`} name={c} stroke={ccyColor(c)} strokeWidth={2.5} dot={false} activeDot={{ r:5 }} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── Commission pie ───────────────────────────────────────────────────────────
function CommPie({ breakdown }) {
  const pieData = [
    { name:'Broker Commission',      value:Math.abs(breakdown.commission_fees) },
    { name:'Exchange / Market Fees', value:Math.abs(breakdown.market_fees) },
    { name:'NFA Fees',               value:Math.abs(breakdown.nfa_fees) },
  ].filter(d => d.value > 0)
  const total = Math.abs(breakdown.total)
  return (
    <div>
      <ResponsiveContainer width="99%" height={160}>
        <PieChart>
          <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" isAnimationActive={false}>
            {pieData.map((_,i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
          </Pie>
          <Tooltip {...CHART_TIP} formatter={(v,n) => [fmt(v),n]} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ textAlign:'center', fontSize:11, color:C.muted, marginBottom:12 }}>
        Total: <span style={{ color:C.neg, fontWeight:700 }}>{fmt(total)}</span>
      </div>
      {pieData.map((d,i) => (
        <div key={d.name} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:10, height:10, borderRadius:2, background:PIE_COLORS[i], flexShrink:0 }} />
            <span style={{ fontSize:11, color:C.dim }}>{d.name}</span>
          </div>
          <span style={{ fontSize:12, color:C.text, fontWeight:600 }}>{fmt(d.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Volume chart ─────────────────────────────────────────────────────────────
function VolumeChart({ assets }) {
  const data = [...assets].sort((a,b) => (b.long+b.short)-(a.long+a.short)).slice(0,15).map(a => ({ name:a.instrument, lots:a.long+a.short, currency:a.currency }))
  return (
    <ResponsiveContainer width="99%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ top:5, right:50, bottom:5, left:165 }}>
        <CartesianGrid {...GRID} horizontal={false} />
        <XAxis type="number" {...AXIS} tickFormatter={v => fmt(v,0)} />
        <YAxis type="category" dataKey="name" width={160} tick={{ fill:'#F1F5F9', fontSize:11 }} axisLine={{ stroke:C.border }} tickLine={false} />
        <Tooltip {...CHART_TIP} formatter={v => [fmt(v,0),'Total Lots']} />
        <Bar dataKey="lots" name="Lots" radius={[0,4,4,0]} isAnimationActive={false}>
          {data.map((e,i) => <Cell key={i} fill={ccyColor(e.currency)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Commission drag chart ────────────────────────────────────────────────────
function CommDragChart({ assets, gbpMode }) {
  const data = [...assets].sort((a,b) => Math.abs(b.total_comms)-Math.abs(a.total_comms)).slice(0,12).map(a => ({ name:a.instrument, gross:Math.round(a.realized_pnl*100)/100, comms:Math.round(Math.abs(a.total_comms)*100)/100 }))
  const grossLabel = gbpMode ? 'Gross P&L (GBP)' : 'Gross P&L'
  const commsLabel = gbpMode ? 'Total Comms (GBP)' : 'Total Comms'
  return (
    <ResponsiveContainer width="99%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ top:5, right:60, bottom:5, left:165 }}>
        <CartesianGrid {...GRID} horizontal={false} />
        <XAxis type="number" {...AXIS} tickFormatter={v => fmt(v,0)} />
        <YAxis type="category" dataKey="name" width={160} tick={{ fill:'#F1F5F9', fontSize:11 }} axisLine={{ stroke:C.border }} tickLine={false} />
        <Tooltip {...CHART_TIP} formatter={(v,n) => [fmt(v),n]} />
        <Legend wrapperStyle={{ color:C.text, fontSize:11 }} />
        <ReferenceLine x={0} stroke={C.border} strokeWidth={2} />
        <Bar dataKey="gross" name={grossLabel} fill={C.accent} radius={[0,4,4,0]} isAnimationActive={false} />
        <Bar dataKey="comms" name={commsLabel} fill={C.neg}    radius={[0,4,4,0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── SVG Sparkline ────────────────────────────────────────────────────────────
function Sparkline({ data, color, h=68 }) {
  if (!data || data.length < 2) return null
  const vals = data.map(d => d.cumulative)
  const min  = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1
  const W = 300, H = h, P = 4
  const pts = vals.map((v,i) => {
    const x = P + (i/(vals.length-1))*(W-P*2)
    const y = H - P - ((v-min)/rng)*(H-P*2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const zeroY = (min < 0 && max > 0) ? (H-P-(-min/rng)*(H-P*2)).toFixed(1) : null
  const lastY = (H-P-((vals[vals.length-1]-min)/rng)*(H-P*2)).toFixed(1)
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display:'block' }}>
      {zeroY && <line x1={P} y1={zeroY} x2={W-P} y2={zeroY} stroke="#1E3A5F" strokeWidth={1} />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={W-P} cy={lastY} r={3.5} fill={color} />
    </svg>
  )
}

function MiniCurve({ asset }) {
  const color = asset.net_pnl >= 0 ? C.pos : C.neg
  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:14 }}>
      <div style={{ fontSize:11, fontWeight:700, color:C.dim, marginBottom:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{asset.instrument}</div>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
        <span style={{ fontSize:10, color:ccyColor(asset.currency), fontWeight:600 }}>{asset.currency}</span>
        <span style={{ fontSize:13, fontWeight:700, color }}>{fmt(asset.net_pnl)}</span>
      </div>
      <Sparkline data={asset.daily} color={color} />
      <div style={{ fontSize:10, color:C.muted, marginTop:8 }}>
        {fmt(asset.long,0)}L / {fmt(asset.short,0)}S · {asset.trade_days}d
      </div>
    </div>
  )
}

// ─── Winners / Losers list ────────────────────────────────────────────────────
function RankList({ items, variant='winner' }) {
  const color = variant === 'winner' ? C.pos : C.neg
  return (
    <div>
      {items.map((a,i) => (
        <div key={`${a.instrument}-${a.currency}`} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:i < items.length-1 ? `1px solid ${C.border}` : 'none' }}>
          <div>
            <div style={{ fontSize:12, color:C.dim, fontWeight:600 }}>{a.instrument}</div>
            <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>{a.currency} · {fmt(a.long,0)} lots · {a.trade_days}d</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:13, fontWeight:700, color }}>{fmt(a.net_pnl)}</div>
            <div style={{ fontSize:10, color:C.muted }}>drag {a.comm_drag_pct}%</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Sortable Asset Table ─────────────────────────────────────────────────────
function AssetTable({ assets }) {
  const [sortKey, setSortKey] = useState('net_pnl')
  const [sortDir, setSortDir] = useState('asc')
  const sorted = useMemo(() => {
    return [...assets].sort((a,b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (av == null) return 1; if (bv == null) return -1
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av-bv : bv-av
    })
  }, [assets, sortKey, sortDir])
  const handleSort = key => { if (sortKey===key) setSortDir(d => d==='asc'?'desc':'asc'); else { setSortKey(key); setSortDir('asc') } }
  const ind = key => sortKey===key ? (sortDir==='asc'?' ↑':' ↓') : ''
  const TH = ({ k, children, align='right' }) => (
    <th onClick={() => handleSort(k)} style={{ padding:'10px 12px', background:C.navy, color:'#CBD5E1', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.6px', textAlign:align, cursor:'pointer', userSelect:'none', whiteSpace:'nowrap', borderBottom:`2px solid ${C.border}`, position:'sticky', top:0, zIndex:10 }}>
      {children}{ind(k)}
    </th>
  )
  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
        <thead style={{ position:'sticky', top:0, zIndex:10 }}>
          <tr>
            <TH k="instrument" align="left">Instrument</TH>
            <TH k="currency" align="center">CCY</TH>
            <TH k="long">Long Lots</TH><TH k="short">Short Lots</TH>
            <TH k="trade_days">Days</TH><TH k="realized_pnl">Realized P&L</TH>
            <TH k="commission_fees">Broker Comms</TH><TH k="market_fees">Market Fees</TH>
            <TH k="nfa_fees">NFA Fees</TH><TH k="total_comms">Total Comms</TH>
            <TH k="net_pnl">Net P&L</TH><TH k="comm_drag_pct">Comm Drag %</TH>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a,i) => {
            const bg = i%2===0 ? C.surface : C.card
            return (
              <tr key={`${a.instrument}-${a.currency}`}>
                <td style={{ padding:'9px 12px', borderBottom:`1px solid ${C.border}`, background:bg, color:C.text, fontWeight:600 }}>{a.instrument}</td>
                <td style={{ padding:'9px 12px', borderBottom:`1px solid ${C.border}`, background:bg, color:ccyColor(a.currency), fontWeight:700, textAlign:'center' }}>{a.currency}</td>
                {[fmt(a.long,0),fmt(a.short,0),a.trade_days,fmt(a.realized_pnl),fmt(a.commission_fees),fmt(a.market_fees),fmt(a.nfa_fees),fmt(a.total_comms)].map((v,ci) => (
                  <td key={ci} style={{ padding:'9px 12px', borderBottom:`1px solid ${C.border}`, background:bg, color:C.dim, textAlign:'right' }}>{v}</td>
                ))}
                <td style={{ padding:'9px 12px', borderBottom:`1px solid ${C.border}`, color:pnlColor(a.net_pnl), fontWeight:700, textAlign:'right', background:a.net_pnl >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)' }}>{fmt(a.net_pnl)}</td>
                <td style={{ padding:'9px 12px', borderBottom:`1px solid ${C.border}`, background:bg, color:C.muted, textAlign:'right' }}>{a.comm_drag_pct}%</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── P&L Heatmap: Currency × Date ────────────────────────────────────────────
function PnlHeatmap({ byDate, currencies }) {
  const [hoveredCell, setHoveredCell] = useState(null)

  // Compute min/max per currency for color scale
  const scales = useMemo(() => {
    const s = {}
    for (const c of currencies) {
      const vals = byDate.map(d => d[`${c}_pnl`] || 0).filter(v => v !== 0)
      if (!vals.length) continue
      const maxAbs = Math.max(...vals.map(Math.abs))
      s[c] = maxAbs || 1
    }
    return s
  }, [byDate, currencies])

  const cellColor = (val, maxAbs) => {
    if (!val || val === 0) return 'rgba(30,58,95,0.2)'
    const intensity = Math.min(Math.abs(val) / maxAbs, 1)
    if (val > 0) {
      const r = Math.round(34  + intensity * (52  - 34))
      const g = Math.round(197 + intensity * (197 - 197))
      const b = Math.round(94  + intensity * (94  - 94))
      return `rgba(${r},${g},${b},${0.15 + intensity * 0.75})`
    } else {
      const intensity2 = Math.min(Math.abs(val) / maxAbs, 1)
      return `rgba(239,68,68,${0.1 + intensity2 * 0.8})`
    }
  }

  // Show at most 60 dates to keep it readable; let user scroll
  const dates     = byDate.map(d => d.date)
  const cellW     = Math.max(18, Math.min(32, Math.floor(1100 / Math.max(dates.length, 1))))
  const totalW    = cellW * dates.length

  return (
    <div>
      <div style={{ overflowX:'auto', overflowY:'visible', paddingBottom:8 }}>
        <div style={{ minWidth: totalW + 120, position:'relative' }}>
          {/* Header date labels */}
          <div style={{ display:'flex', marginLeft:100, marginBottom:4 }}>
            {dates.map((d, di) => (
              <div key={d} style={{ width:cellW, flexShrink:0, fontSize:8, color:C.muted, textAlign:'center',
                transform:'rotate(-60deg)', transformOrigin:'50% 100%', height:32,
                display:'flex', alignItems:'flex-end', justifyContent:'center', overflow:'hidden' }}>
                {di % Math.ceil(dates.length / 25) === 0 ? d.slice(5) : ''}
              </div>
            ))}
          </div>

          {/* Rows per currency */}
          {currencies.filter(c => scales[c]).map(c => (
            <div key={c} style={{ display:'flex', alignItems:'center', marginBottom:3 }}>
              <div style={{ width:95, flexShrink:0, fontSize:11, fontWeight:700, color:ccyColor(c), textAlign:'right', paddingRight:8 }}>{c}</div>
              {dates.map((d, di) => {
                const row   = byDate[di]
                const val   = row ? (row[`${c}_pnl`] || 0) : 0
                const maxAbs = scales[c]
                const isHov  = hoveredCell?.date === d && hoveredCell?.ccy === c
                return (
                  <div
                    key={d}
                    onMouseEnter={() => setHoveredCell({ date:d, ccy:c, val })}
                    onMouseLeave={() => setHoveredCell(null)}
                    style={{
                      width:cellW-2, height:22, flexShrink:0, marginRight:2, borderRadius:3,
                      background:cellColor(val, maxAbs),
                      border:isHov ? '1px solid #38BDF8' : '1px solid transparent',
                      cursor: val !== 0 ? 'crosshair' : 'default',
                      transition:'transform 0.1s',
                      transform:isHov ? 'scale(1.15)' : 'scale(1)',
                    }}
                  />
                )
              })}
            </div>
          ))}

          {/* Colour scale legend */}
          <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:16, marginLeft:100 }}>
            <span style={{ fontSize:10, color:C.muted }}>Loss</span>
            {[1,0.75,0.5,0.25,0,0.25,0.5,0.75,1].map((v,i) => {
              const isPos = i >= 4
              const bg = i === 4 ? 'rgba(30,58,95,0.2)' : isPos
                ? `rgba(34,197,94,${0.15 + v * 0.75})`
                : `rgba(239,68,68,${0.1  + v * 0.8})`
              return <div key={i} style={{ width:20, height:14, borderRadius:2, background:bg }} />
            })}
            <span style={{ fontSize:10, color:C.muted }}>Win</span>
          </div>
        </div>
      </div>

      {/* Hover tooltip */}
      {hoveredCell && (
        <div style={{ marginTop:12, padding:'8px 14px', background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, fontSize:12, display:'inline-block' }}>
          <span style={{ color:C.muted }}>{hoveredCell.date} · {hoveredCell.ccy}</span>
          <span style={{ marginLeft:12, fontWeight:700, color:pnlColor(hoveredCell.val) }}>{fmt(hoveredCell.val)}</span>
        </div>
      )}
    </div>
  )
}

// ─── Equity Curve Explorer (per instrument, interactive) ─────────────────────
function EquityCurveExplorer({ assets }) {
  const instList   = useMemo(() => [...assets].sort((a,b) => a.instrument.localeCompare(b.instrument)), [assets])
  const [mode, setMode] = useState('top10')          // 'top10' | 'select' | 'all'
  const [selected, setSelected] = useState(() => new Set(assets.slice(0,5).map(a => `${a.instrument}|${a.currency}`)))
  const [searchQ, setSearchQ]   = useState('')

  const toggleInst = key => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const activeAssets = useMemo(() => {
    if (mode === 'all')    return instList
    if (mode === 'top10')  return [...assets].sort((a,b) => Math.abs(b.net_pnl)-Math.abs(a.net_pnl)).slice(0,10)
    return instList.filter(a => selected.has(`${a.instrument}|${a.currency}`))
  }, [mode, selected, instList, assets])

  // Build unified date axis
  const allDates = useMemo(() => {
    const s = new Set()
    activeAssets.forEach(a => a.daily.forEach(d => s.add(d.date)))
    return [...s].sort()
  }, [activeAssets])

  // Build chart data: one row per date, one key per asset
  const chartData = useMemo(() => {
    const byDate = {}
    for (const d of allDates) byDate[d] = { date: d }
    for (const a of activeAssets) {
      const key = `${a.instrument}|${a.currency}`
      let running = 0
      for (const d of a.daily) {
        running = d.cumulative
        if (byDate[d.date]) byDate[d.date][key] = running
      }
    }
    return allDates.map(d => byDate[d])
  }, [allDates, activeAssets])

  const filteredList = useMemo(() =>
    instList.filter(a => a.instrument.toLowerCase().includes(searchQ.toLowerCase())),
    [instList, searchQ]
  )

  const BTN = ({ m, label }) => (
    <button onClick={() => setMode(m)} style={{ padding:'6px 14px', borderRadius:6, border:`1px solid ${mode===m ? C.accent : C.border}`, background:mode===m ? 'rgba(56,189,248,0.12)' : 'transparent', color:mode===m ? C.accent : C.dim, fontSize:12, cursor:'pointer', fontWeight:mode===m?700:400, transition:'all 0.15s' }}>
      {label}
    </button>
  )

  return (
    <div>
      {/* Mode selector */}
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        <BTN m="top10"  label="Top 10 by P&L" />
        <BTN m="select" label="Select Instruments" />
        <BTN m="all"    label={`All (${instList.length})`} />
        <div style={{ fontSize:11, color:C.muted, marginLeft:'auto' }}>
          Showing {activeAssets.length} instrument{activeAssets.length!==1?'s':''}
        </div>
      </div>

      {/* Instrument picker (only in select mode) */}
      {mode === 'select' && (
        <div style={{ marginBottom:16, padding:14, background:C.surface, borderRadius:10, border:`1px solid ${C.border}` }}>
          <input
            placeholder="Search instruments…"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            style={{ width:'100%', background:'transparent', border:`1px solid ${C.border}`, borderRadius:6, padding:'6px 10px', color:C.text, fontSize:12, marginBottom:10, outline:'none', boxSizing:'border-box' }}
          />
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, maxHeight:140, overflowY:'auto' }}>
            {filteredList.map((a,i) => {
              const key = `${a.instrument}|${a.currency}`
              const active = selected.has(key)
              return (
                <button key={key} onClick={() => toggleInst(key)} style={{ padding:'4px 10px', borderRadius:6, border:`1px solid ${active ? instColor(i) : C.border}`, background:active ? `${instColor(i)}22` : 'transparent', color:active ? instColor(i) : C.muted, fontSize:11, cursor:'pointer', whiteSpace:'nowrap' }}>
                  {a.instrument} ({a.currency})
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Chart */}
      {activeAssets.length === 0 ? (
        <div style={{ textAlign:'center', padding:'40px 0', color:C.muted, fontSize:13 }}>Select at least one instrument</div>
      ) : (
        <ResponsiveContainer width="99%" height={400}>
          <LineChart data={chartData} margin={{ top:5, right:20, bottom:5, left:80 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="date" {...AXIS} tickFormatter={d => d.slice(5)} />
            <YAxis {...AXIS} tickFormatter={v => fmt(v,0)} />
            <Tooltip
              {...CHART_TIP}
              formatter={(v, name) => {
                const parts = name.split('|')
                return [fmt(v), `${parts[0]} (${parts[1]})`]
              }}
            />
            <ReferenceLine y={0} stroke={C.border} strokeWidth={2} />
            {activeAssets.map((a,i) => {
              const key = `${a.instrument}|${a.currency}`
              return (
                <Line key={key} type="monotone" dataKey={key} stroke={instColor(i)} strokeWidth={2} dot={false} activeDot={{ r:4 }} isAnimationActive={false} name={key} />
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ─── Export Graphs ────────────────────────────────────────────────────────────
async function exportAllGraphs(setExportingGraphs) {
  setExportingGraphs(true)
  try {
    const zip      = new JSZip()
    const chartIds = [
      'chart-asset-pnl', 'chart-daily-pnl', 'chart-cumulative',
      'chart-volume', 'chart-comm-drag', 'chart-comm-pie',
      'chart-heatmap', 'chart-equity-explorer',
      'chart-winners-curves', 'chart-losers-curves',
    ]

    for (const id of chartIds) {
      const el = document.getElementById(id)
      if (!el) continue
      try {
        const canvas = await html2canvas(el, {
          backgroundColor: '#0D1B2E',
          scale:            2,
          useCORS:          true,
          allowTaint:       true,
          logging:          false,
        })
        const png = canvas.toDataURL('image/png').split(',')[1]
        zip.file(`${id}.png`, png, { base64:true })
      } catch (e) {
        console.warn(`Failed to capture ${id}:`, e)
      }
    }

    const blob = await zip.generateAsync({ type:'blob' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = 'AXIA-Analysis-Charts.zip'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } finally {
    setExportingGraphs(false)
  }
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function AxiaAnalysisDashboard({
  data, trader, account, onNewUpload, onExport, exporting, onGbpRetry, gbpRetrying,
  readOnly = false, forceGbp = false, onSaveShare, saving = false,
}) {
  const isMobile = useIsMobile()
  const [exportingGraphs, setExportingGraphs] = useState(false)
  const [gbpMode, setGbpMode]                 = useState(forceGbp)

  // Switch between native multi-currency view and unified GBP view
  const activeData = useMemo(() => {
    if (!gbpMode || !data.gbp_assets) return data
    return {
      ...data,
      by_asset:             data.gbp_assets,
      by_date:              data.gbp_by_date,
      by_currency:          data.gbp_by_currency,
      commission_breakdown: data.gbp_commission_breakdown,
      portfolio_daily_detail: data.gbp_portfolio_daily,
      summary: { ...data.summary, currencies: ['GBP'] },
    }
  }, [data, gbpMode])

  const currencies = activeData.summary.currencies
  const totalLots  = data.summary.total_long_lots + data.summary.total_short_lots
  const topWinners = useMemo(() => [...activeData.by_asset].sort((a,b) => b.net_pnl - a.net_pnl).slice(0,5), [activeData])
  const topLosers  = useMemo(() => [...activeData.by_asset].sort((a,b) => a.net_pnl - b.net_pnl).slice(0,5), [activeData])
  const bestAsset  = topWinners[0]
  const worstAsset = topLosers[0]

  const gbpRatesOk      = data.gbp_rates_ok === true
  const gbpRatesFailed  = data.gbp_rates_failed || []
  const hasGbpData      = gbpRatesOk && !!data.gbp_assets

  return (
    <div style={{ background:C.bg, minHeight:'calc(100vh - 56px)', padding: isMobile ? '18px 14px' : '28px 36px', color:C.text }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:28, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ fontSize:22, fontWeight:700, color:C.text, letterSpacing:'-0.3px' }}>AXIA Strategy — Trade Analysis</div>
            {gbpMode && (
              <div style={{ padding:'3px 10px', borderRadius:20, background:'rgba(52,211,153,0.15)', border:'1px solid rgba(52,211,153,0.4)', fontSize:11, fontWeight:700, color:C.pos, letterSpacing:'0.6px' }}>
                GBP VIEW
              </div>
            )}
            {readOnly && (
              <div style={{ padding:'3px 10px', borderRadius:20, background:'rgba(56,189,248,0.1)', border:'1px solid rgba(56,189,248,0.3)', fontSize:11, fontWeight:700, color:C.accent, letterSpacing:'0.6px' }}>
                SHARED · READ-ONLY
              </div>
            )}
          </div>
          <div style={{ display:'flex', gap:20, fontSize:13, color:C.muted, marginTop:6, flexWrap:'wrap' }}>
            <span>Trader: <span style={{ color:C.accent, fontWeight:600 }}>{trader}</span></span>
            <span>Account: <span style={{ color:C.accent, fontWeight:600 }}>{account}</span></span>
            <span>Period: <span style={{ color:C.dim }}>{fmtDate(data.date_range.from)} → {fmtDate(data.date_range.to)}</span></span>
            <span style={{ color:C.dim }}>{data.date_range.trading_days} trading day{data.date_range.trading_days!==1?'s':''}</span>
          </div>
        </div>

        <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
          {!readOnly && (
            <button onClick={onNewUpload} style={{ padding:'9px 18px', borderRadius:8, cursor:'pointer', border:`1px solid ${C.border}`, background:'transparent', color:C.dim, fontSize:13, transition:'all 0.15s' }}>
              ↑ New Upload
            </button>
          )}

          {/* GBP Toggle — locked to GBP on the shared read-only view */}
          {forceGbp ? null : hasGbpData ? (
            <div style={{ display:'flex', borderRadius:8, border:`1px solid ${C.border}`, overflow:'hidden' }}>
              <button
                onClick={() => setGbpMode(false)}
                style={{ padding:'9px 14px', border:'none', cursor:'pointer', fontSize:12, fontWeight:600, transition:'all 0.15s',
                  background: !gbpMode ? C.navy : 'transparent',
                  color: !gbpMode ? C.accent : C.muted,
                }}
              >Native</button>
              <button
                onClick={() => setGbpMode(true)}
                style={{ padding:'9px 14px', border:'none', cursor:'pointer', fontSize:12, fontWeight:600, transition:'all 0.15s',
                  background: gbpMode ? 'rgba(52,211,153,0.15)' : 'transparent',
                  color: gbpMode ? C.pos : C.muted,
                  borderLeft:`1px solid ${C.border}`,
                }}
              >GBP</button>
            </div>
          ) : (
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', borderRadius:8, border:'1px solid rgba(245,158,11,0.35)', background:'rgba(245,158,11,0.07)' }}>
              <span style={{ fontSize:11, color:C.warn }}>
                {gbpRetrying
                  ? '⏳ Fetching rates…'
                  : gbpRatesFailed.length > 0
                    ? `GBP rates unavailable (${gbpRatesFailed.join(', ')})`
                    : 'GBP rates unavailable'
                }
              </span>
              {!gbpRetrying && onGbpRetry && (
                <button
                  onClick={onGbpRetry}
                  style={{ padding:'3px 10px', borderRadius:6, border:`1px solid ${C.warn}`, background:'transparent', color:C.warn, fontSize:11, fontWeight:700, cursor:'pointer' }}
                >
                  ↺ Retry
                </button>
              )}
            </div>
          )}

          <button
            onClick={() => exportAllGraphs(setExportingGraphs)}
            disabled={exportingGraphs}
            style={{ padding:'9px 18px', borderRadius:8, cursor:exportingGraphs?'not-allowed':'pointer', border:`1px solid ${C.border}`, background:'transparent', color:C.warn, fontSize:13, fontWeight:600, opacity:exportingGraphs?0.6:1, transition:'all 0.15s' }}
          >
            {exportingGraphs ? '⏳ Capturing…' : '🖼 Export Graphs'}
          </button>
          <button onClick={() => onExport(gbpMode)} disabled={exporting} style={{ padding:'9px 22px', borderRadius:8, cursor:'pointer', border:'none', background:C.navy, color:C.accent, fontSize:13, fontWeight:700, opacity:exporting?0.7:1, transition:'all 0.15s' }}>
            {exporting ? 'Generating…' : `⬇ Export Excel${gbpMode ? ' (GBP)' : ''}`}
          </button>

          {!readOnly && onSaveShare && (
            <button
              onClick={onSaveShare}
              disabled={saving || !hasGbpData}
              title={!hasGbpData ? 'GBP rates unavailable — fetch GBP rates before sharing (boss view is GBP-only)' : 'Save this analysis and get a shareable read-only link (GBP view)'}
              style={{ padding:'9px 22px', borderRadius:8, cursor:(saving||!hasGbpData)?'not-allowed':'pointer', border:`1px solid ${C.pos}`, background:'rgba(52,211,153,0.12)', color:C.pos, fontSize:13, fontWeight:700, opacity:(saving||!hasGbpData)?0.5:1, transition:'all 0.15s' }}
            >
              {saving ? 'Saving…' : '🔗 Save & Share'}
            </button>
          )}
        </div>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap' }}>
        <KpiCard label="Instruments" value={data.summary.total_instruments} sub={data.summary.currencies.join(' · ')} />
        <KpiCard label="Total Lots"  value={fmt(totalLots,0)} sub={`${fmt(data.summary.total_long_lots,0)} long  ·  ${fmt(data.summary.total_short_lots,0)} short`} />
        <KpiCard label="Trading Days" value={data.date_range.trading_days} sub={`${fmtDate(data.date_range.from)} – ${fmtDate(data.date_range.to)}`} />
        <KpiCard label="Best Instrument"  value={bestAsset?.instrument}  sub={`${fmt(bestAsset?.net_pnl)} ${gbpMode ? 'GBP' : bestAsset?.currency}`}  color={C.pos} />
        <KpiCard label="Worst Instrument" value={worstAsset?.instrument} sub={`${fmt(worstAsset?.net_pnl)} ${gbpMode ? 'GBP' : worstAsset?.currency}`} color={C.neg} />
        <KpiCard label={gbpMode ? 'Total Comms (GBP)' : 'Total Commissions'} value={fmt(activeData.commission_breakdown.total)} sub="broker + exchange + NFA" color={C.warn} />
      </div>

      {/* ── Currency P&L Strip ─────────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:10, marginBottom:24, flexWrap:'wrap' }}>
        {Object.entries(activeData.by_currency).map(([ccy,vals]) => (
          <div key={ccy} style={{ background:C.card, border:`1px solid ${gbpMode ? 'rgba(52,211,153,0.3)' : C.border}`, borderRadius:10, padding:'14px 22px', flex:1, minWidth:140 }}>
            <div style={{ fontSize:10, color:gbpMode ? C.pos : ccyColor(ccy), fontWeight:700, letterSpacing:'0.8px', marginBottom:8 }}>
              {gbpMode ? 'GBP TOTAL' : `${ccy} BOOK`}
            </div>
            <div style={{ fontSize:20, fontWeight:700, color:pnlColor(vals.net_pnl), lineHeight:1 }}>{fmt(vals.net_pnl)}</div>
            <div style={{ fontSize:10, color:C.muted, marginTop:6 }}>Gross: {fmt(vals.realized_pnl)}</div>
            <div style={{ fontSize:10, color:C.muted }}>Comms: {fmt(vals.total_comms)}</div>
          </div>
        ))}
      </div>

      {/* ── Row 1: P&L by Instrument + Right column ───────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 320px', gap:16, marginBottom:20 }}>
        <Card id="chart-asset-pnl">
          <SectionLabel>Net P&L by Instrument{gbpMode ? ' — converted to GBP' : ' — sorted worst → best'}</SectionLabel>
          <AssetPnlChart assets={activeData.by_asset} gbpMode={gbpMode} />
        </Card>
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <Card id="chart-comm-pie">
            <SectionLabel>Commission Breakdown{gbpMode ? ' (GBP)' : ''}</SectionLabel>
            <CommPie breakdown={activeData.commission_breakdown} />
          </Card>
          <Card>
            <SectionLabel>Top 5 Winners</SectionLabel>
            <RankList items={topWinners} variant="winner" />
          </Card>
          <Card>
            <SectionLabel>Top 5 Losers</SectionLabel>
            <RankList items={topLosers} variant="loser" />
          </Card>
        </div>
      </div>

      {/* ── Row 2: Daily P&L + Cumulative ─────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:16, marginBottom:20 }}>
        <Card id="chart-daily-pnl">
          <SectionLabel>Daily Net P&L{gbpMode ? ' — GBP' : ' by Currency'}</SectionLabel>
          <DailyPnlChart byDate={activeData.by_date} currencies={currencies} />
        </Card>
        <Card id="chart-cumulative">
          <SectionLabel>Cumulative P&L — Equity Curve{gbpMode ? ' (GBP)' : 's by Currency'}</SectionLabel>
          <CumulativeChart byDate={activeData.by_date} currencies={currencies} />
        </Card>
      </div>

      {/* ── P&L Heatmap ────────────────────────────────────────────────────── */}
      <Card id="chart-heatmap" style={{ marginBottom:20 }}>
        <SectionLabel>P&L Heatmap — {gbpMode ? 'All Books in GBP' : 'Currency × Date'} (green = win · red = loss · intensity = magnitude)</SectionLabel>
        <PnlHeatmap byDate={activeData.by_date} currencies={currencies} />
      </Card>

      {/* ── Equity Curve Explorer ──────────────────────────────────────────── */}
      <Card id="chart-equity-explorer" style={{ marginBottom:20 }}>
        <SectionLabel>Instrument Equity Curve Explorer{gbpMode ? ' — GBP' : ' — single · compare · all'}</SectionLabel>
        <EquityCurveExplorer assets={activeData.by_asset} />
      </Card>

      {/* ── Row 3: Volume + Commission Drag ───────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:16, marginBottom:20 }}>
        <Card id="chart-volume">
          <SectionLabel>Trade Volume by Instrument (Total Lots)</SectionLabel>
          <VolumeChart assets={activeData.by_asset} />
        </Card>
        <Card id="chart-comm-drag">
          <SectionLabel>Gross P&L vs Commission Drag{gbpMode ? ' (GBP)' : ' — Top Commission Payers'}</SectionLabel>
          <CommDragChart assets={activeData.by_asset} gbpMode={gbpMode} />
        </Card>
      </div>

      {/* ── Top winners mini curves ────────────────────────────────────────── */}
      <Card id="chart-winners-curves" style={{ marginBottom:20 }}>
        <SectionLabel>Top 5 Winners — Equity Curves{gbpMode ? ' (GBP)' : ''}</SectionLabel>
        <div style={{ display:'grid', gridTemplateColumns:`repeat(auto-fit, minmax(130px, 1fr))`, gap:12 }}>
          {topWinners.map(a => <MiniCurve key={`${a.instrument}-${a.original_currency || a.currency}`} asset={a} />)}
        </div>
      </Card>

      {/* ── Top losers mini curves ─────────────────────────────────────────── */}
      <Card id="chart-losers-curves" style={{ marginBottom:20 }}>
        <SectionLabel>Top 5 Losers — Equity Curves{gbpMode ? ' (GBP)' : ''}</SectionLabel>
        <div style={{ display:'grid', gridTemplateColumns:`repeat(auto-fit, minmax(130px, 1fr))`, gap:12 }}>
          {topLosers.map(a => <MiniCurve key={`${a.instrument}-${a.original_currency || a.currency}`} asset={a} />)}
        </div>
      </Card>

      {/* ── Full Asset Table ───────────────────────────────────────────────── */}
      <Card>
        <SectionLabel>Full Instrument Breakdown{gbpMode ? ' — All values in GBP' : ' — click headers to sort'}</SectionLabel>
        <AssetTable assets={activeData.by_asset} />
      </Card>

    </div>
  )
}
