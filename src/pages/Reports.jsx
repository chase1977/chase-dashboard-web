// frontend/src/pages/Reports.jsx
/**
 * Reports page.
 *
 * Download section: Excel workbook | Investor PDF | Raw CSV
 *
 * Upload section: queue up to 3 CSV files (entities, snapshots, equity_curve),
 * review them, then submit all at once with a single button.
 * Nothing is uploaded until the user clicks Submit.
 */

import { useState, useRef } from 'react'
import {
  Download, Upload, FileSpreadsheet, FileText,
  Database, CheckCircle, AlertCircle, X, Send,
} from 'lucide-react'
import { downloadExcel, downloadPdf, downloadCsv, uploadCsv } from '../services/api.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPORT_CARDS = [
  {
    id:    'excel',
    icon:  FileSpreadsheet,
    title: 'Excel Workbook',
    desc:  'Full institutional metrics workbook. Sheets for Summary, Pods, Strategies, Traders, Venues and Equity Curve.',
    label: 'Download .xlsx',
    color: '#34D399',
    action: () => downloadExcel(),
  },
  {
    id:    'pdf',
    icon:  FileText,
    title: 'Investor PDF',
    desc:  'Clean investor-facing summary report. Portfolio KPIs, pod overview, and performance tables.',
    label: 'Download .pdf',
    color: '#F87171',
    action: () => downloadPdf(),
  },
  {
    id:    'csv',
    icon:  Database,
    title: 'Raw Data CSV',
    desc:  'Full snapshot data merged with entity metadata. Useful for further analysis in Excel or Python.',
    label: 'Download .csv',
    color: '#A78BFA',
    action: () => downloadCsv(),
  },
]

// The three canonical filenames the backend accepts
const ALLOWED = ['entities.csv', 'snapshots.csv', 'equity_curve.csv']

// Friendly label for each file
const FILE_LABELS = {
  'entities.csv':     'Entity tree (hierarchy)',
  'snapshots.csv':    'Snapshot metrics (trader data)',
  'equity_curve.csv': 'Equity curve (time series)',
}


// ---------------------------------------------------------------------------
// Download card
// ---------------------------------------------------------------------------

