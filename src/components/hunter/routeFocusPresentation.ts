/**
 * Route-focus presentation helpers for HunterMap Take Me There.
 *
 * Presentation-only: never mutates Lead records, Hunter store, filters,
 * persisted backups, browser storage, URL, or database state.
 */

export interface LeadMapMarkerEntry {
  leadId: string | null
  marker: { setVisible: (visible: boolean) => void }
  isLeadPin: boolean
}

/** Apply route-focus visibility by Lead ID. Home-base / non-lead pins are untouched. */
export function applyRouteFocusVisibility(
  entries: readonly LeadMapMarkerEntry[],
  routeFocusLeadId: string | null,
): void {
  for (const entry of entries) {
    if (!entry.isLeadPin) continue
    if (!entry.leadId) continue
    entry.marker.setVisible(
      routeFocusLeadId === null || entry.leadId === routeFocusLeadId,
    )
  }
}

/** Stable fingerprint of the filtered Lead set for filter/list-rebuild detection. */
export function leadSetFingerprint(leads: readonly { id?: string | null }[]): string {
  return leads.map((l) => String(l?.id ?? '')).join('\0')
}

export function createRouteOperationController() {
  let generation = 0

  return {
    /** Invalidate pending async route callbacks and return the next generation. */
    begin(): number {
      generation += 1
      return generation
    },
    /** Invalidate pending async route callbacks without starting a new operation. */
    invalidate(): void {
      generation += 1
    },
    isCurrent(token: number): boolean {
      return token === generation
    },
    get current(): number {
      return generation
    },
  }
}

export type RouteFocusPhase =
  | { phase: 'idle'; routeFocusLeadId: null }
  | { phase: 'focused'; routeFocusLeadId: string }

export function idleRouteFocus(): RouteFocusPhase {
  return { phase: 'idle', routeFocusLeadId: null }
}

export function enterRouteFocusPhase(leadId: string): RouteFocusPhase {
  return { phase: 'focused', routeFocusLeadId: leadId }
}

/** True when a filtered Lead-set change should end an active route focus. */
export function shouldExitFocusOnLeadSetChange(
  routeFocusLeadId: string | null,
  previousFingerprint: string | null,
  nextFingerprint: string,
): boolean {
  if (!routeFocusLeadId) return false
  if (previousFingerprint === null) return false
  return previousFingerprint !== nextFingerprint
}

/** True when the focused Lead is no longer present in the pin set. */
export function shouldExitFocusOnMissingLead(
  routeFocusLeadId: string | null,
  pinLeadIds: readonly string[],
): boolean {
  if (!routeFocusLeadId) return false
  return !pinLeadIds.includes(routeFocusLeadId)
}
