// src/components/StatementUpload.jsx
/**
 * AXIA PDF Statement Upload — dark-theme drop zone matching the Chase Capital dashboard.
 *
 * Multi-account, multi-day redesign (2026-09-23): drop one PDF or a whole
 * batch (e.g. every daily statement from 16-Feb through today) → parsed
 * server-side, segmented per account (a single PDF can hold several, see
 * backend/src/services/statement_service.py) → an account picker shows
 * every account detected across every file, with its own date range/row
 * count/currencies, so you choose which account(s) to download — as one
 * combined workbook (still correctly tagged + totalled per account inside
 * it) or as separate workbooks (ZIP). Nothing is written to disk until you
 * pick — POST /api/statement/upload(-batch) just parses and caches.
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

const fmtDate = (d) => {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}-${m}-${y}`
}

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

// ---------------------------------------------------------------------------
// Account picker — shown once parsing is done, drives the download.
// ---------------------------------------------------------------------------
function AccountPicker({ summary, selected, onToggle, onSelectAll, onSelectNone, onDownload, downloading, error, skipped }) {
  const allSelected = summary.accounts.length > 0 && selected.length === summary.accounts.length
  const canCombined = selected.length > 0
  const canSeparate  = selected.length > 1

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <MetaChip label="PDFs Parsed"  value={summary.file_count} />
        <MetaChip label="Date Range"   value={summary.date_range ? `${fmtDate(summary.date_range.from)} → ${fmtDate(summary.date_range.to)}` : '—'} />
        <MetaChip label="Accounts"     value={summary.accounts.length} />
        <MetaChip label="Total Rows"   value={summary.total_rows} />
      </div>

      {skipped && skipped.length > 0 && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 7,
          background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.25)',
          fontSize: 12, color: '#FACC15' }}>
          ⚠ {skipped.length} file{skipped.length > 1 ? 's' : ''} skipped:
          <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 11, opacity: 0.85 }}>
            {skipped.map((s, i) => <div key={i}>{s}</div>)}
          </div>
        </div>
      )}

      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.7px', textTransform: 'uppercase',
        color: C.textSub, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Accounts detected — pick which to download</span>
        <span style={{ display: 'flex', gap: 10 }}>
          <button onClick={onSelectAll}  style={{ background: 'none', border: 'none', color: C.accent, fontSize: 11, cursor: 'pointer', fontWeight: 700, letterSpacing: 0, textTransform: 'none' }}>Select all</button>
          <button onClick={onSelectNone} style={{ background: 'none', border: 'none', color: C.textSub, fontSize: 11, cursor: 'pointer', fontWeight: 700, letterSpacing: 0, textTransform: 'none' }}>Clear</button>
        </span>
      </div>

      <div style={{ overflowX: 'auto', borderRadius: 8, border: `1px solid ${C.border}`, marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['', 'Client', 'Account', 'Date Range', 'Rows', 'Currencies'].map(h => (
                <th key={h} style={{
                  background: C.thBg, color: C.textMid, padding: '9px 11px', textAlign: 'left',
                  fontWeight: 600, fontSize: 10, letterSpacing: '0.5px', whiteSpace: 'nowrap',
                  borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.colBorder}`,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.accounts.map((a, i) => {
              const isSel = selected.includes(a.account)
              const hasRows = a.row_count > 0
              return (
                <tr key={a.account} style={{ background: i % 2 === 0 ? C.rowEven : C.rowOdd, opacity: hasRows ? 1 : 0.55 }}>
                  <td style={{ padding: '7px 11px', borderBottom: `1px solid ${C.colBorder}`, borderRight: `1px solid ${C.colBorder}` }}>
                    <input type="checkbox" checked={isSel} onChange={() => onToggle(a.account)} style={{ cursor: 'pointer' }} />
                  </td>
                  <td style={{ padding: '7px 11px', color: C.text, borderBottom: `1px solid ${C.colBorder}`, borderRight: `1px solid ${C.colBorder}` }}>{a.client || '—'}</td>
                  <td style={{ padding: '7px 11px', color: C.accent, fontWeight: 600, fontFamily: 'monospace', borderBottom: `1px solid ${C.colBorder}`, borderRight: `1px solid ${C.colBorder}` }}>{a.account || '—'}</td>
                  <td style={{ padding: '7px 11px', color: C.textMid, fontFamily: 'monospace', borderBottom: `1px solid ${C.colBorder}`, borderRight: `1px solid ${C.colBorder}` }}>
                    {a.date_from ? `${fmtDate(a.date_from)} → ${fmtDate(a.date_to)}` : 'no activity'}
                  </td>
                  <td style={{ padding: '7px 11px', color: C.text, fontFamily: 'monospace', borderBottom: `1px solid ${C.colBorder}`, borderRight: `1px solid ${C.colBorder}` }}>{a.row_count}</td>
                  <td style={{ padding: '7px 11px', color: C.textMid, borderBottom: `1px solid ${C.colBorder}`, borderRight: `1px solid ${C.colBorder}` }}>{(a.currencies || []).join(', ') || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {error && (
        <div style={{ background: C.negDim, border: `1px solid ${C.negBorder}`,
          borderRadius: 6, padding: '10px 14px', fontSize: 12, color: C.neg, marginBottom: 14 }}>
          ⚠ {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => onDownload('combined')} disabled={!canCombined || downloading}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 6,
            fontSize: 12, fontWeight: 600, background: canCombined ? C.posDim : 'rgba(255,255,255,0.03)',
            border: `1px solid ${canCombined ? C.posBorder : C.border}`,
            color: canCombined ? C.pos : C.textSub, cursor: canCombined && !downloading ? 'pointer' : 'not-allowed' }}>
          ⬇ Download {selected.length === 1 ? `Account ${selected[0]}` : selected.length > 1 ? `${selected.length} Accounts — Combined Workbook` : 'Combined Workbook'}
        </button>
        {canSeparate && (
          <button onClick={() => onDownload('separate')} disabled={downloading}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 6,
              fontSize: 12, fontWeight: 600, background: C.accentDim, border: `1px solid ${C.accentBorder}`,
              color: C.accent, cursor: downloading ? 'not-allowed' : 'pointer' }}>
            ⬇ Download Separately (ZIP, {selected.length} files)
          </button>
        )}
      </div>
      <div style={{ fontSize: 11, color: C.textSub, marginTop: 10 }}>
        Combined = one workbook, every selected account still tagged and totalled separately inside it — nothing summed across accounts.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function StatementUpload() {
  const [dragging, setDragging] = useState(false)
  const [files,    setFiles]    = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [summary,  setSummary]  = useState(null)   // { batch_token, accounts, date_range, total_rows, file_count, skipped }
  const [selected, setSelected] = useState([])      // selected account numbers
  const [downloading, setDownloading] = useState(false)
  const inputRef = useRef()

  const hasFiles = files.length > 0

  const addFiles = useCallback((incoming) => {
    const pdfs = Array.from(incoming).filter(f => f.name.toLowerCase().endsWith('.pdf'))
    if (!pdfs.length) { setError('Only PDF files are accepted.'); return }
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name))
      return [...prev, ...pdfs.filter(f => !existing.has(f.name))]
    })
    setError(null)
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

  // ── Parse (single or batch — same endpoint shape either way) ─────────────
  const parse = async () => {
    if (!hasFiles) return
    setLoading(true); setError(null); setSummary(null)
    const form = new FormData()
    const isSingle = files.length === 1
    files.forEach(f => form.append(isSingle ? 'file' : 'files', f))
    try {
      const res = await fetch(`${BASE}/api/statement/${isSingle ? 'upload' : 'upload-batch'}`, { method: 'POST', body: form })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Parse failed') }
      const json = await res.json()
      setSummary(json)
      // Default: select every account that actually has trade rows
      setSelected(json.accounts.filter(a => a.row_count > 0).map(a => a.account))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const toggleAccount = (acc) => {
    setSelected(prev => prev.includes(acc) ? prev.filter(a => a !== acc) : [...prev, acc])
  }
  const selectAll  = () => setSummary(s => { if (s) setSelected(s.accounts.map(a => a.account)); return s })
  const selectNone = () => setSelected([])

  // ── Download selected account(s) ──────────────────────────────────────────
  const download = async (mode) => {
    if (!summary || selected.length === 0) return
    setDownloading(true); setError(null)
    try {
      const params = new URLSearchParams({ accounts: selected.join(','), mode })
      const res = await fetch(`${BASE}/api/statement/batch/${summary.batch_token}/download?${params}`)
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'Download failed') }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = mode === 'separate' ? 'AXIA-Statements-By-Account.zip' : `AXIA-Statement_${selected.length === 1 ? selected[0] : 'Combined'}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) { setError(e.message) }
    finally { setDownloading(false) }
  }

  const reset = () => {
    setFiles([]); setSummary(null); setSelected([]); setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div style={{ padding: '20px clamp(14px, 4vw, 24px) 28px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Drop zone — hidden once parsed */}
      {!summary && (
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
          <div style={{ fontSize: 11, color: C.textSub }}>
            or click to browse · PDF only · drop your whole date-range backfill at once — accounts are detected automatically
          </div>
          <input ref={inputRef} type="file" accept=".pdf" multiple style={{ display: 'none' }} onChange={onFileChange} />
        </div>
      )}

      {/* Queued file list */}
      {!summary && hasFiles && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.7px', textTransform: 'uppercase',
            color: C.textSub, marginBottom: 8 }}>
            Queued ({files.length} file{files.length > 1 ? 's' : ''})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 220, overflowY: 'auto' }}>
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

      {/* Error (pre-parse) */}
      {error && !summary && (
        <div style={{ background: C.negDim, border: `1px solid ${C.negBorder}`,
          borderRadius: 6, padding: '10px 14px', fontSize: 12, color: C.neg, marginBottom: 14 }}>
          ⚠ {error}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10, marginBottom: summary ? 20 : 0 }}>
        {!summary && hasFiles && (
          <button onClick={parse} disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 20px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: loading ? 'rgba(255,255,255,0.03)' : C.accentDim,
              border: `1px solid ${loading ? C.border : C.accentBorder}`,
              color: loading ? C.textSub : C.accent,
              cursor: loading ? 'not-allowed' : 'pointer', transition: 'all 0.15s' }}>
            {loading && <span style={{ display: 'inline-block', width: 13, height: 13,
              border: `2px solid ${C.accentBorder}`, borderTop: `2px solid ${C.accent}`,
              borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
            {loading ? `Parsing ${files.length} PDF${files.length > 1 ? 's' : ''}…` : `Parse ${files.length} PDF${files.length > 1 ? 's' : ''}`}
          </button>
        )}
        {(hasFiles || summary) && (
          <button onClick={reset}
            style={{ padding: '9px 18px', borderRadius: 6, fontSize: 12, fontWeight: 500,
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.textSub, cursor: 'pointer' }}>
            {summary ? 'Upload More Statements' : 'Clear'}
          </button>
        )}
      </div>

      {/* Account picker + download */}
      {summary && (
        <AccountPicker
          summary={summary}
          selected={selected}
          onToggle={toggleAccount}
          onSelectAll={selectAll}
          onSelectNone={selectNone}
          onDownload={download}
          downloading={downloading}
          error={error}
          skipped={summary.skipped}
        />
      )}
    </div>
  )
}
