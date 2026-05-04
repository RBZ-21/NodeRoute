/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        shell: '#f4f7f8',
        ink: '#102128',
        ocean: '#0f766e',
        seafoam: '#d3f3ef',
        sand: '#fcf4db',
        coral: '#fcd8d4',
        slate: '#6a7d86',
      },
      boxShadow: {
        card: '0 18px 44px -30px rgba(16, 33, 40, 0.35)',
      },
      fontFamily: {
        sans: ['"Avenir Next"', '"Trebuchet MS"', 'ui-sans-serif', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
