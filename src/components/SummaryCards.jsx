// frontend/src/components/SummaryCards.jsx

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

// ─── API HELPERS ─────────────────────────────────────────────────────────────
const fetchPortfolio = () =>
  fetch("/api/portfolio/summary").then((r) => r.json());
const fetchLedger = () =>
  fetch("/api/portfolio/ledger").then((r) => r.json());
const fetchTWR = () =>
  fetch("/api/portfolio/twr-breakdown").then((r) => r.json());
const fetchEquity = () =>
  fetch("/api/portfolio/equity-curve").then((r) => r.json());

// ─── FORMATTERS ──────────────────────────────────────────────────────────────
const fmt = (v, decimals = 2) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-GB", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(v);

const fmtCcy = (v) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(v);

const fmtPct = (v) => (v == null ? "—" : `${fmt(v, 2)}%`);
const sign = (v) => (v >= 0 ? "+" : "");

// ─── MODAL SHELL ─────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl mx-4 rounded-2xl border border-white/10 bg-[#0f1623] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-semibold text-white tracking-wide">{title}</h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-all text-sm font-bold"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ─── LEDGER MODAL ────────────────────────────────────────────────────────────
function LedgerModal({ onClose }) {
  const { data, isLoading } = useQuery({ queryKey: ["ledger"], queryFn: fetchLedger });

  return (
    <Modal title="Money Allocated — Ledger" onClose={onClose}>
      {isLoading ? (
        <p className="text-white/40 text-sm text-center py-8">Loading…</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-white/40 uppercase text-xs tracking-wider border-b border-white/10">
              <th className="text-left pb-3 pr-4">Date</th>
              <th className="text-left pb-3 pr-4">Type</th>
              <th className="text-left pb-3 pr-4">Entity</th>
              <th className="text-right pb-3">Amount</th>
              <th className="text-right pb-3 pl-4">Running Total</th>
            </tr>
          </thead>
          <tbody>
            {(data?.entries ?? []).map((row, i) => (
              <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="py-2.5 pr-4 text-white/60">{row.date}</td>
                <td className="py-2.5 pr-4">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    row.type === "deposit"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-rose-500/15 text-rose-400"
                  }`}>
                    {row.type === "deposit" ? "Deposit" : "Withdrawal"}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-white/80">{row.entity ?? "—"}</td>
                <td className={`py-2.5 text-right font-mono ${
                  row.type === "deposit" ? "text-emerald-400" : "text-rose-400"
                }`}>
                  {row.type === "deposit" ? "+" : "−"}{fmtCcy(Math.abs(row.amount))}
                </td>
                <td className="py-2.5 pl-4 text-right font-mono text-white/70">
                  {fmtCcy(row.running_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

// ─── TWR BREAKDOWN MODAL ─────────────────────────────────────────────────────
function TWRModal({ onClose }) {
  const { data, isLoading } = useQuery({ queryKey: ["twr"], queryFn: fetchTWR });

  return (
    <Modal title="TWR — Period Breakdown" onClose={onClose}>
      {isLoading ? (
        <p className="text-white/40 text-sm text-center py-8">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {(data?.summary ?? []).map((s) => (
              <div key={s.label} className="rounded-xl bg-white/5 border border-white/8 px-4 py-3">
                <p className="text-white/40 text-xs mb-1">{s.label}</p>
                <p className={`text-lg font-semibold font-mono ${
                  s.value >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}>
                  {sign(s.value)}{fmtPct(s.value)}
                </p>
              </div>
            ))}
          </div>
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-white/40 uppercase text-xs tracking-wider border-b border-white/10">
                <th className="text-left pb-3 pr-4">Period</th>
                <th className="text-right pb-3 pr-4">Sub-period Return</th>
                <th className="text-right pb-3">Cumulative TWR</th>
              </tr>
            </thead>
            <tbody>
              {(data?.periods ?? []).map((row, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-2.5 pr-4 text-white/60">{row.period}</td>
                  <td className={`py-2.5 pr-4 text-right font-mono ${
                    row.sub_return >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}>
                    {sign(row.sub_return)}{fmtPct(row.sub_return)}
                  </td>
                  <td className={`py-2.5 text-right font-mono ${
                    row.cumulative >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}>
                    {sign(row.cumulative)}{fmtPct(row.cumulative)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

// ─── EQUITY CURVE MODAL ──────────────────────────────────────────────────────
function EquityModal({ onClose }) {
  const { data, isLoading } = useQuery({ queryKey: ["equity"], queryFn: fetchEquity });

  const series  = data?.curve ?? [];
  const lastPnl = series.length ? series[series.length - 1]?.pnl : null;
  const maxPnl  = series.length ? Math.max(...series.map((d) => d.pnl)) : null;
  const minPnl  = series.length ? Math.min(...series.map((d) => d.pnl)) : null;

  return (
    <Modal title="Total PnL — Equity Curve (Since Inception)" onClose={onClose}>
      {isLoading ? (
        <p className="text-white/40 text-sm text-center py-8">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Current PnL", value: fmtCcy(lastPnl), color: lastPnl >= 0 ? "text-emerald-400" : "text-rose-400" },
              { label: "Peak PnL",    value: fmtCcy(maxPnl),  color: "text-sky-400" },
              { label: "Trough PnL",  value: fmtCcy(minPnl),  color: "text-amber-400" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-white/5 border border-white/8 px-4 py-3">
                <p className="text-white/40 text-xs mb-1">{s.label}</p>
                <p className={`text-base font-semibold font-mono ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => fmtCcy(v)}
                  width={72}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0f1623",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "rgba(255,255,255,0.5)" }}
                  formatter={(v) => [fmtCcy(v), "PnL"]}
                />
                <Line
                  type="monotone"
                  dataKey="pnl"
                  stroke={lastPnl >= 0 ? "#34d399" : "#f87171"}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: lastPnl >= 0 ? "#34d399" : "#f87171" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── MAIN SUMMARY CARDS ──────────────────────────────────────────────────────
export default function SummaryCards() {
  const [modal, setModal] = useState(null); // "ledger" | "twr" | "equity" | null

  const { data: portfolio, isLoading } = useQuery({
    queryKey: ["portfolio-summary"],
    queryFn: fetchPortfolio,
  });

  const net = (portfolio?.total_deposited ?? 0) - (portfolio?.total_withdrawn ?? 0);
  const aum = portfolio?.current_aum ?? null;
  const twr = portfolio?.twr ?? null;
  const pnl = portfolio?.total_pnl ?? null;

  const cardBase =
    "relative flex flex-col justify-between p-5 rounded-2xl border border-white/10 bg-white/[0.04] " +
    "backdrop-blur-sm transition-all duration-200 cursor-pointer " +
    "hover:border-white/20 hover:bg-white/[0.07] hover:shadow-lg hover:shadow-black/30 " +
    "w-full h-[156px]";

  const label    = "text-xs font-medium text-white/40 uppercase tracking-widest mb-1";
  const mainVal  = "text-2xl font-semibold font-mono";
  const subLine  = "text-xs font-mono text-white/50 leading-5";
  const clickHint = "absolute bottom-4 right-4 text-[10px] text-white/25 font-medium uppercase tracking-wider";

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className={`${cardBase} animate-pulse bg-white/5`} />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-4 gap-4">

        {/* ── Card 1: Money Allocated ── */}
        <div className={cardBase} onClick={() => setModal("ledger")}>
          <div>
            <p className={label}>Money Allocated</p>
            <p className={`${mainVal} ${net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {sign(net)}{fmtCcy(net)}
            </p>
          </div>
          <div className="mt-2 space-y-0.5">
            <p className={subLine}>
              <span className="text-emerald-400/70">↑ Deposited</span>{"  "}{fmtCcy(portfolio?.total_deposited)}
            </p>
            <p className={subLine}>
              <span className="text-rose-400/70">↓ Withdrawn</span>{"  "}{fmtCcy(portfolio?.total_withdrawn)}
            </p>
          </div>
          <span className={clickHint}>Ledger ↗</span>
        </div>

        {/* ── Card 2: Current AUM ── */}
        <div className={`${cardBase} cursor-default hover:cursor-default`}>
          <div>
            <p className={label}>Current AUM</p>
            <p className={`${mainVal} text-white`}>{fmtCcy(aum)}</p>
          </div>
          <p className={`${subLine} mt-2`}>Assets under management</p>
        </div>

        {/* ── Card 3: TWR ── */}
        <div className={cardBase} onClick={() => setModal("twr")}>
          <div>
            <p className={label}>TWR</p>
            <p className={`${mainVal} ${twr >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {sign(twr)}{fmtPct(twr)}
            </p>
          </div>
          <p className={`${subLine} mt-2`}>Time-weighted return</p>
          <span className={clickHint}>Breakdown ↗</span>
        </div>

        {/* ── Card 4: Total PnL ── */}
        <div className={cardBase} onClick={() => setModal("equity")}>
          <div>
            <p className={label}>Total PnL</p>
            <p className={`${mainVal} ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {sign(pnl)}{fmtCcy(pnl)}
            </p>
          </div>
          <p className={`${subLine} mt-2`}>Since inception</p>
          <span className={clickHint}>Equity curve ↗</span>
        </div>

      </div>

      {modal === "ledger" && <LedgerModal onClose={() => setModal(null)} />}
      {modal === "twr"    && <TWRModal    onClose={() => setModal(null)} />}
      {modal === "equity" && <EquityModal onClose={() => setModal(null)} />}
    </>
  );
}
