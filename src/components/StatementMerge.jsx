// frontend/src/components/StatementMerge.jsx
/**
 * StatementMerge
 * Drop multiple AXIA single-day Excel files → POST /api/statement/merge
 * → download one merged chronological Excel.
 */

import { useState, useRef, useCallback } from 'react'
import { Upload, FileSpreadsheet, X, CheckCircle, Loader, Merge } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function StatementMerge() {
  const [files, setFiles]       = useState([])
  const [loading, setLoading]   = useState(false)
  const [done, setDone]         = useState(false)
  const [error, setError]       = useState(null)
  const inputRef                = useRef(null)

  const addFiles = useCallback((incoming) => {
    setDone(false)
    setError(null)
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name))
      const fresh    = Array.from(incoming).filter(
        f => f.name.endsWith('.xlsx') && !existing.has(f.name)
      )
      return [...prev, ...fresh]
    })
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    addFiles(e.dataTransfer.files)
  }, [addFiles])

  const onDragOver = (e) => e.preventDefault()

  const removeFile = (name) => {
    setFiles(prev => prev.filter(f => f.name !== name))
    setDone(false)
    setError(null)
  }

  const handleMerge = async () => {
    if (files.length < 2) return
    setLoading(true)
    setError(null)
    setDone(false)

    const fd = new FormData()
    files.forEach(f => fd.append('files', f))

    try {
      const res = await fetch(`${API}/api/statement/merge`, { method: 'POST', body: fd })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail || `Server error ${res.status}`)
      }
      const blob     = await res.blob()
      const url      = URL.createObjectURL(blob)
      const a        = document.createElement('a')
      a.href         = url
      a.download     = 'AXIA-Merged-Statement.xlsx'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const canMerge = files.length >= 2 && !loading

  return (
    <div style={{ padding: 24 }}>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onClick={() => inputRef.current?.click()}
        style={{
          border: '2px dashed #1E3A5F',
          borderRadius: 10,
          padding: '28px 20px',
          textAlign: 'center',
          cursor: 'pointer',
          background: 'rgba(14,165,233,0.03)',
          transition: 'border-color 0.2s',
        }}
        onMouseEnter={e => e.currentTarget.style.borderColor = '#0EA5E9'}
        onMouseLeave={e => e.currentTarget.style.borderColor = '#1E3A5F'}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          style={{ display: 'none' }}
          onChange={e => { addFiles(e.target.files); e.target.value = '' }}
        />
        <Upload size={28} color="#0EA5E9" style={{ marginBottom: 8 }} />
        <div style={{ fontSize: 13, fontWeight: 600, color: '#F1F5F9', marginBottom: 4 }}>
          {files.length === 0
            ? 'Drop AXIA statement Excel files here'
            : `${files.length} file${files.length > 1 ? 's' : ''} queued — drop more to add`}
        </div>
        <div style={{ fontSize: 11, color: '#475569' }}>
          .xlsx only · minimum 2 files · sorted chronologically on merge
        </div>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {files.map(f => (
            <div key={f.name} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', borderRadius: 7,
              background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.15)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileSpreadsheet size={14} color="#0EA5E9" />
                <span style={{ fontSize: 12, color: '#CBD5E1', fontFamily: 'monospace' }}>
                  {f.name}
                </span>
              </div>
              <button
                onClick={() => removeFile(f.name)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 2 }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          marginTop: 14, padding: '10px 14px', borderRadius: 7,
          background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)',
          fontSize: 12, color: '#F87171',
        }}>
          {error}
        </div>
      )}

      {/* Success */}
      {done && (
        <div style={{
          marginTop: 14, padding: '10px 14px', borderRadius: 7, display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)',
          fontSize: 12, color: '#34D399',
        }}>
          <CheckCircle size={14} />
          Merged Excel downloaded successfully.
        </div>
      )}

      {/* Action */}
      <div style={{ marginTop: 18, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          onClick={handleMerge}
          disabled={!canMerge}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 22px', borderRadius: 8, border: 'none', cursor: canMerge ? 'pointer' : 'not-allowed',
            background: canMerge ? '#0EA5E9' : '#1E293B',
            color: canMerge ? '#fff' : '#475569',
            fontSize: 13, fontWeight: 600, transition: 'background 0.2s',
          }}
        >
          {loading
            ? <><Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> Merging…</>
            : <><Merge size={15} /> Merge & Download ({files.length} files)</>}
        </button>
        {files.length > 0 && (
          <button
            onClick={() => { setFiles([]); setDone(false); setError(null) }}
            style={{
              padding: '10px 16px', borderRadius: 8, border: '1px solid #1E3A5F',
              background: 'none', color: '#475569', fontSize: 12, cursor: 'pointer',
            }}
          >
            Clear all
          </button>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
