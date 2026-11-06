/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warna mengikuti logo perusahaan: biru (#0181D5) untuk data & aksi, magenta (#C8035F) hanya untuk penanda.
        bg: '#F4F5F7', deep: '#E9ECF0', surface: '#FFFFFF', surface2: '#F7F8FA', surface3: '#EEF0F4',
        ink: '#151A21', soft: '#4A5361', faint: '#687180', line: '#E2E5EA', 'line-strong': '#CBD1D9',
        accent: '#0172BD', 'accent-ink': '#0A5791', 'accent-soft': '#E4F0FA',
        mark: '#C8035F', 'mark-soft': '#FBE6EF',
        blue: '#1E3A5C', 'blue-soft': '#E7EDF4', 'blue-mid': '#5D6B7C',
        green: '#2E7D4F', 'green-soft': '#E4F2E9', red: '#C03A2B', 'red-soft': '#FBE7E4',
        amber: '#A86300', 'amber-soft': '#FDF0DC',
      },
      fontFamily: {
        // Satu keluarga huruf. font-mono/font-disp dipertahankan sebagai alias supaya kelas lama tetap jalan.
        disp: ["'IBM Plex Sans'", 'system-ui', 'sans-serif'],
        mono: ["'IBM Plex Sans'", 'system-ui', 'sans-serif'],
        sans: ["'IBM Plex Sans'", 'system-ui', 'sans-serif'],
        code: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      boxShadow: { card: '0 1px 2px rgba(21,26,33,.05)' },
      borderRadius: { sm: '6px', DEFAULT: '8px' },
      spacing: { sidebar: '248px' },
    },
  },
  plugins: [],
};
