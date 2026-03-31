// @ts-nocheck
/**
 * V15rBlueprintsTab — Blueprint Intelligence + PO Development Mode
 *
 * Features:
 * - PDF blueprint upload with label types (Full Set, Electrical Only, Reference Sheet)
 * - Stores files in Supabase Storage under org_id/project_id/blueprints/
 * - Text extraction via blueprintExtractor service
 * - OHM analysis mode: reads extracted text, identifies electrical service data
 * - PO Development mode: "Learn with OHM" teaching dialogue
 * - GC/Architect professional email generator
 */
import React, { useState, useRef, useCallback } from 'react'
import {
  Upload, FileText, Zap, BookOpen, Mail, ChevronDown, ChevronUp,
  Loader2, CheckCircle, AlertTriangle, X, Eye, Send
} from 'lucide-react'
import { callClaude, extractText } from '@/services/claudeProxy'
import { extractBlueprintText, type BlueprintExtract } from '@/services/blueprintExtractor'
import { supabase } from '@/lib/supabase'
import { getBackupData } from '@/services/backupDataService'

// ── Types ────────────────────────────────────────────────────────────────────

type LabelType = 'Full Set' | 'Electrical Only' | 'Reference Sheet'

interface BlueprintFile {
  id: string
  filename: string
  label: LabelType
  uploadDate: string
  pageCount: number | null
  storagePath: string
  extractedText?: string
  electricalFlags?: string[]
  analyzed: boolean
}

interface OHMFinding {
  serviceEntrance?: string
  mainBreaker?: string
  panels?: Array<{ name: string; mainBreaker: string; busRating: string; breakers: string[] }>
  meterInfo?: string
  sccrRating?: string
  notedLoads?: string[]
  rawSummary: string
}

interface AnalysisReport {
  totalConnectedLoad?: string
  demandLoad?: string
  faultCurrent?: string
  breakerCoordination?: string
  undersizedEquipment?: string[]
  codeViolations?: string[]
  gcNotes?: string
  rawReport: string
}

interface ChatMessage {
  role: 'ohm' | 'user'
  content: string
  isTeaching?: boolean
}

interface POLearningUpdate {
  skill: string
  delta: number
  reason: string
}

// ── OHM system prompt for blueprint analysis ─────────────────────────────────

const OHM_BLUEPRINT_SYSTEM = `You are OHM, the Electrical Code Compliance Agent for PowerOn Hub. You are analyzing extracted text from electrical blueprints for Power On Solutions, an electrical contractor.

When given blueprint text, identify:
1. Service entrance size (amps, voltage, phases)
2. Main breaker/disconnect size
3. Panel schedules (each panel: name, main breaker, bus rating, individual breakers)
4. Meter count and type (single vs stack)
5. SCCR/KAIC ratings if listed
6. Noted loads: HVAC, lighting, equipment

Then ask clarifying questions to fill gaps. Format responses with clear section headers.
Reference NEC 2023 articles where relevant.
Be specific and technical — this is for a licensed C-10 contractor.`

const OHM_PO_SYSTEM = `You are OHM, the Electrical Code Compliance Agent for PowerOn Hub. You are in PO Development Mode — teaching Christian Dubon (business owner, Power On Solutions LLC) how to read and understand electrical plans.

After each technical finding, add a learning layer:
[Finding]: State what you found technically.
[Why this matters for a PO]: Explain the business and safety significance in plain language.
[What a PE would calculate]: Describe the engineer-level calculation needed.
[What you should learn next]: Suggest the next concept to study, and ask if Christian wants to walk through it using this project as an example.

Use his specific project data as teaching examples. Ask what he already knows before filling gaps.
Track his understanding through the conversation and update accordingly.`

// ── Color palette ─────────────────────────────────────────────────────────────

const C = {
  bg: '#1a1d27',
  surface: '#232738',
  border: 'rgba(255,255,255,0.07)',
  t1: 'var(--t1)',
  t2: 'var(--t2)',
  t3: 'var(--t3)',
  blue: '#3b82f6',
  blueAlpha: 'rgba(59,130,246,0.15)',
  green: '#10b981',
  greenAlpha: 'rgba(16,185,129,0.15)',
  amber: '#f59e0b',
  amberAlpha: 'rgba(245,158,11,0.15)',
  red: '#ef4444',
  redAlpha: 'rgba(239,68,68,0.15)',
  purple: '#8b5cf6',
  purpleAlpha: 'rgba(139,92,246,0.15)',
}

