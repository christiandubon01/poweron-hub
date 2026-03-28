import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // PowerOn Hub brand design system (from blueprint v2)
      colors: {
        bg: {
          DEFAULT: '#060608',
          1: '#0C0C10',
          2: '#111116',
          3: '#18181F',
          4: '#22222C',
          5: '#2E2E3A',
        },
        text: {
          1: '#F0F0FF',
          2: '#A8A8C0',
          3: '#60607A',
          4: '#30303F',
        },
        green: {
          DEFAULT: '#2EE89A',
          subtle: 'rgba(46,232,154,0.10)',
          faint:  'rgba(46,232,154,0.06)',
          border: 'rgba(46,232,154,0.25)',
        },
        blue: {
          DEFAULT: '#3A8EFF',
          subtle: 'rgba(58,142,255,0.12)',
        },
        gold: {
          DEFAULT: '#FFD24A',
          subtle: 'rgba(255,210,74,0.10)',
        },
        red: {
          DEFAULT: '#FF5060',
          subtle: 'rgba(255,80,96,0.10)',
        },
        orange: {
          DEFAULT: '#FF9040',
          subtle: 'rgba(255,144,64,0.10)',
        },
        purple: {
          DEFAULT: '#AA6EFF',
          subtle: 'rgba(170,110,255,0.10)',
        },
        teal: {
          DEFAULT: '#40D4FF',
          subtle: 'rgba(64,212,255,0.10)',
        },
        lime: {
          DEFAULT: '#A8FF3E',
          subtle: 'rgba(168,255,62,0.10)',
        },
        // Agent signature colors
        nexus:     '#2EE89A',
        vault:     '#FFD24A',
        pulse:     '#3A8EFF',
        ledger:    '#40D4FF',
        spark:     '#FF5FA0',
        blueprint: '#AA6EFF',
        ohm:       '#A8FF3E',
        chrono:    '#FF9040',
        scout:     '#FF5060',
      },
      fontFamily: {
        sans: ['Syne', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      borderColor: {
        DEFAULT: '#22222C',
        subtle: '#2E2E3A',
      },
      boxShadow: {
        'glow-green': '0 0 20px rgba(46,232,154,0.15)',
        'glow-gold':  '0 0 20px rgba(255,210,74,0.15)',
        'glow-blue':  '0 0 20px rgba(58,142,255,0.15)',
        'card':       '0 4px 24px rgba(0,0,0,0.5)',
        'card-hover': '0 12px 40px rgba(0,0,0,0.6)',
      },
      animation: {
        'fade-in':    'fadeIn 0.2s ease-out',
        'slide-up':   'slideUp 0.3s ease-out',
        'pulse-ring': 'pulseRing 2s ease-out infinite',
        'shake':      'shake 0.4s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseRing: {
          '0%':   { transform: 'scale(1)',    opacity: '1' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-8px)' },
          '40%, 80%': { transform: 'translateX(8px)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
