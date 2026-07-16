// frontend/src/pages/Reports.jsx
/**
 * Reports page.
 * Download: Excel | PDF | CSV
 * Upload: Drop daily blotter .zip → extract 8 CSVs → insert into Supabase.
 *   Duplicate detection per table before insert.
 *   Per-table row counts + full error reporting in results modal.
 *
 * ZIP → Table mapping:
 *   balance_*                → balance
 *   balance_history_*        → balance_history
 *   user_accounts_equity_*   → user_accounts_equity
 *   user_activity_*          → user_activity
 *   user_pfees_estimation_*  → user_pfees_estimation
 *   user_position_*          → user_position
 *   user_wallet_movements_*  → user_wallet_movements
 *   user_blotter_*           → SKIP (no table)
 */

import { useState, useRef, useCallback } from 'react'
import JSZip    from 'jszip'
import Papa     from 'papaparse'
import {
  Download, Upload, FileSpreadsheet, FileText, Database,
  CheckCircle, AlertCircle, X, AlertTriangle, Info, ArrowRight,
} from 'lucide-react'
import { supabase }                                from '../lib/supabase.js'
import { downloadExcel, downloadPdf, downloadCsv } from '../services/api.js'
import StatementUpload                             from '../components/StatementUpload.jsx'
import StatementMerge                             from '../components/StatementMerge.jsx'
import AxiaEquityEntry                            from '../components/AxiaEquityEntry.jsx'

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const REPORT_CARDS = [
  { id: 'excel', icon: FileSpreadsheet, title: 'Excel Workbook',
    desc: 'Full institutional metrics workbook — Summary, Pods, Strategies, Traders, Venues, Equity Curve.',
    label: 'Download .xlsx', color: '#34D399', action: () => downloadExcel() },
  { id: 'pdf',   icon: FileText,        title: 'Investor PDF',
    desc: 'Clean investor-facing summary report. Portfolio KPIs, pod overview, performance tables.',
    label: 'Download .pdf',  color: '#F87171', action: () => downloadPdf() },
  { id: 'csv',   icon: Database,        title: 'Raw Data CSV',
    desc: 'Full snapshot data merged with entity metadata. Useful for analysis in Excel or Python.',
    label: 'Download .csv',  color: '#A78BFA', action: () => downloadCsv() },
]

// Ordered so balance_history is checked before balance (prefix conflict)
const TABLE_DEFS = [
  { prefix: 'balance_history',       table: 'balance_history',       label: 'Balance History',
    pkCols: ['Date','Currency'],      dateCol: 'Date', skipDupCheck: true, // cumulative file — always upsert
    rowTransform: r => ({ ...r,
      Wallet: Number(r.Wallet ?? 0), Deposits: Number(r.Deposits ?? 0),
      Withdrawals: Number(r.Withdrawals ?? 0), 'Trader Equity': Number(r['Trader Equity'] ?? 0),
      'Investor Equity': Number(r['Investor Equity'] ?? 0), 'User Equity': Number(r['User Equity'] ?? 0),
    }) },
  { prefix: 'balance',               table: 'balance',               label: 'Balance',
    pkCols: ['Date','Currency'],      dateCol: 'Date',
    rowTransform: r => ({ ...r,
      Wallet: Number(r.Wallet ?? 0), Deposits: Number(r.Deposits ?? 0),
      Withdrawals: Number(r.Withdrawals ?? 0), 'Trader Equity': Number(r['Trader Equity'] ?? 0),
      'Investor Equity': Number(r['Investor Equity'] ?? 0), 'User Equity': Number(r['User Equity'] ?? 0),
    }) },
  { prefix: 'user_accounts_equity',  table: 'user_accounts_equity',  label: 'User Accounts Equity',
    pkCols: ['Date','AccountId'],     dateCol: null },       // text type, trigger normalises
  { prefix: 'user_activity',         table: 'user_activity',         label: 'User Activity',
    pkCols: null,                     dateCol: 'Date' },     // auto-id, dedup trigger
  { prefix: 'user_pfees_estimation', table: 'user_pfees_estimation', label: 'User PFees Estimation',
    pkCols: ['Date','AccountId','Darwin'], dateCol: 'Date',
    dateTransform: v => String(v ?? '').split(' ')[0].split('T')[0], // timestamp → date
    rowTransform: r => ({
      ...r,
      'Charged Close PFees': r['Charged Close PFees'] ?? '0',
      'Net PFees':           r['Net PFees']           ?? '0',
    }) },
  { prefix: 'user_position',         table: 'user_position',         label: 'User Position',
    pkCols: ['Ticket'],               dateCol: null },
  { prefix: 'user_wallet_movements', table: 'user_wallet_movements', label: 'User Wallet Movements',
    pkCols: null,                     dateCol: 'Date' },     // auto-id, dedup trigger
  { prefix: 'user_blotter',           table: 'user_blotter',           label: 'User Blotter',
    pkCols: null,                     dateCol: 'Order Date' }, // auto-id, dedup trigger
]

