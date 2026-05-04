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
import { ChevronDown, Settings, RotateCcw, Zap, BookOpen, MoreVertical, Plus, Loader2, MapIcon, ChevronUp } from 'lucide-react'
import HunterMap from './HunterMap'
import { supabase } from '@/lib/supabase'
import clsx from 'clsx'
import HunterLeadCard, { type HunterLead } from './HunterLeadCard'
import AddLeadModal from './AddLeadModal'
import PortalInbox from './PortalInbox'
import YelpAdPanel from './YelpAdPanel'
import { useHunterStore } from '@/store/hunterStore'
import type { HunterLead as StoreHunterLead } from '@/services/hunter/HunterTypes'

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
  const wcKey = ((storeLead as any).work_class_code ?? '').toLowerCase().trim()
  const ptKey = ((storeLead as any).permit_type_code ?? '').toLowerCase().trim()
  const valueRange = estValue && estValue > 0
    ? { min: Math.round(estValue * 0.85), max: Math.round(estValue * 1.15) }
    : WORK_CLASS_VALUE_ESTIMATES[wcKey] ?? WORK_CLASS_VALUE_ESTIMATES[ptKey]

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
    distance: (storeLead as any).distance_from_base_miles ?? undefined,
    distanceFromBaseMiles: (storeLead as any).distance_from_base_miles ?? undefined,
    latitude: (storeLead as any).latitude ?? undefined,
    longitude: (storeLead as any).longitude ?? undefined,
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
  type GeoFilter = 'all' | 'tlma' | 'indio' | 'palm_springs' | 'portal' | 'yelp'
  const [geoFilter, setGeoFilterRaw] = useState<GeoFilter>(() => {
    try { return (localStorage.getItem('hunter_geo_filter') as GeoFilter) ?? 'all' } catch { return 'all' }
  })
  const setGeoFilter = (f: GeoFilter) => {
    try { localStorage.setItem('hunter_geo_filter', f) } catch {}
    setGeoFilterRaw(f)
  }

  // HUNTER-B6-MANUAL-ADD-LEAD-APR23-2026-1
  // Modal open/close state and inline success banner state. Banner clears
  // itself via setTimeout after ~3 seconds.
  const [isAddLeadOpen, setIsAddLeadOpen] = useState(false)
  const [addLeadSuccessVisible, setAddLeadSuccessVisible] = useState(false)

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
  const [isScanning, setIsScanning] = useState(false)
  const handleScanTLMA = async () => {
    if (isScanning) return
    setIsScanning(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? ''
      if (!SUPABASE_URL || !token) {
        alert('Not authenticated. Please refresh and sign in again.')
        return
      }
      const params = new URLSearchParams({ source: 'manual' })
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/tlma-scraper?${params.toString()}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })
      const result = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        alert(`Scan failed: ${result.error || resp.statusText}`)
        return
      }
      const newCount = result.new_leads ?? result.inserts ?? result.inserted ?? 0
      const updatedCount = result.updated_leads ?? result.updates ?? result.updated ?? 0
      const errorCount = (result.errors && Array.isArray(result.errors))
        ? result.errors.length
        : (typeof result.errors === 'number' ? result.errors : 0)
      alert(
        `Scan complete — ${newCount} new lead(s), ${updatedCount} updated` +
          (errorCount ? `, ${errorCount} error(s)` : '') +
          '.'
      )
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
      case 'indio':        return leads.filter((l: any) => l.city === 'Indio')
      case 'palm_springs': return leads.filter((l: any) => l.city === 'Palm Springs')
      case 'portal':       return leads.filter((l: any) => l.source === 'customer_portal' || l.sourceTag === 'customer_portal')
      case 'yelp':         return leads.filter((l: any) => l.source === 'yelp_ad' || l.sourceTag === 'yelp_ad' || (l as any).source_tag === 'yelp_ad')
      default:             return leads
    }
  }, [leads, geoFilter])

  // Real computation for leadsDiscoveredToday if not provided as prop.
  // "Today" = leads whose dateDiscovered renders a string matching today's format.
  // Until B4 unifies types we rely on the translator's formatted string — close enough.
  const todayString = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const leadsDiscoveredToday = leadsDiscoveredTodayFromProps
    ?? leads.filter((l) => l.dateDiscovered === todayString).length
  const [showMoreMenu, setShowMoreMenu] = useState(false)

  // Filter and sort leads
  const filteredAndSortedLeads = useMemo(() => {
    let result = geoFilteredLeads.filter((lead) => {
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

    // Sort
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
  }, [geoFilteredLeads, filters, sortBy])

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
              title={isScanning ? 'Scan in progress…' : 'Manually trigger TLMA scan'}
            >
              {isScanning ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RotateCcw size={14} />
              )}
              {isScanning ? 'Scanning…' : 'Scan Now'}
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
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="p-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
            >
              <MoreVertical size={16} />
            </button>
          </div>
        </div>

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
              <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center gap-1 px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded border border-gray-700 transition-colors"
                >
                  <Settings size={11} />
                  Filter
                  <ChevronDown size={11} className={clsx('transition-transform', showFilters && 'rotate-180')} />
                </button>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="px-2 py-0.5 bg-gray-800 text-gray-300 rounded border border-gray-700 hover:border-gray-600 focus:outline-none text-xs"
                >
                  <option value="score">Score</option>
                  <option value="date">Date</option>
                  <option value="value">Value</option>
                  <option value="distance">Distance</option>
                  <option value="nearest">Nearest</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                {([['all', 'All'], ['tlma', 'TLMA'], ['indio', 'Indio'], ['palm_springs', 'Palm Springs'], ['portal', '⚡ Portal'], ['yelp', 'Yelp']] as const).map(([val, label]) => (
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
          {showFilters && (
            <div className="bg-gray-900 border-b border-gray-800 px-3 py-2 flex flex-wrap items-center gap-2">
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
                <button
                  type="button"
                  onClick={() => {
                    const next = !distanceFilterEnabled
                    setDistanceFilterEnabled(next)
                    if (next && maxDistanceMiles === null) setMaxDistanceMiles(50)
                  }}
                  className={clsx(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition',
                    distanceFilterEnabled
                      ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                  )}
                >
                  <span className={clsx('w-1.5 h-1.5 rounded-full', distanceFilterEnabled ? 'bg-blue-400' : 'bg-gray-600')} />
                  {distanceFilterEnabled && maxDistanceMiles != null ? `Within ${maxDistanceMiles} mi` : 'Within X miles'}
                </button>
                {distanceFilterEnabled && (
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="5"
                      max="100"
                      step="5"
                      value={maxDistanceMiles ?? 50}
                      onChange={(e) => setMaxDistanceMiles(parseInt(e.target.value))}
                      className="w-24"
                    />
                    <span className="text-xs text-gray-400">{maxDistanceMiles} mi</span>
                  </div>
                )}
                <button
                  onClick={() => { setFilters(DEFAULT_FILTERS); setDistanceFilterEnabled(false); setMaxDistanceMiles(null) }}
                  className="text-xs text-gray-500 hover:text-gray-300 underline ml-1"
                >
                  Reset
                </button>
              </div>
            </div>
          )}
          {mapExpanded && (
            <div style={{ height: '50vh', minHeight: 320 }}>
              <HunterMap
              leads={geoFilteredLeads}
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
                      onCall={(lead) => {
                        onLeadAction?.(lead.id, 'call', lead.phone)
                      }}
                      onPractice={(lead) => {
                        onLeadAction?.(lead.id, 'practice', lead)
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Top Leads (Elite + Strong + Qualified) */}
            {topLeads.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-yellow-500"></span>
                  Top Leads ({topLeads.length})
                </h2>
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
                      onCall={(lead) => {
                        onLeadAction?.(lead.id, 'call', lead.phone)
                      }}
                      onPractice={(lead) => {
                        onLeadAction?.(lead.id, 'practice', lead)
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

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
                            onCall={(lead) => onLeadAction?.(lead.id, 'call', lead.phone)}
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
                            onCall={(lead) => onLeadAction?.(lead.id, 'call', lead.phone)}
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
                            onCall={(lead) => onLeadAction?.(lead.id, 'call', lead.phone)}
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
                            onCall={(lead) => onLeadAction?.(lead.id, 'call', lead.phone)}
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
    </div>
  )
}

export default HunterPanel