const btn = (color: string, bg: string, border?: string): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 14px',
  backgroundColor: bg,
  color: color,
  border: `1px solid ${border || 'transparent'}`,
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: '600',
  cursor: 'pointer',
  transition: 'opacity 0.15s',
})

// ── Main Component ────────────────────────────────────────────────────────────

interface V15rBlueprintsTabProps {
  projectId: string
  onUpdate?: () => void
  backup?: any
}

export default function V15rBlueprintsTab({ projectId, onUpdate, backup: initialBackup }: V15rBlueprintsTabProps) {
  const backup = initialBackup || getBackupData()
  const project = backup?.projects?.find((x: any) => x.id === projectId)

  // ── State ──────────────────────────────────────────────────────────────────
  const [blueprints, setBlueprints] = useState<BlueprintFile[]>(() => {
    // Load from project metadata if available
    return project?.blueprints || []
  })
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [selectedLabel, setSelectedLabel] = useState<LabelType>('Electrical Only')
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())

  // Analysis state
  const [activeBlueprint, setActiveBlueprint] = useState<BlueprintFile | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [findings, setFindings] = useState<OHMFinding | null>(null)
  const [report, setReport] = useState<AnalysisReport | null>(null)
  const [analysisStep, setAnalysisStep] = useState<'idle' | 'findings' | 'clarifying' | 'report'>('idle')

  // PO Learning mode
  const [poModeEnabled, setPoModeEnabled] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Email generator
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailData, setEmailData] = useState({
    gcName: '',
    architectName: '',
    siteVisitDate: new Date().toISOString().split('T')[0],
  })
  const [generatedEmail, setGeneratedEmail] = useState<string | null>(null)
  const [generatingEmail, setGeneratingEmail] = useState(false)

  // Upload collapse
  const [uploadExpanded, setUploadExpanded] = useState(true)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── File Upload ────────────────────────────────────────────────────────────

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadError(null)

    const newBlueprints: BlueprintFile[] = []

    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        setUploadError('Only PDF files are accepted.')
        continue
      }

      const bpId = `bp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const orgId = backup?.settings?.orgId || 'local'
      const storagePath = `${orgId}/${projectId}/blueprints/${bpId}_${file.name}`

      let uploadedPath = storagePath
      let extractedText = ''
      let pageCount: number | null = null
      let electricalFlags: string[] = []

      // Try Supabase Storage upload
      try {
        const { error: storageError } = await supabase.storage
          .from('blueprints')
          .upload(storagePath, file, { contentType: 'application/pdf', upsert: false })

        if (storageError) {
          console.warn('[Blueprints] Storage upload failed, using local-only mode:', storageError.message)
        }
      } catch (e) {
        console.warn('[Blueprints] Supabase storage not available, continuing offline')
      }

      // Extract text using pdfjs
      try {
        const result = await extractBlueprintText(file, selectedLabel)
        extractedText = result.extractedText
        pageCount = result.pageCount
        electricalFlags = result.electricalFlags

        // Try to store in Supabase blueprint_extracts table
        try {
          await supabase.from('blueprint_extracts').insert({
            org_id: orgId,
            project_id: projectId,
            filename: file.name,
            label: selectedLabel,
            extracted_text: extractedText,
            page_count: pageCount,
          })
        } catch (e) {
          console.warn('[Blueprints] Could not store extract in Supabase:', e)
        }
      } catch (e) {
        console.warn('[Blueprints] Text extraction failed:', e)
      }

      const bp: BlueprintFile = {
        id: bpId,
        filename: file.name,
        label: selectedLabel,
        uploadDate: new Date().toISOString().split('T')[0],
        pageCount,
        storagePath: uploadedPath,
        extractedText,
        electricalFlags,
        analyzed: false,
      }
      newBlueprints.push(bp)
    }

    // Persist to project metadata
    const updatedBlueprints = [...blueprints, ...newBlueprints]
    setBlueprints(updatedBlueprints)
    if (project) {
      project.blueprints = updatedBlueprints
      const { saveBackupData } = await import('@/services/backupDataService')
      saveBackupData(backup)
    }

    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [blueprints, project, projectId, backup, selectedLabel])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    handleFileSelect(e.dataTransfer.files)
  }, [handleFileSelect])

  const toggleSelect = (id: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const removeBlueprint = (id: string) => {
    const updated = blueprints.filter(b => b.id !== id)
    setBlueprints(updated)
    if (project) {
      project.blueprints = updated
      import('@/services/backupDataService').then(({ saveBackupData }) => saveBackupData(backup))
    }
    if (activeBlueprint?.id === id) {
      setActiveBlueprint(null)
      setFindings(null)
      setReport(null)
      setAnalysisStep('idle')
    }
  }

  // ── OHM Analysis ──────────────────────────────────────────────────────────

  const analyzeBlueprint = async (bp: BlueprintFile) => {
    if (!bp.extractedText) {
      setUploadError('No extracted text available for this file. Re-upload to extract.')
      return
    }

    setActiveBlueprint(bp)
    setAnalyzing(true)
    setAnalysisStep('findings')
    setFindings(null)
    setReport(null)
    setChatMessages([])

    const systemPrompt = poModeEnabled ? OHM_PO_SYSTEM : OHM_BLUEPRINT_SYSTEM

    try {
      // Step 1: Identify findings
      const step1Prompt = `Blueprint file: "${bp.filename}" (${bp.label})
