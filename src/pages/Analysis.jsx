// src/pages/Analysis.jsx
/**
 * AXIA Trade Analysis page.
 * Flow: Upload zone → Trader/Account modal → Dashboard.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import AxiaAnalysisDashboard from '../components/AxiaAnalysisDashboard.jsx'

const API = import.meta.env.VITE_API_BASE ?? ''

const C = {
  bg:     '#0D1B2E',
  card:   '#0F2236',
  border: '#1E3A5F',
  accent: '#38BDF8',
  text:   '#F1F5F9',
  dim:    '#94A3B8',
  muted:  '#64748B',
  navy:   '#1F3864',
  pos:    '#22C55E',
  neg:    '#EF4444',
}

const inputStyle = {
  width: '100%', padding: '11px 14px', boxSizing: 'border-box',
  background: '#132030', border: `1px solid ${C.border}`,
  borderRadius: 8, color: C.text, fontSize: 14, outline: 'none',
  transition: 'border-color 0.15s',
}

// UK convention: DD-MM-YYYY HH:MM
const fmtWhen = iso => {
  if (!iso) return ''
  try {
    const s = new Date(iso).toLocaleString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
    const [datePart, timePart] = s.split(', ')
    return `${datePart.replace(/\//g, '-')}${timePart ? ' ' + timePart : ''}`
  } catch { return iso }
}

// ─── Saved Analyses Panel ──────────────────────────────────────────────────────
function SavedAnalysesPanel({ items, loading, onOpen, onDelete }) {
  if (loading) {
    return (
      <div style={{ marginTop: 40, fontSize: 12, color: C.muted, textAlign: 'center' }}>
        Loading saved analyses…
      </div>
    )
  }
  if (!items || items.length === 0) return null

  return (
    <div style={{ marginTop: 44, textAlign: 'left' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 12 }}>
        Saved Analyses ({items.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
        {items.map(it => (
          <div key={it.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
            padding: '12px 16px', gap: 12,
          }}>
            <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen(it.id)}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {it.label || `${it.trader} · ${it.account}`}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                {it.trader} · {it.account} · {it.date_from} → {it.date_to} · saved {fmtWhen(it.created_at)}
              </div>
            </div>
            <button
              onClick={() => onOpen(it.id)}
              style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${C.accent}`, background: 'transparent', color: C.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
            >
              Open
            </button>
            <button
              onClick={() => onDelete(it.id)}
              title="Delete saved analysis"
              style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.neg, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}
            >
              🗑
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Share Link Modal ───────────────────────────────────────────────────────────
function ShareLinkModal({ url, onClose }) {
  const [copied, setCopied] = useState(false)
  const inputRef = useRef()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      inputRef.current?.select()
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(2,8,18,0.7)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
        padding: 'clamp(20px, 6vw, 36px)', maxWidth: 520, width: '100%',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 6 }}>
          🔗 Analysis Saved & Shareable
        </div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 22, lineHeight: 1.5 }}>
          Send this link to view the GBP-converted analysis — no upload needed on their end.
          It stays available until you delete it from your Saved Analyses list.
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <input
            ref={inputRef}
            readOnly
            value={url}
            onClick={e => e.target.select()}
            style={{ ...inputStyle, fontSize: 13, color: C.accent }}
          />
          <button
            onClick={copy}
            style={{ padding: '11px 18px', borderRadius: 8, border: 'none', background: C.navy, color: C.accent, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {copied ? '✓ Copied' : 'Copy Link'}
          </button>
        </div>
        <button
          onClick={onClose}
          style={{ width: '100%', padding: 12, borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.dim, fontSize: 13, cursor: 'pointer' }}
        >
          Done
        </button>
      </div>
    </div>
  )
}

// ─── Upload Zone ──────────────────────────────────────────────────────────────
function UploadZone({ onFile, error, savedAnalyses, savedLoading, onOpenSaved, onDeleteSaved }) {
  const [dragging, setDragging] = useState(false)
  const ref = useRef()

  const handleDrop = useCallback(e => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }, [onFile])

  return (
    <div style={{
      background: C.bg, minHeight: 'calc(100vh - 56px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(16px, 6vw, 32px)',
    }}>
      <div style={{ maxWidth: 580, width: '100%', textAlign: 'center' }}>

        {/* Title */}
        <div style={{ marginBottom: 12 }}>
          <span style={{
            display: 'inline-block', padding: '4px 12px', borderRadius: 20,
            background: 'rgba(56,189,248,0.1)', border: `1px solid rgba(56,189,248,0.25)`,
            fontSize: 11, color: C.accent, fontWeight: 700, letterSpacing: '1px',
            textTransform: 'uppercase', marginBottom: 20,
          }}>
            AXIA Strategy
          </span>
        </div>
        <div style={{ fontSize: 'clamp(21px, 6vw, 28px)', fontWeight: 700, color: C.text, marginBottom: 10, letterSpacing: '-0.5px' }}>
          Trade Analysis Dashboard
        </div>
        <div style={{ fontSize: 14, color: C.muted, marginBottom: 44, lineHeight: 1.6, maxWidth: 420, margin: '0 auto 44px' }}>
          Upload your AXIA statement Excel file for deep P&L attribution,
          commission analysis, instrument equity curves, and manager-ready reporting.
        </div>

        {/* Drop zone */}
        <div
          onClick={() => ref.current?.click()}
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          style={{
            border: `2px dashed ${dragging ? C.accent : C.border}`,
            borderRadius: 16, padding: 'clamp(28px, 8vw, 52px) clamp(16px, 6vw, 36px)',
            background: dragging ? 'rgba(56,189,248,0.05)' : C.card,
            cursor: 'pointer', transition: 'all 0.2s',
          }}
        >
          <div style={{ fontSize: 'clamp(36px, 10vw, 48px)', marginBottom: 20 }}>📊</div>
          <div style={{ fontSize: 17, fontWeight: 600, color: C.dim, marginBottom: 8 }}>
            Drop AXIA Statement Excel here
          </div>
          <div style={{ fontSize: 13, color: C.muted }}>or click to browse</div>
          <div style={{
            display: 'inline-block', marginTop: 16, padding: '4px 12px',
            background: '#132030', borderRadius: 6, fontSize: 11, color: C.muted,
          }}>
            .xlsx · .xls
          </div>
        </div>

        <input
          ref={ref} type="file" accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={e => e.target.files[0] && onFile(e.target.files[0])}
        />

        {error && (
          <div style={{
            marginTop: 20, padding: '12px 18px',
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8, color: '#FCA5A5', fontSize: 13, textAlign: 'left',
          }}>
            {error}
          </div>
        )}

        {/* Feature chips */}
        <div style={{ display: 'flex', gap: 10, marginTop: 40, flexWrap: 'wrap', justifyContent: 'center' }}>
          {['P&L Attribution', 'Equity Curves', 'Commission Analysis',
            'Daily P&L', 'Excel Export', 'Manager Report'].map(f => (
            <span key={f} style={{
              padding: '5px 14px', borderRadius: 20,
              border: `1px solid ${C.border}`, background: '#132030',
              fontSize: 11, color: C.muted,
            }}>
              {f}
            </span>
          ))}
        </div>

        <SavedAnalysesPanel
          items={savedAnalyses}
          loading={savedLoading}
          onOpen={onOpenSaved}
          onDelete={onDeleteSaved}
        />
      </div>
    </div>
  )
}

