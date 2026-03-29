/// <reference types="vite/client" />

// ── Eruda mobile debugger type declaration ──────────────────────────────────
// Eruda is dynamically imported only when ?debug=1 is present.
// This declaration satisfies tsc when the package isn't installed locally.
declare module 'eruda' {
  const eruda: {
    init(options?: Record<string, unknown>): void
    destroy(): void
  }
  export default eruda
}
