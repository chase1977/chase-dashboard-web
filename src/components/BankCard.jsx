// frontend/src/components/BankCard.jsx

import { useState, useEffect, useRef } from "react";
import { ArrowDownLeft, ArrowUpRight, Landmark } from "lucide-react";

// ---------------------------------------------------------------------------
// CONFIGURABLE
// ---------------------------------------------------------------------------
const COUNT_DURATION_MS = 1800;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(val, decimals = 0) {
  if (val === null || val === undefined) return "—";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : val > 0 ? "+" : "";
  if (abs >= 999_950) return `${sign}£${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)   return `${sign}£${(abs / 1_000).toFixed(2)}K`;
  return `${sign}£${abs.toFixed(2)}`;
}

function useCountUp(target, duration = COUNT_DURATION_MS) {
  const [value, setValue] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (target === null || target === undefined) return;
    const start = performance.now();
    const from = 0;

    const tick = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(from + (target - from) * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

// ---------------------------------------------------------------------------
// FlowRow — individual deposit / withdrawal line item
// ---------------------------------------------------------------------------

function FlowRow({ event }) {
  const isDeposit    = event.event_type === "deposit";
  const isWithdrawal = event.event_type === "withdrawal";
  const isInternal   = !isDeposit && !isWithdrawal;

  const color = isDeposit
    ? "text-emerald-400"
    : isWithdrawal
    ? "text-rose-400"
    : "text-slate-400";

  const bg = isDeposit
    ? "bg-emerald-500/10 border-emerald-500/20"
    : isWithdrawal
    ? "bg-rose-500/10 border-rose-500/20"
    : "bg-slate-500/10 border-slate-500/20";

  const Icon = isDeposit ? ArrowDownLeft : isWithdrawal ? ArrowUpRight : null;
  const label = isDeposit ? "Deposit" : isWithdrawal ? "Withdrawal"
    : event.event_type === "pod_allocation" ? `→ ${event.pod_id}` : `← ${event.pod_id}`;

  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${bg} mb-1.5`}>
      <div className="flex items-center gap-2.5 min-w-0">
        {Icon && (
          <div className={`flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center ${
            isDeposit ? "bg-emerald-500/20" : "bg-rose-500/20"
          }`}>
            <Icon size={13} className={color} />
          </div>
        )}
        {isInternal && (
          <div className="flex-shrink-0 w-6 h-6 rounded-md bg-slate-500/20 flex items-center justify-center">
            <span className="text-slate-400 text-[10px] font-bold">↔</span>
          </div>
        )}
        <div className="min-w-0">
          <span className="text-xs font-semibold text-slate-200 block truncate">{label}</span>
          {event.notes && (
            <span className="text-[10px] text-slate-500 block truncate">{event.notes}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 ml-3">
        <span className="text-[10px] text-slate-500 tabular-nums">{event.date}</span>
        <span className={`text-xs font-bold tabular-nums ${color}`}>
          {formatCurrency(event.amount)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BankCard — main export
// ---------------------------------------------------------------------------

export default function BankCard({ data, loading }) {
  const [expanded, setExpanded] = useState(false);

  const bankBalance    = data?.bank_balance    ?? 0;
  const totalDeposited = data?.total_deposited ?? 0;
  const totalWithdrawn = data?.total_withdrawn ?? 0;
  const events         = data?.events ?? [];

  const animatedBalance  = useCountUp(bankBalance);
  const animatedDeposits = useCountUp(totalDeposited);
  const animatedWithdraw = useCountUp(totalWithdrawn);

  const isPositive = bankBalance >= 0;
  const balanceColor = isPositive ? "text-emerald-400" : "text-rose-400";
  const glowColor    = isPositive
    ? "shadow-[0_0_20px_rgba(52,211,153,0.12)]"
    : "shadow-[0_0_20px_rgba(239,68,68,0.12)]";
  const borderColor  = isPositive ? "border-emerald-500/20" : "border-rose-500/20";

  if (loading) {
    return (
      <div className="bg-[#0d1117]/80 backdrop-blur-sm border border-slate-700/40 rounded-2xl p-5 animate-pulse">
        <div className="h-4 bg-slate-700/50 rounded w-24 mb-3" />
        <div className="h-8 bg-slate-700/50 rounded w-40" />
      </div>
    );
  }

  return (
    <div
      className={`bg-[#0d1117]/80 backdrop-blur-sm border ${borderColor} rounded-2xl
                  transition-all duration-300 ${glowColor} overflow-hidden`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between p-5 pb-4">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0
            ${isPositive ? "bg-emerald-500/15" : "bg-rose-500/15"}`}>
            <Landmark size={17} className={balanceColor} />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-0.5">
              Net Bank Position
            </p>
            <p className="text-[10px] text-slate-600">External flows only</p>
          </div>
        </div>

        <button
          onClick={() => setExpanded(v => !v)}
          className="text-[10px] font-semibold text-slate-500 hover:text-slate-300
                     transition-colors uppercase tracking-widest px-2 py-1 rounded-lg
                     hover:bg-slate-700/30 flex-shrink-0"
        >
          {expanded ? "Collapse" : "Ledger ↓"}
        </button>
      </div>

      {/* Balance */}
      <div className="px-5 pb-4">
        <div className={`text-3xl font-black tabular-nums tracking-tight ${balanceColor}`}>
          {formatCurrency(animatedBalance)}
        </div>

        {/* Deposits / Withdrawals mini stats */}
        <div className="flex gap-4 mt-3">
          <div className="flex items-center gap-1.5">
            <ArrowDownLeft size={12} className="text-emerald-400" />
            <span className="text-[11px] text-slate-500">Deposited</span>
            <span className="text-[11px] font-bold text-emerald-400 tabular-nums">
              {formatCurrency(animatedDeposits)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <ArrowUpRight size={12} className="text-rose-400" />
            <span className="text-[11px] text-slate-500">Withdrawn</span>
            <span className="text-[11px] font-bold text-rose-400 tabular-nums">
              {formatCurrency(animatedWithdraw)}
            </span>
          </div>
        </div>
      </div>

      {/* Expanded ledger */}
      {expanded && (
        <div className="border-t border-slate-700/30 px-4 py-4 max-h-64 overflow-y-auto
                        scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3">
            Event Log
          </p>
          {events.length === 0 && (
            <p className="text-xs text-slate-600 text-center py-4">No events recorded</p>
          )}
          {events.map(ev => (
            <FlowRow key={ev.event_id} event={ev} />
          ))}
        </div>
      )}
    </div>
  );
}
