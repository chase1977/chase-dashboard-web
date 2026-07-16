// frontend/src/App.jsx
import { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'

import Navbar    from './components/layout/Navbar.jsx'
import Portfolio from './pages/Portfolio.jsx'
import DrillDown from './pages/DrillDown.jsx'
import Reports   from './pages/Reports.jsx'
import Analysis  from './pages/Analysis.jsx'
import SharedAnalysis from './pages/SharedAnalysis.jsx'

// ---------------------------------------------------------------------------
// App — global time range state lives here so Navbar and pages stay in sync
// ---------------------------------------------------------------------------

export default function App() {
  const [timeRange, setTimeRange] = useState('SI')

  return (
    <div style={{ minHeight: '100vh' }}>

      {/* Top navigation bar — always visible */}
      <Navbar timeRange={timeRange} onTimeRange={setTimeRange} />

      {/* Page content */}
      <main>
        <Routes>
          {/* Portfolio home */}
          <Route path="/" element={<Portfolio timeRange={timeRange} />} />

          {/* Drill-down — pod / strategy / trader / venue */}
          <Route path="/drilldown/:entityId" element={<DrillDown timeRange={timeRange} />} />

          {/* Hierarchy shortcut tabs */}
          <Route path="/pods"       element={<Portfolio timeRange={timeRange} initialTab="pod"      />} />
          <Route path="/strategies" element={<Portfolio timeRange={timeRange} initialTab="strategy" />} />
          <Route path="/traders"    element={<Portfolio timeRange={timeRange} initialTab="trader"   />} />
          <Route path="/venues"     element={<Portfolio timeRange={timeRange} initialTab="venue"    />} />

          {/* Reports */}
          <Route path="/reports"  element={<Reports />} />

          {/* Analysis — AXIA Trade Analysis Dashboard */}
          <Route path="/analysis" element={<Analysis />} />

          {/* Shared read-only analysis (GBP view) — public link, no upload */}
          <Route path="/analysis/shared/:shareId" element={<SharedAnalysis />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

    </div>
  )
}
