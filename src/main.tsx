// ── Eruda Mobile Debugger ──────────────────────────────────────────────────
// Lazy-load Eruda ONLY when ?debug=1 is present. Uses npm package (not CDN)
// to avoid Netlify CSP header blocks. Never loads on the production URL
// without the debug flag — zero debug UI visible to end users.
if (typeof window !== 'undefined' && window.location.search.includes('debug=1')) {
  import('eruda').then(({ default: eruda }) => eruda.init())
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import App from '@/App'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found. Check index.html.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
