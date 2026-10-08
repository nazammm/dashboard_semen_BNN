/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#DEDACF', deep: '#D2CDBF', surface: '#F8F6F0', surface2: '#F1EEE5', surface3: '#EAE6DA',
        ink: '#211E19', soft: '#645E52', faint: '#8A8375', line: '#C6BFAF', 'line-strong': '#AFA790',
        accent: '#FF5A1F', 'accent-ink': '#B33F16', 'accent-soft': '#FFE3D3',
        blue: '#204A63', 'blue-soft': '#DCE7EC', 'blue-mid': '#3E7899',
        green: '#3F7A52', 'green-soft': '#DEEAE1', red: '#B23B2E', 'red-soft': '#F5DCD8',
        amber: '#B8791A', 'amber-soft': '#F2E4C8',
      },
      fontFamily: {
        disp: ["'Big Shoulders Display'", 'sans-serif'],
        mono: ["'IBM Plex Mono'", 'monospace'],
        sans: ["'IBM Plex Sans'", 'sans-serif'],
      },
      boxShadow: { card: '0 1px 2px rgba(33,30,25,.06), 0 1px 0 rgba(33,30,25,.04)' },
      borderRadius: { sm: '3px', DEFAULT: '6px' },
      spacing: { sidebar: '248px' },
    },
  },
  plugins: [],
};
