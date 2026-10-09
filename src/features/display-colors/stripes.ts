/**
 * src/features/display-colors/stripes.ts
 *
 * BANK-6D: which stripe an entry shows. PURE and presentational: it reads the review state the server already decided and never changes it.
 *
 *   confirmed category with a color      -> SOLID stripe in the category color (the only case that may also get the optional full-entry tint)
 *   suggested category with a color      -> FADED (dashed) stripe in the category color, never tinted: a suggestion must not look approved
 *   a category with no color assigned    -> no stripe (nothing to show)
 *   unknown / "Other / Needs Review" / ignored -> NEUTRAL stripe, never a category color
 *
 * The text cues ("✓", "suggested", "Category needs review", "Ignored") are always rendered by the caller as well: color is never the only signal.
 */
export type StripeKind = 'solid' | 'faded' | 'neutral' | 'none'
export interface Stripe { kind: StripeKind; color: string | null; tint: boolean }

const UNKNOWN = 'other_needs_review'

export function categoryStripe(
  entry: { key: string | null; state: 'confirmed' | 'suggested' | 'none'; ignored?: boolean },
  colorOf: (categoryKey: string) => string | null,
  tintEnabled = false,
): Stripe {
  if (entry.ignored || !entry.key || entry.key === UNKNOWN || entry.state === 'none') return { kind: 'neutral', color: null, tint: false }
  const color = colorOf(entry.key)
  if (!color) return { kind: 'none', color: null, tint: false }
  if (entry.state === 'confirmed') return { kind: 'solid', color, tint: tintEnabled }
  return { kind: 'faded', color, tint: false }
}

/** An account card: its own color as a solid stripe (an account has no "suggested" state), optionally tinted. */
export function accountStripe(color: string | null, tintEnabled = false): Stripe {
  return color ? { kind: 'solid', color, tint: tintEnabled } : { kind: 'none', color: null, tint: false }
}

/** Inline styles for the stripe element and the tint. Kept here so every surface (Explorer, Smart Review, accounts, later redesigns) looks the same. */
export const TINT_PERCENT = 10
export function stripeStyle(s: Stripe): Record<string, string> | null {
  if (s.kind === 'none') return null
  if (s.kind === 'neutral') return { background: 'var(--border-primary)' }
  if (s.kind === 'faded') return { backgroundImage: `repeating-linear-gradient(to bottom, ${s.color} 0 5px, transparent 5px 9px)`, opacity: '0.75' }
  return { background: s.color as string }
}
/** A subtle tint (plain rgba: works on every Safari version, no color-mix needed). Text contrast is unaffected at this strength. */
export const tintColor = (hex: string, percent = TINT_PERCENT): string => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${percent / 100})`
}
export const tintStyle = (s: Stripe): Record<string, string> | undefined =>
  s.tint && s.color ? { background: tintColor(s.color) } : undefined
