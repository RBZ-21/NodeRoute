/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Harbor ink: blue-black canvas scale (hue ~215) so the brand blue
        // reads native to the surface instead of floating on neutral black.
        ink: {
          0: '#070b12',
          50: '#0a0f17',
          100: '#0d1219',
          200: '#121a26',
          300: '#1b2533',
          400: '#252f3f',
          500: '#303c4d',
        },
        line: 'rgba(163,190,225,0.10)',
        'line-strong': 'rgba(163,190,225,0.17)',
        // Dashboard primary blue: hsl(213 70% 42%) = #2367b5
        teal: {
          DEFAULT: '#2367b5',
          light: '#3a7fcc',
          dim: '#1a4f8a',
          sky: '#6aa5e3', // small text & links on dark (8:1 on ink-0)
          ice: '#e8f0f9', // tint surfaces on light sections
          deep: '#12253d', // deep-harbor feature surface (final CTA)
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
          "linear-gradient(to right, rgba(163,190,225,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(163,190,225,0.05) 1px, transparent 1px)",
        'radial-teal':
          'radial-gradient(600px 300px at 50% 0%, rgba(35,103,181,0.22), transparent 60%)',
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