function ReportCard({ card }) {
  const [loading, setLoading] = useState(false)
  const Icon = card.icon

  async function handleClick() {
    setLoading(true)
    try { await card.action() }
    finally { setTimeout(() => setLoading(false), 1200) }
  }

  return (
    <div style={{
      background: '#111C2B', border: '1px solid #1E3A5F',
      borderRadius: 10, padding: 24,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 8, flexShrink: 0,
          background: `${card.color}18`, border: `1px solid ${card.color}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={18} color={card.color} />
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#F1F5F9' }}>{card.title}</div>
      </div>
      <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.6 }}>{card.desc}</div>
      <button
        onClick={handleClick}
        disabled={loading}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '9px 16px', borderRadius: 6, fontSize: 12, fontWeight: 500,
          border: `1px solid ${card.color}60`,
          background: loading ? `${card.color}10` : `${card.color}18`,
          color: card.color,
          cursor: loading ? 'not-allowed' : 'pointer',
          marginTop: 'auto',
        }}
      >
        <Download size={13} />
        {loading ? 'Preparing...' : card.label}
      </button>
    </div>
  )
}


// ---------------------------------------------------------------------------
// Upload section — queue files then submit all at once
// ---------------------------------------------------------------------------

function UploadSection() {
  const fileRef                   = useRef(null)
  const [queue, setQueue]         = useState([])   // [{file, name, valid, label}]
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults]     = useState([])   // [{name, ok, message}]
  const [dragOver, setDragOver]   = useState(false)

  function addFiles(fileList) {
    const incoming = Array.from(fileList)
    setResults([])   // clear previous results when new files added

    incoming.forEach(file => {
      const valid = ALLOWED.includes(file.name)
      // Replace if same filename already queued
      setQueue(prev => {
        const filtered = prev.filter(q => q.name !== file.name)
        return [...filtered, {
          file,
          name:  file.name,
          valid,
          label: FILE_LABELS[file.name] ?? file.name,
        }]
      })
    })
  }

  function removeFromQueue(name) {
    setQueue(prev => prev.filter(q => q.name !== name))
  }

  async function handleSubmit() {
    const validQueue = queue.filter(q => q.valid)
    if (!validQueue.length) return

    setSubmitting(true)
    setResults([])
    const outcome = []

    for (const item of validQueue) {
      try {
        await uploadCsv(item.file)
        outcome.push({ name: item.name, ok: true,  message: 'Uploaded successfully' })
      } catch (err) {
        outcome.push({ name: item.name, ok: false, message: err.message })
      }
    }

    setResults(outcome)
    setQueue([])
    setSubmitting(false)

    if (fileRef.current) fileRef.current.value = ''
  }

  const hasValidFiles  = queue.some(q => q.valid)
  const hasInvalidFiles = queue.some(q => !q.valid)

  return (
    <div style={{
      background: '#111C2B', border: '1px solid #1E3A5F',
      borderRadius: 10, padding: 24, marginTop: 32,
    }}>
      {/* Header */}
      <div style={{ fontSize: 14, fontWeight: 600, color: '#F1F5F9', marginBottom: 6 }}>
        Upload Data Files
      </div>
      <div style={{ fontSize: 12, color: '#64748B', marginBottom: 16, lineHeight: 1.6 }}>
        Add one or more CSV files to the queue, then click Submit to upload them all at once.
        Files must be named exactly:
        {ALLOWED.map((n, i) => (
          <span key={n}>
            {i > 0 ? (i === ALLOWED.length - 1 ? ' or ' : ', ') : ' '}
            <span style={{ color: '#94A3B8', fontFamily: 'monospace', fontSize: 11 }}>{n}</span>
          </span>
        ))}.
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e  => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault()
          setDragOver(false)
          addFiles(e.dataTransfer.files)
        }}
        onClick={() => fileRef.current?.click()}
        style={{
          border:     `1px dashed ${dragOver ? '#0EA5E9' : '#1E3A5F'}`,
          borderRadius: 8, padding: '24px',
          textAlign:  'center', cursor: 'pointer',
          background: dragOver ? 'rgba(14,165,233,0.05)' : 'transparent',
          transition: 'all 0.15s',
        }}
      >
        <Upload size={20} color={dragOver ? '#38BDF8' : '#334155'}
          style={{ margin: '0 auto 8px', display: 'block' }} />
        <div style={{ fontSize: 12, color: dragOver ? '#38BDF8' : '#475569' }}>
          Drag and drop CSV files here, or click to browse
        </div>
        <div style={{ fontSize: 10, color: '#334155', marginTop: 4 }}>
          You can add multiple files — nothing uploads until you click Submit
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv"
        multiple
        style={{ display: 'none' }}
        onChange={e => addFiles(e.target.files)}
      />

      {/* Queue */}
      {queue.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.6px',
            textTransform: 'uppercase', color: '#475569', marginBottom: 8,
          }}>
            Queued for upload ({queue.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {queue.map(item => (
              <div
                key={item.name}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '9px 12px', borderRadius: 6,
                  background: item.valid
                    ? 'rgba(52,211,153,0.06)'
                    : 'rgba(248,113,113,0.06)',
                  border: `1px solid ${item.valid
                    ? 'rgba(52,211,153,0.2)'
                    : 'rgba(248,113,113,0.2)'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Database size={13} color={item.valid ? '#34D399' : '#F87171'} />
                  <div>
                    <div style={{
                      fontSize: 12, fontWeight: 500,
                      color: item.valid ? '#E2E8F0' : '#F87171',
                      fontFamily: 'monospace',
                    }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>
                      {item.valid ? item.label : 'Invalid filename — will be skipped'}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => removeFromQueue(item.name)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#334155', padding: 4,
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>

          {/* Invalid file warning */}
          {hasInvalidFiles && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              marginTop: 8, fontSize: 11, color: '#F59E0B',
            }}>
              <AlertCircle size={12} />
              Files with invalid names will be skipped on submit.
            </div>
          )}

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={submitting || !hasValidFiles}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', marginTop: 14,
              padding: '10px 16px', borderRadius: 6,
              fontSize: 13, fontWeight: 600,
              background: hasValidFiles && !submitting
                ? 'rgba(14,165,233,0.15)'
                : 'rgba(14,165,233,0.05)',
              border: `1px solid ${hasValidFiles && !submitting
                ? 'rgba(14,165,233,0.5)'
                : 'rgba(14,165,233,0.15)'}`,
              color: hasValidFiles && !submitting ? '#38BDF8' : '#334155',
              cursor: hasValidFiles && !submitting ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s',
            }}
          >
            <Send size={14} />
            {submitting
              ? 'Uploading...'
              : `Submit ${queue.filter(q => q.valid).length} file${queue.filter(q => q.valid).length !== 1 ? 's' : ''}`
            }
          </button>
        </div>
      )}

      {/* Results after submission */}
      {results.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.6px',
            textTransform: 'uppercase', color: '#475569', marginBottom: 4,
          }}>
            Upload results
          </div>
          {results.map(r => (
            <div
              key={r.name}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 12px', borderRadius: 6, fontSize: 12,
                background: r.ok ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)',
                border: `1px solid ${r.ok ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`,
                color:  r.ok ? '#34D399' : '#F87171',
              }}
            >
              {r.ok
                ? <CheckCircle size={13} style={{ flexShrink: 0 }} />
                : <AlertCircle size={13} style={{ flexShrink: 0 }} />
              }
              <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{r.name}</span>
              <span style={{ color: '#64748B', marginLeft: 4 }}>— {r.message}</span>
            </div>
          ))}
          {results.every(r => r.ok) && (
            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
              Refresh the page to see updated data.
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Reports() {
  return (
    <div style={{ padding: '16px 24px 48px', maxWidth: 900 }}>

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#F1F5F9', margin: 0 }}>
          Reports
        </h1>
        <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>
          Download institutional reports or upload updated data files
        </div>
      </div>

      {/* Disclaimer */}
      <div style={{
        padding: '10px 14px', borderRadius: 6, marginBottom: 24,
        background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.15)',
        fontSize: 11, color: '#475569', lineHeight: 1.6,
      }}>
        Reports reflect the latest available data snapshot.
        Past performance is not indicative of future results.
        For authorised personnel only.
      </div>

      {/* Download cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {REPORT_CARDS.map(card => <ReportCard key={card.id} card={card} />)}
      </div>

      {/* Upload section */}
      <UploadSection />

    </div>
  )
}