const SKIP_PREFIXES = [] // all CSVs in blotter have a table
const BATCH = 500

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getTableDef(filename) {
  const lower = filename.toLowerCase()
  for (const s of SKIP_PREFIXES) if (lower.startsWith(s)) return null
  for (const d of TABLE_DEFS)    if (lower.startsWith(d.prefix)) return d
  return undefined
}

function parseCSV(text) {
  const r = Papa.parse(text.trim(), { header: true, dynamicTyping: true, skipEmptyLines: true })
  return { data: r.data, errors: r.errors }
}

function applyTransforms(rows, def) {
  let out = rows
  if (def.dateTransform && def.dateCol)
    out = out.map(r => ({ ...r, [def.dateCol]: def.dateTransform(r[def.dateCol]) }))
  if (def.rowTransform)
    out = out.map(def.rowTransform)
  return out
}

function extractDate(rows, def) {
  if (!def.dateCol || !rows.length) return null
  const raw = rows[0][def.dateCol]
  return def.dateTransform ? def.dateTransform(raw) : String(raw ?? '').split('T')[0].split(' ')[0]
}

async function batchInsert(tableName, rows, pkCols) {
  let inserted = 0
  const errors = []
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const res   = pkCols
      ? await supabase.from(tableName).upsert(batch, { onConflict: pkCols.join(','), ignoreDuplicates: true })
      : await supabase.from(tableName).insert(batch)
    if (res.error) errors.push(res.error.message)
    else           inserted += batch.length
  }
  return { inserted, errors }
}

// ─────────────────────────────────────────────────────────────────────────────
// Download card
// ─────────────────────────────────────────────────────────────────────────────

