import type { Config } from 'tailwindcss';

// Waffarha brand tokens (Brand Manual 2024). The manual gives Pantone names only; these HEX
// values are the standard Pantone→sRGB conversions and are approximate until marketing confirms.
// The app uses the secondary palette: dark blue leads, light blue / yellow / 151 orange support.
// The logo keeps the primary orange (the manual allows only orange-on-white or white-on-orange).
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // UI accent: PANTONE 7687 C (buttons, links, active tabs, focus).
        brand: { DEFAULT: '#1D428A', 600: '#163570', 50: '#EDF2FA' },
        // PANTONE 7702 C. `ink` is a darker step for text on sky tints.
        sky: { DEFAULT: '#48A9C5', 50: '#EAF6FA', ink: '#1F6E86' },
        // PANTONE 7548 C / 151 C. `ink` steps are darker for text and icons on the 50 tints.
        sun: { DEFAULT: '#FFC600', 50: '#FFF8DB', ink: '#8A6100' },
        tangerine: { DEFAULT: '#FF8200', 50: '#FFF1E3', ink: '#A84E00' },
        logo: '#FF5E00', // PANTONE Bright Orange C: the logo only
        navy: { DEFAULT: '#15428A', dark: '#091C3A' },
        canvas: '#F8F9FB',
        line: '#EDEFF2',
        ink: { DEFAULT: '#1A1D23', muted: '#5F6673', faint: '#8A919E' },
        ok: { DEFAULT: '#0F7A56', bg: '#E7F6EF' },
        warn: { DEFAULT: '#A15C00', bg: '#FFF4DC' },
        bad: { DEFAULT: '#C2321F', bg: '#FDECEA' },
      },
      fontFamily: {
        sans: ['Poppins', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
        arabic: ['"IBM Plex Sans Arabic"', 'Poppins', 'system-ui', 'sans-serif'],
      },
      borderRadius: { card: '12px' },
      keyframes: {
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-in-rtl': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
      },
      boxShadow: { card: '0 1px 3px rgba(0,0,0,0.10)' },
    },
  },
  plugins: [],
} satisfies Config;
