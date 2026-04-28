// frontend/src/components/ConfirmModal.jsx
/**
 * ConfirmModal — reusable confirmation dialog.
 *
 * Props:
 *   title      {string}              Dialog title
 *   message    {string}              Body text
 *   onConfirm  {function}            Called on confirm
 *   onCancel   {function}            Called on cancel / close
 *   variant    {'default'|'delete'}
 *              default → green Confirm, red Cancel
 *              delete  → red Confirm, grey Cancel  (for destructive actions)
 *   confirmLabel  {string}           Override confirm button text
 *   cancelLabel   {string}           Override cancel button text
 *   loading    {boolean}             Disables buttons while async op runs
 */

import { useEffect } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'

export default function ConfirmModal({
  title        = 'Confirm Action',
  message      = 'Are you sure?',
  onConfirm,
  onCancel,
  variant      = 'default',
  confirmLabel,
  cancelLabel,
  loading      = false,
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && !loading) onCancel?.() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCancel, loading])

  const isDelete = variant === 'delete'

  // Button colours
  // default: Confirm = green (#34D399 bg), Cancel = red (#F87171 bg)
  // delete:  Confirm = red  (#F87171 bg), Cancel = grey (#334155 bg)
  const confirmBg     = isDelete ? '#ef4444' : '#22c55e'
  const confirmHover  = isDelete ? '#dc2626' : '#16a34a'
  const cancelBg      = isDelete ? '#374151' : '#dc2626'
  const cancelHover   = isDelete ? '#4b5563' : '#b91c1c'

  const confirmText = confirmLabel ?? (isDelete ? 'Delete'  : 'Confirm')
  const cancelText  = cancelLabel  ?? (isDelete ? 'Cancel'  : 'Cancel')

  const iconBg    = isDelete ? 'rgba(239,68,68,0.12)'  : 'rgba(34,197,94,0.10)'
  const iconColor = isDelete ? '#f87171'               : '#34d399'

  return (
    <div
      style={{
        position:   'fixed', inset: 0, zIndex: 200,
        display:    'flex', alignItems: 'center', justifyContent: 'center',
        padding:    16,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={() => !loading && onCancel?.()}
    >
      <div
        style={{
          position:    'relative',
          width:       '100%',
          maxWidth:    420,
          background:  '#0D1B2E',
          border:      `1px solid ${isDelete ? 'rgba(239,68,68,0.25)' : 'rgba(30,58,95,0.8)'}`,
          borderRadius: 14,
          padding:     '24px 24px 20px',
          boxShadow:   '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Icon + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: iconBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {isDelete
              ? <Trash2     size={16} color={iconColor} />
              : <AlertTriangle size={16} color={iconColor} />
            }
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#F1F5F9' }}>{title}</div>
        </div>

        {/* Message */}
        <p style={{
          fontSize:   13,
          color:      '#94A3B8',
          lineHeight: 1.6,
          marginBottom: 22,
        }}>
          {message}
        </p>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {/* Cancel */}
          <button
            onClick={() => !loading && onCancel?.()}
            disabled={loading}
            style={{
              padding:      '8px 18px',
              borderRadius: 8,
              border:       'none',
              cursor:       loading ? 'not-allowed' : 'pointer',
              fontSize:     12,
              fontWeight:   600,
              background:   cancelBg,
              color:        '#F1F5F9',
              opacity:      loading ? 0.5 : 1,
              transition:   'background 0.15s',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = cancelHover }}
            onMouseLeave={e => { e.currentTarget.style.background = cancelBg }}
          >
            {cancelText}
          </button>

          {/* Confirm */}
          <button
            onClick={() => !loading && onConfirm?.()}
            disabled={loading}
            style={{
              padding:      '8px 18px',
              borderRadius: 8,
              border:       'none',
              cursor:       loading ? 'not-allowed' : 'pointer',
              fontSize:     12,
              fontWeight:   600,
              background:   confirmBg,
              color:        '#fff',
              opacity:      loading ? 0.7 : 1,
              transition:   'background 0.15s',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = confirmHover }}
            onMouseLeave={e => { e.currentTarget.style.background = confirmBg }}
          >
            {loading ? 'Working…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
