// src/components/StatementUpload.jsx
/**
 * AXIA PDF Statement Upload — dark-theme drop zone matching the Chase Capital dashboard.
 * POST /api/statement/upload -> preview parsed rows -> download Excel.
 */

import { useState, useCallback, useRef } from 'react'

const BASE = import.meta.env.VITE_API_BASE ?? ''

// ---------------------------------------------------------------------------
// Theme tokens
// ---------------------------------------------------------------------------
const C = {
  bg:          '#0D1B2E',
  card:        '#111C2B',
  border:      '#1E3A5F',
  borderHover: '#0EA5E9',
  text:        '#F1F5F9',
  textSub:     '#64748B',
  textMid:     '#94A3B8',
  accent:      '#38BDF8',
  accentDim:   'rgba(14,165,233,0.12)',
  accentBorder:'rgba(14,165,233,0.35)',
  rowEven:     'rgba(255,255,255,0.02)',
  rowOdd:      'transparent',
  thBg:        '#0D1B2E',
  colBorder:   'rgba(255,255,255,0.06)',
  neg:         '#F87171',
  pos:         '#34D399',
  negDim:      'rgba(248,113,113,0.12)',
  posDim:      'rgba(52,211,153,0.12)',
  negBorder:   'rgba(248,113,113,0.3)',
  posBorder:   'rgba(52,211,153,0.3)',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const fmt = (v) => {
  if (v == null) return '—'
  const abs = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `-${abs}` : abs
}
const fmtDate = (d) => {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}-${m}-${y}`
}
const numColor = (v) => v == null ? C.textMid : v < 0 ? C.neg : v > 0 ? C.pos : C.textMid

const COLS = [
  { label: 'TRADE DATE',         key: 'trade_date',      align: 'left'   },
  { label: 'DELIVERY / PRODUCT', key: 'delivery_product', align: 'left'  },
  { label: 'LONG',               key: 'long',             align: 'right'  },
  { label: 'SHORT',              key: 'short',            align: 'right'  },
  { label: 'REALIZED PnL',       key: 'realized_pnl',    align: 'right', colored: true },
  { label: 'COMM FEES',          key: 'commission_fees', align: 'right', colored: true },
  { label: 'MARKET FEES',        key: 'market_fees',     align: 'right', colored: true },
  { label: 'NFA FEES',           key: 'nfa_fees',        align: 'right', colored: true },
  { label: 'TOTAL COMMS',        key: '_totalComms',     align: 'right', colored: true },
  { label: 'TOTAL PnL',          key: '_totalPnl',       align: 'right', colored: true, bold: true },
  { label: 'CCY',                key: 'currency',        align: 'center' },
]

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function MetaChip({ label, value }) {
  return (
    <div style={{
      background: C.accentDim, border: `1px solid ${C.accentBorder}`,
      borderRadius: 8, padding: '10px 18px', minWidth: 110, textAlign: 'center',
    }}>
      <div style={{ fontSize: 9, letterSpacing: '0.8px', textTransform: 'uppercase', color: C.textSub, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{value ?? '—'}</div>
    </div>
  )
}

function PnLChip({ ccy, net }) {
  const pos = net >= 0
  return (
    <div style={{
      background: pos ? C.posDim : C.negDim,
      border: `1px solid ${pos ? C.posBorder : C.negBorder}`,
      borderRadius: 8, padding: '10px 18px', minWidth: 130, textAlign: 'center',
    }}>
      <div style={{ fontSize: 9, letterSpacing: '0.8px', textTransform: 'uppercase', color: C.textSub, marginBottom: 4 }}>
        {ccy} NET P&L
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: pos ? C.pos : C.neg }}>{fmt(net)}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function StatementUpload() {
  const [dragging,  setDragging]  = useState(false)
  const [files,     setFiles]     = useState([])   // always an array
  const [loading,   setLoading]   = useState(false)
  const [result,    setResult]    = useState(null)  // single-mode JSON result
  const [batchDone, setBatchDone] = useState(false) // multi-mode success flag
  const [error,     setError]     = useState(null)
  const inputRef = useRef()

  const isSingle = files.length === 1
  const isMulti  = files.length > 1
  const hasFiles = files.length > 0

  // ── File ingestion ──────────────────────────────────────────────────────────
  const addFiles = useCallback((incoming) => {
    const pdfs = Array.from(incoming).filter(f => f.name.toLowerCase().endsWith('.pdf'))
    if (!pdfs.length) { setError('Only PDF files are accepted.'); return }
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name))
      return [...prev, ...pdfs.filter(f => !existing.has(f.name))]
    })
    setResult(null); setBatchDone(false); setError(null)
  }, [])

  const removeFile = (name) => setFiles(prev => prev.filter(f => f.name !== name))

  const onDragOver  = useCallback((e) => { e.preventDefault(); setDragging(true) }, [])
  const onDragLeave = useCallback(() => setDragging(false), [])
  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files)
  }, [addFiles])

  const onFileChange = (e) => {
    if (e.target.files.length) addFiles(e.target.files); e.target.value = ''
  }

  // ── Single upload (existing flow) ──────────────────────────────────────────
  const uploadSingle = async () => {
    if (!isSingle) return
    setLoading(true); setError(null); setResult(null)
    const form = new FormData()
    form.append('file', files[0])
    try {
      const res = await fetch(`${BASE}/api/statement/upload`, { method: 'POST', body: form })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Upload failed') }
      setResult(await res.json())
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  // ── Batch upload (multi-file → ZIP) ────────────────────────────────────────
  const uploadBatch = async () => {
    if (!isMulti) return
    setLoading(true); setError(null); setBatchDone(false)
    const form = new FormData()
    files.forEach(f => form.append('files', f))
    try {
      const res = await fetch(`${BASE}/api/statement/upload-batch`, { method: 'POST', body: form })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Batch upload failed') }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'AXIA-Statements.zip'; a.click()
      URL.revokeObjectURL(url)
      setBatchDone(true)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const downloadExcel = () => {
    if (!result?.filename) return
    const a = document.createElement('a')
    a.href = `${BASE}/api/statement/download/${result.filename}`; a.download = result.filename; a.click()
  }

  const reset = () => {
    setFiles([]); setResult(null); setBatchDone(false); setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  // ── Derived display ─────────────────────────────────────────────────────────
  const ccyTotals = result?.rows?.reduce((acc, r) => {
    const ccy = r.currency || '?'
    if (!acc[ccy]) acc[ccy] = 0
    const comms = (r.commission_fees || 0) + (r.market_fees || 0) + (r.nfa_fees || 0)
    acc[ccy] += (r.realized_pnl || 0) + comms
    return acc
  }, {})

  const rows = result?.rows?.map(r => {
    const tc = (r.commission_fees || 0) + (r.market_fees || 0) + (r.nfa_fees || 0)
    return { ...r, _totalComms: tc, _totalPnl: (r.realized_pnl || 0) + tc }
  }) || []

  return (
    <div style={{ padding: '20px 24px 28px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Drop zone — hide once single parse result is showing */}
      {!result && (
        <div
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `1.5px dashed ${dragging ? C.borderHover : C.border}`,
            borderRadius: 8,
            background: dragging ? 'rgba(14,165,233,0.06)' : 'rgba(255,255,255,0.02)',
            padding: '36px 24px', textAlign: 'center', cursor: 'pointer',
            transition: 'all 0.15s', marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.5 }}>📄</div>
          <div style={{ fontSize: 13, fontWeight: 500, color: dragging ? C.accent : C.textMid, marginBottom: 4 }}>
            {hasFiles
              ? `${files.length} PDF${files.length > 1 ? 's' : ''} queued — drop more to add`
              : 'Drag & drop AXIA PDF statement(s) here'}
          </div>
          <div style={{ fontSize: 11, color: C.textSub }}>or click to browse · PDF only · multiple supported</div>
          <input ref={inputRef} type="file" accept=".pdf" multiple style={{ display: 'none' }} onChange={onFileChange} />
        </div>
      )}

      {/* Queued file list (multi-mode only) */}
      {!result && isMulti && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.7px', textTransform: 'uppercase',
            color: C.textSub, marginBottom: 8 }}>
            Queued ({files.length} files)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {files.map(f => (
              <div key={f.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '7px 12px', borderRadius: 6, background: 'rgba(56,189,248,0.04)',
                border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, opacity: 0.6 }}>📄</span>
                  <span style={{ fontSize: 11, color: C.textMid, fontFamily: 'monospace' }}>{f.name}</span>
                </div>
                <button onClick={() => removeFile(f.name)} disabled={loading}
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                    color: C.textSub, fontSize: 16, lineHeight: 1, padding: '0 4px' }}>
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Batch success banner */}
      {batchDone && (
        <div style={{ marginBottom: 14, padding: '12px 16px', borderRadius: 7,
          background: C.posDim, border: `1px solid ${C.posBorder}`,
          fontSize: 13, color: C.pos, fontWeight: 600 }}>
          ✓ ZIP downloaded — {files.length} Excel files inside
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: C.negDim, border: `1px solid ${C.negBorder}`,
          borderRadius: 6, padding: '10px 14px', fontSize: 12, color: C.neg, marginBottom: 14 }}>
          ⚠ {error}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10, marginBottom: result ? 20 : 0 }}>

        {/* Single parse */}
        {!result && isSingle && (
          <button onClick={uploadSingle} disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 20px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: loading ? 'rgba(255,255,255,0.03)' : C.accentDim,
              border: `1px solid ${loading ? C.border : C.accentBorder}`,
              color: loading ? C.textSub : C.accent,
              cursor: loading ? 'not-allowed' : 'pointer', transition: 'all 0.15s' }}>
            {loading && <span style={{ display: 'inline-block', width: 13, height: 13,
              border: `2px solid ${C.accentBorder}`, borderTop: `2px solid ${C.accent}`,
              borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
            {loading ? 'Parsing…' : 'Parse Statement'}
          </button>
        )}

        {/* Batch parse → ZIP */}
        {!result && isMulti && (
          <button onClick={uploadBatch} disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 20px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: loading ? 'rgba(255,255,255,0.03)' : C.accentDim,
              border: `1px solid ${loading ? C.border : C.accentBorder}`,
              color: loading ? C.textSub : C.accent,
              cursor: loading ? 'not-allowed' : 'pointer', transition: 'all 0.15s' }}>
            {loading && <span style={{ display: 'inline-block', width: 13, height: 13,
              border: `2px solid ${C.accentBorder}`, borderTop: `2px solid ${C.accent}`,
              borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
            {loading ? `Parsing ${files.length} PDFs…` : `Parse & Download ZIP (${files.length} files)`}
          </button>
        )}

        {/* Single: download Excel */}
        {result && (
          <button onClick={downloadExcel}
            style={{ display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 20px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: C.posDim, border: `1px solid ${C.posBorder}`,
              color: C.pos, cursor: 'pointer' }}>
            ⬇ Download Excel
          </button>
        )}

        {/* Reset */}
        {(hasFiles || result || batchDone) && (
          <button onClick={reset}
            style={{ padding: '9px 18px', borderRadius: 6, fontSize: 12, fontWeight: 500,
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.textSub, cursor: 'pointer' }}>
            {result || batchDone ? 'Upload Another' : 'Clear'}
          </button>
        )}
      </div>

      {/* Single parse results */}
      {result && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10 }}>
            <MetaChip label="Trade Date"  value={fmtDate(result.trade_date)} />
            <MetaChip label="Client"      value={result.client} />
            <MetaChip label="Account"     value={result.account} />
            <MetaChip label="Instruments" value={result.row_count} />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            {Object.entries(ccyTotals || {}).map(([ccy, net]) => (
              <PnLChip key={ccy} ccy={ccy} net={net} />
            ))}
          </div>

          <div style={{ overflowX: 'auto', borderRadius: 8, border: `1px solid ${C.border}` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  {COLS.map(col => (
                    <th key={col.key} style={{
                      background: C.thBg, color: C.textMid,
                      padding: '9px 11px', textAlign: col.align,
                      fontWeight: 600, fontSize: 10, letterSpacing: '0.5px',
                      whiteSpace: 'nowrap', borderBottom: `1px solid ${C.border}`,
                      borderRight: `1px solid ${C.colBorder}`,
                    }}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? C.rowEven : C.rowOdd }}>
                    {COLS.map(col => {
                      const v       = r[col.key]
                      const isNum   = typeof v === 'number'
                      const display = isNum ? fmt(v) : col.key === 'trade_date' ? fmtDate(v) : (v ?? '—')
                      const color   = col.colored ? numColor(v) : col.key === 'currency' ? C.accent : C.text
                      return (
                        <td key={col.key} style={{
                          padding: '7px 11px', textAlign: col.align, color,
                          fontWeight: col.bold ? 700 : 400,
                          fontFamily: isNum ? 'monospace' : 'inherit',
                          whiteSpace: 'nowrap',
                          borderBottom: `1px solid ${C.colBorder}`,
                          borderRight: `1px solid ${C.colBorder}`,
                          fontSize: isNum ? 11 : 12,
                        }}>
                          {display}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
