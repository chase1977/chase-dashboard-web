// frontend/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {

      // ---------------------------------------------------------------------------
      // Design tokens — the entire visual language lives here.
      // Change these and the whole dashboard updates consistently.
      // ---------------------------------------------------------------------------

      colors: {
        // Page / surface backgrounds
        bg: {
          page:    '#0B1420',   // outermost page
          surface: '#0D1B2E',   // navbar, panels
          card:    '#111C2B',   // KPI cards, chart panels
          row:     '#0D1728',   // table rows (base)
          rowAlt:  '#162032',   // table rows (alternating)
          border:  '#1E3A5F',   // all borders
        },
        // Text
        text: {
          primary:  '#F1F5F9',
          secondary:'#94A3B8',
          muted:    '#475569',
          hint:     '#334155',
        },
        // Brand accent
        accent: {
          DEFAULT: '#0EA5E9',
          hover:   '#38BDF8',
          dim:     '#0EA5E920',
        },
        // Semantic
        pos:  '#34D399',    // positive return (green)
        neg:  '#F87171',    // negative return (red)
        warn: '#F59E0B',    // warning (amber)
      },

      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        'xs':   ['11px', { lineHeight: '16px' }],
        'sm':   ['12px', { lineHeight: '18px' }],
        'base': ['13px', { lineHeight: '20px' }],
        'md':   ['14px', { lineHeight: '20px' }],
        'lg':   ['16px', { lineHeight: '24px' }],
        'xl':   ['18px', { lineHeight: '28px' }],
        '2xl':  ['22px', { lineHeight: '30px' }],
      },

      borderRadius: {
        sm:  '4px',
        md:  '6px',
        lg:  '8px',
        xl:  '12px',
      },

      // Pod colour palette (assign one colour per pod consistently)
      // Used in donut charts, bar charts, pod labels
      pod: {
        1: '#0EA5E9',   // blue
        2: '#F59E0B',   // amber
        3: '#34D399',   // green
        4: '#A78BFA',   // purple
        5: '#F472B6',   // pink
      },
    },
  },
  plugins: [],
}