// ─── Trader / Account Modal ───────────────────────────────────────────────────
function TraderModal({ file, trader, setTrader, account, setAccount,
                       onConfirm, onCancel, loading, error }) {
  return (
    <div style={{
      background: C.bg, minHeight: 'calc(100vh - 56px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(16px, 6vw, 32px)',
    }}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 16, padding: 'clamp(22px, 6vw, 44px)', maxWidth: 500, width: '100%',
      }}>

        <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 6 }}>
          Confirm Statement Details
        </div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 30 }}>
          File:{' '}
          <span style={{ color: C.accent, fontWeight: 600 }}>{file?.name}</span>
        </div>

        {/* Trader */}
        <label style={{
          display: 'block', fontSize: 11, color: C.dim, fontWeight: 700,
          letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 8,
        }}>
          Trader Name
        </label>
        <input
          value={trader}
          onChange={e => setTrader(e.target.value)}
          placeholder="e.g. Josh M."
          style={inputStyle}
        />

        {/* Account */}
        <label style={{
          display: 'block', fontSize: 11, color: C.dim, fontWeight: 700,
          letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 8, marginTop: 20,
        }}>
          Account Number
        </label>
        <input
          value={account}
          onChange={e => setAccount(e.target.value)}
          placeholder="e.g. 47511"
          style={{ ...inputStyle, marginBottom: 32 }}
          onKeyDown={e => e.key === 'Enter' && onConfirm()}
        />

        {error && (
          <div style={{
            marginBottom: 20, padding: '11px 16px',
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8, color: '#FCA5A5', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: 13, borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${C.border}`, background: 'transparent',
              color: C.muted, fontSize: 14, transition: 'all 0.15s',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || !trader.trim() || !account.trim()}
            style={{
              flex: 2, padding: 13, borderRadius: 8, cursor: 'pointer',
              border: 'none', background: C.navy, color: C.accent,
              fontSize: 14, fontWeight: 700, opacity: loading ? 0.7 : 1,
              transition: 'all 0.15s',
            }}
          >
            {loading ? 'Analysing…' : 'Run Analysis →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Analysis() {
  const [phase, setPhase]         = useState('upload')   // upload | modal | dashboard
  const [file, setFile]           = useState(null)
  const [trader, setTrader]       = useState('Josh M.')
  const [account, setAccount]     = useState('47511')
  const [analysisId, setAnalysisId]   = useState(null)
  const [analysisData, setAnalysisData] = useState(null)
  const [loading, setLoading]         = useState(false)
  const [exporting, setExporting]     = useState(false)
  const [gbpRetrying, setGbpRetrying] = useState(false)
  const [error, setError]             = useState(null)

  const [savedAnalyses, setSavedAnalyses] = useState([])
  const [savedLoading, setSavedLoading]   = useState(true)
  const [savingShare, setSavingShare]     = useState(false)
  const [shareUrl, setShareUrl]           = useState(null)

  // ── Load saved analyses list (upload screen) ──────────────────────────────
  const loadSavedList = useCallback(async () => {
    setSavedLoading(true)
    try {
      const res = await fetch(`${API}/api/analysis/saved`)
      if (res.ok) setSavedAnalyses(await res.json())
    } catch {
      // Non-fatal — panel just stays empty
    } finally {
      setSavedLoading(false)
    }
  }, [])

  useEffect(() => {
    if (phase === 'upload') loadSavedList()
  }, [phase, loadSavedList])

  // ── Open a previously saved analysis (reopen, full private view) ──────────
  const handleOpenSaved = async id => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API}/api/analysis/saved/${id}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `Failed to load saved analysis (${res.status})`)
      }
      const payload = await res.json()
      setAnalysisId(payload.analysis_id)
      setAnalysisData(payload.data)
      setTrader(payload.trader)
      setAccount(payload.account)
      setPhase('dashboard')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Delete a saved analysis ────────────────────────────────────────────────
  const handleDeleteSaved = async id => {
    if (!window.confirm('Delete this saved analysis? Its shared link will stop working.')) return
    try {
      await fetch(`${API}/api/analysis/saved/${id}`, { method: 'DELETE' })
      setSavedAnalyses(prev => prev.filter(it => it.id !== id))
    } catch {
      setError('Failed to delete saved analysis')
    }
  }

  // ── Save & Share current analysis (GBP view link for managers) ────────────
  const handleSaveShare = async () => {
    if (!analysisId) return
    setSavingShare(true)
    setError(null)
    try {
      const res = await fetch(`${API}/api/analysis/${analysisId}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trader, account }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `Save failed (${res.status})`)
      }
      const { share_path } = await res.json()
      setShareUrl(`${window.location.origin}${share_path}`)
      loadSavedList()
    } catch (err) {
      setError('Save & Share failed: ' + err.message)
    } finally {
      setSavingShare(false)
    }
  }

  // ── Handle file pick ──────────────────────────────────────────────────────
  const handleFile = f => {
    if (!f) return
    const ext = f.name.toLowerCase()
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
      setError('Please upload an Excel file (.xlsx or .xls)')
      return
    }
    // Auto-extract trader + account from filename: AXIA-{trader}-{account}_*
    const match = f.name.match(/^AXIA-([^-]+)-([^_\.]+)/i)
    if (match) {
      setTrader(match[1])
      setAccount(match[2])
    }
    setFile(f)
    setError(null)
    setPhase('modal')
  }

  // ── Run analysis (upload → backend) ──────────────────────────────────────
  const runAnalysis = async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${API}/api/analysis/upload`, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `Server error ${res.status}`)
      }
      const json = await res.json()
      setAnalysisId(json.analysis_id)
      setAnalysisData(json.data)
      setPhase('dashboard')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Export Excel report ───────────────────────────────────────────────────
  const handleExport = async (gbpMode = false) => {
    if (!analysisId) return
    setExporting(true)
    try {
      const params = new URLSearchParams({ trader, account })
      if (gbpMode) params.set('gbp', 'true')
      const res = await fetch(`${API}/api/analysis/${analysisId}/export?${params}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const dr = analysisData?.date_range
      const suffix = gbpMode ? '_GBP' : ''
      link.download = `AXIA-Analysis-${account}_${dr?.from || 'report'}_to_${dr?.to || ''}${suffix}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError('Export failed: ' + err.message)
    } finally {
      setExporting(false)
    }
  }

  // ── Retry GBP rate fetch ──────────────────────────────────────────────────
  const handleGbpRetry = async () => {
    if (!analysisId) return
    setGbpRetrying(true)
    try {
      const res = await fetch(`${API}/api/analysis/${analysisId}/refresh-gbp`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `GBP refresh failed (${res.status})`)
      }
      const gbpView = await res.json()
      // Merge GBP fields into existing analysis data
      setAnalysisData(prev => ({ ...prev, ...gbpView }))
    } catch (err) {
      setError('GBP rate refresh: ' + err.message)
    } finally {
      setGbpRetrying(false)
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  const reset = () => {
    setPhase('upload')
    setFile(null)
    setAnalysisData(null)
    setAnalysisId(null)
    setError(null)
    setShareUrl(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (phase === 'upload') {
    return (
      <UploadZone
        onFile={handleFile}
        error={error}
        savedAnalyses={savedAnalyses}
        savedLoading={savedLoading}
        onOpenSaved={handleOpenSaved}
        onDeleteSaved={handleDeleteSaved}
      />
    )
  }

  if (phase === 'modal') {
    return (
      <TraderModal
        file={file}
        trader={trader}   setTrader={setTrader}
        account={account} setAccount={setAccount}
        onConfirm={runAnalysis}
        onCancel={reset}
        loading={loading}
        error={error}
      />
    )
  }

  if (phase === 'dashboard' && analysisData) {
    return (
      <>
        <AxiaAnalysisDashboard
          data={analysisData}
          trader={trader}
          account={account}
          onNewUpload={reset}
          onExport={handleExport}
          exporting={exporting}
          onGbpRetry={handleGbpRetry}
          gbpRetrying={gbpRetrying}
          onSaveShare={handleSaveShare}
          saving={savingShare}
        />
        {shareUrl && <ShareLinkModal url={shareUrl} onClose={() => setShareUrl(null)} />}
      </>
    )
  }

  return null
}
