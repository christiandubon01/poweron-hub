// @ts-nocheck
/**
 * HunterPanel — Lead hunting dashboard for the HUNTER agent
 * 
 * Features:
 * - Header with lead metrics (discovered today, pipeline value, average score)
 * - Filter bar with job type, score tier, distance range, urgency toggle, date range, source tag
 * - Sort options (score, date, value, distance)
 * - Lead inbox with scrollable list of lead cards, score-sorted
 * - Expansion Opportunities section for 40-59 score leads
 * - Study Queue access button
 * - Empty state with manual trigger button
 */

import React, { useState, useMemo, useEffect } from 'react'
import { ChevronDown, Settings, RotateCcw, Zap, BookOpen, MoreVertical, Plus, Loader2, MapIcon, ChevronUp, ExternalLink, ClipboardPaste, X } from 'lucide-react'
import HunterMap from './HunterMap'
import { supabase } from '@/lib/supabase'
import clsx from 'clsx'
import HunterLeadCard, { type HunterLead } from './HunterLeadCard'
import AddLeadModal from './AddLeadModal'
import CallLogModal from './CallLogModal'
import PortalInbox from './PortalInbox'
import YelpAdPanel from './YelpAdPanel'
import { useHunterStore } from '@/store/hunterStore'
import { useSalesIntelStore } from '@/components/salesIntel/SalesIntelStore'
import type { HunterLead as StoreHunterLead } from '@/services/hunter/HunterTypes'
import { buildTlmaSearchUrl, parseTlmaTableHtml, type ParsedTlmaPermit, DEFAULT_TLMA_SEARCH_FILTERS, TLMA_SEARCH_CITIES, TLMA_SEARCH_PERMIT_TYPES, TLMA_PAGE_SIZE_OPTIONS, type TlmaSearchFilters } from '@/services/hunter/tlmaTableParser'
import { buildTlmaImportRows, previewTlmaImportRows } from '@/services/hunter/tlmaLeadMapper'
import { looksLikeTlmaTableHtml } from '@/services/hunter/tlmaBookmarklet'
import TlmaBookmarkletHelper from './TlmaBookmarkletHelper'
import { isCoachellaValleyCity } from '@/services/hunter/coachellaValleyCities'
import { resolveHunterPanelValueRange } from '@/services/hunter/hunterLeadValueDisplay'

export interface HunterPanelProps {
  leads?: HunterLead[]
  leadsDiscoveredToday?: number
  pipelineValue?: number
  averageScore?: number
  onTriggerHunterScan?: () => void
  onViewStudyQueue?: () => void
  onLeadAction?: (leadId: string, action: string, value: any) => void
}

type SortOption = 'score' | 'date' | 'value' | 'distance' | 'nearest'
type ScoreTier = 'elite' | 'strong' | 'qualified' | 'expansion' | 'archived'
// HUNTER-5B: Timeline list-sort. Independent of the shared map/list filter
// pipeline — when set to anything but 'none', it takes priority over sortBy
// for the lead list ordering only (map pins are unaffected).
type TimelineSort = 'none' | 'permit_newest' | 'permit_oldest' | 'portal_newest' | 'portal_oldest'
// HUNTER-5B: Distance Radius presets — reuse existing distanceFilterEnabled /
// maxDistanceMiles state (fed by Fix Geo's Home Base geocoding), just simplify
// the control to fixed presets instead of a raw slider.
const RADIUS_PRESETS: Array<{ label: string; miles: number | null }> = [
  { label: 'Any', miles: null },
  { label: '5 mi', miles: 5 },
  { label: '10 mi', miles: 10 },
  { label: '25 mi', miles: 25 },
  { label: '50 mi', miles: 50 },
  { label: '100 mi', miles: 100 },
]

// HUNTER-5D: Zone control — shared lead organization for Top Leads and Lead
// Map. Radius options use the existing distanceFromBaseMiles field from Fix
// Geo/Home Base geocoding — no new origin, no geocoding triggered here.
type ZoneOption = 'focus_cv' | 'radius_50' | 'radius_75' | 'radius_100' | 'all_imported' | 'pending_geo'
const ZONE_OPTIONS: Array<{ value: ZoneOption; label: string }> = [
  { value: 'focus_cv', label: 'Focus: Coachella Valley' },
  { value: 'radius_50', label: 'Radius: 50 mi' },
  { value: 'radius_75', label: 'Radius: 75 mi' },
  { value: 'radius_100', label: 'Radius: 100 mi' },
  { value: 'all_imported', label: 'All Imported' },
  { value: 'pending_geo', label: 'Pending Geo' },
]
const ZONE_RADIUS_MILES: Partial<Record<ZoneOption, number>> = {
  radius_50: 50,
  radius_75: 75,
  radius_100: 100,
}
function isPendingGeoLead(lead: any): boolean {
  const d = lead.distanceFromBaseMiles ?? lead.distance
  return d == null || lead.geocodingStatus === 'pending' || lead.geocoding_status === 'pending'
}

interface FilterState {
  jobType: string
  scoreTier: ScoreTier | 'all'
  distanceMin: number
  distanceMax: number
  urgencyOnly: boolean
  dateRange: 'today' | '7days' | '30days' | 'all'
  sourceTag: string
}

const DEFAULT_FILTERS: FilterState = {
  jobType: 'all',
  scoreTier: 'all',
  distanceMin: 0,
  distanceMax: 500,
  urgencyOnly: false,
  dateRange: 'all',
  sourceTag: 'all',
}

function getScoreTierLabel(score: number): ScoreTier {
  if (score >= 85) return 'elite'
  if (score >= 75) return 'strong'
  if (score >= 60) return 'qualified'
  if (score >= 40) return 'expansion'
  return 'archived'
}

// HUNTER-B3-PANEL-STORE-REWIRE-APR23-2026-1
// Translator: converts store-shaped HunterLead (canonical HunterTypes) to
// panel-shaped HunterLead (HunterLeadCard local type). Quick-and-dirty bridge;
// B4 MANAGED-3 session unifies the types so this function can be deleted.

// HUNTER-UI-GEO-UNIFY-APR30-2026-1: static value estimates by work class (C-10 electrical focus)
const WORK_CLASS_VALUE_ESTIMATES: Record<string, { min: number; max: number }> = {
  'panel upgrade': { min: 3500, max: 8000 },
  'simple main panel upgrade': { min: 2500, max: 5500 },
  'electrical modification': { min: 1500, max: 5000 },
  'electrical': { min: 2000, max: 6000 },
  'residential ev station (charging plug)': { min: 1500, max: 3500 },
  'residential energy storage system (ess)': { min: 6000, max: 15000 },
  'simple photovoltaic': { min: 8000, max: 18000 },
  'residential solar panel - roof install': { min: 10000, max: 22000 },
  'residential solar panel roof install - solar app': { min: 10000, max: 22000 },
  'new': { min: 15000, max: 40000 },
  'condominiums new': { min: 20000, max: 60000 },
  'new commercial office': { min: 30000, max: 80000 },
  'single family dwelling - additions/alterations': { min: 5000, max: 20000 },
  'alteration / remodel': { min: 4000, max: 15000 },
  'remodel': { min: 4000, max: 15000 },
  'addition': { min: 5000, max: 20000 },
  'pool & spa': { min: 3000, max: 8000 },
  'mechanical': { min: 3000, max: 10000 },
  'simple hvac': { min: 3500, max: 9000 },
  'alteration / repair / tenant improvement': { min: 8000, max: 30000 },
  'ti (additions/alterations)': { min: 8000, max: 30000 },
  'non residential': { min: 10000, max: 40000 },
  // TLMA permit_type_code keys (Riverside County)
  'bnr': { min: 20000, max: 80000 },  // Commercial Buildings
  'bti': { min: 15000, max: 50000 },  // Tenant Improvement
  'bmn': { min: 20000, max: 60000 },  // Mfg Buildings Commercial
  'brs': { min: 15000, max: 40000 },  // Residential Dwelling
  'bar': { min: 5000,  max: 20000 },  // Residential Add/Rehab
  'bas': { min: 3000,  max: 12000 },  // Accessory Building
  'bsp': { min: 3000,  max: 8000  },  // Pool/Spa/Fountains
  'bmr': { min: 8000,  max: 25000 },  // Manufactured Home Residential
}

function translateStoreToPanel(storeLead: StoreHunterLead): any {
  const estValue = typeof storeLead.estimated_value === 'number' ? storeLead.estimated_value : null
  const valueRange = resolveHunterPanelValueRange({
    estimatedValue: estValue,
    source: storeLead.source,
    sourceTag: storeLead.source_tag,
    workClassCode: (storeLead as any).work_class_code,
    permitTypeCode: (storeLead as any).permit_type_code,
    workClassEstimates: WORK_CLASS_VALUE_ESTIMATES,
  })

  const discoveredDate = storeLead.discovered_at ? new Date(storeLead.discovered_at) : null
  const freshness = discoveredDate ? formatFreshness(discoveredDate) : undefined
  const dateDiscovered = discoveredDate
    ? discoveredDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—'

  return {
    id: storeLead.id,
    score: typeof storeLead.score === 'number' ? storeLead.score : 0,
    scoringFactors: Array.isArray(storeLead.score_factors) ? storeLead.score_factors : undefined,
    contactName: storeLead.contact_name || undefined,
    contact_name: storeLead.contact_name || undefined,
    jobType: storeLead.lead_type || 'electrical',
    jobTypeCategory: (storeLead.lead_type || 'electrical').toLowerCase(),
    pitchPreview: storeLead.description || storeLead.pitch_script || '',
    description: storeLead.description || undefined,
    distanceFromBaseMiles: storeLead.distanceFromBaseMiles ?? (storeLead as any).distance_from_base_miles ?? undefined,
    distance: storeLead.distanceFromBaseMiles ?? (storeLead as any).distance_from_base_miles ?? (storeLead as any).distance ?? undefined,
    lat: (storeLead as any).latitude ?? undefined,
    lng: (storeLead as any).longitude ?? undefined,
    geocodedAt: (storeLead as any).geocoded_at ?? undefined,
    geocodingStatus: (storeLead as any).geocoding_status ?? undefined,
    dateDiscovered,
    sourceTag: storeLead.source_tag || storeLead.source || 'manual',
    source: storeLead.source || undefined,
    freshness,
    phone: storeLead.phone || undefined,
    email: storeLead.email || undefined,
    company: storeLead.company_name || undefined,
    company_name: storeLead.company_name || undefined,
    contact_company: (storeLead as any).contact_company || undefined,
    address: (storeLead as any).address || undefined,
    city: storeLead.city || undefined,
    permit_number: (storeLead as any).permit_number || undefined,
    permit_status: (storeLead as any).permit_status || undefined,
    permit_type_code: (storeLead as any).permit_type_code || undefined,
    portal_url: (storeLead as any).portal_url || (storeLead as any).permit_url || undefined,
    total_sqft: (storeLead as any).total_sqft ?? undefined,
    bestContactMethod: undefined,
    valueRange,
    marginEstimate: typeof storeLead.estimated_margin === 'number' ? storeLead.estimated_margin : undefined,
    comparableJobs: undefined,
    pitchScript: undefined, // store holds scalar text; structured pitch lives on pitchPreview until B4
    pitchAngles: undefined,
    status: (storeLead as any).status || undefined,
    notes: storeLead.notes || undefined,
    contractor_name: (storeLead as any).contractor_name ?? undefined,
    applied_date: (storeLead as any).applied_date ?? undefined,
    work_class_code: (storeLead as any).work_class_code ?? undefined,
    disposition: (storeLead as any).disposition ?? undefined,
    disposition_detail: (storeLead as any).disposition_detail ?? undefined,
    disposition_at: (storeLead as any).disposition_at ?? undefined,
    // HUNTER-5B: Timeline sort fields. Mapped from existing store columns only —
    // no schema changes, no DB writes.
    // Permit Date: issued_date, else applied_date, else created_at/discovered_at.
    permitIssuedDate: (storeLead as any).issued_date
      ?? (storeLead as any).applied_date
      ?? storeLead.created_at
      ?? storeLead.discovered_at
      ?? undefined,
    permitAppliedDate: (storeLead as any).applied_date ?? undefined,
    // Added to Portal: discovered_at, else created_at.
    dateAddedToPortal: storeLead.discovered_at ?? storeLead.created_at ?? undefined,
  }
}

