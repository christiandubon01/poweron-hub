// @ts-nocheck
import React, { useState, useCallback, useEffect } from 'react'
import { Sparkles, ChevronDown, BookOpen } from 'lucide-react'
import { getBackupData, saveBackupData } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { getJournalEntriesForProject, type JournalEntry } from '@/services/voiceJournalService'

interface V15rCoordinationTabProps {
  projectId: string
  onUpdate?: () => void
  backup?: any
}

const coordSections = [
  { key: 'light', label: 'Light Coordination', color: '#3b82f6' },
  { key: 'main', label: 'Main Coordination', color: '#f59e0b' },
  { key: 'urgent', label: 'Urgent Items', color: '#ef4444' },
  { key: 'research', label: 'Research', color: '#06b6d4' },
  { key: 'permit', label: 'Permit', color: '#a855f7' },
  { key: 'inspect', label: 'Inspection', color: '#10b981' },
  { key: 'warn', label: 'Warnings/Issues', color: '#f97316' },
]

export default function V15rCoordinationTab({ projectId, onUpdate, backup: initialBackup }: V15rCoordinationTabProps) {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['light', 'main', 'urgent']))
  const [journalLinks, setJournalLinks] = useState<JournalEntry[]>([])
  const [journalLinksOpen, setJournalLinksOpen] = useState(true)
  const [addingSection, setAddingSection] = useState<string | null>(null)
  const [addingText, setAddingText] = useState("")

  const backup = initialBackup || getBackupData()
  if (!backup) return <div style={{ color: 'var(--t3)' }}>No data</div>

  const p = backup.projects.find(x => x.id === projectId)
  if (!p) return <div style={{ color: 'var(--t3)' }}>Project not found</div>

  // Load journal links for this project whenever projectId changes
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    let cancelled = false
    const projectName = p?.name || ''
    if (!projectName) return
    // Merge Supabase linked entries + local coord.journal_links cross-references
    getJournalEntriesForProject(projectName, 10).then(entries => {
      if (!cancelled) setJournalLinks(entries)
    }).catch(() => {
      // Fallback to local coord.journal_links if DB fails
      if (!cancelled && p?.coord?.journal_links) {
        const links = (p.coord.journal_links || []).map((l: any) => ({
          id: l.id,
          raw_transcript: l.summary || '',
          context_tag: 'general',
          action_items: [],
          created_at: l.date || new Date().toISOString(),
          priority: l.priority,
        }))
        setJournalLinks(links)
      }
    })
    return () => { cancelled = true }
  }, [projectId, p?.name])

  const toggleSection = (key) => {
    const newOpen = new Set(openSections)
    if (newOpen.has(key)) {
      newOpen.delete(key)
    } else {
      newOpen.add(key)
    }
    setOpenSections(newOpen)
  }

  const addItem = (key) => {
    setAddingSection(key)
    setAddingText("")
  }

  const confirmAdd = (key) => {
    const text = addingText.trim()
    if (!text) { setAddingSection(null); return }
    pushState()
    const freshBackup = getBackupData()
    const freshP = freshBackup?.projects?.find(x => x.id === projectId)
    if (!freshP) { setAddingSection(null); return }
    if (!freshP.coord) freshP.coord = {}
    if (!freshP.coord[key]) freshP.coord[key] = []
    freshP.coord[key].push({
      id: "ci" + Date.now(),
      text: String(text),
      status: "pending",
    })
    saveBackupData(freshBackup)
    setAddingSection(null)
    setAddingText("")
    forceUpdate()
  }

  const editItem = (key, itemId, field, value) => {
    pushState()
    const items = (p.coord || {})[key] || []
    const item = items.find(i => i.id === itemId)
    if (item) {
      if (field === 'text') item.text = String(value)
      else if (field === 'status') item.status = String(value)
    }
    saveBackupData(backup)
    forceUpdate()
  }

  const delItem = (key, itemId) => {
    pushState()
    const freshBackup = getBackupData()
    const freshP = freshBackup?.projects?.find(x => x.id === projectId)
    if (!freshP) return
    if (freshP.coord && freshP.coord[key]) {
      freshP.coord[key] = freshP.coord[key].filter(i => i.id !== itemId)
    }
    saveBackupData(freshBackup)
    forceUpdate()
  }

  return (
    <div style={{ backgroundColor: '#1a1d27', padding: '0' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {coordSections.map(section => {
            const items = (p.coord || {})[section.key] || []
            const isOpen = openSections.has(section.key)

            return (
              <div key={section.key} style={{ backgroundColor: '#232738', borderRadius: '8px', overflow: 'hidden' }}>
                <button
                  onClick={() => toggleSection(section.key)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    backgroundColor: section.color + '15',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    fontSize: '13px',
                  }}
                >
                  <ChevronDown
                    size={16}
                    style={{
                      color: section.color,
                      transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                      transition: 'transform 0.2s',
                    }}
                  />
                  <span style={{ color: 'var(--t1)', fontWeight: '600', flex: 1, textAlign: 'left' }}>
                    {section.label}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--t3)', backgroundColor: '#1e2130', padding: '2px 8px', borderRadius: '3px' }}>
                    {items.length}
                  </span>
                </button>

                {isOpen && (
                  <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    {items.length === 0 ? (
                      <div style={{ fontSize: '12px', color: 'var(--t3)', marginBottom: '12px', textAlign: 'center' }}>
                        No items yet
                      </div>
                    ) : (
                      <div style={{ marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {items.map(item => (
                          <div
                            key={item.id}
                            style={{
                              padding: '8px 10px',
                              backgroundColor: '#1e2130',
                              borderRadius: '4px',
                              display: 'flex',
                              gap: '8px',
                              alignItems: 'center',
                              fontSize: '12px',
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <input
                                type="text"
                                value={item.text || ''}
                                onChange={e => editItem(section.key, item.id, 'text', e.target.value)}
                                style={{
                                  width: '100%',
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--t1)',
                                  fontSize: '12px',
                                  fontFamily: 'inherit',
                                  outline: 'none',
                                }}
                              />
                            </div>
                            <select
                              value={item.status || 'pending'}
                              onChange={e => editItem(section.key, item.id, 'status', e.target.value)}
                              style={{
                                padding: '3px 6px',
                                backgroundColor: '#0f1117',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '3px',
                                color: 'var(--t2)',
                                fontSize: '11px',
                                cursor: 'pointer',
                              }}
                            >
                              <option value="pending">Pending</option>
                              <option value="completed">Completed</option>
                            </select>
                            <button
                              onClick={() => delItem(section.key, item.id)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#ef4444',
                                cursor: 'pointer',
                                fontSize: '14px',
                                padding: '0',
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {addingSection === section.key ? (
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <input
                          autoFocus
                          type="text"
                          value={addingText}
                          onChange={e => setAddingText(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") confirmAdd(section.key)
                            if (e.key === "Escape") { setAddingSection(null); setAddingText("") }
                          }}
                          placeholder="Type and press Enter..."
                          style={{
                            flex: 1,
                            padding: "6px 10px",
                            backgroundColor: "#1e2130",
                            border: "1px solid rgba(59,130,246,0.4)",
                            borderRadius: "4px",
                            color: "var(--t1)",
                            fontSize: "12px",
                            fontFamily: "inherit",
                            outline: "none",
                          }}
                        />
                        <button
                          onClick={() => confirmAdd(section.key)}
                          style={{ padding: "6px 10px", backgroundColor: "rgba(59,130,246,0.3)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.4)", borderRadius: "4px", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}
                        >Add</button>
                        <button
                          onClick={() => { setAddingSection(null); setAddingText("") }}
                          style={{ padding: "6px 8px", backgroundColor: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "4px", fontSize: "12px", cursor: "pointer" }}
                        >✕</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => addItem(section.key)}
                        style={{
                          width: "100%",
                          padding: "6px 12px",
                          backgroundColor: "rgba(59,130,246,0.2)",
                          color: "#3b82f6",
                          border: "1px solid rgba(59,130,246,0.3)",
                          borderRadius: "4px",
                          fontSize: "12px",
                          fontWeight: "600",
                          cursor: "pointer",
                        }}
                      >
                        + Add Item
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* LINKED FROM JOURNAL — Session 8 */}
        <div style={{ backgroundColor: '#232738', borderRadius: '8px', overflow: 'hidden', marginTop: '12px' }}>
          <button
            onClick={() => setJournalLinksOpen(o => !o)}
            style={{
              width: '100%',
              padding: '12px 16px',
              backgroundColor: 'rgba(99,102,241,0.10)',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontSize: '13px',
            }}
          >
            <ChevronDown
              size={16}
              style={{
                color: '#6366f1',
                transform: journalLinksOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 0.2s',
              }}
            />
            <BookOpen size={14} style={{ color: '#6366f1', flexShrink: 0 }} />
            <span style={{ color: 'var(--t1)', fontWeight: '600', flex: 1, textAlign: 'left' }}>
              Linked from Journal
            </span>
            <span style={{ fontSize: '11px', color: 'var(--t3)', backgroundColor: '#1e2130', padding: '2px 8px', borderRadius: '3px' }}>
              {journalLinks.length}
            </span>
          </button>

          {journalLinksOpen && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              {journalLinks.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--t3)', textAlign: 'center', padding: '8px 0' }}>
                  No journal entries linked to this project yet.
                  <br />
                  <span style={{ fontSize: '11px', opacity: 0.7 }}>ECHO will auto-link notes that mention this project name.</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {journalLinks.map(link => {
                    const date = new Date(link.created_at)
                    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    const snippet = link.raw_transcript.length > 160 ? link.raw_transcript.slice(0, 160) + '…' : link.raw_transcript
                    const priorityColor = link.priority === 'high' ? '#f87171' : link.priority === 'medium' ? '#fbbf24' : '#9ca3af'
                    return (
                      <div
                        key={link.id}
                        style={{
                          padding: '10px 12px',
                          backgroundColor: '#1e2130',
                          borderRadius: '6px',
                          borderLeft: `3px solid ${priorityColor}`,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <span style={{ fontSize: '10px', color: '#6366f1', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Journal Entry
                          </span>
                          <span style={{ fontSize: '10px', color: 'var(--t3)' }}>{dateStr}</span>
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--t2)', margin: 0, lineHeight: '1.5' }}>{snippet}</p>
                        {link.priority && (
                          <span style={{ fontSize: '9px', fontWeight: '700', color: priorityColor, marginTop: '4px', display: 'inline-block', textTransform: 'uppercase' }}>
                            {link.priority} priority
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* AI PRIORITIZE BUTTON */}
        <button
          onClick={() => alert('AI Prioritize placeholder')}
          style={{
            marginTop: '16px',
            padding: '10px 16px',
            backgroundColor: 'rgba(139,92,246,0.2)',
            color: '#a78bfa',
            border: '1px solid rgba(139,92,246,0.3)',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Sparkles size={14} />
          AI Prioritize
        </button>
      </div>
    </div>
  )
}
