/**
 * LEAD-SRC-3B — shared phone normalization for call matching.
 *
 * Exact match keys only. No substring / includes fuzzy matching.
 */

/** Strip to digits. Returns null when no usable US match key exists. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return digits
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return null
}

/** Digits for tel: href — may be shorter than a match key; dialer-only. */
export function dialerDigits(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const digits = String(raw).replace(/\D/g, '')
  return digits.length > 0 ? digits : null
}

export function openTelDialer(
  phone: string | null | undefined,
  openHref: (href: string) => void = (href) => {
    if (typeof window !== 'undefined') window.location.href = href
  },
): boolean {
  const digits = dialerDigits(phone)
  if (!digits) return false
  openHref(`tel:${digits}`)
  return true
}