Pages: ${bp.pageCount || 'unknown'}
Electrical flags detected: ${bp.electricalFlags?.join(', ') || 'none'}

Extracted text (first 6000 chars):
${bp.extractedText.slice(0, 6000)}

Please analyze this electrical blueprint and identify:
1. Service entrance size (amps, voltage, phases)
2. Main breaker/disconnect size
3. Panel schedules (each panel: name, main breaker, bus rating, individual breakers listed)
4. Meter count and type (single vs stack)
5. SCCR/KAIC ratings if listed
6. Any noted loads: HVAC, lighting, equipment

Then ask 2-3 clarifying questions to fill gaps. Be specific.${poModeEnabled ? '\n\nUse PO Development Mode format: add [Why this matters for a PO], [What a PE would calculate], and [What you should learn next] sections after each finding.' : ''}`

      const resp = await callClaude({
        messages: [{ role: 'user', content: step1Prompt }],
        system: systemPrompt,
        max_tokens: 2000,
      })

      const ohmText = extractText(resp)

      // Parse into structured findings (simplified — OHM returns natural language)
      const parsed: OHMFinding = { rawSummary: ohmText }

      // Extract key values via regex heuristics
      const ampMatch = ohmText.match(/(\d{3,4})\s*[Aa](?:mp|A)?\b.*?(?:service|entrance|main)/i)
      if (ampMatch) parsed.serviceEntrance = `${ampMatch[1]}A service entrance`

      const meterMatch = ohmText.match(/(\d+)\s*meter/i)
      if (meterMatch) parsed.meterInfo = `${meterMatch[1]} meter(s)`

      setFindings(parsed)
      setAnalysisStep('clarifying')

      // Add to chat
      setChatMessages([{ role: 'ohm', content: ohmText, isTeaching: poModeEnabled }])

    } catch (e: any) {
      setUploadError('OHM analysis failed: ' + (e?.message || 'Unknown error'))
      setAnalysisStep('idle')
    }

    setAnalyzing(false)
  }

  const analyzeSelected = () => {
    const toAnalyze = blueprints.filter(b => selectedFiles.has(b.id))
    if (toAnalyze.length > 0) analyzeBlueprint(toAnalyze[0])
  }

  // ── Chat / Clarification ──────────────────────────────────────────────────

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading || !activeBlueprint) return

    const userMsg = chatInput.trim()
    setChatInput('')
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setChatLoading(true)

    const systemPrompt = poModeEnabled ? OHM_PO_SYSTEM : OHM_BLUEPRINT_SYSTEM

    // Build conversation history
    const history = [...chatMessages, { role: 'user', content: userMsg }]
    const messages = [
      {
        role: 'user' as const,
        content: `Context: Analyzing blueprint "${activeBlueprint.filename}" for project "${project?.name || projectId}".