function ReportCard({ card }) {
  const [loading, setLoading] = useState(false)
  const Icon = card.icon
  async function go() {
    setLoading(true)
    try { await card.action() } finally { setTimeout(() => setLoading(false), 1200) }
  }
  return (
    <div style={{ background:'#111C2B', border:'1px solid #1E3A5F', borderRadius:10,
      padding:24, display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:40, height:40, borderRadius:8, flexShrink:0,
          background:`${card.color}18`, border:`1px solid ${card.color}40`,
          display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Icon size={18} color={card.color} />
        </div>
        <div style={{ fontSize:14, fontWeight:600, color:'#F1F5F9' }}>{card.title}</div>
      </div>
      <div style={{ fontSize:12, color:'#64748B', lineHeight:1.6 }}>{card.desc}</div>
      <button onClick={go} disabled={loading} style={{
        display:'flex', alignItems:'center', justifyContent:'center', gap:8,
        padding:'9px 16px', borderRadius:6, fontSize:12, fontWeight:500, marginTop:'auto',
        border:`1px solid ${card.color}60`, background:loading?`${card.color}10`:`${card.color}18`,
        color:card.color, cursor:loading?'not-allowed':'pointer' }}>
        <Download size={13} />{loading ? 'Preparing...' : card.label}
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-upload confirmation modal — missing files + duplicates + row counts
// ─────────────────────────────────────────────────────────────────────────────

function ConfirmModal({ items, missingFiles, dupItems, onConfirm, onCancel }) {
  const uploadable  = items.filter(i => !i.skipped && !i.empty)
  const totalRows   = uploadable.reduce((s, i) => s + i.rows.length, 0)
  const hasMissing  = missingFiles.length > 0
  const hasDups     = dupItems.length > 0

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.85)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'#0F1923',
        border:`1px solid ${hasMissing ? '#F8717160' : hasDups ? '#F59E0B60' : '#34D39960'}`,
        borderRadius:12, padding:28, maxWidth:820, width:'100%',
        maxHeight:'85vh', overflowY:'auto' }}>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            {hasMissing
              ? <AlertCircle size={20} color="#F87171" />
              : hasDups
                ? <AlertTriangle size={20} color="#F59E0B" />
                : <CheckCircle size={20} color="#34D399" />}
            <div style={{ fontSize:15, fontWeight:700,
              color: hasMissing ? '#F87171' : hasDups ? '#F59E0B' : '#34D399' }}>
              {hasMissing ? `Missing ${missingFiles.length} File${missingFiles.length > 1 ? 's' : ''}` : hasDups ? 'Duplicate Data Detected' : 'Ready to Upload'}
            </div>
          </div>
          <button onClick={onCancel} style={{ background:'none', border:'none', cursor:'pointer', color:'#475569' }}>
            <X size={18} />
          </button>
        </div>

        {/* Missing files */}
        {hasMissing && (
          <div style={{ padding:'12px 14px', borderRadius:8, marginBottom:12,
            background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.3)' }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#F87171', marginBottom:6 }}>
              Missing from ZIP:
            </div>
            {missingFiles.map(m => (
              <div key={m} style={{ fontSize:11, color:'#F87171', fontFamily:'monospace',
                marginBottom:2, marginLeft:4 }}>
                x {m}_*.csv — not found
              </div>
            ))}
            <div style={{ fontSize:11, color:'#94A3B8', marginTop:8 }}>
              You can still proceed. Missing tables will not be updated this run.
            </div>
          </div>
        )}

        {/* Duplicates */}
        {hasDups && (
          <div style={{ padding:'12px 14px', borderRadius:8, marginBottom:12,
            background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.3)' }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#F59E0B', marginBottom:6 }}>
              Already uploaded for this date:
            </div>
            {dupItems.map(d => (
              <div key={d.table} style={{ fontSize:11, color:'#FCD34D', fontFamily:'monospace',
                marginBottom:2, marginLeft:4 }}>
                ! {d.table} — has data for {d.date}
              </div>
            ))}
            <div style={{ fontSize:11, color:'#94A3B8', marginTop:8 }}>
              Dedup triggers will reject exact duplicates. Only new rows will be inserted.
            </div>
          </div>
        )}

        {/* Per-table row counts */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.8px',
            color:'#475569', textTransform:'uppercase', marginBottom:8 }}>
            {uploadable.length} tables · {totalRows.toLocaleString()} total rows to upload
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {items.filter(i => !i.skipped).map(item => (
              <div key={item.csvName} style={{ display:'flex', alignItems:'center',
                justifyContent:'space-between', padding:'8px 12px', borderRadius:6,
                background: item.empty ? 'rgba(100,116,139,0.05)' : 'rgba(52,211,153,0.05)',
                border:`1px solid ${item.empty ? 'rgba(100,116,139,0.15)' : 'rgba(52,211,153,0.15)'}` }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <Database size={11} color={item.empty ? '#475569' : '#34D399'} />
                  <div>
                    <span style={{ fontSize:12, fontWeight:600, fontFamily:'monospace',
                      color:'#E2E8F0' }}>{item.table}</span>
                    <span style={{ fontSize:10, color:'#475569', marginLeft:8 }}>{item.csvName}</span>
                  </div>
                </div>
                <span style={{ fontSize:12, fontWeight:700, color: item.empty ? '#475569' : '#94A3B8' }}>
                  {item.empty ? '0 rows (empty)' : `${item.rows.length.toLocaleString()} rows`}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onCancel} style={{ flex:1, padding:'10px 16px', borderRadius:6,
            fontSize:13, fontWeight:500, background:'rgba(100,116,139,0.12)',
            border:'1px solid rgba(100,116,139,0.25)', color:'#94A3B8', cursor:'pointer' }}>
            Cancel
          </button>
          <button onClick={onConfirm} style={{ flex:2, padding:'10px 16px', borderRadius:6,
            fontSize:13, fontWeight:700,
            background: hasMissing ? 'rgba(248,113,113,0.12)' : 'rgba(14,165,233,0.15)',
            border:`1px solid ${hasMissing ? 'rgba(248,113,113,0.4)' : 'rgba(14,165,233,0.4)'}`,
            color: hasMissing ? '#F87171' : '#38BDF8', cursor:'pointer' }}>
            {hasMissing
              ? `Upload ${totalRows.toLocaleString()} Rows (${missingFiles.length} table${missingFiles.length>1?'s':''} missing)`
              : `Confirm & Upload ${totalRows.toLocaleString()} Rows`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Results modal
// ─────────────────────────────────────────────────────────────────────────────

function ResultsModal({ results, onClose }) {
  const totalRows = results.reduce((s, r) => s + (r.inserted ?? 0), 0)
  const hasErrors = results.some(r => r.errors?.length)

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.85)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'#0F1923',
        border:`1px solid ${hasErrors ? '#F8717160' : '#34D39960'}`,
        borderRadius:12, padding:28, maxWidth:820, width:'100%',
        maxHeight:'80vh', overflowY:'auto' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            {hasErrors
              ? <AlertCircle size={20} color="#F87171" />
              : <CheckCircle size={20} color="#34D399" />}
            <div style={{ fontSize:15, fontWeight:700,
              color: hasErrors ? '#F87171' : '#34D399' }}>
              {hasErrors ? 'Upload Completed with Errors' : 'Upload Successful'}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#475569' }}>
            <X size={18} />
          </button>
        </div>

        {/* Summary */}
        <div style={{ padding:'12px 16px', borderRadius:8, marginBottom:16,
          background: hasErrors ? 'rgba(248,113,113,0.06)' : 'rgba(52,211,153,0.06)',
          border:`1px solid ${hasErrors ? 'rgba(248,113,113,0.2)' : 'rgba(52,211,153,0.2)'}`,
          fontSize:13, color:'#94A3B8' }}>
          <span style={{ fontWeight:600, color:'#F1F5F9' }}>{totalRows.toLocaleString()}</span> rows
          {' '}uploaded across{' '}
          <span style={{ fontWeight:600, color:'#F1F5F9' }}>
            {results.filter(r => !r.skipped).length}
          </span> tables
        </div>

        {/* Per-table */}
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {results.map(r => (
            <div key={r.table + r.csvName} style={{
              padding:'10px 14px', borderRadius:8,
              background: r.skipped
                ? 'rgba(100,116,139,0.05)'
                : r.errors?.length
                  ? 'rgba(248,113,113,0.06)'
                  : 'rgba(52,211,153,0.06)',
              border:`1px solid ${r.skipped
                ? 'rgba(100,116,139,0.15)'
                : r.errors?.length
                  ? 'rgba(248,113,113,0.2)'
                  : 'rgba(52,211,153,0.2)'}` }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {r.skipped
                    ? <Info size={13} color="#475569" />
                    : r.errors?.length
                      ? <AlertCircle size={13} color="#F87171" />
                      : <CheckCircle size={13} color="#34D399" />}
                  <span style={{ fontSize:12, fontWeight:600, fontFamily:'monospace',
                    color: r.skipped ? '#475569' : r.errors?.length ? '#F87171' : '#34D399' }}>
                    {r.table}
                  </span>
                </div>
                {!r.skipped && (
                  <span style={{ fontSize:13, fontWeight:700, color:'#F1F5F9' }}>
                    {(r.inserted ?? 0).toLocaleString()} rows
                  </span>
                )}
                {r.skipped && <span style={{ fontSize:11, color:'#334155' }}>skipped</span>}
              </div>
              <div style={{ fontSize:10, color:'#334155', marginTop:3, marginLeft:21 }}>
                {r.csvName}{r.empty ? ' — empty, no rows' : ''}
                {r.skipped ? ` — ${r.reason}` : ''}
              </div>
              {r.errors?.map((e, i) => (
                <div key={i} style={{ fontSize:11, color:'#F87171', marginTop:4,
                  marginLeft:21, fontFamily:'monospace' }}>✗ {e}</div>
              ))}
            </div>
          ))}
        </div>

        <button onClick={onClose} style={{ width:'100%', marginTop:20, padding:'10px 16px',
          borderRadius:6, fontSize:13, fontWeight:600,
          background:'rgba(14,165,233,0.12)', border:'1px solid rgba(14,165,233,0.35)',
          color:'#38BDF8', cursor:'pointer' }}>
          Done
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload section
// ─────────────────────────────────────────────────────────────────────────────

function UploadSection() {
  const fileRef          = useRef(null)
  const pendingRef          = useRef(null)
  const [dragOver,          setDragOver]       = useState(false)
  const [phase,             setPhase]          = useState('idle')
  const [statusMsg,         setStatusMsg]      = useState('')
  const [preview,           setPreview]        = useState([])
  const [dupItems,          setDupItems]       = useState([])
  const [missingFiles,      setMissingFiles]   = useState([])
  const [showConfirm,       setShowConfirm]    = useState(false)
  const [results,           setResults]        = useState(null)

  const isBusy = ['parsing','checking','uploading'].includes(phase)

  async function processZip(file) {
    if (!file?.name.endsWith('.zip')) { alert('Please select a .zip file.'); return }

    setPhase('parsing'); setStatusMsg('Reading ZIP...'); setPreview([]); setResults(null)

    try {
      const zip   = await JSZip.loadAsync(file)
      const items = []

      setStatusMsg('Parsing CSV files...')

      for (const [fname, entry] of Object.entries(zip.files)) {
        if (entry.dir || !fname.endsWith('.csv')) continue
        const base = fname.split('/').pop()
        const def  = getTableDef(base)

        if (def === null) {
          items.push({ csvName:base, table:'—', def:null, rows:[], skipped:true, reason:'No Supabase table (intentional)' })
          continue
        }
        if (def === undefined) {
          items.push({ csvName:base, table:'—', def:null, rows:[], skipped:true, reason:'Unrecognised filename' })
          continue
        }

        const text           = await entry.async('text')
        const { data, errors } = parseCSV(text)
        items.push({ csvName:base, table:def.table, label:def.label, def, rows:data,
          parseErrors: errors.length ? errors.map(e => e.message) : [], empty: data.length === 0 })
      }

      setPreview(items)
      setPhase('checking'); setStatusMsg('Checking for existing data...')

      // Missing file detection — compare found prefixes against all expected TABLE_DEFS
      const foundPrefixes = items.filter(i => !i.skipped).map(i => i.def.prefix)
      const missing = TABLE_DEFS.filter(d => !foundPrefixes.includes(d.prefix)).map(d => d.prefix)
      setMissingFiles(missing)

      // Duplicate detection
      const dups = []
      for (const item of items) {
        if (item.skipped || item.empty || !item.def?.dateCol || item.def?.skipDupCheck) continue
        const date = extractDate(item.rows, item.def)
        if (!date) continue
        const { count } = await supabase
          .from(item.def.table)
          .select('*', { count:'exact', head:true })
          .eq(`"${item.def.dateCol}"`, date)
        if (count > 0) dups.push({ table: item.def.table, date })
      }

      // Always show confirm modal — with missing/dup warnings + row counts
      setDupItems(dups)
      pendingRef.current = items
      setShowConfirm(true)
      setPhase('idle')
      setStatusMsg('')

    } catch (err) {
      setPhase('idle'); setStatusMsg(`Error: ${err.message}`)
    }
  }

  async function runUpload(items) {
    setShowConfirm(false); setPhase('uploading')
    const res = []

    for (const item of items) {
      if (item.skipped) { res.push({ table:item.table, csvName:item.csvName, skipped:true, reason:item.reason }); continue }
      if (item.empty)   { res.push({ table:item.table, csvName:item.csvName, inserted:0, errors:[], empty:true }); continue }

      setStatusMsg(`Uploading ${item.label}...`)
      const rows = applyTransforms(item.rows, item.def)
      const { inserted, errors } = await batchInsert(item.def.table, rows, item.def.pkCols)
      res.push({ table:item.def.table, csvName:item.csvName, inserted,
        errors:[...(item.parseErrors ?? []), ...errors] })
    }

    setResults(res); setPhase('done'); setStatusMsg(''); setPreview([])
  }

  const onDrop = useCallback(async e => {
    e.preventDefault(); setDragOver(false)
    await processZip(e.dataTransfer.files[0])
  }, [])

  const onFile = useCallback(async e => {
    const f = e.target.files[0]; if (f) await processZip(f); e.target.value = ''
  }, [])

  return (
    <div style={{ background:'#111C2B', border:'1px solid #1E3A5F',
      borderRadius:10, padding:28, marginTop:32 }}>

      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
        <Upload size={16} color="#38BDF8" />
        <div style={{ fontSize:14, fontWeight:700, color:'#F1F5F9' }}>Upload Daily Blotter</div>
      </div>
      <div style={{ fontSize:12, color:'#64748B', marginBottom:20, lineHeight:1.7 }}>
        Drop the daily blotter{' '}
        <span style={{ fontFamily:'monospace', color:'#94A3B8' }}>.zip</span> file to
        automatically extract all 8 CSVs and load them into their Supabase tables.
        Duplicate rows are rejected by database triggers — no double-counting possible.
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e  => { e.preventDefault(); if (!isBusy) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={isBusy ? e => e.preventDefault() : onDrop}
        onClick={() => !isBusy && fileRef.current?.click()}
        style={{
          border:     `2px dashed ${dragOver ? '#0EA5E9' : '#1E3A5F'}`,
          borderRadius:10, padding:'36px 24px', textAlign:'center',
          cursor:     isBusy ? 'not-allowed' : 'pointer',
          background: dragOver ? 'rgba(14,165,233,0.05)' : 'rgba(255,255,255,0.01)',
          transition: 'all 0.15s',
        }}
      >
        {isBusy ? (
          <>
            <div style={{ fontSize:22, marginBottom:10 }}>⏳</div>
            <div style={{ fontSize:13, fontWeight:600, color:'#38BDF8' }}>{statusMsg}</div>
            <div style={{ fontSize:11, color:'#334155', marginTop:4 }}>Please wait...</div>
          </>
        ) : (
          <>
            <Upload size={26} color={dragOver ? '#38BDF8' : '#334155'}
              style={{ margin:'0 auto 12px', display:'block' }} />
            <div style={{ fontSize:13, fontWeight:600, color: dragOver ? '#38BDF8' : '#94A3B8' }}>
              Drop <span style={{ fontFamily:'monospace' }}>fwdailyblotter*.zip</span> here
            </div>
            <div style={{ fontSize:11, color:'#334155', marginTop:4 }}>or click to browse</div>
          </>
        )}
      </div>

      <input ref={fileRef} type="file" accept=".zip" style={{ display:'none' }} onChange={onFile} />

      {/* Preview */}
      {preview.length > 0 && !isBusy && (
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.8px',
            color:'#475569', textTransform:'uppercase', marginBottom:10 }}>
            Files found in ZIP
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {preview.map(item => (
              <div key={item.csvName} style={{ display:'flex', alignItems:'center',
                justifyContent:'space-between', padding:'9px 14px', borderRadius:7,
                background: item.skipped ? 'rgba(100,116,139,0.06)' : 'rgba(52,211,153,0.06)',
                border:`1px solid ${item.skipped ? 'rgba(100,116,139,0.2)' : 'rgba(52,211,153,0.2)'}` }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <Database size={12} color={item.skipped ? '#475569' : '#34D399'} />
                  <div>
                    <span style={{ fontSize:11, fontFamily:'monospace', fontWeight:500,
                      color: item.skipped ? '#475569' : '#E2E8F0' }}>{item.csvName}</span>
                    {!item.skipped && (
                      <span style={{ fontSize:10, color:'#64748B', marginLeft:8 }}>
                        → <span style={{ fontFamily:'monospace' }}>{item.table}</span>
                      </span>
                    )}
                    {item.skipped && (
                      <span style={{ fontSize:10, color:'#334155', marginLeft:8 }}>{item.reason}</span>
                    )}
                  </div>
                </div>
                <span style={{ fontSize:11, fontWeight:600, color:'#94A3B8' }}>
                  {item.skipped ? '—' : item.empty ? '0 rows' : `${item.rows.length.toLocaleString()} rows`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {statusMsg.startsWith('Error') && (
        <div style={{ marginTop:12, padding:'10px 14px', borderRadius:7,
          background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.25)',
          fontSize:12, color:'#F87171' }}>{statusMsg}</div>
      )}

      {/* Table map reference */}
      <div style={{ marginTop:20, padding:'14px 16px', borderRadius:8,
        background:'rgba(14,165,233,0.04)', border:'1px solid rgba(14,165,233,0.12)' }}>
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.8px',
          color:'#334155', textTransform:'uppercase', marginBottom:10 }}>
          CSV → Table Mapping
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'5px 24px' }}>
          {TABLE_DEFS.map(d => (
            <div key={d.table} style={{ display:'flex', alignItems:'center', gap:6 }}>
              <ArrowRight size={9} color="#334155" />
              <span style={{ fontSize:10, fontFamily:'monospace', color:'#64748B' }}>{d.prefix}_*</span>
              <span style={{ fontSize:10, color:'#334155' }}>→</span>
              <span style={{ fontSize:10, fontFamily:'monospace', color:'#475569' }}>{d.table}</span>
            </div>
          ))}

        </div>
      </div>

      {/* Confirm modal — missing files + duplicates + row count preview */}
      {showConfirm && (
        <ConfirmModal
          items={pendingRef.current ?? []}
          missingFiles={missingFiles}
          dupItems={dupItems}
          onConfirm={() => runUpload(pendingRef.current)}
          onCancel={() => { setShowConfirm(false); setPhase('idle'); setPreview([]); setStatusMsg('') }}
        />
      )}

      {/* Results modal */}
      {results && phase === 'done' && (
        <ResultsModal results={results} onClose={() => { setResults(null); setPhase('idle') }} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function Reports() {
  return (
    <div style={{ padding:'16px 24px 48px', maxWidth:1400 }}>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:600, color:'#F1F5F9', margin:0 }}>Reports</h1>
        <div style={{ fontSize:11, color:'#475569', marginTop:3 }}>
          Download institutional reports · Upload daily blotter data
        </div>
      </div>
      <div style={{ padding:'10px 14px', borderRadius:6, marginBottom:24,
        background:'rgba(14,165,233,0.06)', border:'1px solid rgba(14,165,233,0.15)',
        fontSize:11, color:'#475569', lineHeight:1.6 }}>
        Reports reflect the latest available data snapshot.
        Past performance is not indicative of future results. For authorised personnel only.
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:16 }}>
        {REPORT_CARDS.map(c => <ReportCard key={c.id} card={c} />)}
      </div>
      <UploadSection />

      {/* AXIA Statement Parser */}
      <div style={{ marginTop:36 }}>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:600, color:'#F1F5F9', marginBottom:3 }}>
            AXIA Statement Parser
          </div>
          <div style={{ fontSize:11, color:'#475569' }}>
            Upload a daily detail PDF statement → parsed preview + formatted Excel workbook download.
          </div>
        </div>
        <div style={{
          background:'#111C2B', border:'1px solid #1E3A5F',
          borderRadius:10, overflow:'hidden',
        }}>
          <StatementUpload />
        </div>
      </div>

      {/* AXIA Statement Merge */}
      <div style={{ marginTop:36 }}>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:600, color:'#F1F5F9', marginBottom:3 }}>
            AXIA Statement Merge
          </div>
          <div style={{ fontSize:11, color:'#475569' }}>
            Drop multiple single-day Excel statements → merged chronological Excel ready for Analysis tab.
          </div>
        </div>
        <div style={{
          background:'#111C2B', border:'1px solid #1E3A5F',
          borderRadius:10, overflow:'hidden',
        }}>
          <StatementMerge />
        </div>
      </div>

      {/* AXIA Daily Equity Entry */}
      <div style={{ marginTop:36 }}>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:600, color:'#F1F5F9', marginBottom:3 }}>
            AXIA Daily Equity (NLV)
          </div>
          <div style={{ fontSize:11, color:'#475569' }}>
            Record daily Net Liquid Value + CHG NLV for AXIA strategy — Alpha Pod.
            CHG NLV auto-calculated from previous record where available.
          </div>
        </div>
        <div style={{
          background:'#111C2B', border:'1px solid #1E3A5F',
          borderRadius:10, overflow:'hidden',
        }}>
          <AxiaEquityEntry />
        </div>
      </div>
    </div>
  )
}
