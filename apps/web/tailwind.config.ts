import type { Config } from 'tailwindcss';

// Waffarha brand tokens.
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#FE5F00',
          600: '#E55500',
          50: '#FFF3EB',
          secondary: '#F58220',
          yellow: '#FFC70B',
        },
        navy: { DEFAULT: '#15428A', dark: '#091C3A' },
        canvas: '#F8F9FB',
        line: '#EDEFF2',
        ink: { DEFAULT: '#1A1D23', muted: '#5F6673', faint: '#8A919E' },
        ok: { DEFAULT: '#12805C', bg: '#E7F6EF' },
        warn: { DEFAULT: '#A15C00', bg: '#FFF4DC' },
        bad: { DEFAULT: '#C2321F', bg: '#FDECEA' },
      },
      fontFamily: {
        sans: ['"AR One Sans"', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
        arabic: ['"IBM Plex Sans Arabic"', '"AR One Sans"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { card: '12px' },
      boxShadow: { card: '0 1px 3px rgba(0,0,0,0.10)' },
    },
  },
  plugins: [],
} satisfies Config;
