// frontend/src/pages/HomePage.jsx

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  TrendingUp, TrendingDown, BarChart2, Activity,
  Shield, Layers, PieChart, Zap, ArrowRight, ChevronRight
} from "lucide-react";
import { LogoFull, LogoMark } from "../components/Logo";

// ── Floating trading particle data ────────────────────────────────────────────
const FLOATERS = [
  { icon: TrendingUp,   label: "+2.4%",  x: 8,  y: 15, delay: 0,   dur: 18, size: 18, opacity: 0.18 },
  { icon: BarChart2,    label: "AUM",    x: 85, y: 10, delay: 3,   dur: 22, size: 22, opacity: 0.14 },
  { icon: Activity,     label: "TWR",    x: 15, y: 60, delay: 6,   dur: 20, size: 16, opacity: 0.16 },
  { icon: TrendingUp,   label: "+0.8%",  x: 75, y: 55, delay: 2,   dur: 25, size: 14, opacity: 0.12 },
  { icon: PieChart,     label: "POD",    x: 50, y: 8,  delay: 8,   dur: 19, size: 20, opacity: 0.15 },
  { icon: TrendingDown, label: "-1.1%",  x: 30, y: 80, delay: 4,   dur: 23, size: 16, opacity: 0.10 },
  { icon: Layers,       label: "STRAT",  x: 90, y: 75, delay: 7,   dur: 21, size: 18, opacity: 0.13 },
  { icon: BarChart2,    label: "PnL",    x: 60, y: 88, delay: 1,   dur: 24, size: 15, opacity: 0.12 },
  { icon: Activity,     label: "RISK",   x: 5,  y: 85, delay: 5,   dur: 17, size: 19, opacity: 0.14 },
  { icon: TrendingUp,   label: "+5.2%",  x: 42, y: 35, delay: 9,   dur: 26, size: 13, opacity: 0.08 },
  { icon: Shield,       label: "VaR",    x: 68, y: 30, delay: 11,  dur: 20, size: 17, opacity: 0.11 },
  { icon: Zap,          label: "EXEC",   x: 22, y: 45, delay: 13,  dur: 22, size: 15, opacity: 0.09 },
];

// Mini candlestick SVG
function Candle({ up = true, width = 24, height = 36 }) {
  const color = up ? "#22c55e" : "#ef4444";
  const bodyH = height * 0.55;
  const bodyY = up ? height * 0.15 : height * 0.3;
  const wickX = width / 2;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none">
      <line x1={wickX} y1="0" x2={wickX} y2={height} stroke={color} strokeWidth="1.5" />
      <rect x={width * 0.25} y={bodyY} width={width * 0.5} height={bodyH} rx="1" fill={color} />
    </svg>
  );
}

// Mini sparkline SVG
function Sparkline({ up = true, width = 60, height = 24 }) {
  const pts = up
    ? "0,20 12,16 24,14 36,10 48,7 60,3"
    : "0,4  12,8  24,10 36,13 48,16 60,20";
  const color = up ? "#3b82f6" : "#8b5cf6";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none">
      <polyline points={pts} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Floating background particle ──────────────────────────────────────────────
function FloatingParticle({ icon: Icon, label, x, y, delay, dur, size, opacity }) {
  return (
    <div
      className="absolute flex flex-col items-center gap-0.5 select-none pointer-events-none"
      style={{
        left: `${x}%`,
        top:  `${y}%`,
        opacity,
        animation: `floatBob ${dur}s ${delay}s ease-in-out infinite`,
      }}
    >
      <Icon size={size} strokeWidth={1.5} className="text-blue-400" />
      <span style={{ fontSize: size * 0.5, color: "#94a3b8", fontFamily: "monospace" }}>{label}</span>
    </div>
  );
}

// ── Candlestick cluster background ────────────────────────────────────────────
function CandleCluster({ left, top, delay }) {
  return (
    <div
      className="absolute flex items-end gap-1 pointer-events-none select-none"
      style={{ left: `${left}%`, top: `${top}%`, opacity: 0.07, animation: `floatBob 28s ${delay}s ease-in-out infinite` }}
    >
      <Candle up={false} width={10} height={28} />
      <Candle up      width={10} height={38} />
      <Candle up      width={10} height={44} />
      <Candle up={false} width={10} height={32} />
      <Candle up      width={10} height={50} />
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, up = true }) {
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 backdrop-blur-sm hover:border-blue-500/30 transition-all duration-300">
      <p className="text-slate-400 text-xs font-medium mb-1">{label}</p>
      <p className="text-white text-xl font-bold font-mono">{value}</p>
      <p className={`text-xs mt-0.5 ${up ? "text-emerald-400" : "text-red-400"}`}>{sub}</p>
    </div>
  );
}

