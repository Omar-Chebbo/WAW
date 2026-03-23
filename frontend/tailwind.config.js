/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy:   '#1B2A4A',
        teal:   { DEFAULT: '#0F6E56', light: '#14916f', bg: '#E1F5EE' },
        amber:  { DEFAULT: '#BA7517', light: '#d4890d', bg: '#FAEEDA' },
        coral:  { DEFAULT: '#993C1D', light: '#b84720', bg: '#FAECE7' },
        purple: { DEFAULT: '#3C3489', light: '#4d44a8', bg: '#EEEDFE' },
      }
    }
  },
  plugins: []
}
