// src/pages/SharedAnalysis.jsx
/**
 * Public read-only AXIA Trade Analysis view.
 * Fetches a previously saved analysis by id -- no upload, no auth.
 * Opens on the GBP view when available (2026-09-24: no longer locked --
 * managers can switch to Native and back, same toggle as the dashboard).
 */

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import AxiaAnalysisDashboard from '../components/AxiaAnalysisDashboard.jsx'

const API = import.meta.env.VITE_API_BASE ?? ''

const C = {
  bg:    '#0D1B2E',
  card:  '#0F2236',
  border:'#1E3A5F',
  accent:'#38BDF8',
  text:  '#F1F5F9',
  muted: '#64748B',
  neg:   '#EF4444',
}

function CenteredMessage({ children }) {
  return (
    <div style={{
      background: C.bg, minHeight: 'calc(100vh - 56px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32,
    }}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
        padding: 44, maxWidth: 460, width: '100%', textAlign: 'center',
      }}>
        {children}
      </div>
    </div>
  )
}

export default function SharedAnalysis() {
  const { shareId } = useParams()
  const [state, setState]         = useState({ loading: true, error: null, payload: null })
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setState({ loading: true, error: null, payload: null })

    fetch(`${API}/api/analysis/saved/${shareId}`)
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.detail || `This analysis is unavailable (${res.status})`)
        }
        return res.json()
      })
      .then(payload => { if (!cancelled) setState({ loading: false, error: null, payload }) })
      .catch(err => { if (!cancelled) setState({ loading: false, error: err.message, payload: null }) })

    return () => { cancelled = true }
  }, [shareId])

  if (state.loading) {
    return (
      <CenteredMessage>
        <div style={{ fontSize: 15, color: C.muted }}>Loading analysis…</div>
      </CenteredMessage>
    )
  }

  if (state.error || !state.payload) {
    return (
      <CenteredMessage>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 8 }}>
          Analysis Not Available
        </div>
        <div style={{ fontSize: 13, color: C.neg }}>
          {state.error || 'This link may have been deleted or is invalid.'}
        </div>
      </CenteredMessage>
    )
  }

  const { trader, account, data } = state.payload

  // Export matches whichever tab (Native/GBP) is active on screen -- the
  // dashboard calls onExport(gbpMode) from its own toggle state (2026-09-24,
  // Nish: managers can now switch tabs here same as the trader dashboard).
  const handleExport = async (gbpMode = true) => {
    setExporting(true)
    try {
      const params = new URLSearchParams({ trader, account })
      if (gbpMode) params.set('gbp', 'true')
      const res = await fetch(`${API}/api/analysis/${shareId}/export?${params}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const dr = data?.date_range
      const suffix = gbpMode ? '_GBP' : ''
      link.download = `AXIA-Analysis-${account}_${dr?.from || 'report'}_to_${dr?.to || ''}${suffix}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      // Export is a nice-to-have on the shared view; fail silently in the UI chrome
    } finally {
      setExporting(false)
    }
  }

  // 2026-09-24 (Nish): previously this whole page refused to render at all
  // without a GBP conversion, and even when GBP was present it locked the
  // view to GBP-only with no toggle -- managers couldn't see Native, unlike
  // the trader dashboard. Now it opens on GBP when available (native
  // otherwise) but stays fully switchable, exactly like the dashboard
  // traders see right after uploading.
  return (
    <AxiaAnalysisDashboard
      data={data}
      trader={trader}
      account={account}
      readOnly
      initialGbp={!!data.gbp_assets}
      onExport={handleExport}
      exporting={exporting}
    />
  )
}
