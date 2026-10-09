/**
 * src/features/spending-explorer/ui.ts
 *
 * BANK-6E / 6F: one visual language for the Cash OS spending surfaces (Explorer, Smart Review, the choice sheets), aligned with the entry cards and
 * the Settings-hub cards: rounded-xl controls, a quiet surface, a clear selected state, 44px touch targets, a visible keyboard focus ring, and motion
 * only when the user allows it.
 * BANK-6F: surfaces use the theme-safe --surface-* tokens (white overlays vanished in the light theme), and hover fills apply only on devices that
 * can hover, so a tapped button on iPad does not stay lit (D14).
 */
export const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]'
export const btn = `min-h-[44px] rounded-xl bg-[var(--surface-1)] px-3.5 text-sm font-semibold ring-1 ring-[var(--border-primary)] [@media(hover:hover)]:hover:bg-[var(--surface-2)] motion-safe:transition-colors disabled:opacity-50 ${focusRing}`
/** The "on" state of a toggle-like control: a raised surface with a visible outline (never color alone: callers also set aria-pressed / aria-selected). */
export const btnOn = 'bg-[var(--surface-selected)] ring-[var(--surface-line)] text-[var(--text-primary)]'
/** A quiet text button for secondary actions (Not this, Ignore, Show more). */
export const btnQuiet = `min-h-[44px] rounded-xl px-3 text-sm font-semibold text-[var(--text-secondary)] [@media(hover:hover)]:hover:bg-[var(--surface-2)] motion-safe:transition-colors disabled:opacity-50 ${focusRing}`
export const field = `min-h-[44px] rounded-xl bg-[var(--surface-1)] px-3 text-sm ring-1 ring-[var(--border-primary)] ${focusRing}`
/** Section eyebrow (Settings-hub style). */
export const eyebrow = 'text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]'
/** A quiet inset card for grouped controls (filters, detail, colors). */
export const panel = 'rounded-2xl border border-[var(--surface-line)] bg-[var(--surface-1)] p-3 sm:p-4'
/** The one primary action in a group (Approve, Confirm, Apply). Green here means "the action", never a state. */
export const btnPrimary = `min-h-[44px] rounded-xl border border-[var(--fin-cash-border)] bg-[var(--fin-cash-tint)] px-3.5 text-sm font-semibold text-[var(--fin-cash)] [@media(hover:hover)]:hover:brightness-110 motion-safe:transition disabled:opacity-50 ${focusRing}`
/** D1: the "on" state of a SELECTION toggle (Select group): blue, like every other draft selection. */
export const btnSel = 'bg-[var(--fin-protected-tint)] ring-[var(--fin-protected-border)] text-[var(--fin-protected)]'
/** D1: a DRAFT selection (checked for approval, a filter in use) is blue, so it never reads as approved. Inline style for a selected card. */
export const selectedCard: React.CSSProperties = { background: 'var(--fin-protected-tint)', boxShadow: '0 0 0 2px var(--fin-protected-border)' }