function formatFreshness(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const SAMPLE_LEADS: HunterLead[] = [
  {
    id: 'lead_001',
    score: 94,
    scoringFactors: [
      { label: 'Budget clarity', value: 25 },
      { label: 'Timeline urgency', value: 20 },
      { label: 'Decision maker present', value: 15 },
    ],
    contactName: 'John Peterson',
    jobType: 'Kitchen Electrical Upgrade',
    jobTypeCategory: 'electrical',
    pitchPreview: 'New kitchen remodel with full electrical system upgrade needed...',
    distance: 3.2,
    dateDiscovered: 'Today at 9:30 AM',
    sourceTag: 'Google My Business',
    freshness: '45 minutes old',
    phone: '(555) 123-4567',
    email: 'john@example.com',
    company: 'Peterson Home Solutions',
    bestContactMethod: 'phone',
    triggerReason: 'Kitchen contractor mentioned electrical needs',
    estimatedScope: '200-300 square foot upgrade with panel service',
    valueRange: { min: 4500, max: 6200 },
    marginEstimate: 38,
    comparableJobs: [
      { id: '001', name: 'Miller Kitchen', value: 5200, margin: 35 },
      { id: '002', name: 'Chen Remodel', value: 5800, margin: 40 },
    ],
    pitchScript: {
      opener: 'Hi John, I noticed you\'re planning a kitchen remodel. We\'ve worked with several contractors in your area on similar projects.',
      valueProp: 'We can handle your full electrical system upgrade with panel service and make sure everything is code-compliant and future-proof for additional appliances.',
      socialProof: 'We just completed a similar project for the Miller family 2 blocks away, and they\'ve had perfect uptime for 8 months.',
      softAsk: 'Would it make sense to grab 30 minutes this week to walk through your kitchen plans and give you an accurate estimate?',
      objectionAnticipation: 'I know you might be concerned about timeline - we can typically complete this type of work within 3-5 business days.',
      close: 'How does Thursday afternoon look for a quick walkthrough?',
    },
    pitchAngles: [
      { angle: 'urgency', applied: true, reasoning: 'Kitchen project has hard move-in date' },
      { angle: 'pain', applied: true, reasoning: 'Old panel causing breaker issues' },
      { angle: 'opportunity', applied: false },
    ],
    notes: 'Mentioned neighbor reference - great signal',
    lastActivity: '45 min ago',
  },
  {
    id: 'lead_002',
    score: 87,
    scoringFactors: [
      { label: 'High budget', value: 22 },
      { label: 'Problem urgency', value: 18 },
      { label: 'Repeat customer potential', value: 12 },
    ],
    contactName: 'Sarah Chen',
    jobType: 'Commercial Panel Upgrade',
    jobTypeCategory: 'electrical',
    pitchPreview: 'Commercial office expansion requiring electrical infrastructure upgrade...',
    distance: 8.5,
    dateDiscovered: 'Today at 8:15 AM',
    sourceTag: 'LinkedIn',
    freshness: '2 hours old',
    phone: '(555) 987-6543',
    email: 'sarah.chen@techcorp.com',
    company: 'TechCorp Inc',
    bestContactMethod: 'email',
    triggerReason: 'Office expansion announced, electrical contractor mentioned as need',
    estimatedScope: '400-500 amp service upgrade for expanded data center wing',
    valueRange: { min: 12000, max: 18000 },
    marginEstimate: 42,
    pitchAngles: [
      { angle: 'urgency', applied: true },
      { angle: 'efficiency', applied: true },
      { angle: 'safety', applied: true },
    ],
  },
  {
    id: 'lead_003',
    score: 72,
    scoringFactors: [
      { label: 'Local search', value: 16 },
      { label: 'Website inquiry', value: 12 },
    ],
    contactName: 'Mike Rodriguez',
    jobType: 'Residential EV Charger Install',
    jobTypeCategory: 'electrical',
    pitchPreview: 'Homeowner interested in installing EV charger for new Tesla purchase...',
    distance: 2.1,
    dateDiscovered: 'Today at 10:45 AM',
    sourceTag: 'Website',
    freshness: '15 minutes old',
    triggerReason: 'New EV charger inquiry from website contact form',
    estimatedScope: 'Level 2 charger installation with 50-amp dedicated circuit',
    valueRange: { min: 1500, max: 2500 },
  },
  {
    id: 'lead_004',
    score: 68,
    scoringFactors: [
      { label: 'Community event mention', value: 14 },
      { label: 'Vague timeline', value: -8 },
    ],
    contactName: 'Lisa Williamson',
    jobType: 'Kitchen & Bath Lighting',
    jobTypeCategory: 'electrical',
    pitchPreview: 'Bathroom and kitchen lighting redesign for ranch-style home...',
    distance: 6.3,
    dateDiscovered: 'Yesterday at 4:20 PM',
    sourceTag: 'Community Event',
  },
  {
    id: 'lead_005',
    score: 45,
    scoringFactors: [
      { label: 'Fixture replacement inquiry', value: 10 },
      { label: 'Budget not mentioned', value: -15 },
    ],
    contactName: 'David Park',
    jobType: 'General Electrical Maintenance',
    jobTypeCategory: 'maintenance',
    pitchPreview: 'Maintenance work with light bulb fixture replacement and outlet testing...',
    distance: 4.8,
    dateDiscovered: '3 days ago',
    sourceTag: 'Google Search',
  },
  {
    id: 'lead_006',
    score: 52,
    scoringFactors: [
      { label: 'Troubleshooting inquiry', value: 12 },
      { label: 'Previous customer', value: 18 },
    ],
    contactName: 'Amanda Foster',
    jobType: 'Electrical Troubleshooting',
    jobTypeCategory: 'electrical',
    pitchPreview: 'Breaker panel issues with inconsistent outlet power - potential repeat customer...',
    distance: 5.2,
    dateDiscovered: '2 days ago',
    sourceTag: 'Previous Customer Referral',
  },
]

export function HunterPanel({
  leads: leadsFromProps,
  leadsDiscoveredToday: leadsDiscoveredTodayFromProps,
  pipelineValue: _pipelineValueFromProps, // dead prop — not rendered; B4 removes from interface
  averageScore: _averageScoreFromProps,   // dead prop — not rendered; B4 removes from interface
  onTriggerHunterScan,
  onViewStudyQueue,
  onLeadAction,
}: HunterPanelProps) {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [sortBy, setSortBy] = useState<SortOption>('score')
  const [showFilters, setShowFilters] = useState(false)
  // HUNTER-5B: Timeline list sort — 'none' means Score sort (sortBy) applies as before.
  const [timelineSort, setTimelineSort] = useState<TimelineSort>('none')
  const [showTimeline, setShowTimeline] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  // HUNTER-MAP-VIEW-APR28-2026-1
const [mapExpanded, setMapExpandedRaw] = useState(() => {
  try { return localStorage.getItem('hunter_map_expanded') !== 'false' } catch { return true }
})
const setMapExpanded = (v: boolean) => {
  try { localStorage.setItem('hunter_map_expanded', String(v)) } catch {}
  setMapExpandedRaw(v)
}
const [highlightedLeadId, setHighlightedLeadId] = useState<string | null>(null)

const handleMapLeadSelect = (leadId: string) => {
  setHighlightedLeadId(leadId)
  // Scroll the matching card into view
  setTimeout(() => {
    const el = document.querySelector(`[data-lead-id="${leadId}"]`)
    if (el && 'scrollIntoView' in el) {
      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, 50)
  // Auto-clear the highlight after a few seconds
  setTimeout(() => setHighlightedLeadId(null), 3500)
}
  // Distance filter — null = disabled (show all); number = max miles
  const [maxDistanceMiles, setMaxDistanceMiles] = useState<number | null>(null)
  const [distanceFilterEnabled, setDistanceFilterEnabled] = useState(false)
  // Sub-bucket collapse state — Estimated, Lost, Deferred each independent.
  // All three default to collapsed so the screen stays compact; operator
  // expands the bucket they want to investigate.
  const [estimatedExpanded, setEstimatedExpanded] = useState(false)
  const [wonArchivedExpanded, setWonArchivedExpanded] = useState(false)
  const [lostExpanded, setLostExpanded] = useState(false)
  const [rejectedExpanded, setRejectedExpanded] = useState(false)
  const [studyExpanded, setStudyExpanded] = useState(false)
  const [cityPermitsExpanded, setCityPermitsExpanded] = useState(true)
  // HUNTER-UI-GEO-UNIFY-APR30-2026-1: geography filter persisted across sessions
  type GeoFilter = 'all' | 'tlma' | 'indio' | 'palm_springs' | 'palm_desert' | 'portal' | 'yelp'
  const [geoFilter, setGeoFilterRaw] = useState<GeoFilter>(() => {
    try { return (localStorage.getItem('hunter_geo_filter') as GeoFilter) ?? 'all' } catch { return 'all' }
  })
  const setGeoFilter = (f: GeoFilter) => {
    try { localStorage.setItem('hunter_geo_filter', f) } catch {}
    setGeoFilterRaw(f)
  }

  // HUNTER-5D: Zone control — persisted like geoFilter, defaults to the
  // Coachella Valley focus view.
  const [zone, setZoneRaw] = useState<ZoneOption>(() => {
    try { return (localStorage.getItem('hunter_zone') as ZoneOption) ?? 'focus_cv' } catch { return 'focus_cv' }
  })
  const setZone = (z: ZoneOption) => {
    try { localStorage.setItem('hunter_zone', z) } catch {}
    setZoneRaw(z)
  }
  const [showZoneMenu, setShowZoneMenu] = useState(false)

  // HUNTER-B6-MANUAL-ADD-LEAD-APR23-2026-1
  // Modal open/close state and inline success banner state. Banner clears
  // itself via setTimeout after ~3 seconds.
  const [isAddLeadOpen, setIsAddLeadOpen] = useState(false)
  const [addLeadSuccessVisible, setAddLeadSuccessVisible] = useState(false)

  // LEAD-SRC-3C1 — Call opens outbound log modal; external dialer is optional
  const [callLogWarning, setCallLogWarning] = useState<string | null>(null)
  const [callModalOpen, setCallModalOpen] = useState(false)
  const [callModalLead, setCallModalLead] = useState<HunterLead | null>(null)

  const handleCallLead = (lead: HunterLead) => {
    const phone = lead.phone
    if (!phone) {
      setCallLogWarning('No phone number on this lead.')
      return
    }
    setCallLogWarning(null)
    // COACH-LINK-2 — establish shared live_call context; stay on Leads + modal
    if (lead?.id) {
      useSalesIntelStore.getState().beginSalesSession(String(lead.id), 'live_call')
    }
    onLeadAction?.(lead.id, 'call', phone)
    setCallModalLead(lead)
    setCallModalOpen(true)
  }

  const closeCallModal = () => {
    setCallModalOpen(false)
    setCallModalLead(null)
  }

  const handleAddLeadSuccess = () => {
    setAddLeadSuccessVisible(true)
    window.setTimeout(() => {
      setAddLeadSuccessVisible(false)
    }, 3000)
  }

  // HUNTER-B3-PANEL-STORE-REWIRE-APR23-2026-1
  // Subscribe to hunterStore and fetch real leads on mount. If caller passes
  // leads prop (e.g., tests or external wrappers), prop wins. Otherwise the
  // store's tenant-scoped Supabase data feeds the panel via translator.
  const storeLeads = useHunterStore((s) => s.leads)
  const storeIsLoading = useHunterStore((s) => s.isLoading)
  const storeLastError = useHunterStore((s) => s.lastError)
  const fetchLeads = useHunterStore((s) => s.fetchLeads)

  useEffect(() => {
    if (!leadsFromProps) {
      fetchLeads().catch((err) => {
        console.error('[HunterPanel] fetchLeads failed:', err)
      })
    }
  }, [leadsFromProps, fetchLeads])

  const translatedStoreLeads = useMemo(
    () => storeLeads.map(translateStoreToPanel),
    [storeLeads],
  )

  // HUNTER-MANUAL-SCAN-BUTTON-APR28-2026-1
  // Manual "Scan Now" button handler. Calls deployed tlma-scraper Edge
  // Function (which logs to cron_run_log via inject HUNTER-CRON-STATUS-
  // VISIBILITY). Owner-only is enforced implicitly by the Edge Function's
  // service-role check (auth header required). CORS preflight must
  // succeed; tlma-scraper >= v9 required.
  //
  // HUNTER-SCAN-ACCURACY-2026-06-23: When a specific city geo filter is
  // active, the scan targets only that city (8 combos instead of 104) with
  // a 30-day lookback. Full 13-city scan is triggered only from "All" or
  // non-city filters. Error messaging now reflects actual scan outcome
  // (failed/partial/complete) and surfaces the first diagnostic error.
  const GEO_TO_TLMA_CITY: Partial<Record<GeoFilter, string>> = {
    palm_desert: 'PALM DESERT',
    indio: 'INDIO',
    palm_springs: 'PALM SPRINGS',
    tlma: 'COACHELLA',
  }

  type ScanResultStatus = 'complete' | 'partial' | 'blocked' | 'failed'
  interface TlmaScanResult {
    status: ScanResultStatus
    title: string
    newCount: number
    updatedCount: number
    matrixSize: number
    completedCount?: number
    blockedCount: number
    httpErrorCount: number
    issueCount: number
    manualReviewRequired: boolean
    blockedReason?: string
    firstError?: string
    firstErrorBody?: string
    sourceStatus?: string
    cityLabel?: string
    abortedEarly?: boolean
  }

  const [isScanning, setIsScanning] = useState(false)
  const [scanResult, setScanResult] = useState<TlmaScanResult | null>(null)

  const [tlmaSearchFilters, setTlmaSearchFilters] = useState<TlmaSearchFilters>(() => ({
    ...DEFAULT_TLMA_SEARCH_FILTERS,
  }))
  const tlmaSearchUrl = useMemo(
    () => buildTlmaSearchUrl(tlmaSearchFilters),
    [tlmaSearchFilters],
  )

  useEffect(() => {
    const mapped = GEO_TO_TLMA_CITY[geoFilter]
    if (mapped && geoFilter !== 'all' && geoFilter !== 'tlma') {
      setTlmaSearchFilters(prev => ({ ...prev, city: mapped }))
    }
  }, [geoFilter])

  const updateTlmaSearchFilter = (patch: Partial<TlmaSearchFilters>) => {
    setTlmaSearchFilters(prev => ({ ...prev, ...patch }))
  }

  const [isTlmaPasteOpen, setIsTlmaPasteOpen] = useState(false)
  const [showTlmaMethodModal, setShowTlmaMethodModal] = useState(false)
  const [tlmaPasteHtml, setTlmaPasteHtml] = useState('')
  const [tlmaParsePreview, setTlmaParsePreview] = useState<{
    total_rows: number
    rows_with_permit_numbers: number
    permits: ParsedTlmaPermit[]
    warnings: string[]
  } | null>(null)
  const [tlmaImportResult, setTlmaImportResult] = useState<{
    rows_inserted: number
    rows_updated: number
    rows_skipped: number
    error_count: number
    message?: string
  } | null>(null)
  const [isTlmaParsing, setIsTlmaParsing] = useState(false)
  const [isTlmaImporting, setIsTlmaImporting] = useState(false)
  const [tlmaClipboardStatus, setTlmaClipboardStatus] = useState<string | null>(null)
  const [isFixingGeo, setIsFixingGeo] = useState(false)
  const [geoFixResult, setGeoFixResult] = useState<{
    processed: number
    succeeded: number
    failed: number
    skipped: number
    remaining: number
    hint?: string
    errors?: { address?: string; error?: string }[]
  } | null>(null)

  const handleOpenTlmaSearch = () => {
    window.open(tlmaSearchUrl, '_blank', 'noopener,noreferrer')
  }

  const handleParseTlmaPaste = () => {
    setIsTlmaParsing(true)
    setTlmaImportResult(null)
    setTlmaClipboardStatus(null)
    try {
      const parsed = parseTlmaTableHtml(tlmaPasteHtml)
      setTlmaParsePreview(parsed)
    } finally {
      setIsTlmaParsing(false)
    }
  }

  const handleImportFromClipboard = async () => {
    setIsTlmaParsing(true)
    setTlmaImportResult(null)
    setTlmaClipboardStatus(null)
    try {
      if (!navigator.clipboard?.readText) {
        setTlmaClipboardStatus('Browser blocked clipboard read. Use Paste TLMA Table instead.')
        return
      }
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        setTlmaClipboardStatus('Clipboard is empty. Click the bookmarklet on the TLMA results page first.')
        return
      }
      if (!looksLikeTlmaTableHtml(text)) {
        setTlmaClipboardStatus(
          'Clipboard does not look like a TLMA results table. Click the bookmarklet from the TLMA results page first.',
        )
        return
      }
      const parsed = parseTlmaTableHtml(text)
      setTlmaParsePreview(parsed)
      if (parsed.permits.length > 0) {
        setTlmaClipboardStatus(`Parsed ${parsed.permits.length} TLMA permits from clipboard.`)
      } else if (parsed.warnings[0]) {
        setTlmaClipboardStatus(parsed.warnings[0])
      } else {
        setTlmaClipboardStatus('No importable permits found in clipboard.')
      }
    } catch {
      setTlmaClipboardStatus('Browser blocked clipboard read. Use Paste TLMA Table instead.')
    } finally {
      setIsTlmaParsing(false)
    }
  }

  const handleImportTlmaPaste = async () => {
    if (!tlmaParsePreview?.permits.length || isTlmaImporting) return
    setIsTlmaImporting(true)
    setTlmaImportResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        alert('Not authenticated. Please refresh and sign in again.')
        return
      }
      const rows = buildTlmaImportRows(tlmaParsePreview.permits)
      const resp = await fetch('/.netlify/functions/city-scraper?action=tlma-import', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rows }),
      })
      const result = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        alert(`TLMA import failed: ${result.error || resp.statusText}`)
        return
      }
      setTlmaImportResult({
        rows_inserted: result.rows_inserted ?? 0,
        rows_updated: result.rows_updated ?? 0,
        rows_skipped: result.rows_skipped ?? 0,
        error_count: result.error_count ?? 0,
        message: result.message,
      })
      await fetchLeads()
    } catch (err: any) {
      alert(`TLMA import error: ${err?.message ?? String(err)}`)
    } finally {
      setIsTlmaImporting(false)
    }
  }

  const closeTlmaPasteModal = () => {
    setIsTlmaPasteOpen(false)
    setTlmaPasteHtml('')
    setTlmaParsePreview(null)
    setTlmaImportResult(null)
    setTlmaClipboardStatus(null)
  }

  const closeTlmaMethodModal = () => {
    setShowTlmaMethodModal(false)
    closeTlmaPasteModal()
  }

  const tlmaPreviewRows = useMemo(
    () => (tlmaParsePreview?.permits?.length ? previewTlmaImportRows(tlmaParsePreview.permits, 5) : []),
    [tlmaParsePreview],
  )

  const renderTlmaImportPreview = () => {
    if (!tlmaParsePreview) return null
    return (
      <div className="rounded border border-gray-800 bg-gray-900 p-3 text-sm space-y-2">
        <div className="text-gray-200">
          Parsed {tlmaParsePreview.total_rows} row(s) · {tlmaParsePreview.rows_with_permit_numbers} with permit numbers
        </div>
        {tlmaParsePreview.warnings.map((warning) => (
          <p key={warning} className="text-xs text-amber-300">{warning}</p>
        ))}
        {tlmaParsePreview.permits.length === 0 ? (
          <p className="text-xs text-gray-400">No importable permits found.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-400">First permits preview:</p>
            <ul className="space-y-1 text-xs text-gray-300">
              {tlmaPreviewRows.map((row) => (
                <li key={row.permit_number} className="border border-gray-800 rounded px-2 py-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-white">{row.permit_number}</span>
                    <span className="text-yellow-300">{row.score} · {row.score_tier}</span>
                    <span>{row.city || 'Unknown city'}</span>
                    <span>{row.permit_type || 'Unknown type'}</span>
                    <span>{row.status || 'Unknown status'}</span>
                  </div>
                  {row.address && <div className="text-gray-400 mt-0.5">{row.address}</div>}
                  {row.description && <div className="text-gray-500 mt-0.5">{row.description.slice(0, 120)}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={handleImportTlmaPaste}
            disabled={!tlmaParsePreview.permits.length || isTlmaImporting}
            className="px-3 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm rounded"
          >
            {isTlmaImporting ? 'Importing…' : 'Import Leads'}
          </button>
        </div>
      </div>
    )
  }

  const renderTlmaSearchBuilder = (showOpenButton = true) => (
    <div className="rounded border border-gray-800 bg-gray-900/70 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-gray-200">TLMA Search Builder</div>
          <p className="text-xs text-gray-500 mt-1">
            Use TLMA Search Builder to open a broader county search, then copy the result table and import it.
          </p>
        </div>
        {showOpenButton && (
          <button
            type="button"
            onClick={handleOpenTlmaSearch}
            className="shrink-0 flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition-colors"
          >
            <ExternalLink size={14} />
            Open TLMA Search
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
        <label className="text-xs text-gray-400 space-y-1">
          <span>City</span>
          <select
            value={tlmaSearchFilters.city ?? ''}
            onChange={(e) => updateTlmaSearchFilter({ city: e.target.value })}
            className="w-full px-2 py-1.5 bg-gray-950 text-gray-200 text-sm rounded border border-gray-700"
          >
            {TLMA_SEARCH_CITIES.map(option => (
              <option key={option.label} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="text-xs text-gray-400 space-y-1">
          <span>Permit Type</span>
          <select
            value={tlmaSearchFilters.permitType ?? ''}
            onChange={(e) => updateTlmaSearchFilter({ permitType: e.target.value })}
            className="w-full px-2 py-1.5 bg-gray-950 text-gray-200 text-sm rounded border border-gray-700"
          >
            {TLMA_SEARCH_PERMIT_TYPES.map(option => (
              <option key={option.label} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="text-xs text-gray-400 space-y-1">
          <span>Page Size</span>
          <select
            value={String(tlmaSearchFilters.pageSize ?? 100)}
            onChange={(e) => updateTlmaSearchFilter({ pageSize: Number(e.target.value) })}
            className="w-full px-2 py-1.5 bg-gray-950 text-gray-200 text-sm rounded border border-gray-700"
          >
            {TLMA_PAGE_SIZE_OPTIONS.map(size => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>

        <label className="text-xs text-gray-400 space-y-1">
          <span>Page</span>
          <input
            type="number"
            min={1}
            value={tlmaSearchFilters.page ?? 1}
            onChange={(e) => updateTlmaSearchFilter({ page: Math.max(1, Number(e.target.value) || 1) })}
            className="w-full px-2 py-1.5 bg-gray-950 text-gray-200 text-sm rounded border border-gray-700"
          />
        </label>

        <label className="text-xs text-gray-400 space-y-1">
          <span>Applied From</span>
          <input
            type="date"
            value={tlmaSearchFilters.appliedDateStart ?? ''}
            onChange={(e) => updateTlmaSearchFilter({ appliedDateStart: e.target.value })}
            className="w-full px-2 py-1.5 bg-gray-950 text-gray-200 text-sm rounded border border-gray-700"
          />
        </label>

        <label className="text-xs text-gray-400 space-y-1">
          <span>Applied To</span>
          <input
            type="date"
            value={tlmaSearchFilters.appliedDateEnd ?? ''}
            onChange={(e) => updateTlmaSearchFilter({ appliedDateEnd: e.target.value })}
            className="w-full px-2 py-1.5 bg-gray-950 text-gray-200 text-sm rounded border border-gray-700"
          />
        </label>

        <label className="text-xs text-gray-400 space-y-1">
          <span>Issued From</span>
          <input
            type="date"
            value={tlmaSearchFilters.issuedDateStart ?? ''}
            onChange={(e) => updateTlmaSearchFilter({ issuedDateStart: e.target.value })}
            className="w-full px-2 py-1.5 bg-gray-950 text-gray-200 text-sm rounded border border-gray-700"
          />
        </label>

        <label className="text-xs text-gray-400 space-y-1">
          <span>Issued To</span>
          <input
            type="date"
            value={tlmaSearchFilters.issuedDateEnd ?? ''}
            onChange={(e) => updateTlmaSearchFilter({ issuedDateEnd: e.target.value })}
            className="w-full px-2 py-1.5 bg-gray-950 text-gray-200 text-sm rounded border border-gray-700"
          />
        </label>
      </div>

      <p className="text-[11px] text-gray-500">
        TLMA only imports the page you copy. For more results, go to page 2, copy the table again, and import.
        Existing permits are updated, not duplicated.
      </p>
    </div>
  )

  const buildScanResult = (
    result: Record<string, unknown>,
    tlmaCity: string | null,
  ): TlmaScanResult => {
    const newCount = (result.new_leads ?? result.inserts ?? result.inserted ?? 0) as number
    const updatedCount = (result.updated_leads ?? result.updates ?? result.updated ?? 0) as number
    const errorMessages: string[] = Array.isArray(result.errors) ? result.errors as string[] : []
    const matrixSize = typeof result.search_matrix_size === 'number'
      ? result.search_matrix_size
      : (tlmaCity ? 8 : 104)
    const completedCount = typeof result.completed_matrix_count === 'number'
      ? result.completed_matrix_count
      : undefined
    const blockedCount = typeof result.blocked_count === 'number' ? result.blocked_count : 0
    const httpErrorCount = typeof result.http_error_count === 'number'
      ? result.http_error_count
      : Math.max(0, errorMessages.length - blockedCount)
    const issueCount = blockedCount + httpErrorCount > 0
      ? blockedCount + httpErrorCount
      : errorMessages.length
    const manualReviewRequired = Boolean(
      result.manual_review_required ?? (blockedCount > 0 || result.aborted_for_blocked_source),
    )
    const abortedEarly = Boolean(result.aborted_for_blocked_source)
    const sourceStatus = typeof result.source_status === 'string' ? result.source_status : undefined
    const blockedReason = typeof result.blocked_reason === 'string' ? result.blocked_reason : undefined
    const firstErrorBody = typeof result.first_error_body === 'string' ? result.first_error_body : undefined
    const firstError = errorMessages[0]
    const hasLeadActivity = newCount > 0 || updatedCount > 0
    const cityLabel = tlmaCity ? ` [${tlmaCity}]` : ''

    let status: ScanResultStatus = 'complete'
    let title = `Scan complete${cityLabel}`

    if (manualReviewRequired && !hasLeadActivity) {
      status = 'blocked'
      title = `Source blocked automated access${cityLabel}`
    } else if (hasLeadActivity && issueCount > 0) {
      status = 'partial'
      title = `Scan partial${cityLabel}`
    } else if (issueCount > 0 && !hasLeadActivity) {
      status = abortedEarly || sourceStatus === 'blocked' ? 'blocked' : 'failed'
      title = status === 'blocked'
        ? `Source blocked automated access${cityLabel}`
        : `Scan could not complete${cityLabel}`
    } else if (issueCount > 0) {
      status = 'partial'
      title = `Scan partial${cityLabel}`
    }

    return {
      status,
      title,
      newCount,
      updatedCount,
      matrixSize,
      completedCount,
      blockedCount,
      httpErrorCount,
      issueCount,
      manualReviewRequired,
      blockedReason,
      firstError,
      firstErrorBody,
      sourceStatus,
      cityLabel: tlmaCity ?? undefined,
      abortedEarly,
    }
  }

  const handleScanTLMA = async () => {
    if (isScanning) return
    setIsScanning(true)
    setScanResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? ''
      if (!SUPABASE_URL || !token) {
        alert('Not authenticated. Please refresh and sign in again.')
        return
      }
      const tlmaCity = GEO_TO_TLMA_CITY[geoFilter] ?? null
      const params = new URLSearchParams({ source: 'manual' })
      if (tlmaCity) {
        params.set('city', tlmaCity)
        params.set('days_back', '30')
      }
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/tlma-scraper?${params.toString()}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })
      const result = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        alert(`Scan failed: ${result.error || resp.statusText}`)
        return
      }
      setScanResult(buildScanResult(result, tlmaCity))
      await fetchLeads()
    } catch (err: any) {
      alert(`Scan error: ${err?.message ?? String(err)}`)
    } finally {
      setIsScanning(false)
    }
  }

  const leads: HunterLead[] = leadsFromProps ?? translatedStoreLeads

  // HUNTER-UI-GEO-UNIFY-APR30-2026-1: geography-scoped lead set gates all buckets
  const geoFilteredLeads = useMemo(() => {
    switch (geoFilter) {
      case 'tlma':         return leads.filter((l: any) => l.source === 'tlma_riverside')
      case 'indio':        return leads.filter((l: any) => l.city?.toLowerCase() === 'indio')
      case 'palm_springs': return leads.filter((l: any) => l.city?.toLowerCase() === 'palm springs')
      case 'palm_desert':  return leads.filter((l: any) => l.city?.toLowerCase() === 'palm desert')
      case 'portal':       return leads.filter((l: any) => l.source === 'customer_portal' || l.sourceTag === 'customer_portal')
      case 'yelp':         return leads.filter((l: any) => l.source === 'yelp_ad' || l.sourceTag === 'yelp_ad' || (l as any).source_tag === 'yelp_ad')
      default:             return leads
    }
  }, [leads, geoFilter])

  // HUNTER-5D: Zone filtering applied on top of geoFilteredLeads, before the
  // Filter panel and Timeline/Score sort. Radius options use the existing
  // distanceFromBaseMiles/distance field only — leads with unknown distance
  // never silently pass a numeric radius; they belong in Pending Geo instead.
  const zoneFilteredLeads = useMemo(() => {
    switch (zone) {
      case 'focus_cv':
        return geoFilteredLeads.filter((l: any) => isCoachellaValleyCity(l.city))
      case 'radius_50':
      case 'radius_75':
      case 'radius_100': {
        const miles = ZONE_RADIUS_MILES[zone]!
        return geoFilteredLeads.filter((l: any) => {
          const d = l.distanceFromBaseMiles ?? l.distance
          return d != null && d <= miles
        })
      }
      case 'pending_geo':
        return geoFilteredLeads.filter(isPendingGeoLead)
      case 'all_imported':
      default:
        return geoFilteredLeads
    }
  }, [geoFilteredLeads, zone])

  const pendingGeoCount = useMemo(
    () => geoFilteredLeads.filter(isPendingGeoLead).length,
    [geoFilteredLeads],
  )

  // Real computation for leadsDiscoveredToday if not provided as prop.
  // "Today" = leads whose dateDiscovered renders a string matching today's format.
  // Until B4 unifies types we rely on the translator's formatted string — close enough.
  const todayString = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const leadsDiscoveredToday = leadsDiscoveredTodayFromProps
    ?? leads.filter((l) => l.dateDiscovered === todayString).length
  const [showMoreMenu, setShowMoreMenu] = useState(false)

  // Canonical filtered dataset shared by Top Leads and Lead Map. Timeline and
  // score/distance sort are applied only in filteredAndSortedLeads below.
  const canonicalFilteredLeads = useMemo(() => {
    let result = zoneFilteredLeads.filter((lead) => {
      // Score tier filter — bypass for archived-status leads so they
      // always reach the isArchivedLead bucket regardless of score.
      const leadStatus = (lead as any).status
      const isArchivedByStatus = leadStatus === 'lost' || leadStatus === 'deferred' || leadStatus === 'archived' || leadStatus === 'estimated'
      if (isArchivedByStatus) {
        // Always include archived leads in filteredAndSortedLeads
        // showArchived controls section visibility, not filtering
        return true
      }
      if (filters.scoreTier !== 'all' && filters.scoreTier !== 'archived') {
        const tier = getScoreTierLabel(lead.score)
        if (tier !== filters.scoreTier) return false
      }

      // Job type filter
      if (filters.jobType !== 'all' && lead.jobTypeCategory?.toLowerCase() !== filters.jobType) {
        return false
      }

      // Distance filter
      if (lead.distance !== undefined) {
        if (lead.distance < filters.distanceMin || lead.distance > filters.distanceMax) {
          return false
        }
      }

      // Urgency filter
      if (filters.urgencyOnly && lead.score < 75) {
        return false
      }

      // Source tag filter
      if (filters.sourceTag !== 'all' && lead.sourceTag !== filters.sourceTag) {
        return false
      }

      return true
    })

    // Distance filter — applied after other filters
    // Leads without geocoding (null distance) are always included so we don't hide pending leads
    if (distanceFilterEnabled && maxDistanceMiles !== null) {
      result = result.filter((l) => {
        const d = (l as any).distanceFromBaseMiles ?? l.distance
        return d == null || d <= maxDistanceMiles
      })
    }

    return result
  }, [zoneFilteredLeads, filters, distanceFilterEnabled, maxDistanceMiles])

  // Sort — Timeline sort (when active) takes priority over Score sort (sortBy).
  // Timeline affects list order only; it never touches HunterMap.
  const filteredAndSortedLeads = useMemo(() => {
    const result = [...canonicalFilteredLeads]

    if (timelineSort !== 'none') {
      result.sort((a: any, b: any) => {
        switch (timelineSort) {
          case 'permit_newest':
            return new Date(b.permitIssuedDate || 0).getTime() - new Date(a.permitIssuedDate || 0).getTime()
          case 'permit_oldest':
            return new Date(a.permitIssuedDate || 0).getTime() - new Date(b.permitIssuedDate || 0).getTime()
          case 'portal_newest':
            return new Date(b.dateAddedToPortal || 0).getTime() - new Date(a.dateAddedToPortal || 0).getTime()
          case 'portal_oldest':
            return new Date(a.dateAddedToPortal || 0).getTime() - new Date(b.dateAddedToPortal || 0).getTime()
          default:
            return 0
        }
      })
      return result
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case 'score':
          return b.score - a.score
        case 'date':
          return new Date(b.dateDiscovered).getTime() - new Date(a.dateDiscovered).getTime()
        case 'value':
          return (b.valueRange?.max || 0) - (a.valueRange?.max || 0)
        case 'distance':
          return (a.distance || 999) - (b.distance || 999)
        case 'nearest': {
          // Nearest first; nulls go to the bottom
          const aD = (a as any).distanceFromBaseMiles ?? a.distance
          const bD = (b as any).distanceFromBaseMiles ?? b.distance
          if (aD == null && bD == null) return 0
          if (aD == null) return 1
          if (bD == null) return -1
          return aD - bD
        }
        default:
          return 0
      }
    })

    return result
  }, [canonicalFilteredLeads, sortBy, timelineSort])

  // Tier thresholds per canonical HUNTER scoring: elite 85+, strong 75-84,
  // qualified 60-74, expansion 40-59, archived <40.
  // "Top Leads" section spans elite+strong+qualified (score >= 60).
  // Unscored leads: score null/undefined/0 - typically manual adds pending
  // automated scoring. Rendered in a distinct section above tiered leads so
  // operator can see them immediately after creation even before scoring runs.
  
  // Status-aware filter helpers
  // Statuses that disqualify a lead from appearing in Leads tab by default.
  // 'won' is permanently excluded (Pipeline tab owns won leads).
  // 'lost', 'deferred', 'archived' are hidden by default but surfaced when
  // showArchived toggle is on.
  const isArchivedStatus = (status: string | null | undefined) =>
    status === 'lost' || status === 'deferred' || status === 'archived' || status === 'estimated'
  const isActiveLead = (lead: any) => {
    const s = (lead as any).status
    return s !== 'won' && !isArchivedStatus(s)
  }
  const isArchivedLead = (lead: any) => isArchivedStatus((lead as any).status)

  const activeLeads = filteredAndSortedLeads.filter(isActiveLead)

  const unscoredLeads = activeLeads.filter(
    (l) => l.score === 0 || l.score == null
  )
  const topLeads = activeLeads.filter((l) => (l.score ?? 0) >= 60)
  const expansionLeads = activeLeads.filter(
    (l) => (l.score ?? 0) >= 40 && (l.score ?? 0) < 60
  )

  // HUNTER-UI-GEO-UNIFY-APR30-2026-1: city-portal leads now flow through score
  // buckets (Top/Expansion) via geoFilter — no separate City Permits section.

  // Archived bucket: lost/deferred/archived/estimated leads, hidden behind toggle.
  const archivedLeads = filteredAndSortedLeads.filter(isArchivedLead)

  // Sub-buckets within Archived — split by disposition so operator can scan
  // each independently. Each bucket has its own collapse state.
  const wonArchivedLeads = archivedLeads.filter((l: any) => (l as any).disposition === 'won_archived' || l.status === 'estimated' || l.status === 'won')
  const lostLeads = archivedLeads.filter((l: any) => (l as any).disposition === 'lost' || (l.status === 'lost' && !(l as any).disposition))
  const rejectedLeads = archivedLeads.filter((l: any) => (l as any).disposition === 'rejected')
  const studyLeads = archivedLeads.filter((l: any) => (l as any).disposition === 'study' || (l.status === 'deferred' && !(l as any).disposition))
  const otherArchivedLeads = archivedLeads.filter((l: any) =>
    l.status !== 'estimated' && l.status !== 'lost' && l.status !== 'deferred'
  )

  // Metrics
  const totalPipeline = geoFilteredLeads.reduce((sum, lead) => {
    const midpoint = lead.valueRange
      ? (lead.valueRange.min + lead.valueRange.max) / 2
      : 0
    return sum + midpoint
  }, 0)

  const avgScore = geoFilteredLeads.length > 0 ? (geoFilteredLeads.reduce((sum, l) => sum + l.score, 0) / geoFilteredLeads.length).toFixed(0) : 0

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-gray-900 to-black">
      {/* Header */}
      <div className="bg-gray-950 border-b border-gray-800 p-4 space-y-4">
        {/* Title and Actions */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Zap className="text-yellow-500" size={28} />
              HUNTER
            </h1>
            <p className="text-xs text-gray-400 mt-1">Lead discovery and pipeline intelligence</p>
          </div>
          <div className="flex gap-2">
            {/* HUNTER-B6-MANUAL-ADD-LEAD-APR23-2026-1 */}
            <button
              onClick={() => setIsAddLeadOpen(true)}
              className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded transition-colors"
              title="Manually add a new lead"
            >
              <Plus size={14} />
              Add Lead
            </button>
            <button
              onClick={handleScanTLMA}
              disabled={isScanning}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
              title={isScanning ? 'Scan in progress…' : GEO_TO_TLMA_CITY[geoFilter] ? `Scan TLMA for ${GEO_TO_TLMA_CITY[geoFilter]} only (30 days)` : 'Scan all 13 TLMA cities (7 days)'}
            >
              {isScanning ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RotateCcw size={14} />
              )}
              {isScanning ? 'Scanning…' : 'Scan Now'}
            </button>
            <button
              onClick={() => setShowTlmaMethodModal(true)}
              className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition-colors"
              title="Open TLMA search, copy table data, or import from clipboard"
            >
              <ClipboardPaste size={14} />
              TLMA Method
            </button>
            <button
              onClick={onViewStudyQueue}
              className="flex items-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded transition-colors"
              title="View Study Queue for deferred lessons"
            >
              <BookOpen size={14} />
              Queue
            </button>
            <button
              onClick={async () => {
                setIsFixingGeo(true)
                setGeoFixResult(null)
                try {
                  const { resolveHunterTenantIdOrNull } = await import(
                    '@/services/hunter/resolveHunterTenantId'
                  )
                  const tenantId = await resolveHunterTenantIdOrNull()
                  if (!tenantId) return
                  const { triggerGeocodingBackfill } = await import('@/services/geocoding/GeocodingClient')
                  const result = await triggerGeocodingBackfill(tenantId)
                  setGeoFixResult(result)
                  fetchLeads()
                } finally {
                  setIsFixingGeo(false)
                }
              }}
              disabled={isFixingGeo}
              className="flex items-center gap-2 px-3 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
              title="Retry geocoding for all pending/failed leads"
            >
              {isFixingGeo ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              Fix Geo
            </button>
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="p-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
            >
              <MoreVertical size={16} />
            </button>
          </div>
        </div>

        {geoFixResult && (
          <div
            className={clsx(
              'rounded border p-3 text-sm space-y-2',
              geoFixResult.failed > 0
                ? 'bg-amber-950 border-amber-800 text-amber-100'
                : 'bg-emerald-950 border-emerald-800 text-emerald-100',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="font-semibold">Fix Geo result</div>
              <button
                type="button"
                onClick={() => setGeoFixResult(null)}
                className="text-xs underline opacity-80 hover:opacity-100 shrink-0"
              >
                Dismiss
              </button>
            </div>
            <div className="text-xs opacity-90">
              {geoFixResult.processed} processed · {geoFixResult.succeeded} succeeded ·{' '}
              {geoFixResult.failed} failed · {geoFixResult.skipped} skipped ·{' '}
              {geoFixResult.remaining} remaining
            </div>
            {geoFixResult.failed > 0 && /REQUEST_DENIED|API key/i.test(geoFixResult.hint || '') && (
              <p className="text-xs">
                Google geocoding key may be restricted or denied. Check Supabase
                GOOGLE_MAPS_API_KEY / Google Cloud Geocoding API settings.
              </p>
            )}
            {geoFixResult.skipped > 0 && (
              <p className="text-xs">
                Some leads were skipped because address/city was missing.
              </p>
            )}
            {geoFixResult.hint && (
              <p className="text-xs opacity-80">{geoFixResult.hint}</p>
            )}
            {geoFixResult.errors && geoFixResult.errors.length > 0 && (
              <details className="text-xs opacity-90">
                <summary className="cursor-pointer">Sample failures ({geoFixResult.errors.length})</summary>
                <div className="mt-2 space-y-1">
                  {geoFixResult.errors.map((e, i) => (
                    <p key={i}>{e.address || '(no address)'} — {e.error || 'unknown error'}</p>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {false && renderTlmaSearchBuilder(false)}

        {false && <TlmaBookmarkletHelper
          onImportFromClipboard={handleImportFromClipboard}
          onManualPaste={() => setIsTlmaPasteOpen(true)}
          isImporting={isTlmaParsing}
          clipboardStatus={tlmaClipboardStatus}
        />}

        {false && renderTlmaImportPreview()}

        {false && tlmaImportResult && (
          <div className="rounded border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-100 space-y-1">
            <div className="font-medium">Import complete</div>
            <div>
              {tlmaImportResult.rows_inserted} new · {tlmaImportResult.rows_updated} updated ·{' '}
              {tlmaImportResult.rows_skipped} skipped · {tlmaImportResult.error_count} errors
            </div>
            <div className="text-xs">{tlmaImportResult.message || 'Existing leads were not deleted.'}</div>
          </div>
        )}

        <p className="text-xs text-gray-500">
          TLMA blocks server auto-scan. Browser import only — no server fetch.
        </p>

        {/* HUNTER-1/HUNTER-2: scan result panel — partial/blocked/manual review UX */}
        {scanResult && (
          <div
            className={clsx(
              'rounded border p-3 text-sm space-y-2',
              scanResult.status === 'complete' && 'bg-emerald-950 border-emerald-800 text-emerald-100',
              scanResult.status === 'partial' && 'bg-amber-950 border-amber-800 text-amber-100',
              scanResult.status === 'blocked' && 'bg-orange-950/70 border-orange-800/80 text-orange-100',
              scanResult.status === 'failed' && 'bg-red-950 border-red-800 text-red-100',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">
                  {scanResult.status === 'blocked'
                    ? 'TLMA auto-scan is blocked by the public source. Use browser import.'
                    : scanResult.title}
                </div>
                {(scanResult.status === 'complete' || scanResult.status === 'partial') && (
                  <div className="text-xs mt-1 opacity-90">
                    {scanResult.newCount} new · {scanResult.updatedCount} updated
                    {scanResult.issueCount > 0 && (
                      <span>
                        {' '}· {scanResult.issueCount} of {scanResult.matrixSize} request(s) blocked/failed
                      </span>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setScanResult(null)}
                className="text-xs underline opacity-80 hover:opacity-100 shrink-0"
              >
                Dismiss
              </button>
            </div>

            {scanResult.status === 'blocked' ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleOpenTlmaSearch}
                  className="px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-white border border-gray-600"
                >
                  Open TLMA Search
                </button>
                <button
                  type="button"
                  onClick={() => setIsTlmaPasteOpen(true)}
                  className="px-2.5 py-1 rounded bg-indigo-800 hover:bg-indigo-700 text-xs text-white border border-indigo-600"
                >
                  Paste TLMA Table
                </button>
              </div>
            ) : (
              <>
                {scanResult.manualReviewRequired && (
                  <p className="text-xs">
                    Manual review required. Existing leads were not deleted.
                  </p>
                )}
                {scanResult.status !== 'complete' && (
                  <details className="text-xs opacity-90">
                    <summary className="cursor-pointer">Diagnostics</summary>
                    <div className="mt-2 space-y-1">
                      {scanResult.blockedCount > 0 && (
                        <p>Blocked responses: {scanResult.blockedCount}</p>
                      )}
                      {(scanResult.blockedReason || scanResult.firstError) && (
                        <p>{scanResult.blockedReason || scanResult.firstError}</p>
                      )}
                      {scanResult.sourceStatus && (
                        <p>Source status: {scanResult.sourceStatus}</p>
                      )}
                    </div>
                  </details>
                )}
              </>
            )}
          </div>
        )}

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-800 rounded p-3 border border-gray-700">
            <div className="text-xs text-gray-400">Leads Today</div>
            <div className="text-2xl font-bold text-white">{leadsDiscoveredToday}</div>
            <div className="text-xs text-gray-500 mt-1">Discovered this morning</div>
          </div>
          <div className="bg-gray-800 rounded p-3 border border-gray-700">
            <div className="text-xs text-gray-400">Pipeline Value</div>
            <div className="text-2xl font-bold text-emerald-400">
              ${(totalPipeline / 1000).toFixed(1)}k
            </div>
            <div className="text-xs text-gray-500 mt-1">In queue</div>
          </div>
          <div className="bg-gray-800 rounded p-3 border border-gray-700">
            <div className="text-xs text-gray-400">Avg Score</div>
            <div className="text-2xl font-bold text-yellow-400">{avgScore}</div>
            <div className="text-xs text-gray-500 mt-1">Quality index</div>
          </div>
        </div>

        {/* HUNTER-MAP-VIEW-APR28-2026-1 — collapsible map */}
        <div className="border border-gray-800 rounded overflow-hidden bg-gray-950">
          <button
            onClick={() => setMapExpanded(!mapExpanded)}
            className="w-full flex items-center justify-between px-3 py-2 bg-gray-900 hover:bg-gray-800 transition-colors"
          >
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <MapIcon size={13} className="text-emerald-500" />
              <span className="font-medium">Lead Map</span>
              <span className="text-gray-500">— pin click opens lead</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                {([['all', 'All'], ['tlma', 'TLMA'], ['indio', 'Indio'], ['palm_springs', 'Palm Springs'], ['palm_desert', 'Palm Desert'], ['portal', '⚡ Portal'], ['yelp', 'Yelp']] as const).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setGeoFilter(val)}
                    className={clsx(
                      'px-2 py-0.5 rounded text-xs font-medium transition-colors',
                      geoFilter === val
                        ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-500/50'
                        : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-500'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {mapExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
            </div>
          </button>
          {mapExpanded && (
            <div style={{ height: '50vh', minHeight: 320 }}>
              <HunterMap
              leads={canonicalFilteredLeads}
              onLeadSelect={handleMapLeadSelect}
            />
            </div>
          )}
        </div>
        
        {/* HUNTER-B6-MANUAL-ADD-LEAD-APR23-2026-1 — inline success confirmation */}
        {addLeadSuccessVisible && (
          <div className="bg-emerald-900 border border-emerald-700 rounded p-3 text-sm text-emerald-100 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
            Lead added
          </div>
        )}

        {callLogWarning && (
          <div className="bg-amber-950 border border-amber-700 rounded p-3 text-sm text-amber-100 flex items-start justify-between gap-3">
            <span>{callLogWarning}</span>
            <button
              type="button"
              className="text-amber-300 hover:text-white text-xs shrink-0"
              onClick={() => setCallLogWarning(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Empty State Message */}
        {leads.length === 0 && (
          <div className="bg-amber-900 border border-amber-700 rounded p-3 text-sm text-amber-100 flex items-center justify-between">
            <span>
              ⏰ No leads yet. HUNTER scans run every morning. {' '}
              <button
                onClick={onTriggerHunterScan}
                className="underline hover:text-amber-50 font-medium"
              >
                Trigger manual scan now
              </button>
            </span>
          </div>
        )}
      </div>

      

      {/* Expandable Filter Panel - moved to map header */}
      {false && (
        <div>
          <div>
            <div>
              <label className="text-xs text-gray-400 font-medium">Score Tier</label>
              <select
                value={filters.scoreTier}
                onChange={(e) => setFilters({ ...filters, scoreTier: e.target.value as any })}
                className="w-full mt-1 px-2 py-1 bg-gray-800 text-gray-300 text-xs rounded border border-gray-700 focus:outline-none focus:border-blue-500"
              >
                <option value="all">All Tiers</option>
                <option value="elite">Elite (85+)</option>
                <option value="strong">Strong (75-84)</option>
                <option value="qualified">Qualified (60-74)</option>
                <option value="expansion">Expansion (40-59)</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            {/* Job Type Filter */}
            <div>
              <label className="text-xs text-gray-400 font-medium">Job Type</label>
              <select
                value={filters.jobType}
                onChange={(e) => setFilters({ ...filters, jobType: e.target.value })}
                className="w-full mt-1 px-2 py-1 bg-gray-800 text-gray-300 text-xs rounded border border-gray-700 focus:outline-none focus:border-blue-500"
              >
                <option value="all">All Types</option>
                <option value="electrical">Electrical</option>
                <option value="hvac">HVAC</option>
                <option value="plumbing">Plumbing</option>
                <option value="solar">Solar</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>

            {/* Distance Range */}
            <div className="col-span-2">
              <label className="text-xs text-gray-400 font-medium">
                Distance: {filters.distanceMin} - {filters.distanceMax} miles
              </label>
              <div className="flex gap-2 mt-1">
                <input
                  type="range"
                  min="0"
                  max="250"
                  value={filters.distanceMin}
                  onChange={(e) => setFilters({ ...filters, distanceMin: parseInt(e.target.value) })}
                  className="flex-1"
                />
                <input
                  type="range"
                  min="0"
                  max="500"
                  value={filters.distanceMax}
                  onChange={(e) => setFilters({ ...filters, distanceMax: parseInt(e.target.value) })}
                  className="flex-1"
                />
              </div>
            </div>

            {/* Urgency Toggle */}
            <div className="col-span-2">
              <button
                type="button"
                onClick={() => setFilters({ ...filters, urgencyOnly: !filters.urgencyOnly })}
                className={clsx(
                  'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition',
                  filters.urgencyOnly
                    ? 'bg-orange-500/20 border-orange-500/50 text-orange-300'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                )}
                aria-pressed={filters.urgencyOnly}
              >
                <span className={clsx(
                  'w-1.5 h-1.5 rounded-full',
                  filters.urgencyOnly ? 'bg-orange-400' : 'bg-gray-600'
                )} />
                Urgent only (score 75+)
              </button>
            </div>
            {/* Show Archived Leads Toggle */}
            <div className="col-span-2">
              <button
                type="button"
                onClick={() => setShowArchived(!showArchived)}
                className={clsx(
                  'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition',
                  showArchived
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                )}
                aria-pressed={showArchived}
              >
                <span className={clsx(
                  'w-1.5 h-1.5 rounded-full',
                  showArchived ? 'bg-emerald-400' : 'bg-gray-600'
                )} />
                Show archived (lost, deferred, estimated)
              </button>
            </div>

            {/* Within X miles distance filter */}
            <div className="col-span-2 space-y-2">
              <button
                type="button"
                onClick={() => {
                  const next = !distanceFilterEnabled
                  setDistanceFilterEnabled(next)
                  if (next && maxDistanceMiles === null) setMaxDistanceMiles(50)
                }}
                className={clsx(
                  'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition',
                  distanceFilterEnabled
                    ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                )}
                aria-pressed={distanceFilterEnabled}
              >
                <span className={clsx(
                  'w-1.5 h-1.5 rounded-full',
                  distanceFilterEnabled ? 'bg-blue-400' : 'bg-gray-600'
                )} />
                Within {distanceFilterEnabled && maxDistanceMiles != null ? `${maxDistanceMiles} miles` : 'X miles'}
              </button>
              {distanceFilterEnabled && (
                <div>
                  <label className="text-xs text-gray-400">
                    Max distance: {maxDistanceMiles} mi
                  </label>
                  <input
                    type="range"
                    min="5"
                    max="100"
                    step="5"
                    value={maxDistanceMiles ?? 50}
                    onChange={(e) => setMaxDistanceMiles(parseInt(e.target.value))}
                    className="w-full mt-1"
                  />
                  <div className="flex justify-between text-xs text-gray-600 mt-0.5">
                    <span>5 mi</span>
                    <span>100 mi</span>
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* Reset Filters */}
          <button
            onClick={() => {
              setFilters(DEFAULT_FILTERS)
              setDistanceFilterEnabled(false)
              setMaxDistanceMiles(null)
            }}
            className="text-xs text-gray-400 hover:text-gray-200 underline"
          >
            Reset all filters
          </button>
        </div>
      )}

      {/* Lead Inbox */}
      <div className="flex-1 overflow-y-auto space-y-4 p-4">
        <PortalInbox onLeadConverted={fetchLeads} />
        {(geoFilter === 'yelp') && (
          <YelpAdPanel />
        )}
        {geoFilteredLeads.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-400">
            <Zap size={48} className="mb-3 opacity-50" />
            {leads.length === 0 ? (
              <>
                <p>No leads yet. HUNTER scans run every morning.</p>
                <button
                  onClick={onTriggerHunterScan}
                  className="mt-3 text-blue-400 hover:text-blue-300 underline text-sm"
                >
                  Trigger manual scan
                </button>
              </>
            ) : (
              <p className="text-sm">No leads in this area. Select a different jurisdiction above.</p>
            )}
          </div>
        ) : (
          <>
            {/* Unscored Leads (score 0 or null - pending automated scoring) */}
            {unscoredLeads.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-sky-400"></span>
                  Unscored Leads ({unscoredLeads.length})
                  <span className="ml-2 text-xs text-gray-400 font-normal">
                    pending automated scoring
                  </span>
                </h2>
                <div className="space-y-2">
                  {unscoredLeads.map((lead) => (
                    <HunterLeadCard
                      key={lead.id}
                      lead={lead}
                      onStatusChange={(id, status) => {
                        onLeadAction?.(id, 'status_change', status)
                      }}
                      onNotesChange={(id, notes) => {
                        onLeadAction?.(id, 'update_notes', notes)
                      }}
                      onCall={handleCallLead}
                      onPractice={(lead) => {
                        onLeadAction?.(lead.id, 'practice', lead)
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Top Leads (Elite + Strong + Qualified) */}
            {/* HUNTER-4B: Filter/Score controls moved here from Lead Map header —
                same height as the section title, far right. Filter feeds the
                shared canonical dataset; Score updates list sorting only. */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-yellow-500"></span>
                  Top Leads ({topLeads.length})
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* HUNTER-5D: Zone — shared map/list organization control.
                      Defaults to Focus: Coachella Valley. */}
                  <div className="relative">
                    <button
                      onClick={() => setShowZoneMenu(!showZoneMenu)}
                      className={clsx(
                        'flex items-center gap-1.5 min-h-[36px] px-3 py-2 rounded border transition-colors text-sm font-medium',
                        zone !== 'all_imported'
                          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                          : 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border-gray-700'
                      )}
                    >
                      Zone: {ZONE_OPTIONS.find((o) => o.value === zone)?.label ?? 'Focus: Coachella Valley'}
                      <ChevronDown size={14} className={clsx('transition-transform', showZoneMenu && 'rotate-180')} />
                    </button>
                    {showZoneMenu && (
                      <div className="absolute left-0 mt-1 w-64 bg-gray-900 border border-gray-800 rounded shadow-lg z-10 py-1">
                        {ZONE_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => { setZone(opt.value); setShowZoneMenu(false) }}
                            className={clsx(
                              'w-full text-left px-3 py-1.5 text-xs hover:bg-gray-800',
                              zone === opt.value ? 'text-cyan-300' : 'text-gray-300'
                            )}
                          >
                            {opt.label}
                            {opt.value === 'pending_geo' && pendingGeoCount > 0 && (
                              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/30 text-amber-200">
                                {pendingGeoCount}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className="flex items-center gap-1.5 min-h-[36px] px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded border border-gray-700 transition-colors text-sm font-medium"
                  >
                    <Settings size={14} />
                    Filter
                    <ChevronDown size={14} className={clsx('transition-transform', showFilters && 'rotate-180')} />
                  </button>
                  {/* HUNTER-5B: Timeline — list-only sort by permit date / added-to-portal
                      date. Never changes the map pin set; never hardcodes a date range. */}
                  <div className="relative">
                    <button
                      onClick={() => setShowTimeline(!showTimeline)}
                      className={clsx(
                        'flex items-center gap-1.5 min-h-[36px] px-3 py-2 rounded border transition-colors text-sm font-medium',
                        timelineSort !== 'none'
                          ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                          : 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border-gray-700'
                      )}
                    >
                      Timeline
                      {timelineSort !== 'none' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/30 text-blue-200">
                          active
                        </span>
                      )}
                      <ChevronDown size={14} className={clsx('transition-transform', showTimeline && 'rotate-180')} />
                    </button>
                    {showTimeline && (
                      <div className="absolute right-0 mt-1 w-56 bg-gray-900 border border-gray-800 rounded shadow-lg z-10 py-1">
                        {([
                          { value: 'permit_newest', label: 'Permit Date: Newest first' },
                          { value: 'permit_oldest', label: 'Permit Date: Oldest first' },
                          { value: 'portal_newest', label: 'Added to Portal: Newest first' },
                          { value: 'portal_oldest', label: 'Added to Portal: Oldest first' },
                        ] as Array<{ value: TimelineSort; label: string }>).map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => { setTimelineSort(opt.value); setShowTimeline(false) }}
                            className={clsx(
                              'w-full text-left px-3 py-1.5 text-xs hover:bg-gray-800',
                              timelineSort === opt.value ? 'text-blue-300' : 'text-gray-300'
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                        <div className="border-t border-gray-800 my-1" />
                        <button
                          type="button"
                          onClick={() => { setTimelineSort('none'); setShowTimeline(false) }}
                          className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800"
                        >
                          Clear Timeline Sort
                        </button>
                      </div>
                    )}
                  </div>
                  <label className="flex items-center gap-1.5 min-h-[36px] px-3 py-2 bg-gray-800 rounded border border-gray-700 text-sm text-gray-300">
                    <span className="text-gray-400">Score</span>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortOption)}
                      className="bg-transparent text-gray-100 focus:outline-none text-sm"
                    >
                      <option value="score">Score</option>
                      <option value="date">Date</option>
                      <option value="value">Value</option>
                      <option value="distance">Distance</option>
                      <option value="nearest">Nearest</option>
                    </select>
                  </label>
                </div>
              </div>
              {/* HUNTER-5D: Zone helper copy — clarifies Home Base dependency and
                  which views need Fix Geo. List-only; no map or data changes. */}
              <p className="text-[11px] text-gray-500 mb-2">
                Zone uses your saved HUNTER Home Base from Fix Geo. Pending Geo leads need Fix Geo before radius views are accurate.
                {zone === 'focus_cv' && ' City-based focus. No geocode required.'}
                {(zone === 'radius_50' || zone === 'radius_75' || zone === 'radius_100') && ' Distance from HUNTER Home Base. Pending geocode leads are separated.'}
              </p>
              {zone === 'pending_geo' && zoneFilteredLeads.length > 0 && (
                <p className="text-[11px] text-amber-300 mb-2">
                  Run Fix Geo from Settings / HUNTER Home Base to calculate distance.
                </p>
              )}
              {showFilters && (
                <div className="bg-gray-900 border border-gray-800 rounded px-3 py-2 flex flex-wrap items-center gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={filters.scoreTier}
                      onChange={(e) => setFilters({ ...filters, scoreTier: e.target.value as any })}
                      className="px-2 py-1 bg-gray-800 text-gray-300 text-xs rounded border border-gray-700 focus:outline-none"
                    >
                      <option value="all">All Tiers</option>
                      <option value="elite">Elite (85+)</option>
                      <option value="strong">Strong (75-84)</option>
                      <option value="qualified">Qualified (60-74)</option>
                      <option value="expansion">Expansion (40-59)</option>
                    </select>
                    <select
                      value={filters.jobType}
                      onChange={(e) => setFilters({ ...filters, jobType: e.target.value })}
                      className="px-2 py-1 bg-gray-800 text-gray-300 text-xs rounded border border-gray-700 focus:outline-none"
                    >
                      <option value="all">All Types</option>
                      <option value="residential">Residential</option>
                      <option value="commercial">Commercial</option>
                      <option value="electrical">Electrical</option>
                      <option value="solar">Solar</option>
                      <option value="maintenance">Maintenance</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setFilters({ ...filters, urgencyOnly: !filters.urgencyOnly })}
                      className={clsx(
                        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition',
                        filters.urgencyOnly
                          ? 'bg-orange-500/20 border-orange-500/50 text-orange-300'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                      )}
                    >
                      <span className={clsx('w-1.5 h-1.5 rounded-full', filters.urgencyOnly ? 'bg-orange-400' : 'bg-gray-600')} />
                      Urgent only (75+)
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowArchived(!showArchived)}
                      className={clsx(
                        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition',
                        showArchived
                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                      )}
                    >
                      <span className={clsx('w-1.5 h-1.5 rounded-full', showArchived ? 'bg-emerald-400' : 'bg-gray-600')} />
                      Show archived
                    </button>
                    {/* HUNTER-5D: Radius presets moved to the Zone control above —
                        removed here to avoid duplicate/conflicting radius UI. */}
                    <button
                      onClick={() => { setFilters(DEFAULT_FILTERS); setTimelineSort('none') }}
                      className="text-xs text-gray-500 hover:text-gray-300 underline ml-1"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              )}
              {topLeads.length > 0 && (
                <div className="space-y-2">
                  {topLeads.map((lead) => (
                    <HunterLeadCard
                      key={lead.id}
                      lead={lead}
                      onStatusChange={(id, status) => {
                        onLeadAction?.(id, 'status_change', status)
                      }}
                      onNotesChange={(id, notes) => {
                        onLeadAction?.(id, 'update_notes', notes)
                      }}
                      onCall={handleCallLead}
                      onPractice={(lead) => {
                        onLeadAction?.(lead.id, 'practice', lead)
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Expansion Opportunities */}
            {expansionLeads.length > 0 && (
              <div className="bg-gray-800 bg-opacity-50 border-2 border-dashed border-amber-700 rounded p-4">
                <h2 className="text-sm font-bold text-amber-200 mb-3 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-500"></span>
                  Expansion Opportunities ({expansionLeads.length})
                </h2>
                <p className="text-xs text-gray-400 mb-3">
                  Lower-scoring leads with potential. Study and nurture these for future wins.
                </p>
                <div className="space-y-2">
                  {expansionLeads.map((lead) => (
                    <HunterLeadCard
                      key={lead.id}
                      lead={lead}
                      onStatusChange={(id, status) => {
                        onLeadAction?.(id, 'status_change', status)
                      }}
                      onNotesChange={(id, notes) => {
                        onLeadAction?.(id, 'update_notes', notes)
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* City-portal leads now flow through Top Leads / Expansion via geoFilter */}

            {/* Archived Leads - conditionally shown, split into sub-buckets */}
            {showArchived && archivedLeads.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-800">
                <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-gray-500"></span>
                  Archived Leads ({archivedLeads.length})
                </h2>

                {/* Won Archived */}
                {wonArchivedLeads.length > 0 && (
                  <div className="mb-3">
                    <button type="button" onClick={() => setWonArchivedExpanded(!wonArchivedExpanded)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 rounded text-left transition-colors">
                      <span className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        <span className="text-xs font-semibold text-emerald-300">Won Archived</span>
                        <span className="text-xs text-gray-500">({wonArchivedLeads.length})</span>
                      </span>
                      <span className="text-gray-500 text-xs">{wonArchivedExpanded ? '▼' : '▶'}</span>
                    </button>
                    {wonArchivedExpanded && (
                      <div className="mt-2 space-y-2 opacity-75">
                        {wonArchivedLeads.map((lead) => (
                          <HunterLeadCard key={lead.id} lead={lead}
                            onStatusChange={(id, status) => onLeadAction?.(id, 'status_change', status)}
                            onNotesChange={(id, notes) => onLeadAction?.(id, 'update_notes', notes)}
                            onCall={handleCallLead}
                            onPractice={(lead) => onLeadAction?.(lead.id, 'practice', lead)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Lost */}
                {lostLeads.length > 0 && (
                  <div className="mb-3">
                    <button type="button" onClick={() => setLostExpanded(!lostExpanded)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 rounded text-left transition-colors">
                      <span className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                        <span className="text-xs font-semibold text-red-300">Lost</span>
                        <span className="text-xs text-gray-500">({lostLeads.length})</span>
                      </span>
                      <span className="text-gray-500 text-xs">{lostExpanded ? '▼' : '▶'}</span>
                    </button>
                    {lostExpanded && (
                      <div className="mt-2 space-y-2 opacity-75">
                        {lostLeads.map((lead) => (
                          <HunterLeadCard key={lead.id} lead={lead}
                            onStatusChange={(id, status) => onLeadAction?.(id, 'status_change', status)}
                            onNotesChange={(id, notes) => onLeadAction?.(id, 'update_notes', notes)}
                            onCall={handleCallLead}
                            onPractice={(lead) => onLeadAction?.(lead.id, 'practice', lead)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Rejected */}
                {rejectedLeads.length > 0 && (
                  <div className="mb-3">
                    <button type="button" onClick={() => setRejectedExpanded(!rejectedExpanded)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 rounded text-left transition-colors">
                      <span className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-400"></span>
                        <span className="text-xs font-semibold text-orange-300">Rejected</span>
                        <span className="text-xs text-gray-500">({rejectedLeads.length})</span>
                      </span>
                      <span className="text-gray-500 text-xs">{rejectedExpanded ? '▼' : '▶'}</span>
                    </button>
                    {rejectedExpanded && (
                      <div className="mt-2 space-y-2 opacity-75">
                        {rejectedLeads.map((lead) => (
                          <HunterLeadCard key={lead.id} lead={lead}
                            onStatusChange={(id, status) => onLeadAction?.(id, 'status_change', status)}
                            onNotesChange={(id, notes) => onLeadAction?.(id, 'update_notes', notes)}
                            onCall={handleCallLead}
                            onPractice={(lead) => onLeadAction?.(lead.id, 'practice', lead)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Study */}
                {studyLeads.length > 0 && (
                  <div className="mb-3">
                    <button type="button" onClick={() => setStudyExpanded(!studyExpanded)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 rounded text-left transition-colors">
                      <span className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                        <span className="text-xs font-semibold text-blue-300">Study</span>
                        <span className="text-xs text-gray-500">({studyLeads.length})</span>
                      </span>
                      <span className="text-gray-500 text-xs">{studyExpanded ? '▼' : '▶'}</span>
                    </button>
                    {studyExpanded && (
                      <div className="mt-2 space-y-2 opacity-75">
                        {studyLeads.map((lead) => (
                          <HunterLeadCard key={lead.id} lead={lead}
                            onStatusChange={(id, status) => onLeadAction?.(id, 'status_change', status)}
                            onNotesChange={(id, notes) => onLeadAction?.(id, 'update_notes', notes)}
                            onCall={handleCallLead}
                            onPractice={(lead) => onLeadAction?.(lead.id, 'practice', lead)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* No results message */}
            {activeLeads.length === 0 && unscoredLeads.length === 0 && (
              <div className="text-center text-gray-400 text-sm p-8">
                No active leads.
                {archivedLeads.length > 0 && !showArchived && (
                  <span className="block mt-1 text-gray-500 text-xs">
                    ({archivedLeads.length} archived leads hidden — enable via Filter)
                  </span>
                )}
                {activeLeads.length === 0 && archivedLeads.length === 0 && (
                  <button
                    onClick={() => setFilters(DEFAULT_FILTERS)}
                    className="text-blue-400 hover:text-blue-300 underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* HUNTER-B6-MANUAL-ADD-LEAD-APR23-2026-1 */}
      <AddLeadModal
        isOpen={isAddLeadOpen}
        onClose={() => setIsAddLeadOpen(false)}
        onSuccess={handleAddLeadSuccess}
      />

      <CallLogModal
        isOpen={callModalOpen}
        mode="create"
        defaultDirection="outbound"
        defaultPhone={callModalLead?.phone ?? ''}
        defaultHunterLeadId={callModalLead?.id ?? null}
        showOptionalDialer
        onClose={closeCallModal}
        onSaved={(log) => {
          setCallLogWarning(null)
          // COACH-LINK-2 — attach durable call_logs.id when linked to active lead
          const session = useSalesIntelStore.getState().salesSession
          if (
            log?.id &&
            session &&
            log.hunterLeadId &&
            log.hunterLeadId === session.leadId
          ) {
            useSalesIntelStore.getState().attachCallLog(log.id)
          }
        }}
      />

      {showTlmaMethodModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-lg border border-gray-700 bg-gray-950 shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
              <div>
                <h2 className="text-lg font-semibold text-white">TLMA Method</h2>
                <p className="text-xs text-gray-400 mt-1">
                  Search TLMA, copy table data, or import from clipboard.
                </p>
              </div>
              <button
                type="button"
                onClick={closeTlmaMethodModal}
                className="p-1 text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <section className="space-y-2">
                <div>
                  <h3 className="text-sm font-semibold text-white">Search Builder</h3>
                  <p className="text-xs text-gray-500">Build and open the same TLMA county search as before.</p>
                </div>
              </section>

              {renderTlmaSearchBuilder(true)}

              <section className="rounded border border-gray-800 bg-gray-900/60 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Import Tools</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      Paste copied TLMA table HTML, or import table HTML from your clipboard.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsTlmaPasteOpen(true)}
                    className="shrink-0 inline-flex items-center gap-2 px-3 py-2 bg-indigo-700 hover:bg-indigo-600 text-white text-sm rounded"
                  >
                    <ClipboardPaste size={14} />
                    Paste TLMA Table
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleImportFromClipboard}
                    disabled={isTlmaParsing}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm rounded"
                  >
                    {isTlmaParsing ? 'Reading clipboard...' : 'Import From Clipboard'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsTlmaPasteOpen(true)}
                    className="text-xs text-gray-400 hover:text-gray-200 underline"
                  >
                    Manual Paste
                  </button>
                </div>
                {isTlmaPasteOpen && (
                  <div className="space-y-3">
              <textarea
                value={tlmaPasteHtml}
                onChange={(e) => {
                  setTlmaPasteHtml(e.target.value)
                  setTlmaParsePreview(null)
                  setTlmaImportResult(null)
                  setTlmaClipboardStatus(null)
                }}
                placeholder='Paste HTML containing #resultsScroll table or table.results-table…'
                className="w-full h-40 px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 font-mono"
              />

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleParseTlmaPaste}
                  disabled={!tlmaPasteHtml.trim() || isTlmaParsing}
                  className="px-3 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-sm rounded"
                >
                  {isTlmaParsing ? 'Parsing…' : 'Parse'}
                </button>
              </div>
                  </div>
                )}

                {tlmaClipboardStatus && (
                  <p className="text-xs text-gray-300 border border-gray-800 rounded px-2 py-1.5 bg-gray-950/80">
                    {tlmaClipboardStatus}
                  </p>
                )}
              </section>

              <section className="space-y-2">
                <div>
                  <h3 className="text-sm font-semibold text-white">Bookmarklet Helper</h3>
                  <p className="text-xs text-gray-500">Install the helper once, then use it on the TLMA results page.</p>
                </div>
                <TlmaBookmarkletHelper
                  onImportFromClipboard={handleImportFromClipboard}
                  onManualPaste={() => setIsTlmaPasteOpen(true)}
                  isImporting={isTlmaParsing}
                  clipboardStatus={null}
                />
              </section>

              {renderTlmaImportPreview()}

              {tlmaImportResult && (
                <div className="rounded border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-100 space-y-1">
                  <div className="font-medium">Import complete</div>
                  <div>{tlmaImportResult.rows_inserted} new · {tlmaImportResult.rows_updated} updated · {tlmaImportResult.rows_skipped} skipped · {tlmaImportResult.error_count} errors</div>
                  <div className="text-xs">{tlmaImportResult.message || 'Existing leads were not deleted.'}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default HunterPanel
