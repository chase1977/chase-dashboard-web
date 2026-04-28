// frontend/src/components/layout/Navbar.jsx
/**
 * Top navigation bar.
 * Contains: logo | nav links (Portfolio/Pods/Strategies/Traders/Venues/Reports)
 *           | time range chips | user avatar
 *
 * Props:
 *   timeRange     {string}   currently selected time range
 *   onTimeRange   {function} called with new time range string
 */

import { Link, useLocation } from 'react-router-dom'
import { Clock } from 'lucide-react'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const NAV_LINKS = [
  { label: 'Portfolio',   path: '/'            },
  { label: 'Pods',        path: '/pods'         },
  { label: 'Strategies',  path: '/strategies'   },
  { label: 'Traders',     path: '/traders'      },
  { label: 'Venues',      path: '/venues'       },
  { label: 'Reports',     path: '/reports'      },
]

const TIME_RANGES = ['1D', '7D', '30D', 'YTD', 'SI']


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Navbar({ timeRange, onTimeRange }) {
  const { pathname } = useLocation()

  return (
    <nav
      style={{
        background:   '#0D1B2E',
        borderBottom: '1px solid #1E3A5F',
        height:       '56px',
        display:      'flex',
        alignItems:   'center',
        padding:      '0 24px',
        justifyContent: 'space-between',
        position:     'sticky',
        top:          0,
        zIndex:       100,
      }}
    >
      {/* ── Left: logo + nav links ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>

        {/* Logo */}
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10, marginRight: 28 }}>
          <img
            src="/chase-logo.png"
            alt="Chase Capital"
            style={{
              width:        32,
              height:       32,
              borderRadius: 6,
              objectFit:    'contain',
              flexShrink:   0,
            }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#F1F5F9', lineHeight: 1.2 }}>
              Chase Capital
            </div>
            <div style={{ fontSize: 9, color: '#475569', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
              Multi-Strategy
            </div>
          </div>
        </Link>

        {/* Nav links */}
        <div style={{ display: 'flex', gap: 2 }}>
          {NAV_LINKS.map(({ label, path }) => {
            const active = path === '/'
              ? pathname === '/'
              : pathname.startsWith(path)

            return (
              <Link
                key={path}
                to={path}
                style={{
                  padding:         '5px 12px',
                  borderRadius:    6,
                  fontSize:        13,
                  fontWeight:      500,
                  textDecoration:  'none',
                  color:           active ? '#38BDF8' : '#64748B',
                  background:      active ? '#1E3A5F' : 'transparent',
                  transition:      'all 0.15s',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    e.currentTarget.style.background = '#162032'
                    e.currentTarget.style.color      = '#94A3B8'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color      = '#64748B'
                  }
                }}
              >
                {label}
              </Link>
            )
          })}
        </div>
      </div>

      {/* ── Right: time range + avatar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>

        {/* Time range chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={12} color="#475569" style={{ marginRight: 4 }} />
          {TIME_RANGES.map(tr => {
            const active = tr === timeRange
            return (
              <button
                key={tr}
                onClick={() => onTimeRange(tr)}
                style={{
                  padding:      '3px 9px',
                  borderRadius: 20,
                  fontSize:     11,
                  fontWeight:   500,
                  border:       active ? '1px solid #0EA5E9' : '1px solid #1E3A5F',
                  background:   active ? 'rgba(14,165,233,0.12)' : '#162032',
                  color:        active ? '#38BDF8' : '#475569',
                  cursor:       'pointer',
                  transition:   'all 0.15s',
                }}
              >
                {tr}
              </button>
            )
          })}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 20, background: '#1E3A5F' }} />

        {/* User avatar */}
        <div style={{ fontSize: 11, color: '#475569' }}>Josh M.</div>
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: '#1E3A5F',
          border:     '1px solid #2E5280',
          display:    'flex', alignItems: 'center', justifyContent: 'center',
          fontSize:   11, fontWeight: 600, color: '#38BDF8',
          cursor:     'pointer',
        }}>
          JM
        </div>
      </div>
    </nav>
  )
}
