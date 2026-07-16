// src/pages/SharedAnalysis.jsx
/**
 * Public read-only AXIA Trade Analysis view.
 * Fetches a previously saved analysis by id -- no upload, no auth.
 * Always renders the GBP view (locked), for sharing with non-traders (e.g. managers).
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

  const handleExport = async () => {
    setExporting(true)
    try {
      const params = new URLSearchParams({ trader, account, gbp: 'true' })
      const res = await fetch(`${API}/api/analysis/${shareId}/export?${params}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const dr = data?.date_range
      link.download = `AXIA-Analysis-${account}_${dr?.from || 'report'}_to_${dr?.to || ''}_GBP.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      // Export is a nice-to-have on the shared view; fail silently in the UI chrome
    } finally {
      setExporting(false)
    }
  }

  if (!data.gbp_assets) {
    return (
      <CenteredMessage>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 8 }}>
          GBP View Unavailable
        </div>
        <div style={{ fontSize: 13, color: C.muted }}>
          This saved analysis does not have a GBP conversion. Ask the sender to
          refresh GBP rates and re-share the link.
        </div>
      </CenteredMessage>
    )
  }

  return (
    <AxiaAnalysisDashboard
      data={data}
      trader={trader}
      account={account}
      readOnly
      forceGbp
      onExport={handleExport}
      exporting={exporting}
    />
  )
}
