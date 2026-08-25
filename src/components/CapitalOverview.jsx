// frontend/src/components/CapitalOverview.jsx
/**
 * Capital & Performance Overview — 6-metric hero strip, Capital Flow Summary
 * table, Capital at a Glance chart, and narrative info box.
 *
 * Mirrors the model supplied by management:
 *   Total Capital Invested  — cumulative capital ever deployed (never reduces)
 *   Banked Profit / Loss    — profit AND loss physically withdrawn and returned
 *   Capital Allocated       — Total Capital Invested − total cash withdrawn
 *                             (BOTH the capital-return portion AND the
 *                             profit/loss portion reduce it — any cash that
 *                             physically left the strategy is no longer
 *                             "still out", whichever portion it was)
 *   Current Equity          — current value of the remaining economic interest
 *   Total P&L                — Current Equity + Banked Profit/Loss − Total Capital Invested
 *   Total ROI                — Total P&L ÷ Total Capital Invested × 100
 *
 * Banked Profit/Loss and Capital Allocated are real, sourced from the
 * backend's per-strategy classification of outbound Capital/Darwinex
 * Transfers (capital_return_amount / profit_loss_amount). A withdrawal not
 * yet classified there simply doesn't count until tagged — it never
 * silently shows as profit. Banked Profit/Loss can be negative: a closing
 * withdrawal that returns less than the capital still allocated is a
 * realized loss.
 *
 * NOTE: Total P&L is always computed as Equity + Banked − Invested here,
 * NOT via the "Equity − Allocated" shortcut — that shortcut only matches
 * once a strategy has a pure capital-return withdrawal (Allocated drops by
 * more than just the profit portion), so the two forms diverge in general.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import useIsMobile from '../hooks/useIsMobile.js'
import {
  Wallet, Landmark, PieChart, Activity, TrendingUp, TrendingDown, Percent, Info, X,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  ResponsiveContainer, ReferenceLine, LabelList,
} from 'recharts'
import {
  fetchCapitalTransfers, fetchInternalTransfers, fetchPods, fetchStrategies,
} from '../services/api.js'
import { usePortfolio } from '../hooks/usePortfolioData.js'

// ---------------------------------------------------------------------------
// Small-text palette — brightened ~40% off the app's muted greys so labels,
// captions, axis ticks and legends stay legible on the glass panels.
// ---------------------------------------------------------------------------

const TXT_MUTED = '#9199A5'   // was #475569
const TXT_SOFT  = '#A2ABB9'   // was #64748B
const TXT_SUB   = '#BFC8D4'   // was #94A3B8

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const r = parseInt(full.substring(0, 2), 16)
  const g = parseInt(full.substring(2, 4), 16)
  const b = parseInt(full.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function fmtGBP(v) {
  if (v == null || Number.isNaN(v)) return '£0.00'
  const sign = v < 0 ? '-' : ''
  return `${sign}£${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtGBPSigned(v) {
  if (v == null || Number.isNaN(v)) return '£0.00'
  const sign = v < 0 ? '-£' : '+£'
  return `${sign}${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtGBPAxis(v) {
  const abs = Math.abs(v)
  if (abs >= 999_950) return `${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)   return `${(abs / 1_000).toFixed(0)}k`
  return `£${abs.toFixed(0)}`
}

// Compact bar-top label — 2dp, £2.37M / £104.35K, falls back to full £ for
// anything under a thousand. Full precision stays in the click/hover tooltip.
function fmtGBPShortSigned(v) {
  if (v == null || Number.isNaN(v)) return '£0.00'
  const sign = v < 0 ? '-' : '+'
  const abs  = Math.abs(v)
  let out
  if (abs >= 1_000_000) out = `£${(abs / 1_000_000).toFixed(2)}M`
  else if (abs >= 1_000) out = `£${(abs / 1_000).toFixed(2)}K`
  else out = `£${abs.toFixed(2)}`
  return `${sign}${out}`
}

export function fmtPctSigned(v) {
  if (v == null || Number.isNaN(v)) return '0.00%'
  const p = (v * 100).toFixed(2)
  return v >= 0 ? `+${p}%` : `${p}%`
}

// UK convention: DD-MM-YYYY — matches SummaryStrip.jsx's fmtDate exactly
function fmtDate(str) {
  if (!str) return '—'
  const d = new Date(str + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')
}

// ---------------------------------------------------------------------------
// Banked Profit / Loss — drill-down modal
//
// The bridge: every figure in the Banked Profit/Loss row/card is the sum of
// profit_loss_amount across classified outbound legs recorded in the
// Capital Transfers and Darwinex (Internal) Transfers ledgers. This modal
// reads those SAME two tables (same React Query keys the ledger tabs use —
// 'capital_transfers' / 'internal_transfers' / 'pods' / 'strategies_all' —
// so the breakdown is always the underlying ledger, never a separate copy,
// and picks up new/edited entries the moment those ledgers invalidate).
//
// Only the NET total is shown on the overview cards/table. This modal is
// the only place the individual profit/loss legs are listed, each colour-
// coded by sign — green for a profit leg, red for a loss leg.
// ---------------------------------------------------------------------------

export function BankedProfitModal({ onClose }) {
  const isMobile = useIsMobile()
  const { data: capTransfers = [] } = useQuery({
    queryKey: ['capital_transfers'], queryFn: fetchCapitalTransfers, staleTime: 30_000,
  })
  const { data: intTransfers = [] } = useQuery({
    queryKey: ['internal_transfers'], queryFn: fetchInternalTransfers, staleTime: 30_000,
  })
  const { data: pods = [] } = useQuery({
    queryKey: ['pods'], queryFn: fetchPods, staleTime: 60_000,
  })
  const { data: strategies = [] } = useQuery({
    queryKey: ['strategies_all'], queryFn: () => fetchStrategies(), staleTime: 60_000,
  })
  const strategiesById = Object.fromEntries(strategies.map(s => [s.id, s]))
  const podsById       = Object.fromEntries(pods.map(p => [p.id, p]))
  // Reuses the same cached query the Portfolio page already fetches (SI /
  // since-inception window) — just for each strategy's authoritative
  // kpis.total_pnl, to show alongside a closed strategy's return legs below.
  const { data: portfolioData } = usePortfolio('SI')
  const strategyKpisById = Object.fromEntries(
    (portfolioData?.strategies ?? []).map(s => [Number(String(s.entity_id).replace('strategy_', '')), s.kpis])
  )

  // Capital Transfers — classifiable leg is Strategy → Wallet
  const capRows = capTransfers
    .filter(t => t.profit_loss_amount != null && t.from_type === 'strategy' && t.to_type === 'wallet')
    .map(t => {
      const strat = strategiesById[t.from_id]
      const pod   = strat ? podsById[strat.pod_id] : null
      // Closed/Inactive strategy with a watermark/split (e.g. NEWS-01): the
      // ledger leg's profit_loss_amount is the RAW cash physically moved
      // (bookkeeping necessity, mirrors §12.3), not Chase's split-adjusted
      // economic pnl. Same treatment as Darwinex's isClosingReturn below —
      // tag it neutrally and show the strategy's own realized total_pnl
      // (already watermark-adjusted by the backend aggregator) instead of
      // summing the raw leg into Total Profit/Total Loss.
      const isClosingReturn = strat && (strat.status === 'Closed' || strat.status === 'Inactive')
      return {
        id: `cap-${t.id}`, date: t.transfer_date, notes: t.notes,
        sourceLabel: strat?.name ?? `Strategy ${t.from_id}`, sourceColor: pod?.color || '#6366f1',
        amount: t.amount, capitalReturn: t.capital_return_amount, profitLoss: t.profit_loss_amount,
        isClosingReturn,
        linkedStrategyId: strat?.id,
        strategyPnl: strat ? strategyKpisById[strat.id]?.total_pnl : undefined,
      }
    })

  // Darwinex (Internal) Transfers — classifiable leg is Account → Wallet.
  // brokerage_account -> strategy lookup, so a closed strategy's return legs
  // can be flagged (see isClosingReturn below).
  const strategyByAccount = Object.fromEntries(
    strategies.filter(s => s.brokerage_account).map(s => [s.brokerage_account, s])
  )
  const intRows = intTransfers
    .filter(t => t.profit_loss_amount != null && t.from_account !== 'Wallet' && t.to_account === 'Wallet')
    .map(t => {
      const linkedStrategy = strategyByAccount[t.from_account]
      return {
        id: `int-${t.id}`, date: t.transfer_date, notes: t.notes,
        sourceLabel: t.from_account, sourceColor: '#F59E0B',
        amount: t.amount, capitalReturn: t.capital_return_amount, profitLoss: t.profit_loss_amount,
        // Closed-strategy return legs carry profit_loss_amount = the FULL
        // cash amount by convention (needed so Total P&L/ROI reconcile
        // against the frozen Capital Invested baseline — see §12.3) — that
        // is a bookkeeping necessity, not a claim the leg is trading profit.
        // Tag these neutrally instead of "Profit"/"Loss" so the audit trail
        // never implies a closed strategy's principal coming back is a gain.
        isClosingReturn: linkedStrategy?.status === 'Closed',
        linkedStrategyId: linkedStrategy?.id,
        strategyPnl: linkedStrategy ? strategyKpisById[linkedStrategy.id]?.total_pnl : undefined,
      }
    })

  const rows = [...capRows, ...intRows].sort((a, b) => (a.date < b.date ? 1 : -1))
  // One signed contribution per ordinary leg, but a closed strategy counts
  // ONCE (its true realized P&L via kpis.total_pnl) — NOT once per return
  // leg. Summing raw profitLoss across every leg would double/triple-count
  // a closed strategy's gross-cash bookkeeping figure (§9) — e.g. Chase1's
  // two return legs both carry large positive profit_loss_amount values
  // that individually mean nothing; only the strategy-level total_pnl
  // (already correct, from the backend aggregator) is the real number.
  const ordinaryContribs = rows.filter(r => !r.isClosingReturn).map(r => r.profitLoss)
  const closedStrategyIds = [...new Set(rows.filter(r => r.isClosingReturn).map(r => r.linkedStrategyId))]
  const closedContribs    = closedStrategyIds.map(id => strategyKpisById[id]?.total_pnl ?? 0)
  const contribs           = [...ordinaryContribs, ...closedContribs]
  const round2 = v => Math.round(v * 100) / 100
  const totalProfit = round2(contribs.filter(v => v > 0).reduce((s, v) => s + v, 0))
  const totalLoss    = round2(contribs.filter(v => v < 0).reduce((s, v) => s + v, 0))   // negative
  const netTotal      = round2(totalProfit + totalLoss)
  const netColor      = netTotal >= 0 ? '#34D399' : '#F87171'

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: isMobile ? 8 : 16,
      }}
      onClick={onClose}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} />
      <div
        style={{
          position: 'relative', zIndex: 10,
          width: isMobile ? '92vw' : '100%', maxWidth: isMobile ? '92vw' : 640,
          maxHeight: isMobile ? '90vh' : '85vh',
          overflow: 'hidden', background: '#0D1117', border: '1px solid rgba(148,163,184,0.2)',
          borderRadius: 16, boxShadow: '0 25px 80px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid rgba(148,163,184,0.15)', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#F1F5F9' }}>Banked Profit / Loss — Breakdown</div>
            <div style={{ fontSize: 10.5, color: TXT_SOFT, marginTop: 2 }}>
              Every classified withdrawal leg from Capital Transfers &amp; Darwinex Transfers
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: 8, background: 'rgba(148,163,184,0.12)',
              border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            <X size={14} color={TXT_SOFT} />
          </button>
        </div>

        {/* Totals strip — Profit / Loss shown separately, Net still the headline */}
        <div style={{
          padding: '12px 20px', background: hexToRgba(netColor, 0.08),
          borderBottom: '1px solid rgba(148,163,184,0.1)', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: TXT_SUB, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Net Total ({rows.length} {rows.length === 1 ? 'entry' : 'entries'})
            </span>
            <span style={{ fontSize: 16, fontWeight: 800, color: netColor, fontVariantNumeric: 'tabular-nums' }}>
              {fmtGBPSigned(netTotal)}
            </span>
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 10,
            paddingTop: 10, borderTop: '1px solid rgba(148,163,184,0.1)',
          }}>
            <div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: TXT_SOFT, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                Total Profit
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#34D399', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                {fmtGBPSigned(totalProfit)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: TXT_SOFT, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                Total Loss
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#F87171', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                {fmtGBPSigned(totalLoss)}
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable list */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '10px 20px 18px' }}>
          {rows.length === 0 && (
            <div style={{ fontSize: 12, color: TXT_SOFT, textAlign: 'center', padding: '30px 0' }}>
              No classified withdrawals yet.
            </div>
          )}
          {rows.map(r => {
            const isProfit = r.profitLoss > 0
            const isFlat   = r.profitLoss === 0
            // Closed-strategy return legs: profit_loss_amount here is a
            // bookkeeping figure (the full cash amount, so Total P&L/ROI
            // reconcile against the frozen Capital Invested baseline — see
            // README §12.3) — NOT a claim this leg was trading profit. Tag
            // it neutrally and show the strategy's own realized P&L instead,
            // so the audit trail never implies a closed strategy's returned
            // principal was a gain.
            const tagColor = r.isClosingReturn ? '#94A3B8' : (isFlat ? '#94A3B8' : (isProfit ? '#34D399' : '#F87171'))
            return (
              <div key={r.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', gap: 12,
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#E2E8F0' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.sourceColor, flexShrink: 0 }} />
                    {r.sourceLabel}
                  </span>
                  <span style={{
                    display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', gap: 4,
                    padding: '3px 9px', borderRadius: 8, fontSize: 10, fontWeight: 700, color: tagColor,
                    background: hexToRgba(tagColor, 0.12), border: `1px solid ${hexToRgba(tagColor, 0.35)}`,
                  }}>
                    {r.isClosingReturn
                      ? <>Capital Return {fmtGBP(Math.abs(r.profitLoss))}</>
                      : <>
                          {isFlat ? null : (isProfit ? <TrendingUp size={10} /> : <TrendingDown size={10} />)}
                          {isFlat ? 'No Profit/Loss' : (isProfit ? 'Profit' : 'Loss')} {fmtGBP(Math.abs(r.profitLoss))}
                        </>}
                  </span>
                  {r.isClosingReturn && (
                    <span style={{ fontSize: 10.5, color: TXT_SOFT }}>
                      Strategy closed — realized P&amp;L{' '}
                      <span style={{ fontWeight: 700, color: (r.strategyPnl ?? 0) >= 0 ? '#34D399' : '#F87171' }}>
                        {r.strategyPnl != null ? fmtGBPSigned(r.strategyPnl) : '—'}
                      </span>{' '}(see Strategy card)
                    </span>
                  )}
                  {r.notes && (
                    <span style={{ fontSize: 10.5, color: TXT_SOFT }}>{r.notes}</span>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, color: '#CBD5E1', fontSize: 12 }}>{fmtDate(r.date)}</div>
                  {!r.isClosingReturn && (
                    <div style={{ marginTop: 3, fontSize: 11, color: TXT_SOFT }}>
                      Return {fmtGBP(r.capitalReturn)}
                    </div>
                  )}
                  <div style={{ marginTop: 2, fontSize: 12, fontWeight: 700, color: tagColor, fontVariantNumeric: 'tabular-nums' }}>
                    {r.isClosingReturn ? fmtGBP(r.amount) : fmtGBPSigned(r.profitLoss)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Core computation — shared by hero strip, pod cards and strategy cards
// kpis: { initial_investment, current_equity, total_pnl, performance, ... }
// ---------------------------------------------------------------------------

export function computeCapitalMetrics(kpis = {}) {
  const invested    = kpis.initial_investment || 0
  const equity      = kpis.current_equity     || 0
  // bankedGross — the bookkeeping figure Total P&L's formula needs
  // internally to reconcile against the frozen Capital Invested baseline
  // (see README §12.3/§9). For a CLOSED strategy this equals the FULL cash
  // amount ever returned, not just true profit — it's not meant to be
  // displayed as-is. Used ONLY for pnl/allocated below, never rendered.
  const bankedGross = kpis.banked_profit ?? 0
  // banked — what's actually DISPLAYED as "Banked Profit/Loss". Prefers the
  // backend's banked_profit_true (the real realized P&L — for a closed
  // strategy that's its aggregator's own pnl, e.g. §12's Chase1 figure;
  // for everything else it's identical to bankedGross, a genuine profit
  // skim). Falls back to bankedGross if the backend response predates this
  // field. Deliberately NOT used in the pnl calculation below — see above.
  const banked      = kpis.banked_profit_true ?? bankedGross
  // Capital Allocated = Invested − total cash withdrawn (capital-return AND
  // profit portions both reduce it — money that left is no longer "still
  // out", whatever it was). Backend's capital_allocated already reflects
  // this; the fallback here mirrors the same formula for safety (using the
  // gross figure, matching how the backend derives it).
  const allocated = kpis.capital_allocated != null ? kpis.capital_allocated : (invested - bankedGross)
  // Total P&L = Current Equity + Banked Profit (gross) − Total Capital
  // Invested. Deliberately uses bankedGross, NOT the displayed `banked`
  // (banked_profit_true) — for a closed strategy those differ on purpose
  // (see above), and only the gross figure reconciles correctly against
  // the frozen invested baseline. Deliberately NOT kpis.total_pnl either
  // (that field is the broker's raw live snapshot PnL for an open/live
  // strategy — it excludes profit already withdrawn, and would show a
  // strategy as "down" right after a profitable withdrawal). Also
  // deliberately NOT "equity − allocated": that shortcut only matches this
  // formula when nothing has been returned as pure capital — once a
  // capital-return withdrawal exists (e.g. Darwinex), the two diverge and
  // this equity+bankedGross-invested form is the correct one.
  const pnl       = equity + bankedGross - invested
  const roi       = invested !== 0 ? pnl / invested : 0
  return { invested, banked, allocated, equity, pnl, roi }
}

// ---------------------------------------------------------------------------
// Hero card — big 6-box strip
// ---------------------------------------------------------------------------

function HeroCard({ icon: Icon, color, label, value, sub, onClick, isMobile }) {
  return (
    <div
      className="ov-card cap-hero-card"
      style={{
        '--accent': color, '--accent-soft': hexToRgba(color, 0.22),
        cursor: onClick ? 'pointer' : 'default',
        minHeight: isMobile ? 120 : undefined,
        padding: isMobile ? '13px 14px' : undefined,
      }}
      onClick={onClick}
    >
      <div style={{
        width: isMobile ? 32 : 44, height: isMobile ? 32 : 44, borderRadius: isMobile ? 9 : 12, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `radial-gradient(circle at 32% 28%, ${hexToRgba(color, 0.38)}, ${hexToRgba(color, 0.10)})`,
        border: `1px solid ${hexToRgba(color, 0.28)}`,
        boxShadow: `0 0 16px 1px ${hexToRgba(color, 0.18)}`,
        marginBottom: isMobile ? 8 : 14,
      }}>
        <Icon size={isMobile ? 16 : 22} color={color} strokeWidth={2.1} />
      </div>
      <div style={{
        fontSize: isMobile ? 10 : 12, fontWeight: 600, color: TXT_SUB, marginBottom: isMobile ? 4 : 8,
        letterSpacing: '0.2px',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: isMobile ? 16 : 24, fontWeight: 800, color, lineHeight: 1.15,
        fontVariantNumeric: 'tabular-nums', marginBottom: isMobile ? 4 : 8,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {value}
      </div>
      <div style={{
        fontSize: isMobile ? 8.5 : 10.5, color: TXT_SOFT, lineHeight: 1.35,
        display: isMobile ? '-webkit-box' : 'block',
        WebkitLineClamp: isMobile ? 2 : undefined,
        WebkitBoxOrient: isMobile ? 'vertical' : undefined,
        overflow: isMobile ? 'hidden' : 'visible',
      }}>
        {sub}
      </div>
    </div>
  )
}

export function CapitalOverviewHero({ kpis, isMobile }) {
  const { invested, banked, allocated, equity, pnl, roi } = computeCapitalMetrics(kpis)
  const pnlPos = pnl >= 0
  const roiPos = roi >= 0
  const [showBankedModal, setShowBankedModal] = useState(false)

  const cards = [
    {
      icon: Wallet, color: '#38BDF8', label: 'Total Capital Invested',
      value: fmtGBP(invested),
      sub: 'Total capital historically invested across the portfolio.',
    },
    {
      icon: banked >= 0 ? Landmark : TrendingDown, color: banked >= 0 ? '#34D399' : '#F87171', label: 'Banked Profit / Loss',
      value: fmtGBP(banked),
      sub: isMobile
        ? 'Click for details →'
        : (banked >= 0
          ? 'Profit withdrawn and returned to Chase. Click for breakdown.'
          : 'Net realized loss on withdrawals — a closing withdrawal returned less than remaining allocated capital. Click for breakdown.'),
      onClick: () => setShowBankedModal(true),
    },
    {
      icon: PieChart, color: '#F59E0B', label: 'Capital Allocated',
      value: fmtGBP(allocated),
      sub: "Chase's original capital still deployed across the portfolio.",
    },
    {
      icon: Activity, color: '#A78BFA', label: 'Current Equity',
      value: fmtGBP(equity),
      sub: "Current value of Chase's economic interest across all investments.",
    },
    {
      icon: pnlPos ? TrendingUp : TrendingDown, color: pnlPos ? '#34D399' : '#F87171', label: 'Total P&L',
      value: fmtGBPSigned(pnl),
      sub: 'Total profit or loss, including both banked and current performance.',
    },
    {
      icon: Percent, color: roiPos ? '#34D399' : '#F87171', label: 'Total ROI',
      value: fmtPctSigned(roi),
      sub: 'Total P&L as a percentage of total capital invested.',
    },
  ]

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? 'repeat(2, minmax(0,1fr))' : 'repeat(6, minmax(0,1fr))',
      gap: 12,
    }}>
      {cards.map(c => <HeroCard key={c.label} {...c} isMobile={isMobile} />)}
      {showBankedModal && <BankedProfitModal onClose={() => setShowBankedModal(false)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Capital Flow Summary — table
// ---------------------------------------------------------------------------

export function CapitalFlowTable({ kpis }) {
  const { invested, banked, allocated, equity, pnl } = computeCapitalMetrics(kpis)
  const pct = v => invested !== 0 ? `${((v / invested) * 100).toFixed(2)}%` : '—'
  const [showBankedModal, setShowBankedModal] = useState(false)

  const rows = [
    { dot: '#38BDF8', label: 'Total Capital Invested',          amount: invested,  pct: pct(invested) },
    { dot: banked >= 0 ? '#34D399' : '#F87171', label: 'Banked Profit / Loss (Withdrawn)', amount: banked, pct: pct(banked), signed: true, negativeAware: true, onClick: () => setShowBankedModal(true) },
    { dot: '#F59E0B', label: 'Capital Allocated (Still Out)',   amount: allocated, pct: pct(allocated) },
    { dot: '#A78BFA', label: 'Current Equity (Economic Interest)', amount: equity, pct: pct(equity) },
    { dot: pnl >= 0 ? '#34D399' : '#F87171', label: 'Total P&L', amount: pnl, pct: pct(pnl), bold: true, signed: true, negativeAware: true },
  ]

  return (
    <div className="glass-table" style={{ padding: '16px 18px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#F1F5F9', marginBottom: 14 }}>
        Capital Flow Summary
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <th style={{ textAlign: 'left', padding: '10px 12px 8px 14px', fontSize: 10, color: TXT_SOFT, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Description</th>
              <th style={{ textAlign: 'right', padding: '10px 12px 8px', fontSize: 10, color: TXT_SOFT, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Amount (£)</th>
              <th style={{ textAlign: 'right', padding: '10px 14px 8px 12px', fontSize: 10, color: TXT_SOFT, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>% of Invested</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={r.label}
                onClick={r.onClick}
                style={{
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  cursor: r.onClick ? 'pointer' : 'default',
                }}
              >
                <td style={{ padding: '10px 12px 10px 14px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: r.bold ? 700 : 500, color: r.bold ? '#F1F5F9' : '#CBD5E1' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.dot, flexShrink: 0 }} />
                    {r.label}
                  </span>
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: r.bold ? 700 : 500, fontVariantNumeric: 'tabular-nums', color: r.negativeAware ? (r.amount >= 0 ? '#34D399' : '#F87171') : '#E2E8F0' }}>
                  {r.signed ? fmtGBPSigned(r.amount) : fmtGBP(r.amount)}
                </td>
                <td style={{ padding: '10px 14px 10px 12px', textAlign: 'right', color: TXT_SUB, fontVariantNumeric: 'tabular-nums' }}>
                  {r.pct}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showBankedModal && <BankedProfitModal onClose={() => setShowBankedModal(false)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Capital at a Glance — bar chart with dashed connector + interactive tooltip
// ---------------------------------------------------------------------------

function GlanceTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{
      background: 'rgba(13,27,46,0.95)', border: '1px solid rgba(255,255,255,0.1)',
      backdropFilter: 'blur(8px)', borderRadius: 8, padding: '9px 13px', fontSize: 11.5,
    }}>
      <div style={{ color: TXT_SUB, marginBottom: 4 }}>{d.fullName}</div>
      <div style={{ fontWeight: 700, color: d.amount >= 0 ? '#34D399' : '#F87171' }}>
        {fmtGBPSigned(d.amount)}
      </div>
    </div>
  )
}

// Multi-line, centre-aligned X-axis tick — wraps on '\n' instead of overlapping
function WrappedAxisTick({ x, y, payload, fontSize = 9.5 }) {
  const lines = String(payload.value).split('\n')
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" fontSize={fontSize} fill={TXT_SOFT}>
        {lines.map((line, i) => (
          <tspan key={i} x={0} dy={i === 0 ? 12 : (fontSize + 1.5)}>{line}</tspan>
        ))}
      </text>
    </g>
  )
}

export function CapitalAtGlanceChart({ kpis, height = 300, isMobile = false }) {
  const { invested, banked, allocated, equity, pnl } = computeCapitalMetrics(kpis)

  // Shorter category labels on mobile — full names stay on desktop.
  const data = isMobile
    ? [
        { name: 'Capital\nInvested',   fullName: 'Total Capital Invested',           amount: invested,  color: '#38BDF8' },
        { name: 'Banked\nP/L',         fullName: 'Banked Profit / Loss (Withdrawn)', amount: banked,    color: banked >= 0 ? '#34D399' : '#F87171' },
        { name: 'Capital\nAllocated',  fullName: 'Capital Allocated (Still Out)',    amount: allocated, color: '#F59E0B' },
        { name: 'Current\nEquity',     fullName: 'Current Equity (Economic Interest)', amount: equity,  color: '#A78BFA' },
        { name: 'Total\nP&L',          fullName: 'Total P&L',                        amount: pnl,       color: pnl >= 0 ? '#34D399' : '#F87171' },
      ]
    : [
        { name: 'Total Capital\nInvested',       fullName: 'Total Capital Invested',        amount: invested,  color: '#38BDF8' },
        { name: 'Banked Profit/Loss\n(Withdrawn)', fullName: 'Banked Profit / Loss (Withdrawn)', amount: banked, color: banked >= 0 ? '#34D399' : '#F87171' },
        { name: 'Capital Allocated\n(Still Out)',fullName: 'Capital Allocated (Still Out)', amount: allocated, color: '#F59E0B' },
        { name: 'Current Equity\n(Economic Interest)', fullName: 'Current Equity (Economic Interest)', amount: equity, color: '#A78BFA' },
        { name: 'Total P&L',                     fullName: 'Total P&L',                     amount: pnl,       color: pnl >= 0 ? '#34D399' : '#F87171' },
      ]

  return (
    <div className="glass-table" style={{ padding: isMobile ? '14px 12px' : '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
        <div style={{ fontSize: isMobile ? 12 : 13, fontWeight: 700, color: '#F1F5F9' }}>Capital at a Glance</div>
        <div style={{ display: 'flex', gap: isMobile ? 10 : 14, fontSize: isMobile ? 9.5 : 10.5, color: TXT_SUB }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: '#34D399', display: 'inline-block' }} /> Increase
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: '#F87171', display: 'inline-block' }} /> Decrease
          </span>
        </div>
      </div>
      {isMobile && (
        <div style={{ fontSize: 9.5, color: TXT_MUTED, marginBottom: 6 }}>
          Tap a bar for the exact value
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          margin={isMobile ? { top: 26, right: 4, left: 0, bottom: 10 } : { top: 20, right: 8, left: 0, bottom: 12 }}
          barCategoryGap={isMobile ? '18%' : '28%'}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#1E3A5F" strokeOpacity={0.4} />
          <XAxis
            dataKey="name" height={isMobile ? 32 : 40}
            tick={<WrappedAxisTick fontSize={isMobile ? 8 : 9.5} />}
            axisLine={false} tickLine={false} interval={0}
          />
          <YAxis
            tickFormatter={fmtGBPAxis} tick={{ fill: TXT_MUTED, fontSize: isMobile ? 8.5 : 10 }}
            axisLine={false} tickLine={false} width={isMobile ? 38 : 48}
          />
          <ReferenceLine y={0} stroke="#1E3A5F" strokeWidth={1} />
          <Tooltip content={<GlanceTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={isMobile ? 44 : 64}>
            {data.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.88} />)}
            <LabelList
              dataKey="amount"
              position="top"
              formatter={fmtGBPShortSigned}
              style={{ fill: '#E0E6ED', fontSize: isMobile ? 8.5 : 10, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Narrative info box
// ---------------------------------------------------------------------------

export function CapitalInfoBox({ kpis }) {
  const { invested, banked, allocated, equity, pnl, roi } = computeCapitalMetrics(kpis)
  const pnlColor    = pnl >= 0 ? '#34D399' : '#F87171'
  const roiColor    = roi >= 0 ? '#34D399' : '#F87171'
  const bankedColor = banked >= 0 ? '#34D399' : '#F87171'

  return (
    <div className="glass-panel" style={{
      padding: '14px 18px', display: 'flex', gap: 24, flexWrap: 'wrap',
      alignItems: 'flex-start',
    }}>
      <Info size={16} color="#38BDF8" style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', flex: 1 }}>
        <div style={{ fontSize: 12.5, color: TXT_SUB, lineHeight: 1.7, flex: '1 1 320px' }}>
          We invested <b style={{ color: '#38BDF8' }}>{fmtGBP(invested)}</b>. We have{' '}
          {banked >= 0 ? 'banked' : 'realized a net loss of'}{' '}
          <b style={{ color: bankedColor }}>{fmtGBP(Math.abs(banked))}</b>
          {banked >= 0 ? ' of profit.' : ' on withdrawals.'}{' '}
          <b style={{ color: '#F59E0B' }}>{fmtGBP(allocated)}</b> of our original capital remains
          out and is currently worth <b style={{ color: '#A78BFA' }}>{fmtGBP(equity)}</b>.
        </div>
        <div style={{ fontSize: 12.5, color: TXT_SUB, lineHeight: 1.7, flex: '1 1 280px' }}>
          We have made a total profit of <b style={{ color: pnlColor }}>{fmtGBPSigned(pnl)}</b>,
          representing a <b style={{ color: roiColor }}>{fmtPctSigned(roi)}</b> return on our
          original capital.
        </div>
      </div>
    </div>
  )
}