Previous analysis:
${findings?.rawSummary?.slice(0, 2000) || ''}

Conversation continues:`,
      },
      ...history.map(m => ({
        role: m.role === 'ohm' ? 'assistant' as const : 'user' as const,
        content: m.content,
      })),
    ]

    try {
      const resp = await callClaude({
        messages,
        system: systemPrompt,
        max_tokens: 1500,
      })
      const ohmReply = extractText(resp)
      setChatMessages(prev => [...prev, { role: 'ohm', content: ohmReply, isTeaching: poModeEnabled }])

      // If user confirmed clarifications, generate report
      const lc = userMsg.toLowerCase()
      if (analysisStep === 'clarifying' &&
        (lc.includes('yes') || lc.includes('correct') || lc.includes('confirmed') ||
          lc.includes('proceed') || lc.includes('generate') || lc.includes('report'))) {
        setAnalysisStep('report')
        await generateReport(ohmReply)
      }
    } catch (e: any) {
      setChatMessages(prev => [...prev, {
        role: 'ohm',
        content: '⚠️ I encountered an error processing that. Please try again.',
        isTeaching: false,
      }])
    }

    setChatLoading(false)
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  const generateReport = async (clarificationContext = '') => {
    if (!activeBlueprint || !findings) return
    setAnalyzing(true)

    try {
      const reportPrompt = `Based on the blueprint analysis of "${activeBlueprint.filename}" and the clarifications provided, generate a comprehensive scope analysis report:

Blueprint findings:
${findings.rawSummary?.slice(0, 3000)}

Clarification context:
${clarificationContext.slice(0, 1000)}

Generate:
1. Total connected load (kVA)
2. Demand load calculation per NEC 220
3. Available fault current estimate
4. Breaker coordination observations
5. Flag any undersized equipment
6. Flag any code violations or concerns
7. Specific notes formatted for GC/Architect communication

Format clearly with section headers. Be specific with numbers and NEC citations.`

      const resp = await callClaude({
        messages: [{ role: 'user', content: reportPrompt }],
        system: OHM_BLUEPRINT_SYSTEM,
        max_tokens: 2000,
      })

      const reportText = extractText(resp)
      setReport({ rawReport: reportText })

      // Mark blueprint as analyzed
      const updated = blueprints.map(b =>
        b.id === activeBlueprint.id ? { ...b, analyzed: true } : b
      )
      setBlueprints(updated)
      if (project) {
        project.blueprints = updated
        const { saveBackupData } = await import('@/services/backupDataService')
        saveBackupData(backup)
      }

      setChatMessages(prev => [...prev, {
        role: 'ohm',
        content: `📋 **Scope Analysis Report Generated**\n\n${reportText}`,
        isTeaching: false,
      }])
    } catch (e: any) {
      setUploadError('Report generation failed: ' + (e?.message || ''))
    }
    setAnalyzing(false)
  }

  // ── Email Generator ───────────────────────────────────────────────────────

  const generateEmail = async () => {
    if (!report && !findings) return
    setGeneratingEmail(true)

    const emailPrompt = `Generate a professional field observation email from Christian Dubon / Power On Solutions LLC to the GC and/or Architect.

Project: "${project?.name || 'Project'}"
GC Name: ${emailData.gcName || '[GC Name]'}
Architect Name: ${emailData.architectName || '[Architect Name]'}
Site Visit Date: ${emailData.siteVisitDate}

OHM Findings:
${findings?.rawSummary?.slice(0, 2000) || ''}

Report:
${report?.rawReport?.slice(0, 2000) || ''}

Format the email exactly like this:
Subject: Field Observations — [Project Name] Electrical Service

Dear [GC/Architect Name],

During my site visit on [date], I noted the following observations regarding the electrical service that warrant review before proceeding:

1. Switchboard Configuration:
   [findings]

2. Available Fault Current:
   [analysis]

3. Recommended Action:
   [recommendation]

These observations are provided to ensure the installation meets NEC requirements and long-term operational safety. Please advise on how you would like to proceed.

