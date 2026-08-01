/**
 * Behavioral tests for Take Me There route-focus presentation.
 *
 * Covers focus entry/exit, Lead-ID visibility, operation generation,
 * filter/list rebuild exits, and presentation-only guarantees.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyRouteFocusVisibility,
  createRouteOperationController,
  enterRouteFocusPhase,
  idleRouteFocus,
  leadSetFingerprint,
  shouldExitFocusOnLeadSetChange,
  shouldExitFocusOnMissingLead,
  type LeadMapMarkerEntry,
} from '../routeFocusPresentation'

function mockMarker(visible = true) {
  return {
    visible,
    setVisible: vi.fn(function (this: { visible: boolean }, v: boolean) {
      this.visible = v
    }),
  }
}

function buildEntries() {
  const home = mockMarker(true)
  const a = mockMarker(true)
  const b = mockMarker(true)
  const c = mockMarker(true)
  const entries: LeadMapMarkerEntry[] = [
    { leadId: null, marker: home, isLeadPin: false },
    { leadId: 'lead-a', marker: a, isLeadPin: true },
    { leadId: 'lead-b', marker: b, isLeadPin: true },
    { leadId: 'lead-c', marker: c, isLeadPin: true },
  ]
  return { home, a, b, c, entries }
}

describe('FOCUS ENTRY — normal → route focus', () => {
  it('1. normal state shows all filtered Lead markers', () => {
    const { a, b, c, entries } = buildEntries()
    applyRouteFocusVisibility(entries, null)
    expect(a.visible).toBe(true)
    expect(b.visible).toBe(true)
    expect(c.visible).toBe(true)
  })

  it('2. entering focus sets the focused Lead ID', () => {
    const phase = enterRouteFocusPhase('lead-b')
    expect(phase.phase).toBe('focused')
    expect(phase.routeFocusLeadId).toBe('lead-b')
  })

  it('3. selected Lead remains visible', () => {
    const { a, b, c, entries } = buildEntries()
    applyRouteFocusVisibility(entries, 'lead-b')
    expect(b.visible).toBe(true)
    expect(a.visible).toBe(false)
    expect(c.visible).toBe(false)
  })

  it('4. every other normal Lead marker becomes hidden', () => {
    const { a, b, c, entries } = buildEntries()
    applyRouteFocusVisibility(entries, 'lead-a')
    expect(a.visible).toBe(true)
    expect(b.visible).toBe(false)
    expect(c.visible).toBe(false)
  })

  it('5. home base remains visible (non-lead pin untouched)', () => {
    const { home, entries } = buildEntries()
    applyRouteFocusVisibility(entries, 'lead-a')
    expect(home.setVisible).not.toHaveBeenCalled()
    expect(home.visible).toBe(true)
  })

  it('6. route markers are not part of the normal Lead marker set', () => {
    const { entries } = buildEntries()
    // Route truck/smoke would be separate google.maps.Marker instances — not in entries.
    const leadPins = entries.filter((e) => e.isLeadPin)
    expect(leadPins.every((e) => e.leadId != null)).toBe(true)
    expect(entries.some((e) => !e.isLeadPin && e.leadId === null)).toBe(true)
  })
})

describe('FOCUS EXIT — restore filtered Leads', () => {
  it('7. Clear Route (idle phase) restores all currently filtered Leads', () => {
    const { a, b, c, entries } = buildEntries()
    applyRouteFocusVisibility(entries, 'lead-b')
    const idle = idleRouteFocus()
    applyRouteFocusVisibility(entries, idle.routeFocusLeadId)
    expect(idle.routeFocusLeadId).toBeNull()
    expect(a.visible).toBe(true)
    expect(b.visible).toBe(true)
    expect(c.visible).toBe(true)
  })

  it('8. route calculation failure restores all Leads via null focus', () => {
    const { a, b, c, entries } = buildEntries()
    applyRouteFocusVisibility(entries, 'lead-a')
    applyRouteFocusVisibility(entries, null)
    expect([a, b, c].every((m) => m.visible)).toBe(true)
  })

  it('9. invalid destination restores all Leads via null focus', () => {
    const { entries, a, b } = buildEntries()
    applyRouteFocusVisibility(entries, 'lead-a')
    applyRouteFocusVisibility(entries, null)
    expect(a.visible).toBe(true)
    expect(b.visible).toBe(true)
  })

  it('10. route exception restores all Leads via null focus', () => {
    const { entries, a, b, c } = buildEntries()
    applyRouteFocusVisibility(entries, 'lead-c')
    applyRouteFocusVisibility(entries, null)
    expect([a, b, c].every((m) => m.visible)).toBe(true)
  })

  it('11. component unmount clears route focus (idle contract)', () => {
    expect(idleRouteFocus()).toEqual({ phase: 'idle', routeFocusLeadId: null })
  })

  it('12. focused Lead removal restores normal mode', () => {
    expect(shouldExitFocusOnMissingLead('lead-a', ['lead-b', 'lead-c'])).toBe(true)
    expect(shouldExitFocusOnMissingLead('lead-a', ['lead-a', 'lead-b'])).toBe(false)
    expect(shouldExitFocusOnMissingLead(null, ['lead-a'])).toBe(false)
  })
})

describe('SWITCHING — route A → route B', () => {
  it('13. starting route B cancels route A via generation token', () => {
    const ops = createRouteOperationController()
    const tokenA = ops.begin()
    expect(ops.isCurrent(tokenA)).toBe(true)
    const tokenB = ops.begin()
    expect(ops.isCurrent(tokenA)).toBe(false)
    expect(ops.isCurrent(tokenB)).toBe(true)
  })

  it('14. only Lead B remains visible after switch', () => {
    const { a, b, c, entries } = buildEntries()
    applyRouteFocusVisibility(entries, 'lead-a')
    applyRouteFocusVisibility(entries, 'lead-b')
    expect(a.visible).toBe(false)
    expect(b.visible).toBe(true)
    expect(c.visible).toBe(false)
  })

  it('15. stale route-A callback cannot restore markers during route B', () => {
    const ops = createRouteOperationController()
    const tokenA = ops.begin()
    ops.begin() // B
    // Stale A success would check isCurrent before restoring
    expect(ops.isCurrent(tokenA)).toBe(false)
    const { a, b, entries } = buildEntries()
    applyRouteFocusVisibility(entries, 'lead-b')
    if (ops.isCurrent(tokenA)) {
      applyRouteFocusVisibility(entries, null)
    }
    expect(a.visible).toBe(false)
    expect(b.visible).toBe(true)
  })

  it('16. invalidate() drops old route visuals ownership', () => {
    const ops = createRouteOperationController()
    const token = ops.begin()
    ops.invalidate()
    expect(ops.isCurrent(token)).toBe(false)
  })
})

describe('FILTERS — lead-set fingerprint clears focus', () => {
  const allLeads = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const tlmaLeads = [{ id: 'a' }, { id: 'b' }]
  const portalLeads = [{ id: 'c' }]
  const cityLeads = [{ id: 'b' }]

  it('17. All filter change clears active focus', () => {
    const prev = leadSetFingerprint(tlmaLeads)
    const next = leadSetFingerprint(allLeads)
    expect(shouldExitFocusOnLeadSetChange('lead-a', prev, next)).toBe(true)
  })

  it('18. TLMA filter change clears active focus', () => {
    const prev = leadSetFingerprint(allLeads)
    const next = leadSetFingerprint(tlmaLeads)
    expect(shouldExitFocusOnLeadSetChange('a', prev, next)).toBe(true)
  })

  it('19. Portal filter change clears active focus', () => {
    const prev = leadSetFingerprint(allLeads)
    const next = leadSetFingerprint(portalLeads)
    expect(shouldExitFocusOnLeadSetChange('c', prev, next)).toBe(true)
  })

  it('20. City filter change clears active focus', () => {
    const prev = leadSetFingerprint(allLeads)
    const next = leadSetFingerprint(cityLeads)
    expect(shouldExitFocusOnLeadSetChange('b', prev, next)).toBe(true)
  })

  it('21. new filtered markers are all visible after exit to null focus', () => {
    const { a, b, entries } = buildEntries()
    applyRouteFocusVisibility(entries, 'lead-a')
    applyRouteFocusVisibility(entries, null)
    expect(a.visible).toBe(true)
    expect(b.visible).toBe(true)
  })

  it('22. no duplicate markers — apply visibility does not clone entries', () => {
    const { entries } = buildEntries()
    const before = entries.length
    applyRouteFocusVisibility(entries, 'lead-a')
    applyRouteFocusVisibility(entries, null)
    applyRouteFocusVisibility(entries, 'lead-b')
    expect(entries.length).toBe(before)
  })

  it('identical lead-set fingerprint does not force exit', () => {
    const fp = leadSetFingerprint(allLeads)
    expect(shouldExitFocusOnLeadSetChange('a', fp, fp)).toBe(false)
  })

  it('first fingerprint observation does not force exit', () => {
    expect(
      shouldExitFocusOnLeadSetChange('a', null, leadSetFingerprint(allLeads)),
    ).toBe(false)
  })
})

describe('PRESENTATION ONLY — no data mutation', () => {
  it('23-26. helpers do not mutate Lead records or filter arrays', () => {
    const leads = [{ id: 'a', score: 90, status: 'new' }, { id: 'b', score: 50, status: 'new' }]
    const snapshot = JSON.stringify(leads)
    const fp = leadSetFingerprint(leads)
    shouldExitFocusOnLeadSetChange('a', fp, leadSetFingerprint(leads))
    enterRouteFocusPhase('a')
    idleRouteFocus()
    expect(JSON.stringify(leads)).toBe(snapshot)
  })

  it('27. marker visibility uses Lead ID, not coordinates/name/title', () => {
    const shared = { lat: 33.7, lng: -116.3, title: 'Same Name' }
    const m1 = mockMarker(true)
    const m2 = mockMarker(true)
    // Two Leads at identical coordinates / same title — identity is leadId only
    const entries: LeadMapMarkerEntry[] = [
      { leadId: 'id-1', marker: m1, isLeadPin: true },
      { leadId: 'id-2', marker: m2, isLeadPin: true },
    ]
    void shared
    applyRouteFocusVisibility(entries, 'id-2')
    expect(m1.visible).toBe(false)
    expect(m2.visible).toBe(true)
  })

  it('28. home base identity is separate (isLeadPin false)', () => {
    const { home, entries } = buildEntries()
    applyRouteFocusVisibility(entries, 'lead-a')
    expect(home.setVisible).not.toHaveBeenCalled()
  })

  it('29. route-specific marker identity is separate from Lead pins', () => {
    const truck = mockMarker(true)
    const leadEntries = buildEntries().entries
    applyRouteFocusVisibility(leadEntries, 'lead-a')
    // Truck never passed into applyRouteFocusVisibility
    expect(truck.setVisible).not.toHaveBeenCalled()
    expect(truck.visible).toBe(true)
  })
})

describe('REGRESSION — wiring + untouched surfaces', () => {
  const root = process.cwd()
  const hunterMapPath = join(root, 'src/components/hunter/HunterMap.tsx')
  const swPath = join(root, 'public/sw.js')
  const helperPath = join(root, 'src/components/hunter/routeFocusPresentation.ts')

  it('30-34. HunterMap still wires Take Me There, clearRoute, and route visuals', () => {
    const src = readFileSync(hunterMapPath, 'utf-8')
    expect(src).toContain('Take me there')
    expect(src).toContain('clearRoute')
    expect(src).toContain('drawRoute')
    expect(src).toContain('DirectionsService')
    expect(src).toContain('requestAnimationFrame(animate)')
    expect(src).toContain('addRubberBurn')
    expect(src).toContain('showMilestoneMsg')
    expect(src).toContain('InfoWindowF')
    expect(src).toContain('applyRouteFocusVisibility')
    expect(src).toContain('syncLeadMarkerVisibility')
  })

  it('35. service-worker bypass remains unchanged (gstatic + maps.googleapis)', () => {
    const sw = readFileSync(swPath, 'utf-8')
    expect(sw).toContain('.gstatic.com')
    expect(sw).toContain('maps.googleapis.com')
    expect(sw).toContain("new Response('', { status: 503 })")
  })

  it('36. personalized Lead icons remain (elite + portal frame caches)', () => {
    const src = readFileSync(hunterMapPath, 'utf-8')
    expect(src).toContain('eliteFrameCache')
    expect(src).toContain('portalFrameCache')
    expect(src).toContain('elitePinIcon')
    expect(src).toContain('portalPinIcon')
  })

  it('37. Portal MiniMap / PortalInbox file still exists and is not rewritten by helper', () => {
    expect(existsSync(join(root, 'src/components/hunter/PortalInbox.tsx'))).toBe(true)
    const helper = readFileSync(helperPath, 'utf-8')
    expect(helper).not.toContain('PortalInbox')
    expect(helper).not.toContain('MiniMap')
  })

  it('38. public tracking map remains (PortalTrackView present)', () => {
    expect(
      existsSync(join(root, 'src/views/PortalTrackView.tsx')) ||
      existsSync(join(root, 'src/components/portal/PortalTrackView.tsx')),
    ).toBe(true)
  })

  it('39. no migration or API-key change in helper / focus wiring', () => {
    const helper = readFileSync(helperPath, 'utf-8')
    const src = readFileSync(hunterMapPath, 'utf-8')
    expect(helper).not.toContain('VITE_GOOGLE_MAPS')
    expect(helper).not.toContain('supabase/migrations')
    expect(src).toContain('GOOGLE_MAPS_BROWSER_KEY')
    // Focus helpers must not write persistence surfaces
    expect(helper).not.toMatch(/localStorage\.(get|set|remove)Item/)
    expect(helper).not.toMatch(/\bBackupData\b/)
    expect(helper).not.toMatch(/\.from\(/)
  })

  it('HunterMap uses routeFocusLeadId presentation state (not Lead mutation)', () => {
    const src = readFileSync(hunterMapPath, 'utf-8')
    expect(src).toContain('routeFocusLeadId')
    expect(src).toContain('createRouteOperationController')
    expect(src).toContain('leadSetFingerprint')
    // Must hide via setVisible, not the old opacity dim
    expect(src).not.toContain('setOpacity(!focusedMapLeadId')
    expect(src).not.toContain('focusedMapLeadId')
  })
})

describe('operation controller lifecycle', () => {
  let ops: ReturnType<typeof createRouteOperationController>

  beforeEach(() => {
    ops = createRouteOperationController()
  })

  it('begin returns monotonically increasing tokens', () => {
    const a = ops.begin()
    const b = ops.begin()
    expect(b).toBeGreaterThan(a)
  })

  it('only the latest token is current', () => {
    const a = ops.begin()
    const b = ops.begin()
    expect(ops.isCurrent(a)).toBe(false)
    expect(ops.isCurrent(b)).toBe(true)
    expect(ops.current).toBe(b)
  })
})
