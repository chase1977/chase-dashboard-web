// frontend/src/hooks/useIsMobile.js
/**
 * Returns true when viewport width is at or below the mobile breakpoint.
 * Used to switch layout-critical inline styles (grid columns, flex direction,
 * nav layout) between desktop and phone without altering desktop output —
 * desktop path (isMobile === false) is byte-identical to the pre-existing
 * unconditional styles.
 *
 * Breakpoint: 768px (matches Tailwind's `md`).
 */

import { useState, useEffect } from 'react'

const BREAKPOINT = 768

export default function useIsMobile(breakpoint = BREAKPOINT) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false
  )

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const handler = (e) => setIsMobile(e.matches)
    setIsMobile(mq.matches)
    if (mq.addEventListener) mq.addEventListener('change', handler)
    else mq.addListener(handler)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler)
      else mq.removeListener(handler)
    }
  }, [breakpoint])

  return isMobile
}