Respectfully,
Christian Dubon
Power On Solutions LLC
C-10 License #1151468`

    try {
      const resp = await callClaude({
        messages: [{ role: 'user', content: emailPrompt }],
        system: 'You are a professional electrical contractor assistant. Generate formal, precise field observation emails.',
        max_tokens: 1200,
      })
      setGeneratedEmail(extractText(resp))
    } catch (e: any) {
      setUploadError('Email generation failed: ' + (e?.message || ''))
    }
    setGeneratingEmail(false)
  }

  const copyEmail = () => {
    if (generatedEmail) {
      navigator.clipboard.writeText(generatedEmail).catch(() => {})
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const LABEL_COLORS: Record<LabelType, { bg: string; color: string }> = {
    'Full Set': { bg: C.blueAlpha, color: C.blue },
    'Electrical Only': { bg: C.greenAlpha, color: C.green },
    'Reference Sheet': { bg: C.amberAlpha, color: C.amber },
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ color: C.t1, fontWeight: '700', fontSize: '16px', margin: 0 }}>
            📐 Blueprint Intelligence
          </h3>
          <p style={{ color: C.t3, fontSize: '12px', margin: '2px 0 0' }}>
            Upload electrical plans → OHM analyzes → generates scope report & GC email
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* PO Mode Toggle */}
          <div
            onClick={() => setPoModeEnabled(!poModeEnabled)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              backgroundColor: poModeEnabled ? C.purpleAlpha : 'rgba(255,255,255,0.05)',
              border: `1px solid ${poModeEnabled ? C.purple : C.border}`,
              borderRadius: '20px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '600',
              color: poModeEnabled ? C.purple : C.t3,
              transition: 'all 0.2s',
              userSelect: 'none',
            }}
          >
            <BookOpen size={13} />
            Learn with OHM
            <div style={{
              width: '28px', height: '16px',
              backgroundColor: poModeEnabled ? C.purple : 'rgba(255,255,255,0.1)',
              borderRadius: '8px',
              position: 'relative',
              transition: 'background 0.2s',
            }}>
              <div style={{
                position: 'absolute',
                width: '12px', height: '12px',
                backgroundColor: '#fff',
                borderRadius: '50%',
                top: '2px',
                left: poModeEnabled ? '14px' : '2px',
                transition: 'left 0.2s',
              }} />
            </div>
          </div>
        </div>
      </div>

      {/* PO Mode Banner */}
      {poModeEnabled && (
        <div style={{
          padding: '10px 14px',
          backgroundColor: C.purpleAlpha,
          border: `1px solid ${C.purple}`,
          borderRadius: '8px',
          fontSize: '12px',
          color: C.purple,
        }}>
          <strong>🎓 PO Development Mode Active</strong> — OHM will explain each finding with context about why it matters for a project owner, what a PE would calculate, and what you should learn next. Your skill map updates as you demonstrate understanding.
        </div>
      )}

      {/* Upload Section */}
      <div style={{
        backgroundColor: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: '10px',
        overflow: 'hidden',
      }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            cursor: 'pointer',
            borderBottom: uploadExpanded ? `1px solid ${C.border}` : 'none',
          }}
          onClick={() => setUploadExpanded(!uploadExpanded)}
        >
          <span style={{ color: C.t1, fontWeight: '600', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Upload size={14} />
            Upload Blueprints
            {blueprints.length > 0 && (
              <span style={{
                fontSize: '11px', padding: '1px 7px',
                backgroundColor: C.blueAlpha, color: C.blue,
                borderRadius: '10px', fontWeight: '700',
              }}>
                {blueprints.length} file{blueprints.length !== 1 ? 's' : ''}
              </span>
            )}
          </span>
          {uploadExpanded ? <ChevronUp size={14} color={C.t3} /> : <ChevronDown size={14} color={C.t3} />}
        </div>

        {uploadExpanded && (
          <div style={{ padding: '16px' }}>
            {/* Label selector */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ color: C.t3, fontSize: '11px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>
                LABEL TYPE
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['Full Set', 'Electrical Only', 'Reference Sheet'] as LabelType[]).map(lbl => (
                  <button
                    key={lbl}
                    onClick={() => setSelectedLabel(lbl)}
                    style={{
                      padding: '5px 12px',
                      backgroundColor: selectedLabel === lbl ? LABEL_COLORS[lbl].bg : 'rgba(255,255,255,0.04)',
                      color: selectedLabel === lbl ? LABEL_COLORS[lbl].color : C.t3,
                      border: `1px solid ${selectedLabel === lbl ? LABEL_COLORS[lbl].color : C.border}`,
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${C.border}`,
                borderRadius: '8px',
                padding: '28px',
                textAlign: 'center',
                cursor: 'pointer',
                backgroundColor: 'rgba(59,130,246,0.03)',
                transition: 'border-color 0.2s',
              }}
            >
              <Upload size={24} color={C.blue} style={{ marginBottom: '8px' }} />
              <p style={{ color: C.t1, fontSize: '14px', fontWeight: '600', margin: '0 0 4px' }}>
                Drop PDF blueprints here or click to browse
              </p>
              <p style={{ color: C.t3, fontSize: '12px', margin: 0 }}>
                Multiple files allowed • PDF only • Label: <strong style={{ color: LABEL_COLORS[selectedLabel].color }}>{selectedLabel}</strong>
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                multiple
                onChange={e => handleFileSelect(e.target.files)}
                style={{ display: 'none' }}
              />
            </div>

            {uploading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', color: C.blue, fontSize: '13px' }}>
                <Loader2 size={14} className="animate-spin" />
                Uploading and extracting text...
              </div>
            )}
            {uploadError && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px',
                color: C.red, fontSize: '12px', padding: '8px 12px',
                backgroundColor: C.redAlpha, borderRadius: '6px',
              }}>
                <AlertTriangle size={13} />
                {uploadError}
                <button onClick={() => setUploadError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.red, cursor: 'pointer' }}>
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* File List */}
      {blueprints.length > 0 && (
        <div style={{
          backgroundColor: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: '10px',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: `1px solid ${C.border}`,
          }}>
            <span style={{ color: C.t1, fontWeight: '600', fontSize: '14px' }}>
              Blueprint Files
            </span>
            {selectedFiles.size > 0 && (
              <button
                onClick={analyzeSelected}
                disabled={analyzing}
                style={btn('#fff', C.blue)}
              >
                <Zap size={13} />
                Analyze {selectedFiles.size} with OHM
              </button>
            )}
          </div>

          <div>
            {blueprints.map((bp, i) => {
              const lc = LABEL_COLORS[bp.label] || LABEL_COLORS['Full Set']
              const isSelected = selectedFiles.has(bp.id)
              const isActive = activeBlueprint?.id === bp.id

              return (
                <div
                  key={bp.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '12px 16px',
                    borderBottom: i < blueprints.length - 1 ? `1px solid ${C.border}` : 'none',
                    backgroundColor: isActive ? 'rgba(59,130,246,0.06)' : isSelected ? 'rgba(255,255,255,0.02)' : 'transparent',
                  }}
                >
                  {/* Checkbox */}
                  <div
                    onClick={() => toggleSelect(bp.id)}
                    style={{
                      width: '16px', height: '16px',
                      border: `2px solid ${isSelected ? C.blue : C.border}`,
                      borderRadius: '3px',
                      backgroundColor: isSelected ? C.blue : 'transparent',
                      cursor: 'pointer',
                      flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {isSelected && <CheckCircle size={10} color="#fff" />}
                  </div>

                  <FileText size={16} color={lc.color} style={{ flexShrink: 0 }} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.t1, fontSize: '13px', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {bp.filename}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '3px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', padding: '1px 7px', backgroundColor: lc.bg, color: lc.color, borderRadius: '10px', fontWeight: '600' }}>
                        {bp.label}
                      </span>
                      <span style={{ fontSize: '11px', color: C.t3 }}>
                        {bp.uploadDate}
                      </span>
                      {bp.pageCount !== null && (
                        <span style={{ fontSize: '11px', color: C.t3 }}>
                          {bp.pageCount} page{bp.pageCount !== 1 ? 's' : ''}
                        </span>
                      )}
                      {bp.electricalFlags && bp.electricalFlags.length > 0 && (
                        <span style={{ fontSize: '11px', color: C.green }}>
                          ⚡ {bp.electricalFlags.length} electrical flag{bp.electricalFlags.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {bp.analyzed && (
                        <span style={{ fontSize: '11px', color: C.green }}>
                          ✓ Analyzed
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button
                      onClick={() => analyzeBlueprint(bp)}
                      disabled={analyzing}
                      title="Analyze with OHM"
                      style={{
                        padding: '5px 10px',
                        backgroundColor: C.blueAlpha,
                        color: C.blue,
                        border: `1px solid rgba(59,130,246,0.3)`,
                        borderRadius: '5px',
                        fontSize: '11px',
                        fontWeight: '700',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '4px',
                      }}
                    >
                      <Zap size={11} />
                      Analyze
                    </button>
                    <button
                      onClick={() => removeBlueprint(bp.id)}
                      title="Remove"
                      style={{
                        padding: '5px 8px',
                        backgroundColor: 'rgba(239,68,68,0.1)',
                        color: C.red,
                        border: `1px solid rgba(239,68,68,0.2)`,
                        borderRadius: '5px',
                        cursor: 'pointer',
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Analysis Panel */}
      {activeBlueprint && (
        <div style={{
          backgroundColor: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: '10px',
          overflow: 'hidden',
        }}>
          {/* Panel header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${C.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Zap size={14} color={C.blue} />
              <span style={{ color: C.t1, fontWeight: '700', fontSize: '14px' }}>
                OHM Analysis — {activeBlueprint.filename}
              </span>
              {poModeEnabled && (
                <span style={{
                  fontSize: '11px', padding: '1px 8px',
                  backgroundColor: C.purpleAlpha, color: C.purple,
                  borderRadius: '10px', fontWeight: '700',
                }}>
                  🎓 PO Mode
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(findings || report) && (
                <button
                  onClick={() => setShowEmailModal(true)}
                  style={btn(C.green, C.greenAlpha, `rgba(16,185,129,0.3)`)}
                >
                  <Mail size={12} />
                  Generate Email
                </button>
              )}
              {analysisStep === 'clarifying' && findings && !report && (
                <button
                  onClick={() => generateReport()}
                  disabled={analyzing}
                  style={btn('#fff', C.blue)}
                >
                  {analyzing ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                  Generate Report
                </button>
              )}
            </div>
          </div>

          {/* Chat window */}
          <div style={{
            minHeight: '300px',
            maxHeight: '500px',
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}>
            {analyzing && chatMessages.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: '12px' }}>
                <Loader2 size={28} color={C.blue} className="animate-spin" />
                <p style={{ color: C.t2, fontSize: '14px' }}>OHM is analyzing {activeBlueprint.filename}...</p>
              </div>
            )}

            {chatMessages.map((msg, i) => (
              <div key={i} style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                gap: '4px',
              }}>
                <div style={{
                  fontSize: '10px',
                  color: C.t3,
                  fontWeight: '600',
                  paddingLeft: msg.role === 'ohm' ? '4px' : '0',
                }}>
                  {msg.role === 'ohm' ? '⚡ OHM' : '👤 You'}
                </div>
                <div style={{
                  maxWidth: '90%',
                  padding: '10px 14px',
                  borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                  backgroundColor: msg.role === 'user' ? C.blueAlpha : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${msg.role === 'user' ? 'rgba(59,130,246,0.2)' : C.border}`,
                  color: C.t1,
                  fontSize: '13px',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap',
                }}>
                  {msg.content}
                  {msg.isTeaching && (
                    <div style={{
                      marginTop: '8px',
                      paddingTop: '8px',
                      borderTop: `1px solid ${C.purple}`,
                      fontSize: '11px',
                      color: C.purple,
                    }}>
                      🎓 PO Development Mode — skill map updating based on your responses
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input */}
          <div style={{
            padding: '12px 16px',
            borderTop: `1px solid ${C.border}`,
            display: 'flex',
            gap: '8px',
          }}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage() } }}
              placeholder={
                analysisStep === 'clarifying'
                  ? 'Answer OHM\'s questions or type "generate report" to proceed...'
                  : 'Ask OHM a follow-up question...'
              }
              style={{
                flex: 1,
                padding: '8px 12px',
                backgroundColor: 'rgba(255,255,255,0.05)',
                border: `1px solid ${C.border}`,
                borderRadius: '6px',
                color: C.t1,
                fontSize: '13px',
                outline: 'none',
              }}
            />
            <button
              onClick={sendChatMessage}
              disabled={chatLoading || !chatInput.trim()}
              style={{
                ...btn('#fff', C.blue),
                opacity: chatLoading || !chatInput.trim() ? 0.5 : 1,
              }}
            >
              {chatLoading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            </button>
          </div>
        </div>
      )}

      {/* Email Modal */}
      {showEmailModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.7)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
        }}>
          <div style={{
            backgroundColor: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: '12px',
            width: '100%',
            maxWidth: '680px',
            maxHeight: '85vh',
            overflowY: 'auto',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ color: C.t1, fontWeight: '700', fontSize: '16px', margin: 0 }}>
                <Mail size={16} style={{ marginRight: '8px' }} />
                Generate GC / Architect Email
              </h3>
              <button onClick={() => { setShowEmailModal(false); setGeneratedEmail(null) }} style={{ background: 'none', border: 'none', color: C.t3, cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ color: C.t3, fontSize: '11px', fontWeight: '600', display: 'block', marginBottom: '5px' }}>GC NAME</label>
                <input
                  value={emailData.gcName}
                  onChange={e => setEmailData(prev => ({ ...prev, gcName: e.target.value }))}
                  placeholder="General Contractor name"
                  style={{
                    width: '100%', padding: '8px 10px',
                    backgroundColor: 'rgba(255,255,255,0.05)',
                    border: `1px solid ${C.border}`, borderRadius: '6px',
                    color: C.t1, fontSize: '13px', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ color: C.t3, fontSize: '11px', fontWeight: '600', display: 'block', marginBottom: '5px' }}>ARCHITECT NAME</label>
                <input
                  value={emailData.architectName}
                  onChange={e => setEmailData(prev => ({ ...prev, architectName: e.target.value }))}
                  placeholder="Architect name (optional)"
                  style={{
                    width: '100%', padding: '8px 10px',
                    backgroundColor: 'rgba(255,255,255,0.05)',
                    border: `1px solid ${C.border}`, borderRadius: '6px',
                    color: C.t1, fontSize: '13px', boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ color: C.t3, fontSize: '11px', fontWeight: '600', display: 'block', marginBottom: '5px' }}>SITE VISIT DATE</label>
              <input
                type="date"
                value={emailData.siteVisitDate}
                onChange={e => setEmailData(prev => ({ ...prev, siteVisitDate: e.target.value }))}
                style={{
                  padding: '8px 10px',
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  border: `1px solid ${C.border}`, borderRadius: '6px',
                  color: C.t1, fontSize: '13px',
                }}
              />
            </div>

            {!generatedEmail ? (
              <button
                onClick={generateEmail}
                disabled={generatingEmail}
                style={{ ...btn('#fff', C.blue), width: '100%', justifyContent: 'center', padding: '10px' }}
              >
                {generatingEmail ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                {generatingEmail ? 'OHM is drafting...' : 'Generate Email with OHM'}
              </button>
            ) : (
              <>
                <textarea
                  value={generatedEmail}
                  onChange={e => setGeneratedEmail(e.target.value)}
                  rows={18}
                  style={{
                    width: '100%',
                    padding: '12px',
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    border: `1px solid ${C.border}`,
                    borderRadius: '8px',
                    color: C.t1,
                    fontSize: '12px',
                    lineHeight: '1.6',
                    fontFamily: 'monospace',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={copyEmail} style={btn(C.green, C.greenAlpha, `rgba(16,185,129,0.3)`)}>
                    Copy to Clipboard
                  </button>
                  <button
                    onClick={() => setGeneratedEmail(null)}
                    style={btn(C.t3, 'rgba(255,255,255,0.05)', C.border)}
                  >
                    Regenerate
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {blueprints.length === 0 && !uploading && (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: C.t3,
          backgroundColor: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: '10px',
        }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>📐</div>
          <p style={{ fontSize: '14px', fontWeight: '600', color: C.t2, margin: '0 0 6px' }}>
            No blueprints uploaded yet
          </p>
          <p style={{ fontSize: '12px', margin: 0 }}>
            Upload electrical plans to let OHM analyze service size, panel schedules, fault current, and NEC compliance.
          </p>
        </div>
      )}
    </div>
  )
}
