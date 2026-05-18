/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}'
  ],
  theme: {
    extend: {
      colors: {
        // Dark industrial palette
        bg: {
          base:   '#0a0a0b',
          panel:  '#131316',
          card:   '#1a1a1f',
          hover:  '#22222a'
        },
        border: {
          subtle: '#26262e',
          DEFAULT: '#2e2e38'
        },
        text: {
          primary:   '#e8e8ec',
          secondary: '#9999a3',
          muted:     '#5c5c66'
        },
        accent: {
          DEFAULT: '#5b8def',
          hover:   '#4a7ce0',
          glow:    '#5b8def33'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      }
    }
  },
  plugins: []
};
