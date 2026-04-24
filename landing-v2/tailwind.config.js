/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          0: '#000000',
          50: '#050505',
          100: '#0a0a0a',
          200: '#111111',
          300: '#1a1a1a',
          400: '#242424',
          500: '#2e2e2e',
        },
        line: 'rgba(255,255,255,0.08)',
        'line-strong': 'rgba(255,255,255,0.14)',
        teal: {
          DEFAULT: '#3dba7f',
          light: '#4dcf91',
          dim: '#2e8c60',
        },
        cream: {
          DEFAULT: '#f4f4f0',
          dim: '#e9e9e2',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Geist"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.04em',
        tighter2: '-0.035em',
      },
      backgroundImage: {
        'grid-faint':
          "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)",
        'radial-teal':
          'radial-gradient(600px 300px at 50% 0%, rgba(61,186,127,0.18), transparent 60%)',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.6s ease-out both',
        'pulse-dot': 'pulseDot 1.6s ease-in-out infinite',
        shimmer: 'shimmer 3s linear infinite',
      },
    },
  },
  plugins: [],
};
