/** @type {import('tailwindcss').Config} */
// Design tokens live as CSS variables (RGB triplets) in src/styles.scss - a light set on
// :root and a dark set on html.dark - and are mapped here so Tailwind utilities like
// `bg-paper`, `text-ink`, `border-hairline`, `bg-primary/10` follow the theme automatically.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{html,ts,scss,css}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        paper: token('paper'),
        surface: token('surface'),
        sunken: token('sunken'),
        ink: token('ink'),
        muted: token('muted'),
        hairline: token('hairline'),
        primary: {
          DEFAULT: token('primary'),
          hover: token('primary-hover'),
          tint: token('primary-tint'),
          on: token('on-primary'),
        },
        accent: token('accent'),
        saffron: token('saffron'),
      },
      fontFamily: {
        // Latin glyphs come from Inter / Fraunces; Arabic glyphs fall through to IBM Plex Sans Arabic
        // (body) and Noto Naskh Arabic (display headings), loaded from @fontsource via angular.json.
        sans: ['"Inter Variable"', 'Inter', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
        display: ['"Fraunces Variable"', 'Fraunces', '"Noto Naskh Arabic Variable"', 'Georgia', 'serif'],
      },
      borderRadius: {
        card: '20px',
        sheet: '24px',
      },
      boxShadow: {
        soft: '0 1px 2px rgb(30 27 22 / 0.04), 0 8px 24px -12px rgb(30 27 22 / 0.18)',
        sheet: '0 -8px 32px -12px rgb(30 27 22 / 0.25)',
      },
      spacing: {
        'tab-bar': '4.5rem',
      },
      transitionTimingFunction: {
        sheet: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      keyframes: {
        sheetUp: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        riseIn: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'sheet-up': 'sheetUp 0.32s cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in': 'fadeIn 0.2s ease-out',
        'rise-in': 'riseIn 0.25s ease-out',
      },
    },
  },
  plugins: [],
};