// ── Feature pill ──────────────────────────────────────────────────────────────
function Feature({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-2 text-slate-300 text-sm">
      <div className="w-6 h-6 bg-blue-500/10 border border-blue-500/20 rounded-md flex items-center justify-center shrink-0">
        <Icon size={12} className="text-blue-400" />
      </div>
      {text}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  HOMEPAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function HomePage() {
  const navigate   = useNavigate();
  const heroRef    = useRef(null);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      {/* ── Keyframe styles ─────────────────────────────────────────────────── */}
      <style>{`
        @keyframes floatBob {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          33%       { transform: translateY(-18px) rotate(1.5deg); }
          66%       { transform: translateY(-8px) rotate(-1deg); }
        }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 20px rgba(59,130,246,0.3); }
          50%       { box-shadow: 0 0 40px rgba(59,130,246,0.6); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }
        .animate-fade-up { animation: fadeSlideUp 0.7s ease both; }
        .delay-100 { animation-delay: 0.1s; }
        .delay-200 { animation-delay: 0.2s; }
        .delay-300 { animation-delay: 0.3s; }
        .delay-400 { animation-delay: 0.4s; }
        .delay-500 { animation-delay: 0.5s; }
        .shimmer-text {
          background: linear-gradient(90deg, #60a5fa, #a78bfa, #60a5fa);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 3s linear infinite;
        }
      `}</style>

      <div className="min-h-screen bg-[#070d1a] text-white overflow-x-hidden">

        {/* ── Navbar ────────────────────────────────────────────────────────── */}
        <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4
                        bg-[#070d1a]/80 backdrop-blur-md border-b border-slate-800/50">
          <div style={{ animation: "pulseGlow 3s ease-in-out infinite" }}>
            <LogoFull size={34} />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/auth")}
              className="text-slate-300 hover:text-white text-sm transition-colors px-3 py-1.5">
              Sign In
            </button>
            <button
              onClick={() => navigate("/auth")}
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-all">
              Get Access
            </button>
          </div>
        </nav>

        {/* ── Hero Section ─────────────────────────────────────────────────── */}
        <section ref={heroRef} className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-20 pb-16">

          {/* Grid background */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(30,60,120,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(30,60,120,0.06)_1px,transparent_1px)] bg-[size:60px_60px]" />

          {/* Radial glow */}
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px]
                          bg-blue-600/8 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute top-1/2 left-1/4 w-[300px] h-[300px]
                          bg-purple-600/6 rounded-full blur-3xl pointer-events-none" />

          {/* Floating particles */}
          {FLOATERS.map((f, i) => <FloatingParticle key={i} {...f} />)}

          {/* Candlestick clusters */}
          <CandleCluster left={3}  top={20} delay={0}  />
          <CandleCluster left={80} top={65} delay={5}  />
          <CandleCluster left={55} top={70} delay={10} />
          <CandleCluster left={88} top={15} delay={8}  />

          {/* Hero content */}
          <div className="relative z-10 text-center max-w-3xl mx-auto">

            {/* Badge */}
            <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/25 rounded-full px-4 py-1.5 text-xs text-blue-300 font-medium mb-6 animate-fade-up">
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
              Institutional Fund Management Platform
            </div>

            {/* Headline */}
            <h1 className="text-4xl sm:text-6xl font-black leading-tight mb-4 animate-fade-up delay-100">
              Multi-Strategy
              <br />
              <span className="shimmer-text">Portfolio Intelligence</span>
            </h1>

            {/* Sub */}
            <p className="text-slate-400 text-base sm:text-lg max-w-xl mx-auto mb-8 animate-fade-up delay-200 leading-relaxed">
              Real-time visibility across your entire fund hierarchy.
              Portfolio → Pod → Strategy → Trader → Venue.
              Built for quant professionals.
            </p>

            {/* CTA buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 animate-fade-up delay-300">
              <button
                onClick={() => navigate("/auth")}
                className="group flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500
                           hover:from-blue-500 hover:to-blue-400 text-white font-bold px-7 py-3
                           rounded-xl transition-all text-sm shadow-lg shadow-blue-900/30">
                Access Dashboard
                <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
              <button
                onClick={() => navigate("/auth")}
                className="flex items-center gap-2 border border-slate-700 hover:border-slate-500
                           text-slate-300 hover:text-white font-semibold px-7 py-3 rounded-xl transition-all text-sm">
                Sign In <ChevronRight size={14} />
              </button>
            </div>

            {/* Sparklines decorative */}
            <div className="flex items-center justify-center gap-6 mt-10 opacity-40 animate-fade-up delay-400">
              <Sparkline up  />
              <Sparkline up={false} />
              <Sparkline up  />
            </div>
          </div>
        </section>

        {/* ── Stats Strip ───────────────────────────────────────────────────── */}
        <section className="relative px-6 py-12 max-w-4xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Total AUM"       value="£4.2M"   sub="↑ +2.4% MTD"   up />
            <StatCard label="Live Strategies" value="14"      sub="Across 3 pods"  up />
            <StatCard label="Portfolio TWR"   value="+18.3%"  sub="Since inception" up />
            <StatCard label="Active Venues"   value="3"       sub="DWX · ALT · IB" up />
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────────────────── */}
        <section className="px-6 py-16 max-w-4xl mx-auto">
          <div className="grid sm:grid-cols-2 gap-10 items-center">

            {/* Left */}
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
                Built for institutional<br />
                <span className="text-blue-400">quant workflows</span>
              </h2>
              <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                Chain-linked TWR computation, AUM tracking, full pod/strategy
                CRUD, and live Supabase data — all in one clean interface.
              </p>
              <div className="space-y-3">
                <Feature icon={TrendingUp}  text="Chain-linked TWR across capital events" />
                <Feature icon={BarChart2}   text="Real-time AUM from live Supabase data" />
                <Feature icon={Layers}      text="Pod → Strategy → Trader hierarchy" />
                <Feature icon={PieChart}    text="Equity breakdown with PnL by entity" />
                <Feature icon={Shield}      text="Role-based access — superadmin secured" />
                <Feature icon={Activity}    text="Daily balance history & event tracking" />
              </div>
            </div>

            {/* Right — mock dashboard card */}
            <div className="relative">
              <div className="absolute -inset-2 bg-gradient-to-r from-blue-600/15 to-purple-600/10 rounded-2xl blur-lg" />
              <div className="relative bg-slate-900/80 border border-slate-700/60 rounded-2xl p-5 backdrop-blur-sm">

                {/* Mock header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                    <span className="text-slate-300 text-xs font-medium">Live Portfolio</span>
                  </div>
                  <span className="text-slate-500 text-xs font-mono">Chase Multi-Strategy</span>
                </div>

                {/* Mock rows */}
                {[
                  { pod: "ALPHA",  strat: "DAY",       pnl: "+£18,200", pct: "+3.1%", up: true  },
                  { pod: "SYSDWX", strat: "SYSDWX-01", pnl: "+£9,400",  pct: "+2.0%", up: true  },
                  { pod: "GLOBAL", strat: "MACRO",     pnl: "-£3,100",  pct: "-0.7%", up: false },
                ].map((r, i) => (
                  <div key={i} className="flex items-center justify-between py-2.5 border-b border-slate-800/50 last:border-0">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-6 rounded-sm ${i === 0 ? "bg-blue-500" : i === 1 ? "bg-purple-500" : "bg-emerald-500"}`} />
                      <div>
                        <p className="text-white text-xs font-semibold">{r.pod}</p>
                        <p className="text-slate-500 text-xs">{r.strat}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-xs font-mono font-bold ${r.up ? "text-emerald-400" : "text-red-400"}`}>{r.pnl}</p>
                      <p className={`text-xs font-mono ${r.up ? "text-emerald-500/70" : "text-red-500/70"}`}>{r.pct}</p>
                    </div>
                  </div>
                ))}

                {/* Mock chart bar */}
                <div className="mt-4 flex items-end gap-1 h-10">
                  {[40,60,45,75,55,80,65,90,70,85,60,95].map((h, i) => (
                    <div key={i} className="flex-1 bg-blue-500/20 rounded-sm"
                         style={{ height: `${h}%`, opacity: 0.4 + i * 0.05 }} />
                  ))}
                </div>
                <p className="text-slate-600 text-xs mt-1 text-right font-mono">30-day equity</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── CTA Banner ────────────────────────────────────────────────────── */}
        <section className="px-6 py-16 max-w-2xl mx-auto text-center">
          <div className="relative">
            <div className="absolute -inset-4 bg-blue-600/8 rounded-3xl blur-xl" />
            <div className="relative bg-slate-900/60 border border-slate-700/50 rounded-2xl p-10 backdrop-blur-sm">
              <h2 className="text-2xl font-bold text-white mb-2">Ready to access?</h2>
              <p className="text-slate-400 text-sm mb-6">Superadmin credentials required.</p>
              <button
                onClick={() => navigate("/auth")}
                className="group inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500
                           hover:from-blue-500 hover:to-blue-400 text-white font-bold px-8 py-3
                           rounded-xl transition-all text-sm shadow-lg shadow-blue-900/30">
                Sign In
                <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          </div>
        </section>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <footer className="border-t border-slate-800/50 px-6 py-6 text-center">
          <p className="text-slate-600 text-xs">
            © {new Date().getFullYear()} Chase Dashboard · Institutional use only
          </p>
        </footer>

      </div>
    </>
  );
}
