/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#282b46',
        muted: '#85889c',
        brand: { DEFAULT: '#6966d5', dark: '#5956c6', pale: '#f0efff' },
        line: '#e8e9f1',
      },
      fontFamily: { sans: ['DM Sans', 'sans-serif'], display: ['Manrope', 'sans-serif'] },
      boxShadow: { soft: '0 4px 18px rgba(48, 50, 78, 0.06)' },
    },
  },
  plugins: [],
}
