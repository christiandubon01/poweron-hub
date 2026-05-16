// @ts-nocheck
/**
 * V15rProjectsPanel — Projects panel grouped by Active / Coming / Completed.
 * Faithfully ported from HTML renderProjects().
 *
 * Each card shows: health score (0-100), progress bar, quoted/paid/exposure,
 * chips (stale days, completion %, open RFIs), edit/delete/move-status buttons.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Plus, Edit3, Trash2, ArrowRight, RotateCcw, Eye, FileText, X, Archive } from 'lucide-react'
import {
  getBackupData,
  saveBackupData,
  saveBackupDataAndSync,
  health,
  getOverallCompletion,
  getProjectFinancials,
  resolveProjectBucket,
  daysSince,
  fmtK,
  fmt,
  pct,
  num,
  syncAllProjectFinanceBuckets,
  isActiveProject,
  type BackupProject,
} from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import QuickBooksImportModal from './QuickBooksImportModal'
import { useDemoMode } from '@/store/demoStore'
import { getDemoBackupData } from '@/services/demoDataService'
import { useHunterStore } from '@/store/hunterStore'
import { useAuth } from '@/hooks/useAuth'
import { linkEntityToAccount, upsertRelationshipEvent } from '@/services/relationshipAccountService'
import { useJsApiLoader } from '@react-google-maps/api'
import { GOOGLE_MAPS_BROWSER_KEY } from './MileageProjectAddress'

interface Props {
  onSelectProject?: (projectId: string) => void
  prefillFromLead?: {
    name?: string;
    customer?: string;
    contract?: number;
    type?: string;
    notes?: string;
    leadId?: string;
    leadType?: string;
    hunterContext?: {
      score?: number;
      pitch_angle?: any;
      pitch_script?: string;
      comparable_jobs_count?: number;
      urgency_level?: number;
      urgency_reason?: string;
      value_min?: number;
      value_max?: number;
      freshness?: string;
      source_tag?: string;
      contact_email?: string;
      contact_phone?: string;
      address?: string;
      city?: string;
      estimated_margin?: number;
    };
  } | null
  onPrefillUsed?: () => void
}

const JOB_TYPES = ['Residential', 'Commercial', 'Service', 'Solar', 'New Construction', 'Commercial TI']
const STATUS_OPTIONS = ['active', 'coming']
const REL_ACCOUNT_TYPES = ['General Contractor', 'Subcontractor', 'Homeowner', 'Property Manager', 'Commercial Client', 'Service Customer', 'Other']
const DEFAULT_PHASES = { Planning: 0, Estimating: 0, 'Site Prep': 0, 'Rough-in': 0, Trim: 0, Finish: 0 }

function fmtDate(dateStr?: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function V15rProjectsPanel({ onSelectProject, prefillFromLead, onPrefillUsed }: Props) {
  const { isDemoMode, hasHydrated } = useDemoMode()
  // Pulled from hunterStore so we can transition the source HUNTER lead to
  // status='estimated' ONLY when the operator actually saves a new Project
  // (not when the modal opens). Cancel does nothing — lead stays in Pipeline.
  const updateLeadStatus = useHunterStore((s) => s.updateLeadStatus)
  let authProfile: any = null
  try { authProfile = useAuth().profile } catch { /* auth not available */ }
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    const handler = () => forceUpdate()
    window.addEventListener('poweron-data-saved', handler)
    return () => window.removeEventListener('poweron-data-saved', handler)
  }, [forceUpdate])
  const [showQBImport, setShowQBImport] = useState(false)
  const [showNewProject, setShowNewProject] = useState(false)
  const [showArchivedProjects, setShowArchivedProjects] = useState(false)
  // Local snapshot of HUNTER context from prefillFromLead, kept independent
  // of the prop so the banner persists after onPrefillUsed nulls the prop.
  const [hunterBannerCtx, setHunterBannerCtx] = useState<any>(null)
  const portalLeadRef = useRef<{ isPortal: boolean }>({ isPortal: false })
  // New Project form state
  const [npName, setNpName] = useState('')
  const [npClient, setNpClient] = useState('')
  const [npAccountId, setNpAccountId] = useState('')
  const [npClientEdited, setNpClientEdited] = useState(false)
  const [npContract, setNpContract] = useState('')
  const [npType, setNpType] = useState('Residential')
  const [npStartDate, setNpStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [npStatus, setNpStatus] = useState('active')
  const [npNotes, setNpNotes] = useState('')
  // DASHBOARD-START-DATE-GATE-AND-PERSIST-APR22-2026-1 — "Start Date" input is the single
  // source of truth for project start and now writes to p.plannedStart. The old
  // npPlannedStart state is retired; Planned Start is no longer a separate user field.
  const [npPlannedEnd, setNpPlannedEnd] = useState('')
  const [showNewCustomerModal, setShowNewCustomerModal] = useState(false)
  const [newCustomerForm, setNewCustomerForm] = useState({
    company: '',
    contact: '',
    role: 'General Contractor',
    phone: '',
    email: '',
    address: '',
    city: '',
    notes: '',
    tags: '',
  })

  // Collect modal state
  const [collectProject, setCollectProject] = useState<BackupProject | null>(null)
  const [collectPartialInput, setCollectPartialInput] = useState('')
  const [collectLoggingPartial, setCollectLoggingPartial] = useState(false)

  // Edit Project modal state
  const [showEditProject, setShowEditProject] = useState(false)
  const [editProjectId, setEditProjectId] = useState<string | null>(null)
  const [sourceProjectHighlightId, setSourceProjectHighlightId] = useState<string | null>(null)
  const [epName, setEpName] = useState('')
  const [epClient, setEpClient] = useState('')
  const [epAccountId, setEpAccountId] = useState('')
  const [epContract, setEpContract] = useState('')
  const [epType, setEpType] = useState('Residential')
  const [epStartDate, setEpStartDate] = useState('')
  const [epStatus, setEpStatus] = useState('active')
  const [epNotes, setEpNotes] = useState('')
  // DASHBOARD-START-DATE-GATE-AND-PERSIST-APR22-2026-1 — epPlannedStart retired; "Start Date" now writes to plannedStart.
  const [epPlannedEnd, setEpPlannedEnd] = useState('')
  /** Job site address — same persisted field as Estimate mileage section */
  const [epAddress, setEpAddress] = useState('')
  const [epAddressSuggestions, setEpAddressSuggestions] = useState([])
  const [epShowAddressSuggestions, setEpShowAddressSuggestions] = useState(false)
  const epAutocompleteServiceRef = useRef(null)
  const epSessionTokenRef = useRef(null)
  const epPredictDebounceRef = useRef(null)
  const epSelectedAddressRef = useRef<{
    address: string
    addressLat: number | null
    addressLng: number | null
    placeId: string | null
  } | null>(null)

  const { isLoaded: isMapsLoaded } = useJsApiLoader({
    id: 'v15r-estimate-mileage-places',
    googleMapsApiKey: GOOGLE_MAPS_BROWSER_KEY,
    libraries: ['places'],
  })

  useEffect(() => {
    if (!showEditProject || !isMapsLoaded || !GOOGLE_MAPS_BROWSER_KEY || typeof window === 'undefined') return
    const g = window.google
    if (!g?.maps?.places) return
    epAutocompleteServiceRef.current = new g.maps.places.AutocompleteService()
    epSessionTokenRef.current = new g.maps.places.AutocompleteSessionToken()
  }, [showEditProject, isMapsLoaded])

  useEffect(() => {
    function handleOpenSourceRecord(e: Event) {
      const ev = e as CustomEvent<{ entityType?: string; entityId?: string }>
      const detail = ev.detail || {}
      if (String(detail.entityType || '') !== 'project' || !detail.entityId) return
      const targetId = String(detail.entityId)
      setSourceProjectHighlightId(targetId)
      setTimeout(() => {
        const el = document.querySelector(`[data-project-id="${targetId}"]`) as HTMLElement | null
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 160)
      setTimeout(() => setSourceProjectHighlightId((prev) => (prev === targetId ? null : prev)), 3000)
    }
    window.addEventListener('poweron-open-source-record', handleOpenSourceRecord)
    return () => window.removeEventListener('poweron-open-source-record', handleOpenSourceRecord)
  }, [])

  const backup = (hasHydrated && isDemoMode) ? getDemoBackupData() : getBackupData()

  // Handle prefill from lead conversion
  if (prefillFromLead && !showNewProject) {
    setNpName(prefillFromLead.name || prefillFromLead.customer || '')
    setNpClient(prefillFromLead.customer || '')
    setNpAccountId('')
    setNpClientEdited(false)
    setNpContract(prefillFromLead.contract ? String(prefillFromLead.contract) : '')
    setNpType(prefillFromLead.type || 'Residential')
    setNpNotes(prefillFromLead.notes || '')
    // Snapshot hunterContext locally so banner persists after onPrefillUsed clears the prop
    if (prefillFromLead.hunterContext) {
      setHunterBannerCtx({
        leadId: prefillFromLead.leadId,
        ...prefillFromLead.hunterContext
      })
      const isPortal = prefillFromLead.hunterContext.source_tag === 'customer_portal' ||
                       prefillFromLead.hunterContext.source === 'customer_portal'
      portalLeadRef.current = { isPortal }
    }
    setShowNewProject(true)
    onPrefillUsed?.()
  }

  function openNewProjectModal() {
    setNpName(''); setNpClient(''); setNpContract(''); setNpType('Residential')
    setNpStartDate(new Date().toISOString().slice(0, 10)); setNpStatus('active'); setNpNotes('')
    setNpPlannedEnd('')
    setNpAccountId('')
    setNpClientEdited(false)
    setShowNewCustomerModal(false)
    setShowNewProject(true)
  }

  function closeNewProjectModal() {
    setShowNewProject(false)
    setHunterBannerCtx(null)
    setShowNewCustomerModal(false)
    setNewCustomerForm({
      company: '',
      contact: '',
      role: 'General Contractor',
      phone: '',
      email: '',
      address: '',
      city: '',
      notes: '',
      tags: '',
    })
  }

  function openEditProjectModal(p: BackupProject) {
    const linkedAccountId = String((p as any).accountId || '')
    const linkedAccount = linkedAccountId ? gcContacts.find((g: any) => String(g?.id || '') === linkedAccountId) : null
    const canonicalClient = linkedAccount ? [linkedAccount.company || 'Unnamed', linkedAccount.contact ? `(${linkedAccount.contact})` : ''].filter(Boolean).join(' ').trim() : ''
    setEditProjectId(p.id)
    setEpName(p.name || '')
    setEpClient(canonicalClient || (p as any).client || '')
    setEpAccountId((p as any).accountId || '')
    setEpContract(String(p.contract || 0))
    setEpType(p.type || 'Residential')
    // DASHBOARD-START-DATE-GATE-AND-PERSIST-APR22-2026-1 — "Start Date" reads from plannedStart,
    // not lastMove. lastMove is the auto-updated movement timestamp; plannedStart is the
    // user-entered project start date that feeds the CFOT chart gate.
    setEpStartDate(p.plannedStart ? p.plannedStart.slice(0, 10) : '')
    setEpStatus(p.status || 'active')
    setEpNotes((p as any).notes || '')
    setEpPlannedEnd(p.plannedEnd || '')
    setEpAddress(String((p as any).address || ''))
    epSelectedAddressRef.current = null
    setEpAddressSuggestions([])
    setEpShowAddressSuggestions(false)
    setShowEditProject(true)
  }

  async function saveNewProject() {
    if (!npName.trim()) { alert('Project name is required.'); return }
    if (!backup) return
    pushState(backup)
    const id = 'proj' + Date.now() + Math.random().toString(36).slice(2, 6)
    const newProj: any = {
      id,
      name: npName.trim(),
      client: npClient.trim(),
      accountId: npAccountId || undefined,
      type: npType,
      status: npStatus,
      contract: num(npContract),
      billed: 0,
      paid: 0,
      mileRT: 0,
      miDays: 0,
      phases: { ...DEFAULT_PHASES },
      tasks: { Planning: [], Estimating: [], 'Site Prep': [], 'Rough-in': [], Trim: [], Finish: [] },
      laborRows: [],
      ohRows: [],
      matRows: [],
      mtoRows: [],
      rfis: [],
      coord: {},
      logs: [],
      finance: {},
      lastMove: npStartDate,
      notes: npNotes.trim(),
      created: new Date().toISOString(),
      // DASHBOARD-START-DATE-GATE-AND-PERSIST-APR22-2026-1 — "Start Date" input writes here.
      plannedStart: npStartDate || undefined,
      plannedEnd: npPlannedEnd || undefined,
    }
    // If converted from a lead, add conversion tracking fields
    if (prefillFromLead?.leadId) {
      newProj.convertedFromLeadId = prefillFromLead.leadId
      newProj.convertedFromLeadType = prefillFromLead.leadType || 'unknown'
    }
    backup.projects = [...(backup.projects || []), newProj]
    saveBackupDataAndSync(backup)
    if (newProj.accountId) {
      void linkEntityToAccount({
        orgId: authProfile?.org_id || null,
        accountId: String(newProj.accountId),
        entityType: 'project',
        entityId: String(newProj.id),
        entityLabel: newProj.name || newProj.client || 'Project',
        legacyCustomerText: newProj.client || '',
        metadata: { legacy_payload: newProj },
        createdBy: authProfile?.id || null,
      }).catch((err) => console.warn('[V15rProjectsPanel] relationship link upsert failed', err))
      void upsertRelationshipEvent({
        orgId: authProfile?.org_id || null,
        accountId: String(newProj.accountId),
        entityType: 'project',
        entityId: String(newProj.id),
        title: newProj.name || 'Project',
        description: newProj.notes || '',
        quotedAmount: num(newProj.contract || 0),
        collectedAmount: num(newProj.paid || 0),
        outstandingAmount: Math.max(0, num(newProj.contract || 0) - num(newProj.paid || 0)),
        metadata: { status: newProj.status || '', type: newProj.type || '', legacy_payload: newProj },
        createdBy: authProfile?.id || null,
      }).catch((err) => console.warn('[V15rProjectsPanel] relationship event upsert failed', err))
    }
    // If this Project was created from a HUNTER lead, transition the lead to
    // 'estimated' so it leaves Pipeline's default view. Lineage is already
    // captured via newProj.convertedFromLeadId above.
    if (prefillFromLead?.leadId || hunterBannerCtx?.leadId) {
      const leadId = prefillFromLead?.leadId || hunterBannerCtx?.leadId
      try {
        await updateLeadStatus(leadId, 'estimated' as any)
        // Write disposition so Lead History shows what happened
        const { supabase: sb } = await import('@/lib/supabase')
        await (sb as any).from('hunter_leads').update({
          disposition: 'won_archived',
          disposition_detail: `Converted to project: ${npName.trim() || 'Unnamed project'}`,
          disposition_at: new Date().toISOString(),
        }).eq('id', leadId)
      } catch (err) {
        console.error('[V15rProjectsPanel] Failed to mark HUNTER lead as estimated:', err)
      }

      // If this lead came from the customer portal, fire the Scheduling milestone
      const isPortalLead = portalLeadRef.current.isPortal ||
                           hunterBannerCtx?.source_tag === 'customer_portal' ||
                           hunterBannerCtx?.source === 'customer_portal'
      if (isPortalLead) {
        // Find the portal_request linked to this hunter lead
        console.log('[Portal] isPortalLead=true, leadId=', leadId)
        const { supabase: sb } = await import('@/lib/supabase')
        const { data: portalReq } = await (sb as any)
          .from('portal_requests')
          .select('id')
          .eq('hunter_lead_id', leadId)
          .maybeSingle()
        if (portalReq?.id) {
          try {
            await (sb as any)
              .from('job_timeline')
              .insert({
                portal_request_id: portalReq.id,
                event_type:        'confirmed',
                title:             'Appointment Confirmed',
                description:       'Your appointment has been scheduled. We will be there as planned.',
                event_time:        npStartDate ? new Date(npStartDate + 'T12:00:00').toISOString() : new Date().toISOString(),
                triggered_by:      'owner',
              })
            console.log('[Portal] confirmed milestone inserted for', portalReq.id)
          } catch (err: any) {
            console.error('[V15rProjectsPanel] job_timeline confirmed insert failed:', err)
          }
        }
      }
    }
    setShowNewProject(false)
    setHunterBannerCtx(null)
    forceUpdate()
  }

  function saveEditProject() {
    if (!epName.trim()) { alert('Project name is required.'); return }
    if (!backup || !editProjectId) return
    pushState(backup)
    const p = (backup.projects || []).find((x: any) => x.id === editProjectId)
    if (!p) return
    p.name = epName.trim()
    ;(p as any).client = epClient.trim()
    ;(p as any).accountId = epAccountId || undefined
    p.contract = num(epContract)
    p.type = epType
    p.status = epStatus
    p.lastMove = epStartDate
    ;(p as any).notes = epNotes.trim()
    // DASHBOARD-START-DATE-GATE-AND-PERSIST-APR22-2026-1 — "Start Date" input writes to plannedStart.
    p.plannedStart = epStartDate || undefined
    p.plannedEnd = epPlannedEnd || undefined

    const nextAddr = epAddress.trim()
    const prevAddr = String((p as any).address || '').trim()
    const selectedAddress = epSelectedAddressRef.current
    const selectedMatches =
      !!selectedAddress &&
      nextAddr.length > 0 &&
      selectedAddress.address.trim() === nextAddr

    if (selectedMatches) {
      const lat = selectedAddress.addressLat
      const lng = selectedAddress.addressLng
      if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
        ;(p as any).addressLat = lat
        ;(p as any).addressLng = lng
      } else {
        delete (p as any).addressLat
        delete (p as any).addressLng
      }

      if (selectedAddress.placeId) {
        ;(p as any).placeId = selectedAddress.placeId
      } else {
        delete (p as any).placeId
      }
    } else if (nextAddr !== prevAddr) {
      delete (p as any).addressLat
      delete (p as any).addressLng
      delete (p as any).placeId
    }
    ;(p as any).address = nextAddr

    saveBackupDataAndSync(backup)
    if ((p as any).accountId) {
      void linkEntityToAccount({
        orgId: authProfile?.org_id || null,
        accountId: String((p as any).accountId),
        entityType: 'project',
        entityId: String(p.id),
        entityLabel: p.name || (p as any).client || 'Project',
        legacyCustomerText: (p as any).client || '',
        metadata: { legacy_payload: p },
        createdBy: authProfile?.id || null,
      }).catch((err) => console.warn('[V15rProjectsPanel] relationship link upsert failed', err))
      void upsertRelationshipEvent({
        orgId: authProfile?.org_id || null,
        accountId: String((p as any).accountId),
        entityType: 'project',
        entityId: String(p.id),
        title: p.name || 'Project',
        description: (p as any).notes || '',
        quotedAmount: num(p.contract || 0),
        collectedAmount: num((p as any).paid || 0),
        outstandingAmount: Math.max(0, num(p.contract || 0) - num((p as any).paid || 0)),
        metadata: { status: p.status || '', type: p.type || '', legacy_payload: p },
        createdBy: authProfile?.id || null,
      }).catch((err) => console.warn('[V15rProjectsPanel] relationship event upsert failed', err))
    }
    setShowEditProject(false)
    epSelectedAddressRef.current = null
    setEpAddressSuggestions([])
    setEpShowAddressSuggestions(false)
    setEditProjectId(null)
    forceUpdate()
  }

  if (!backup) {
    return (
      <div className="flex items-center justify-center w-full h-64 bg-[var(--bg-secondary)]">
        <div className="text-gray-500 text-sm">No backup data. Import to view projects.</div>
      </div>
    )
  }

  const allProjects = backup.projects || []
  const projects = allProjects.filter(isActiveProject)
  const isArchivedRecord = (record: any) => !!(record && (record.archived === true || record.isArchived === true || record.archivedAt))
  const archivedProjects = allProjects.filter(isArchivedRecord)
  const gcContacts = backup.gcContacts || []
  const accountOptions = gcContacts.map((gc: any) => ({
    id: String(gc.id || ''),
    label: [gc.company || 'Unnamed', gc.contact ? `(${gc.contact})` : ''].filter(Boolean).join(' ').trim(),
  }))
  syncAllProjectFinanceBuckets(backup)

  function persist(changedKey: string = 'projects') {
    backup._lastSavedAt = new Date().toISOString()
    saveBackupDataAndSync(backup, changedKey)
    forceUpdate()
  }

  function handleSelectProjectAccount(accountId: string, forceFill: boolean = false) {
    setNpAccountId(accountId)
    const selected = accountOptions.find((a: any) => a.id === accountId)
    if (!selected) return
    if (forceFill || !npClientEdited || !npClient.trim()) {
      setNpClient(selected.label)
      setNpClientEdited(false)
    }
  }

  function runEditAddressPredictions(query: string) {
    if (!query || query.trim().length < 3 || !epAutocompleteServiceRef.current) {
      setEpAddressSuggestions([])
      setEpShowAddressSuggestions(false)
      return
    }

    epAutocompleteServiceRef.current.getPlacePredictions(
      {
        input: query.trim(),
        componentRestrictions: { country: 'us' },
        sessionToken: epSessionTokenRef.current || undefined,
      },
      (results, status) => {
        const g = window.google
        if (status !== g.maps.places.PlacesServiceStatus.OK || !results?.length) {
          setEpAddressSuggestions([])
          setEpShowAddressSuggestions(false)
          return
        }
        setEpAddressSuggestions(results)
        setEpShowAddressSuggestions(true)
      },
    )
  }

  function handleEditAddressChange(value: string) {
    epSelectedAddressRef.current = null
    setEpAddress(value)
    clearTimeout(epPredictDebounceRef.current)
    if (!GOOGLE_MAPS_BROWSER_KEY || !isMapsLoaded || !epAutocompleteServiceRef.current) return
    epPredictDebounceRef.current = window.setTimeout(() => runEditAddressPredictions(value), 200)
  }

  function selectEditAddressPrediction(prediction: google.maps.places.AutocompletePrediction) {
    if (!prediction?.place_id || typeof window === 'undefined') return
    const g = window.google
    const svc = new g.maps.places.PlacesService(document.createElement('div'))

    svc.getDetails(
      {
        placeId: prediction.place_id,
        fields: ['formatted_address', 'geometry', 'place_id'],
        sessionToken: epSessionTokenRef.current || undefined,
      },
      (place: google.maps.places.PlaceResult | null, status: string) => {
        epSessionTokenRef.current = new g.maps.places.AutocompleteSessionToken()
        setEpAddressSuggestions([])
        setEpShowAddressSuggestions(false)

        if (status !== g.maps.places.PlacesServiceStatus.OK || !place) return

        const formatted = place.formatted_address?.trim() || prediction.description?.trim() || ''
        const loc = place.geometry?.location
        const lat = loc ? loc.lat() : null
        const lng = loc ? loc.lng() : null
        const hasCoords =
          typeof lat === 'number' &&
          typeof lng === 'number' &&
          Number.isFinite(lat) &&
          Number.isFinite(lng)

        epSelectedAddressRef.current = {
          address: formatted,
          addressLat: hasCoords ? lat : null,
          addressLng: hasCoords ? lng : null,
          placeId: place.place_id ?? prediction.place_id,
        }
        setEpAddress(formatted)
      },
    )
  }

  function saveNewCustomerForProject() {
    const company = String(newCustomerForm.company || '').trim()
    if (!company) {
      alert('Account / company name is required.')
      return
    }
    pushState(backup)
    const newGC: any = {
      id: 'gc' + Date.now(),
      company,
      contact: String(newCustomerForm.contact || '').trim(),
      role: newCustomerForm.role || 'General Contractor',
      phone: String(newCustomerForm.phone || '').trim(),
      email: String(newCustomerForm.email || '').trim(),
      address: String(newCustomerForm.address || '').trim(),
      city: String(newCustomerForm.city || '').trim(),
      intro: '',
      sent: 0,
      awarded: 0,
      avg: 0,
      pay: '',
      phase: 'First Contact',
      fit: 0,
      action: '',
      due: '',
      notes: String(newCustomerForm.notes || '').trim(),
      tags: String(newCustomerForm.tags || '').trim(),
      created: new Date().toISOString().slice(0, 10),
      contactLog: [],
      nextFollowup: '',
      lastContact: '',
    }
    backup.gcContacts = [...gcContacts, newGC]
    saveBackupDataAndSync(backup, 'gcContacts')
    forceUpdate()

    setShowNewCustomerModal(false)
    setNewCustomerForm({
      company: '',
      contact: '',
      role: 'General Contractor',
      phone: '',
      email: '',
      address: '',
      city: '',
      notes: '',
      tags: '',
    })
    const label = [newGC.company || 'Unnamed', newGC.contact ? `(${newGC.contact})` : ''].filter(Boolean).join(' ').trim()
    setNpAccountId(newGC.id)
    setNpClient(label)
    setNpClientEdited(false)
  }

  async function deleteProject(id: string) {
    if (!confirm('Delete this project? This cannot be undone.')) return
    const proj = allProjects.find(p => p.id === id)
    backup.projects = allProjects.filter(p => p.id !== id)
    backup.logs = (backup.logs || []).filter(l => l.projId !== id)
    persist()
    // Write won_archived disposition to linked hunter lead
    if (proj?.convertedFromLeadId) {
      try {
        const { supabase: sb } = await import('@/lib/supabase')
        await (sb as any).from('hunter_leads').update({
          disposition: 'won_archived',
          disposition_detail: `Project deleted: ${(proj.name || 'Unnamed project').split(' - ')[0].trim()}`,
          disposition_at: new Date().toISOString(),
        }).eq('id', proj.convertedFromLeadId)
      } catch (err) {
        console.error('[V15rProjectsPanel] disposition write failed (non-fatal):', err)
      }
    }
  }

  function moveStatus(id: string, newStatus: string) {
    const p = allProjects.find(x => x.id === id)
    if (!p) return
    p.status = newStatus
    if (newStatus === 'completed') p.completedAt = new Date().toISOString()
    persist()
  }

  function archiveProject(id: string) {
    if (!confirm('Archive this record? It will be hidden from active views but kept for history.')) return
    const p = allProjects.find(x => x.id === id)
    if (!p) return
    pushState(backup)
    ;(p as any).archived = true
    ;(p as any).archivedAt = new Date().toISOString()
    ;(p as any).archivedReason = (p as any).archivedReason ?? null
    persist()
  }

  function restoreProject(id: string) {
    const p = allProjects.find(x => x.id === id)
    if (!p) return
    pushState(backup)
    ;(p as any).archived = false
    ;(p as any).isArchived = false
    if ((p as any).archivedAt && !(p as any).lastArchivedAt) {
      ;(p as any).lastArchivedAt = (p as any).archivedAt
    }
    delete (p as any).archivedAt
    persist()
  }

  function markProjectLost(id: string) {
    if (!confirm('Mark this project as lost? It will leave active project queues but stay in data.')) return
    const p = allProjects.find(x => x.id === id)
    if (!p) return
    pushState(backup)
    p.status = 'lost'
    ;(p as any).outcome = 'lost'
    ;(p as any).lostAt = new Date().toISOString()
    persist()
  }

  // ── Collection payment handlers ───────────────────────────────────────────

  function handleMarkFullPayment(p: BackupProject) {
    // DASHBOARD-CFOT-COLLECTION-PATH-PARITY-APR22-2026-1
    // Writes to backup.logs stream (the single source of truth for collected amounts).
    // Drops the p.paid scalar write — getProjectFinancials derives paid from logs,
    // and both health() and mapBackupInvoices now read from getProjectFinancials too.
    // Amount collected = remaining balance (contract − paid), not full contract.
    const fin = getProjectFinancials(p, backup)
    const amount = Math.max(0, num(fin.contract) - num(fin.paid))
    if (amount <= 0) { setCollectProject(null); return }
    pushState()
    const today = new Date().toISOString().slice(0, 10)
    const entry: any = {
      id: 'log' + Date.now(),
      projId: p.id,
      projName: p.name,
      phase: 'Payment',
      date: today,
      emp: 'Me',
      empId: '',
      hrs: 0,
      miles: 0,
      mat: 0,
      collected: amount,
      store: '',
      emergencyMatInfo: '',
      detailLink: '',
      notes: 'Full payment received',
    }
    backup.logs = [...(backup.logs || []), entry]
    p.lastCollectedAt = new Date().toISOString()
    p.lastCollectedAmount = amount
    saveBackupDbackup.logs = [...(backup.logs || []), entry]
    p.lastCollectedAt = new Date().toISOString()
    p.lastCollectedAmount = amount
    saveBackupData(backup)
    // Write disposition_detail to linked HUNTER lead if this project came from one
    if (p.convertedFromLeadId) {
      const leadId = p.convertedFromLeadId
      import('@/lib/supabase').then(({ supabase: sb }) => {
        const detail = `Full payment collected: $${amount.toLocaleString()} on ${today} — Project: ${p.name || 'Unnamed'}`
        ;(sb as any).from('hunter_leads').update({
          disposition_detail: detail,
          disposition_at: new Date().toISOString(),
        }).eq('id', leadId).then(({ error }: any) => {
          if (error) console.error('[V15rProjectsPanel] Failed to update hunter lead disposition_detail:', error)
        })
      })
    }
    setCollectProject(null)
    forceUpdate()
  }
  function handleLogPartialPayment(p: BackupProject) {ata(backup)
    setCollectProject(null)
    forceUpdate()
  }

  function handleLogPartialPayment(p: BackupProject) {
    // DASHBOARD-CFOT-COLLECTION-PATH-PARITY-APR22-2026-1
    // Writes partial payment to backup.logs stream. See handleMarkFullPayment for rationale.
    const amount = num(collectPartialInput)
    if (!amount || amount <= 0) return
    pushState()
    const today = new Date().toISOString().slice(0, 10)
    const entry: any = {
      id: 'log' + Date.now(),
      projId: p.id,
      projName: p.name,
      phase: 'Payment',
      date: today,
      emp: 'Me',
      empId: '',
      hrs: 0,
      miles: 0,
      mat: 0,
      collected: amount,
      store: '',
      emergencyMatInfo: '',
      detailLink: '',
      notes: 'Partial payment received',
    }
    backup.logs = [...(backup.logs || []), entry]
    p.lastCollectedAt = new Date().toISOString()
    p.lastCollectedAmount = amount
    saveBackupData(backup)
    // Write disposition_detail to linked HUNTER lead if this project came from one
    if (p.convertedFromLeadId) {
      const leadId = p.convertedFromLeadId
      import('@/lib/supabase').then(({ supabase: sb }) => {
        const detail = `Partial payment collected: $${amount.toLocaleString()} on ${today} — Project: ${p.name || 'Unnamed'}`
        ;(sb as any).from('hunter_leads').update({
          disposition_detail: detail,
          disposition_at: new Date().toISOString(),
        }).eq('id', leadId).then(({ error }: any) => {
          if (error) console.error('[V15rProjectsPanel] Failed to update hunter lead disposition_detail:', error)
        })
      })
    }
    setCollectPartialInput('')
    setCollectLoggingPartial(false)
    setCollectProject(null)
    forceUpdate()
  }
  // ── Group projects by bucket

  // ── Group projects by bucket
  const active = projects.filter(p => resolveProjectBucket(p) === 'active')
  const coming = projects.filter(p => resolveProjectBucket(p) === 'coming')
  const completed = projects.filter(p => resolveProjectBucket(p) === 'completed')

  function renderProjectCard(p: BackupProject, bucket: string) {
    const h = health(p, backup)
    const o = getOverallCompletion(p, backup)
    const d = daysSince(p.lastMove)
    const openR = (p.rfis || []).filter((r: any) => r.status !== 'answered').length
    const fin = getProjectFinancials(p, backup)

    // Planned timeline display
    const plannedLine = (p.plannedStart && p.plannedEnd)
      ? `Planned: ${fmtDate(p.plannedStart)} – ${fmtDate(p.plannedEnd)}`
      : null

    return (
      <div
        key={p.id}
        data-project-id={p.id}
        className={`rounded-xl border border-gray-800 bg-[var(--bg-card)] p-4 hover:border-gray-600 transition-colors ${sourceProjectHighlightId === String(p.id) ? 'ring-2 ring-cyan-400/70' : ''}`}
      >
        {/* Header: name/type + health score */}
        <div className="flex items-start justify-between mb-2">
          <div
            className="cursor-pointer"
            onClick={() => onSelectProject?.(p.id)}
          >
            <div className="font-bold text-sm text-gray-100">{p.name}</div>
            <div className="text-[10px] text-gray-500">{p.type}</div>
            {plannedLine && (
              <div className="text-[9px] text-gray-500 mt-0.5">{plannedLine}</div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xl font-bold font-mono" style={{ color: h.clr }}>{h.sc}</div>
            <div className="text-[9px] text-gray-500">Health</div>
          </div>
        </div>

        {/* Financial metrics */}
        <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
          <div className="bg-[var(--bg-input)] rounded p-1.5 text-center">
            <div className="text-gray-500 uppercase font-bold">Quoted</div>
            <div className="font-mono text-gray-200">{fmtK(fin.contract)}</div>
          </div>
          <div className="bg-[var(--bg-input)] rounded p-1.5 text-center">
            <div className="text-gray-500 uppercase font-bold">Paid</div>
            <div className="font-mono text-emerald-400">{fmtK(fin.paid)}</div>
          </div>
          <div className="bg-[var(--bg-input)] rounded p-1.5 text-center">
            <div className="text-gray-500 uppercase font-bold">Exposure</div>
            <div className="font-mono text-red-400">{fmtK(fin.risk)}</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 rounded-full bg-gray-700/50 overflow-hidden mb-2">
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, o)}%`, background: h.clr }} />
        </div>

        {/* Chips */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          <span className={`text-[9px] px-2 py-0.5 rounded font-semibold ${
            d >= 14 ? 'bg-red-500/20 text-red-400' : d >= 7 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-emerald-500/20 text-emerald-400'
          }`}>{d}d stale</span>
          <span className="text-[9px] px-2 py-0.5 rounded font-semibold bg-blue-500/20 text-blue-400">
            {pct(Math.round(o))}
          </span>
          {openR > 0 && (
            <span className="text-[9px] px-2 py-0.5 rounded font-semibold bg-red-500/20 text-red-400">
              {openR} RFI
            </span>
          )}
          {bucket === 'completed' && (
            fin.AR > 0 ? (
              <span className="text-[9px] px-2 py-0.5 rounded font-semibold bg-orange-500/20 text-orange-400 border border-orange-500/30"
                    title={`Outstanding balance: ${fmtK(fin.AR)}`}>
                🚨 UNPAID {fmtK(fin.AR)}
              </span>
            ) : (
              <span className="text-[9px] px-2 py-0.5 rounded font-semibold bg-emerald-500/20 text-emerald-400">
                ✓ Fully Paid
              </span>
            )
          )}
          {bucket === 'completed' && fin.contract - fin.paid > 0 && (
            <button
              onClick={e => { e.stopPropagation(); setCollectProject(p); setCollectPartialInput(''); setCollectLoggingPartial(false) }}
              className="text-[9px] px-2 py-0.5 rounded font-bold bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 hover:bg-yellow-400/30 transition-colors"
            >
              💰 Collect
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t border-gray-700/50">
          {bucket !== 'completed' ? (
            <>
              <button
                onClick={() => openEditProjectModal(p)}
                className="flex-1 text-[10px] px-2 py-1.5 rounded bg-gray-700/50 text-gray-300 hover:bg-gray-600/50 font-semibold"
              >
                <Edit3 size={10} className="inline mr-1" /> Edit
              </button>
              <button
                onClick={() => onSelectProject?.(p.id)}
                className="text-[10px] px-2 py-1.5 rounded bg-gray-700/30 text-gray-400 hover:bg-gray-600/30 font-semibold border border-gray-700/50"
                title="Open project tabs"
              >
                <Eye size={10} />
              </button>
              <button
                onClick={() => moveStatus(p.id, bucket === 'active' ? 'coming' : 'active')}
                className="text-[10px] px-2 py-1.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold"
              >
                <ArrowRight size={10} className="inline mr-1" /> {bucket === 'active' ? 'Coming Up' : 'Active'}
              </button>
              {bucket === 'coming' && (
                <button
                  onClick={() => markProjectLost(p.id)}
                  className="text-[10px] px-2 py-1.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-semibold"
                >
                  Mark Lost
                </button>
              )}
              <button
                onClick={() => archiveProject(p.id)}
                className="text-[10px] px-2 py-1.5 rounded bg-slate-500/10 text-slate-300 border border-slate-500/20 font-semibold"
              >
                <Archive size={10} />
              </button>
              <button
                onClick={() => deleteProject(p.id)}
                className="text-[10px] px-2 py-1.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-semibold"
              >
                <Trash2 size={10} />
              </button>
            </>
          ) : (
            <>
              <button onClick={() => onSelectProject?.(p.id)} className="flex-1 text-[10px] px-2 py-1.5 rounded bg-gray-700/50 text-gray-300 hover:bg-gray-600/50 font-semibold">
                <Eye size={10} className="inline mr-1" /> View Project
              </button>
              <button
                onClick={() => moveStatus(p.id, 'active')}
                className="text-[10px] px-2 py-1.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold"
              >
                <RotateCcw size={10} className="inline mr-1" /> Reactivate
              </button>
              <button
                onClick={() => archiveProject(p.id)}
                className="text-[10px] px-2 py-1.5 rounded bg-slate-500/10 text-slate-300 border border-slate-500/20 font-semibold"
              >
                <Archive size={10} />
              </button>
              <button
                onClick={() => deleteProject(p.id)}
                className="text-[10px] px-2 py-1.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-semibold"
              >
                <Trash2 size={10} />
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  function renderSection(label: string, items: BackupProject[], bucket: string) {
    if (items.length === 0) return null
    return (
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            {label} <span className="text-gray-600 ml-1">({items.length})</span>
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(p => renderProjectCard(p, bucket))}
        </div>
      </div>
    )
  }

  function renderArchivedProjects() {
    if (!showArchivedProjects) return null
    return (
      <div className="mb-6 rounded-xl border border-slate-700/50 bg-slate-950/20 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            Archived Projects <span className="text-gray-600 ml-1">({archivedProjects.length})</span>
          </h3>
          <span className="text-[10px] text-gray-500">Hidden from active project cards</span>
        </div>
        {archivedProjects.length === 0 ? (
          <div className="text-xs text-gray-500 py-4">No archived projects.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {archivedProjects.map(p => {
              const fin = getProjectFinancials(p, backup)
              return (
                <div key={p.id} className="rounded-lg border border-slate-700/50 bg-[var(--bg-card)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-gray-100">{p.name || 'Unnamed project'}</div>
                      <div className="text-[10px] text-gray-500">{p.client || p.customer || 'No client listed'}</div>
                    </div>
                    <span className="text-[9px] px-2 py-0.5 rounded bg-slate-500/20 text-slate-300 font-bold">Archived</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                    <div className="bg-[var(--bg-input)] rounded p-2">
                      <div className="text-gray-500 uppercase font-bold">Quoted</div>
                      <div className="font-mono text-gray-200">{fmtK(fin.contract || p.contract || 0)}</div>
                    </div>
                    <div className="bg-[var(--bg-input)] rounded p-2">
                      <div className="text-gray-500 uppercase font-bold">Status</div>
                      <div className="text-gray-300">{p.outcome || p.status || 'Unknown'}</div>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1 text-[10px] text-gray-500">
                    {(p as any).archivedAt && <div>Archived: {new Date((p as any).archivedAt).toLocaleString()}</div>}
                    {(p as any).archivedReason && <div>Reason: {(p as any).archivedReason}</div>}
                  </div>
                  <div className="mt-3 flex gap-2 border-t border-gray-700/50 pt-3">
                    <button
                      onClick={() => restoreProject(p.id)}
                      className="flex-1 text-[10px] px-2 py-1.5 rounded bg-emerald-600/20 text-emerald-300 border border-emerald-600/30 font-semibold"
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => deleteProject(p.id)}
                      className="text-[10px] px-2 py-1.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-semibold"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const inputCls = "w-full px-3 py-2 bg-[var(--bg-input)] border border-gray-600 rounded text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)] p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-bold text-gray-300 uppercase tracking-wider">Projects</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowArchivedProjects(v => !v)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border ${
              showArchivedProjects
                ? 'bg-slate-600/30 text-slate-100 border-slate-500/50'
                : 'bg-slate-700/20 text-slate-300 border-slate-600/30'
            }`}
          >
            <Archive size={12} /> Archived Projects ({archivedProjects.length})
          </button>
          <button
            onClick={() => setShowQBImport(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ backgroundColor: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}
          >
            <FileText size={12} /> New from QB Estimate
          </button>
          <button onClick={openNewProjectModal} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold">
            <Plus size={12} /> New Project
          </button>
        </div>
      </div>

      {renderSection('Active', active, 'active')}
      {renderSection('Coming Up', coming, 'coming')}
      {renderSection('Completed', completed, 'completed')}
      {renderArchivedProjects()}

      {projects.length === 0 && (
        <div className="p-8 text-center">
          <div className="text-2xl mb-2">📋</div>
          <div className="text-xs text-gray-500">No projects yet. Add one to get started.</div>
        </div>
      )}

      {/* QuickBooks PDF Import Modal */}
      {showQBImport && (
        <QuickBooksImportModal
          mode="project"
          onClose={() => setShowQBImport(false)}
          onImported={() => { forceUpdate() }}
        />
      )}

      {/* New Project Modal */}
      {showNewProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-gray-700 rounded-xl w-full max-w-lg mx-4 p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-200 uppercase tracking-wider">New Project</h3>
              <button onClick={closeNewProjectModal} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
            </div>
            {/* HUNTER-sourced provenance banner — renders only when prefillFromLead
                contains a leadId (i.e., this modal was opened via Pipeline Open
                Estimate, not manually). */}
            {hunterBannerCtx?.leadId && (
              <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-emerald-300">Sourced from HUNTER</span>
                      {hunterBannerCtx.source_tag && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                          {hunterBannerCtx.source_tag}
                        </span>
                      )}
                      {hunterBannerCtx.freshness && (
                        <span className="text-[10px] text-gray-500">&middot; {hunterBannerCtx.freshness}</span>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      {typeof hunterBannerCtx.score === 'number' && hunterBannerCtx.score > 0 && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-500">Score:</span>
                          <span className="font-semibold text-emerald-400">{hunterBannerCtx.score}</span>
                        </div>
                      )}
                      {typeof hunterBannerCtx.urgency_level === 'number' && hunterBannerCtx.urgency_level >= 3 && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-500">Urgency:</span>
                          <span className="font-semibold text-orange-400">{hunterBannerCtx.urgency_level}/5</span>
                        </div>
                      )}
                      {typeof hunterBannerCtx.value_min === 'number' && typeof hunterBannerCtx.value_max === 'number' && (
                        <div className="flex items-center gap-1.5 col-span-2">
                          <span className="text-gray-500">Value range:</span>
                          <span className="font-semibold text-gray-200">&#36;{hunterBannerCtx.value_min.toLocaleString()} &ndash; &#36;{hunterBannerCtx.value_max.toLocaleString()}</span>
                        </div>
                      )}
                      {typeof hunterBannerCtx.comparable_jobs_count === 'number' && hunterBannerCtx.comparable_jobs_count > 0 && (
                        <div className="flex items-center gap-1.5 col-span-2">
                          <span className="text-gray-500">Comparable jobs:</span>
                          <span className="text-gray-300">{hunterBannerCtx.comparable_jobs_count} matched</span>
                        </div>
                      )}
                      {hunterBannerCtx.urgency_reason && (
                        <div className="col-span-2 mt-1">
                          <span className="text-gray-500 text-[10px]">Urgency reason:</span>
                          <span className="block text-gray-300 text-[11px] mt-0.5">{hunterBannerCtx.urgency_reason}</span>
                        </div>
                      )}
                      {hunterBannerCtx.pitch_angle && typeof hunterBannerCtx.pitch_angle === 'object' && (hunterBannerCtx.pitch_angle as any).angle && (
                        <div className="col-span-2">
                          <span className="text-gray-500 text-[10px]">Suggested pitch angle:</span>
                          <span className="block text-gray-300 text-[11px] mt-0.5 capitalize">{(hunterBannerCtx.pitch_angle as any).angle}</span>
                        </div>
                      )}
                      {(hunterBannerCtx.address || hunterBannerCtx.city) && (
                        <div className="col-span-2 mt-1 pt-2 border-t border-emerald-500/10">
                          <span className="text-gray-500 text-[10px]">Location:</span>
                          <span className="block text-gray-300 text-[11px] mt-0.5">
                            {hunterBannerCtx.address}{hunterBannerCtx.address && hunterBannerCtx.city ? ', ' : ''}{hunterBannerCtx.city}
                          </span>
                        </div>
                      )}
                      {(hunterBannerCtx.contact_email || hunterBannerCtx.contact_phone) && (
                        <div className="col-span-2">
                          <span className="text-gray-500 text-[10px]">Contact:</span>
                          <span className="block text-gray-300 text-[11px] mt-0.5">
                            {hunterBannerCtx.contact_phone}{hunterBannerCtx.contact_phone && hunterBannerCtx.contact_email ? ' | ' : ''}{hunterBannerCtx.contact_email}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Project Name *</label>
                <input value={npName} onChange={e => setNpName(e.target.value)} className={inputCls} placeholder="e.g. Smith Residence Panel Upgrade" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Relationship Account (Optional)</label>
                  <select
                    value={npAccountId}
                    onChange={e => handleSelectProjectAccount(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">No linked account</option>
                    {accountOptions.map((acc: any) => (
                      <option key={acc.id} value={acc.id}>{acc.label}</option>
                    ))}
                  </select>
                </div>
                <div className="self-end">
                  <button
                    type="button"
                    onClick={() => setShowNewCustomerModal(true)}
                    className="w-full md:w-auto px-3 py-2 rounded bg-cyan-700/40 border border-cyan-700/50 text-cyan-200 text-xs font-semibold hover:bg-cyan-700/60"
                  >
                    + New Customer
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Client / Customer</label>
                  <input value={npClient} onChange={e => { setNpClient(e.target.value); setNpClientEdited(true) }} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Contract Amount ($)</label>
                  <input type="number" value={npContract} onChange={e => setNpContract(e.target.value)} className={inputCls} placeholder="0" />
                </div>
              </div>
              {/* DASHBOARD-START-DATE-GATE-AND-PERSIST-APR22-2026-1 — L1 layout: dates top row, categoricals bottom row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Start Date</label>
                  <input type="date" value={npStartDate} onChange={e => setNpStartDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Planned End</label>
                  <input type="date" value={npPlannedEnd} onChange={e => setNpPlannedEnd(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Job Type</label>
                  <select value={npType} onChange={e => setNpType(e.target.value)} className={inputCls}>
                    {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Status</label>
                  <select value={npStatus} onChange={e => setNpStatus(e.target.value)} className={inputCls}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Notes</label>
                <textarea value={npNotes} onChange={e => setNpNotes(e.target.value)} rows={2} className={inputCls + ' resize-none'} placeholder="Optional project notes..." />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={closeNewProjectModal} className="flex-1 px-4 py-2 rounded bg-gray-700 text-gray-300 text-sm font-semibold hover:bg-gray-600">Cancel</button>
              <button onClick={saveNewProject} className="flex-1 px-4 py-2 rounded bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500">Create Project</button>
            </div>

            {showNewCustomerModal && (
              <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="w-full max-w-2xl rounded-xl border border-cyan-500/30 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-semibold text-cyan-300">Add Relationship Account</div>
                    <button onClick={() => setShowNewCustomerModal(false)} className="text-gray-400 hover:text-gray-200">✕</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    <input value={newCustomerForm.company} onChange={(e) => setNewCustomerForm((f) => ({ ...f, company: e.target.value }))} placeholder="Account / company name" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                    <input value={newCustomerForm.contact} onChange={(e) => setNewCustomerForm((f) => ({ ...f, contact: e.target.value }))} placeholder="Contact name" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                    <select value={newCustomerForm.role} onChange={(e) => setNewCustomerForm((f) => ({ ...f, role: e.target.value }))} className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-cyan-300">
                      {REL_ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input value={newCustomerForm.phone} onChange={(e) => setNewCustomerForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Phone" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                    <input value={newCustomerForm.email} onChange={(e) => setNewCustomerForm((f) => ({ ...f, email: e.target.value }))} placeholder="Email" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                    <input value={newCustomerForm.address} onChange={(e) => setNewCustomerForm((f) => ({ ...f, address: e.target.value }))} placeholder="Primary address" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                    <input value={newCustomerForm.city} onChange={(e) => setNewCustomerForm((f) => ({ ...f, city: e.target.value }))} placeholder="City" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                    <input value={newCustomerForm.tags} onChange={(e) => setNewCustomerForm((f) => ({ ...f, tags: e.target.value }))} placeholder="Tags / relationship notes" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                    <textarea value={newCustomerForm.notes} onChange={(e) => setNewCustomerForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes" className="md:col-span-2 px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200 h-24" />
                  </div>
                  <div className="flex justify-end gap-2 mt-3">
                    <button onClick={() => setShowNewCustomerModal(false)} className="px-3 py-2 rounded bg-gray-800 text-gray-300 text-xs">Cancel</button>
                    <button onClick={saveNewCustomerForProject} className="px-3 py-2 rounded bg-emerald-600 text-white text-xs font-semibold">Save Customer</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Project Modal */}
      {showEditProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-gray-700 rounded-xl w-full max-w-lg mx-4 p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-200 uppercase tracking-wider">Edit Project</h3>
              <button onClick={() => setShowEditProject(false)} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Project Name *</label>
                <input value={epName} onChange={e => setEpName(e.target.value)} className={inputCls} placeholder="e.g. Smith Residence Panel Upgrade" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
  <div>
    <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">
      Client / Customer
    </label>
    <input
      value={epClient}
      onChange={e => setEpClient(e.target.value)}
      className={inputCls}
    />
  </div>

  <div>
    <label className="text-[10px] text-cyan-500 uppercase font-bold block mb-1">
      Link To Existing Customer
    </label>

    <select
      value={epAccountId}
      onChange={e => {
        setEpAccountId(e.target.value)

        const selected = accountOptions.find((a: any) => a.id === e.target.value)

        if (selected) {
          const cleanName = selected.label.split('(')[0].trim()
          setEpClient(cleanName)
        }
      }}
      className={inputCls}
    >
      <option value="">No linked customer</option>

      {accountOptions.map((a: any) => (
        <option key={a.id} value={a.id}>
          {a.label}
        </option>
      ))}
    </select>
  </div>
</div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Contract Amount ($)</label>
                  <input type="number" value={epContract} onChange={e => setEpContract(e.target.value)} className={inputCls} placeholder="0" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Job site address</label>
                {!GOOGLE_MAPS_BROWSER_KEY && (
                  <div className="text-[10px] text-gray-500 mb-1">Maps suggestions need VITE_GOOGLE_MAPS_BROWSER_KEY.</div>
                )}
                <div className="relative">
                  <input
                    type="text"
                    value={epAddress}
                    onChange={(e) => handleEditAddressChange(e.target.value)}
                    onBlur={() => window.setTimeout(() => setEpShowAddressSuggestions(false), 180)}
                    onFocus={() => epAddressSuggestions.length > 0 && GOOGLE_MAPS_BROWSER_KEY && isMapsLoaded && setEpShowAddressSuggestions(true)}
                    className={inputCls}
                    placeholder="Street, city (matches Estimate → Mileage)"
                    autoComplete="off"
                  />
                  {epShowAddressSuggestions && epAddressSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-[70] max-h-48 overflow-y-auto rounded-md border border-gray-700 bg-gray-950 shadow-2xl">
                      {epAddressSuggestions.map((s: google.maps.places.AutocompletePrediction) => (
                        <button
                          type="button"
                          key={s.place_id}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => selectEditAddressPrediction(s)}
                          className="block w-full border-0 border-b border-gray-800 bg-gray-950 px-3 py-2 text-left text-xs text-gray-200 hover:bg-gray-900"
                        >
                          {s.description}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {/* DASHBOARD-START-DATE-GATE-AND-PERSIST-APR22-2026-1 — L1 layout: dates top row, categoricals bottom row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Start Date</label>
                  <input type="date" value={epStartDate} onChange={e => setEpStartDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Planned End</label>
                  <input type="date" value={epPlannedEnd} onChange={e => setEpPlannedEnd(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Job Type</label>
                  <select value={epType} onChange={e => setEpType(e.target.value)} className={inputCls}>
                    {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Status</label>
                  <select value={epStatus} onChange={e => setEpStatus(e.target.value)} className={inputCls}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Notes</label>
                <textarea value={epNotes} onChange={e => setEpNotes(e.target.value)} rows={2} className={inputCls + ' resize-none'} placeholder="Optional project notes..." />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowEditProject(false)} className="flex-1 px-4 py-2 rounded bg-gray-700 text-gray-300 text-sm font-semibold hover:bg-gray-600">Cancel</button>
              <button onClick={saveEditProject} className="flex-1 px-4 py-2 rounded bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500">Save Changes</button>
            </div>
          </div>
        </div>
      )}
      {/* ── Collect Payment Modal ────────────────────────────────────────────── */}
      {collectProject && (() => {
        const cp = collectProject
        const cfin = getProjectFinancials(cp, backup)
        const outstanding = Math.max(0, num(cfin.contract) - num(cfin.paid))
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setCollectProject(null)}>
            <div
              className="bg-[var(--bg-card)] border border-yellow-500/30 rounded-xl w-full max-w-sm mx-4 p-5 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-yellow-300">💰 Collect Payment</h3>
                  <p className="text-[10px] text-gray-400 mt-0.5">{cp.name}</p>
                </div>
                <button onClick={() => setCollectProject(null)} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
              </div>

              {/* Financial summary */}
              <div className="space-y-2 mb-4">
                <div className="flex justify-between items-center py-1.5 border-b border-gray-700/50">
                  <span className="text-[11px] text-gray-400">Total Contract Value</span>
                  <span className="text-[11px] font-mono text-gray-200">{fmt(cfin.contract)}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-gray-700/50">
                  <span className="text-[11px] text-gray-400">Amount Collected</span>
                  <span className="text-[11px] font-mono text-emerald-400">{fmt(cfin.paid)}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 rounded-lg px-2" style={{ backgroundColor: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)' }}>
                  <span className="text-[11px] font-semibold text-yellow-300">Outstanding Balance</span>
                  <span className="text-[13px] font-bold font-mono text-yellow-300">{fmt(outstanding)}</span>
                </div>
              </div>

              {/* Partial payment input */}
              {collectLoggingPartial && (
                <div className="mb-4 p-3 rounded-lg bg-[var(--bg-input)] border border-gray-600">
                  <label className="text-[10px] text-gray-400 uppercase font-bold block mb-1.5">Amount Received ($)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={collectPartialInput}
                      onChange={e => setCollectPartialInput(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 px-3 py-2 bg-[var(--bg-secondary)] border border-gray-600 rounded text-sm text-gray-200 font-mono focus:outline-none focus:border-yellow-500"
                      autoFocus
                    />
                    <button
                      onClick={() => handleLogPartialPayment(cp)}
                      className="px-3 py-2 rounded bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 text-xs font-bold hover:bg-yellow-500/30"
                    >
                      Log
                    </button>
                    <button
                      onClick={() => { setCollectLoggingPartial(false); setCollectPartialInput('') }}
                      className="px-2 py-2 rounded bg-gray-700/50 text-gray-400 text-xs hover:bg-gray-600/50"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              {!collectLoggingPartial && (
                <div className="flex flex-col gap-2 mb-3">
                  <button
                    onClick={() => handleMarkFullPayment(cp)}
                    className="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition-colors"
                  >
                    ✓ Mark Full Payment Received
                  </button>
                  <button
                    onClick={() => setCollectLoggingPartial(true)}
                    className="w-full py-2.5 rounded-lg bg-yellow-500/15 text-yellow-300 border border-yellow-500/30 text-xs font-bold hover:bg-yellow-500/25 transition-colors"
                  >
                    + Log Partial Payment
                  </button>
                </div>
              )}

              {/* Follow-up link */}
              <div className="border-t border-gray-700/50 pt-3 space-y-2">
                <button
                  onClick={() => { setCollectProject(null); window.dispatchEvent(new CustomEvent('poweron:show-money')) }}
                  className="text-[10px] text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline w-full text-left"
                >
                  Need to follow up? → Open Money / AR tab
                </button>

                {/* LEDGER AI stub */}
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/15">
                  <span className="text-[10px] text-gray-400 flex-1">Want me to draft a payment follow-up message?</span>
                  <button
                    className="px-2.5 py-1 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/25 cursor-not-allowed opacity-60"
                    title="LEDGER AI — coming soon"
                    disabled
                  >
                    ✦ LEDGER <span className="text-[8px] opacity-70">(soon)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
