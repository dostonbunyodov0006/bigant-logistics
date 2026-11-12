/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14181f',
        graphite: '#2b313b',
        slate: { DEFAULT: '#5b6470', light: '#8a93a0' },
        mist: '#e6e9ef',
        paper: '#f6f7f9',
        card: '#ffffff',
        brand: { DEFAULT: '#e2630b', dark: '#b94e06', tint: '#fdf0e6' },
        // Seller board (dark island — scoped to the board subtree, not the console).
        night: '#0d1017',
        panel: '#161b24',
        panel2: '#1f2632',
        hairline: '#2b313b',
        free: { DEFAULT: '#22c55e', bg: 'rgba(34,197,94,0.14)' },
        booked: { DEFAULT: '#f5b544', bg: 'rgba(245,181,68,0.14)' },
        full: { DEFAULT: '#ef4444', bg: 'rgba(239,68,68,0.14)' },
      },
      fontFamily: {
        display: ['Archivo', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(20,24,31,0.04), 0 1px 3px rgba(20,24,31,0.06)',
      },
    },
  },
  plugins: [],
};
