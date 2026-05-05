// frontend/src/components/FundLedgerCard.jsx

import { useState, useEffect, useRef } from "react";
import { X, TrendingUp, PoundSterling, Calendar, ChevronRight, Info } from "lucide-react";

// ---------------------------------------------------------------------------
// CONFIGURABLE
// ---------------------------------------------------------------------------
const COUNT_DURATION_MS = 2000;

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function fmt$(val, decimals = 0) {
  if (val === null || val === undefined) return "—";
  const abs  = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 999_950) return `${sign}£${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)   return `${sign}£${(abs / 1_000).toFixed(1)}K`;
  return `${sign}£${abs.toFixed(decimals)}`;
}

function fmtPct(val, decimals = 2) {
  if (val === null || val === undefined) return "—";
  const sign = val >= 0 ? "+" : "";
  return `${sign}${(val * 100).toFixed(decimals)}%`;
}

function fmtDate(str) {
  if (!str) return "—";
  const d = new Date(str + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Count-up animation hook
// ---------------------------------------------------------------------------

function useCountUp(target, duration = COUNT_DURATION_MS) {
  const [value, setValue] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (target === null || target === undefined) return;
    const start = performance.now();

    const tick = (now) => {
      const elapsed  = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased    = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setValue(target * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

// ---------------------------------------------------------------------------
// PeriodRow — single sub-period row inside the modal
// ---------------------------------------------------------------------------

function PeriodRow({ period, index }) {
  const isPositive = period.pnl >= 0;
  const pnlColor   = isPositive ? "text-emerald-400" : "text-rose-400";
  const retColor   = isPositive ? "text-emerald-400" : "text-rose-400";
  const badge      = isPositive
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
    : "bg-rose-500/15 text-rose-400 border-rose-500/25";

  const cashFlowSign = period.cash_flow_at_start >= 0 ? "+" : "";
  const cashFlowColor = period.cash_flow_at_start >= 0
    ? "text-sky-400" : "text-amber-400";

  return (
    <div className="rounded-xl border border-slate-700/40 bg-slate-800/30 overflow-hidden mb-3">
      {/* Period header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-700/20 border-b border-slate-700/30">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-slate-600/40 flex items-center justify-center">
            <span className="text-[10px] font-bold text-slate-300">P{period.period_num}</span>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <Calendar size={11} className="text-slate-500" />
              <span className="text-[11px] font-semibold text-slate-300">
                {fmtDate(period.start_date)}
              </span>
              <ChevronRight size={10} className="text-slate-600" />
              <span className="text-[11px] font-semibold text-slate-300">
                {fmtDate(period.end_date)}
              </span>
            </div>
          </div>
        </div>
        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${badge}`}>
          {fmtPct(period.period_return)}
        </span>
      </div>

      {/* Period stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-slate-700/30">
        <div className="px-4 py-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Start AUM</p>
          <p className="text-sm font-bold text-slate-200 tabular-nums">
            {fmt$(period.start_aum)}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Cash Flow</p>
          <p className={`text-sm font-bold tabular-nums ${cashFlowColor}`}>
            {cashFlowSign}{fmt$(period.cash_flow_at_start)}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">End AUM</p>
          <p className="text-sm font-bold text-slate-200 tabular-nums">
            {fmt$(period.end_aum)}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">PnL</p>
          <p className={`text-sm font-bold tabular-nums ${pnlColor}`}>
            {period.pnl >= 0 ? "+" : ""}{fmt$(period.pnl)}
          </p>
        </div>
      </div>

      {/* Annualised row */}
      {period.annualised_return !== null && period.annualised_return !== undefined && (
        <div className="px-4 py-2 bg-slate-700/10 border-t border-slate-700/20 flex items-center gap-2">
          <Info size={10} className="text-slate-600" />
          <span className="text-[10px] text-slate-500">
            Annualised return:{" "}
            <span className={`font-semibold ${retColor}`}>
              {fmtPct(period.annualised_return)}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Totals Row — bottom of modal
// ---------------------------------------------------------------------------

function TotalsRow({ data }) {
  const twrColor = data.twr >= 0 ? "text-emerald-400" : "text-rose-400";
  const pnlColor = data.total_pnl >= 0 ? "text-emerald-400" : "text-rose-400";

  return (
    <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 overflow-hidden">
      <div className="px-4 py-2.5 bg-sky-500/10 border-b border-sky-500/20">
        <span className="text-[10px] font-bold text-sky-400 uppercase tracking-widest">
          Fund Total — Since Inception
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-sky-500/15">
        <div className="px-4 py-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Initial AUM</p>
          <p className="text-sm font-bold text-slate-200 tabular-nums">
            {fmt$(data.initial_aum)}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Current AUM</p>
          <p className="text-sm font-bold text-slate-200 tabular-nums">
            {fmt$(data.current_aum)}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Total PnL</p>
          <p className={`text-sm font-bold tabular-nums ${pnlColor}`}>
            {data.total_pnl >= 0 ? "+" : ""}{fmt$(data.total_pnl)}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">TWR</p>
          <p className={`text-sm font-bold tabular-nums ${twrColor}`}>
            {fmtPct(data.twr)}
          </p>
        </div>
      </div>
      {/* TWR explanation */}
      <div className="px-4 py-2.5 border-t border-sky-500/15 flex items-start gap-2">
        <Info size={11} className="text-sky-500/60 mt-0.5 flex-shrink-0" />
        <p className="text-[10px] text-slate-500 leading-relaxed">
          <span className="text-sky-400/80 font-semibold">Time-Weighted Return (TWR)</span> —
          chain-links each sub-period return, eliminating the impact of when capital
          was added or withdrawn. Industry-standard performance metric.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal overlay
// ---------------------------------------------------------------------------

function LedgerModal({ data, onClose }) {
  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal panel */}
      <div
        className="relative z-10 w-full max-w-2xl max-h-[85vh] overflow-hidden
                   bg-[#0d1117] border border-slate-700/50 rounded-2xl
                   shadow-[0_25px_80px_rgba(0,0,0,0.6)]
                   flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4
                        border-b border-slate-700/40 flex-shrink-0">
          <div>
            <h2 className="text-sm font-bold text-slate-100 tracking-wide">
              Fund Performance Ledger
            </h2>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Inception: {fmtDate(data.inception_date)} · {data.num_periods} period{data.num_periods !== 1 ? "s" : ""} · Updated {fmtDate(data.last_updated)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-700/50 hover:bg-slate-600/50
                       flex items-center justify-center transition-colors"
          >
            <X size={14} className="text-slate-400" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 py-5
                        scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">

          {/* Sub-periods */}
          <div className="mb-4">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3">
              Sub-Period Breakdown
            </p>
            {data.periods.map((p, i) => (
              <PeriodRow key={p.period_num} period={p} index={i} />
            ))}
          </div>

          {/* Totals */}
          <TotalsRow data={data} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FundLedgerCard — main export (collapsed card on dashboard)
// ---------------------------------------------------------------------------

export default function FundLedgerCard({ data, loading }) {
  const [modalOpen, setModalOpen] = useState(false);

  const twr      = data?.twr       ?? 0;
  const totalPnl = data?.total_pnl ?? 0;
  const curAum   = data?.current_aum ?? 0;
  const periods  = data?.num_periods ?? 0;

  const animTWR = useCountUp(twr);
  const animPnl = useCountUp(totalPnl);
  const animAum = useCountUp(curAum);

  const isPositive = twr >= 0;
  const twrColor   = isPositive ? "text-emerald-400" : "text-rose-400";
  const pnlColor   = totalPnl >= 0 ? "text-emerald-400" : "text-rose-400";
  const glow       = isPositive
    ? "shadow-[0_0_24px_rgba(52,211,153,0.10)]"
    : "shadow-[0_0_24px_rgba(239,68,68,0.10)]";
  const borderCol  = isPositive ? "border-emerald-500/20" : "border-rose-500/20";

  if (loading) {
    return (
      <div className="bg-[#0d1117]/80 backdrop-blur-sm border border-slate-700/40
                      rounded-2xl p-5 animate-pulse flex-1">
        <div className="h-4 bg-slate-700/50 rounded w-32 mb-3" />
        <div className="h-10 bg-slate-700/50 rounded w-48 mb-4" />
        <div className="h-4 bg-slate-700/50 rounded w-24" />
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className={`bg-[#0d1117]/80 backdrop-blur-sm border ${borderCol} rounded-2xl
                    p-5 text-left w-full transition-all duration-300 ${glow}
                    hover:border-opacity-50 hover:scale-[1.01] group`}
      >
        {/* Top row */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center
              ${isPositive ? "bg-emerald-500/15" : "bg-rose-500/15"}`}>
              <TrendingUp size={17} className={twrColor} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-0.5">
                Fund Performance
              </p>
              <p className="text-[10px] text-slate-600">
                {periods} period{periods !== 1 ? "s" : ""} · Click for breakdown
              </p>
            </div>
          </div>

          <span className="text-[10px] font-semibold text-slate-600 group-hover:text-sky-400
                           transition-colors uppercase tracking-widest">
            Details →
          </span>
        </div>

        {/* TWR — headline metric */}
        <div className="mb-4">
          <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">
            Time-Weighted Return (TWR)
          </p>
          <div className={`text-4xl font-black tabular-nums tracking-tight ${twrColor}`}>
            {(animTWR * 100).toFixed(2)}%
          </div>
          <p className="text-[10px] text-slate-600 mt-1">
            Chain-linked · eliminates cash flow timing distortion
          </p>
        </div>

        {/* Secondary stats */}
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-700/30">
          <div>
            <p className="text-[10px] text-slate-500 mb-1 flex items-center gap-1">
              <PoundSterling size={10} /> Total PnL
            </p>
            <p className={`text-sm font-bold tabular-nums ${pnlColor}`}>
              {totalPnl >= 0 ? "+" : ""}{fmt$(animPnl)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 mb-1 flex items-center gap-1">
              <PoundSterling size={10} /> Current AUM
            </p>
            <p className="text-sm font-bold text-slate-200 tabular-nums">
              {fmt$(animAum)}
            </p>
          </div>
        </div>
      </button>

      {/* Modal */}
      {modalOpen && (
        <LedgerModal data={data} onClose={() => setModalOpen(false)} />
      )}
    </>
  );
}

