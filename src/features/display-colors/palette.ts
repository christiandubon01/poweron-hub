/**
 * src/features/display-colors/palette.ts
 *
 * BANK-6D: the curated, NAMED colors an owner can give an expense category or a financial account. Purely visual: a color never means
 * approved, reviewed, good or bad. Every swatch keeps at least 3:1 contrast (WCAG non-text) against the card background in BOTH the dark and the
 * light theme, and none of them reuses a Cash OS status color (cash green, warning amber, negative red, protected blue), so a stripe can never be
 * mistaken for a status. There is deliberately no free-form color input.
 */
export type SwatchGroup = 'warm' | 'cool' | 'natural' | 'neutral'
export interface Swatch { id: string; name: string; hex: string; group: SwatchGroup }

/**
 * BANK-6E: 24 swatches. The first 12 hex values are the BANK-6D originals and must never change or disappear (saved organization colors point at them).
 * Every swatch keeps >= 3:1 contrast on BOTH theme card backgrounds with ONE stable hex (no per-theme variants), and no new swatch sits closer to
 * any other (CIEDE2000) than the closest original pair (Indigo / Violet) - all enforced by tests.
 */
export const SWATCHES: readonly Swatch[] = [
  { id: 'gold', name: 'Gold', hex: '#a8841f', group: 'warm' },
  { id: 'amber', name: 'Amber', hex: '#b8761c', group: 'warm' },
  { id: 'copper', name: 'Copper', hex: '#c0652f', group: 'warm' },
  { id: 'terracotta', name: 'Terracotta', hex: '#c2533f', group: 'warm' },
  { id: 'scarlet', name: 'Scarlet', hex: '#e85060', group: 'warm' },
  { id: 'rose', name: 'Rose', hex: '#cf4f7d', group: 'warm' },
  { id: 'bronze', name: 'Bronze', hex: '#9a7442', group: 'warm' },
  { id: 'sand', name: 'Sand', hex: '#a88868', group: 'warm' },
  { id: 'sky', name: 'Sky', hex: '#2f8fcf', group: 'cool' },
  { id: 'lagoon', name: 'Lagoon', hex: '#1098b0', group: 'cool' },
  { id: 'teal', name: 'Teal', hex: '#14998f', group: 'cool' },
  { id: 'indigo', name: 'Indigo', hex: '#5a72d9', group: 'cool' },
  { id: 'violet', name: 'Violet', hex: '#7f68d6', group: 'cool' },
  { id: 'plum', name: 'Plum', hex: '#a256b8', group: 'cool' },
  { id: 'magenta', name: 'Magenta', hex: '#c4469e', group: 'cool' },
  { id: 'mauve', name: 'Mauve', hex: '#a080a8', group: 'cool' },
  { id: 'pine', name: 'Pine', hex: '#3a9461', group: 'natural' },
  { id: 'grass', name: 'Grass', hex: '#3f9a1e', group: 'natural' },
  { id: 'olive', name: 'Olive', hex: '#86932b', group: 'natural' },
  { id: 'sage', name: 'Sage', hex: '#809080', group: 'natural' },
  { id: 'slate', name: 'Slate', hex: '#7f8aa3', group: 'neutral' },
  { id: 'storm', name: 'Storm', hex: '#507880', group: 'neutral' },
  { id: 'clay', name: 'Clay', hex: '#a08080', group: 'neutral' },
  { id: 'graphite', name: 'Graphite', hex: '#787078', group: 'neutral' },
]
/** The BANK-6D swatches, kept forever so saved colors stay valid. */
export const ORIGINAL_HEXES: readonly string[] = ['#a8841f', '#c0652f', '#c2533f', '#cf4f7d', '#a256b8', '#7f68d6', '#5a72d9', '#2f8fcf', '#14998f', '#3a9461', '#86932b', '#7f8aa3']
export const SWATCH_GROUPS: ReadonlyArray<{ id: SwatchGroup; name: string }> = [
  { id: 'warm', name: 'Warm' }, { id: 'cool', name: 'Cool' }, { id: 'natural', name: 'Natural' }, { id: 'neutral', name: 'Neutral' },
]

const BY_HEX = new Map(SWATCHES.map(s => [s.hex, s]))
/** Only curated colors are accepted anywhere (storage, server rows): anything else is ignored. */
export const isPaletteColor = (v: unknown): v is string => typeof v === 'string' && BY_HEX.has(v)
/** A 0-1 alpha wash of a swatch, as plain rgba (works in every Safari, no color-mix). */
export const withAlpha = (hex: string, alpha: number): string => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})` }
export const swatchName = (hex: string | null | undefined): string | null => (hex ? BY_HEX.get(hex)?.name ?? null : null)

/** Stable identifiers only, never labels: category KEYS (e.g. "fuel_vehicle") and financial_accounts ids (UUID). */
export const CATEGORY_KEY = /^[a-z][a-z_]{1,39}$/
export const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** WCAG relative luminance / contrast, used by the tests that hold the palette to its contrast promise. */
const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
export const luminance = (hex: string): number => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) }
export const contrast = (a: string, b: string): number => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
