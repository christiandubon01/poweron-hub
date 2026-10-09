/**
 * src/features/display-colors/palette.ts
 *
 * BANK-6D: the curated, NAMED colors an owner can give an expense category or a financial account. Purely visual: a color never means
 * approved, reviewed, good or bad. Every swatch keeps at least 3:1 contrast (WCAG non-text) against the card background in BOTH the dark and the
 * light theme, and none of them reuses a Cash OS status color (cash green, warning amber, negative red, protected blue), so a stripe can never be
 * mistaken for a status. There is deliberately no free-form color input.
 */
export interface Swatch { id: string; name: string; hex: string }

export const SWATCHES: readonly Swatch[] = [
  { id: 'gold', name: 'Gold', hex: '#a8841f' },
  { id: 'copper', name: 'Copper', hex: '#c0652f' },
  { id: 'terracotta', name: 'Terracotta', hex: '#c2533f' },
  { id: 'rose', name: 'Rose', hex: '#cf4f7d' },
  { id: 'plum', name: 'Plum', hex: '#a256b8' },
  { id: 'violet', name: 'Violet', hex: '#7f68d6' },
  { id: 'indigo', name: 'Indigo', hex: '#5a72d9' },
  { id: 'sky', name: 'Sky', hex: '#2f8fcf' },
  { id: 'teal', name: 'Teal', hex: '#14998f' },
  { id: 'pine', name: 'Pine', hex: '#3a9461' },
  { id: 'olive', name: 'Olive', hex: '#86932b' },
  { id: 'slate', name: 'Slate', hex: '#7f8aa3' },
]

const BY_HEX = new Map(SWATCHES.map(s => [s.hex, s]))
/** Only curated colors are accepted anywhere (storage, server rows): anything else is ignored. */
export const isPaletteColor = (v: unknown): v is string => typeof v === 'string' && BY_HEX.has(v)
export const swatchName = (hex: string | null | undefined): string | null => (hex ? BY_HEX.get(hex)?.name ?? null : null)

/** Stable identifiers only, never labels: category KEYS (e.g. "fuel_vehicle") and financial_accounts ids (UUID). */
export const CATEGORY_KEY = /^[a-z][a-z_]{1,39}$/
export const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** WCAG relative luminance / contrast, used by the tests that hold the palette to its contrast promise. */
const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
export const luminance = (hex: string): number => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) }
export const contrast = (a: string, b: string): number => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
