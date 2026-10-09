/**
 * src/features/spending-explorer/ui.ts
 *
 * BANK-6E: one visual language for the Cash OS spending surfaces (Explorer, Smart Review, the category picker), aligned with the premium entry cards
 * and the Settings-hub cards: rounded-xl controls, a quiet surface, a clear selected state, 44px touch targets, a visible keyboard focus ring, and
 * motion only when the user allows it.
 */
export const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]'
export const btn = `min-h-[44px] rounded-xl bg-white/[0.02] px-3.5 text-sm font-semibold ring-1 ring-[var(--border-primary)] hover:bg-white/[0.06] motion-safe:transition-colors disabled:opacity-50 ${focusRing}`
/** The selected / "on" state of a control: a soft cash-tinted fill with a matching ring (never color alone: callers also set aria-pressed / aria-selected). */
export const btnOn = 'bg-[var(--fin-cash-tint)] ring-[var(--fin-cash-border)]'
export const field = `min-h-[44px] rounded-xl bg-white/[0.02] px-3 text-sm ring-1 ring-[var(--border-primary)] ${focusRing}`
/** Section eyebrow (Settings-hub style). */
export const eyebrow = 'text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]'
/** A quiet inset card for grouped controls (filters, detail, colors). */
export const panel = 'rounded-2xl border border-[var(--border-primary)] bg-white/[0.015] p-3 sm:p-4'
/** The one primary action in a group (Approve, Confirm, Apply). */
export const btnPrimary = `min-h-[44px] rounded-xl border border-[var(--fin-cash-border)] bg-[var(--fin-cash-tint)] px-3.5 text-sm font-semibold text-[var(--fin-cash)] hover:brightness-110 motion-safe:transition disabled:opacity-50 ${focusRing}`
