// @ts-nocheck
import React, { useState, useCallback, useEffect } from 'react'
import { Sparkles, ChevronDown, BookOpen, X } from 'lucide-react'
import {
  fetchLatestRemoteBackup,
  getBackupData,
  saveBackupData,
  saveBackupDataAndSync,
  saveBackupWithRemoteBaselineSync,
} from '@/services/backupDataService'
import {
  createCoordItemTombstone,
  ensureCoordItemIdentity,
  getLiveCoordItems,
  mergeProjectCoordinationIntoRemote,
} from '@/services/projectScopeMerge'
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
  const [editingCoordKey, setEditingCoordKey] = useState<string | null>(null)
  const [editingCoordId, setEditingCoordId] = useState<string | null>(null)
  const [editCoordForm, setEditCoordForm] = useState({ text: '', status: 'pending', response: '', solvedBy: '' })

  const backup = initialBackup || getBackupData()
  if (!backup) return <div style={{ color: 'var(--t3)' }}>No data</div>

  const p = backup.projects.find(x => x.id === projectId)
  if (!p) return <div style={{ color: 'var(--t3)' }}>Project not found</div>

  const saveProjectCoordinationScoped = async (currentBackup: any) => {
    try {
      const remote = await fetchLatestRemoteBackup()
      if (remote.hasRemoteRow && remote.remoteData) {
        const incoming = getBackupData() || currentBackup
        const merged = mergeProjectCoordinationIntoRemote(remote.remoteData, incoming, projectId)
        await saveBackupWithRemoteBaselineSync(
          merged,
          { remoteUpdatedAt: remote.remoteUpdatedAt, remoteDataLastSavedAt: remote.remoteDataLastSavedAt },
          {
            source: 'project-coordination-remote-merge',
            changedKey: 'project.coordination',
            _scopes: ['project.coordination'],
          },
        )
        return
      }
      saveBackupDataAndSync(getBackupData() || currentBackup, 'project.coordination', {
        source: 'project.coordination',
        _scopes: ['project.coordination'],
      })
    } catch (err) {
      console.warn('[V15rCoordinationTab] Scoped project-coordination sync failed; local changes preserved', err)
      saveBackupDataAndSync(getBackupData() || currentBackup, 'project.coordination', {
        source: 'project.coordination',
        _scopes: ['project.coordination'],
      })
    }
  }

  const persistCoordinationChange = (mutate: (project: any, currentBackup: any) => false | void): boolean => {
    const currentBackup = getBackupData()
    const currentProject = currentBackup?.projects?.find((x: any) => x.id === projectId)
    if (!currentBackup || !currentProject) return false
    const result = mutate(currentProject, currentBackup)
    if (result === false) return false
    currentBackup._lastSavedAt = new Date().toISOString()
    saveBackupData(currentBackup)
    forceUpdate()
    if (onUpdate) onUpdate()
    void saveProjectCoordinationScoped(currentBackup)
    return true
  }

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
    const saved = persistCoordinationChange((freshP) => {
      if (!freshP.coord) freshP.coord = {}
      if (!freshP.coord[key]) freshP.coord[key] = []
      freshP.coord[key].push(ensureCoordItemIdentity({
        id: "ci" + Date.now(),
        text: String(text),
        status: "pending",
        section: key,
      }, new Date().toISOString()))
    })
    if (!saved) { setAddingSection(null); return }
    setAddingSection(null)
    setAddingText("")
  }

  const editItem = (key, itemId, field, value) => {
    pushState()
    persistCoordinationChange((freshP) => {
      const items = (freshP.coord || {})[key] || []
      const index = items.findIndex(i => i.id === itemId)
      const item = index >= 0 ? items[index] : null
      if (!item) return false
      if (field === 'text') item.text = String(value)
      else if (field === 'status') item.status = String(value)
      else return false
      items[index] = ensureCoordItemIdentity(item, new Date().toISOString())
    })
  }

  const delItem = (key, itemId) => {
    pushState()
    persistCoordinationChange((freshP) => {
      if (!freshP.coord || !freshP.coord[key]) return false
      freshP.coord[key] = freshP.coord[key].map(i => (
        i.id === itemId ? createCoordItemTombstone(i) : i
      ))
    })
  }

  const openEditCoordModal = (key, item) => {
    setEditingCoordKey(key)
    setEditingCoordId(item.id)
    setEditCoordForm({
      text: item.text || '',
      status: item.status || 'pending',
      response: item.response || '',
      solvedBy: item.solvedBy || '',
    })
  }

  const closeEditCoordModal = () => {
    setEditingCoordKey(null)
    setEditingCoordId(null)
  }

  const saveEditCoordModal = () => {
    if (!editingCoordKey || !editingCoordId) return
    pushState()
    const saved = persistCoordinationChange((freshP) => {
      const items = (freshP.coord || {})[editingCoordKey] || []
      const index = items.findIndex(i => i.id === editingCoordId)
      const item = index >= 0 ? items[index] : null
      if (!item) return false
      item.text = editCoordForm.text
      item.status = editCoordForm.status
      item.response = editCoordForm.response
      item.solvedBy = editCoordForm.solvedBy
      items[index] = ensureCoordItemIdentity(item, new Date().toISOString())
    })
    if (!saved) return
    closeEditCoordModal()
  }

  return (
    <div style={{ backgroundColor: '#1a1d27', padding: '0' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {coordSections.map(section => {
            const items = getLiveCoordItems((p.coord || {})[section.key] || [])
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
                              fontSize: '12px',
                              borderLeft: item.response ? `3px solid ${section.color}` : '3px solid transparent',
                            }}
                          >
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <div style={{ flex: 1 }}>
                                <input
                                  type="text"
                                  value={item.text || ''}
                                  onChange={e => editItem(section.key, item.id, 'text', e.target.value)}
                                  style={{
                                    width: '100%', background: 'transparent', border: 'none',
                                    color: 'var(--t1)', fontSize: '12px', fontFamily: 'inherit', outline: 'none',
                                  }}
                                />
                              </div>
                              <select
                                value={item.status || 'pending'}
                                onChange={e => editItem(section.key, item.id, 'status', e.target.value)}
                                style={{
                                  padding: '3px 6px', backgroundColor: '#0f1117',
                                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px',
                                  color: 'var(--t2)', fontSize: '11px', cursor: 'pointer',
                                }}
                              >
                                <option value="pending">Pending</option>
                                <option value="completed">Completed</option>
                              </select>
                              <button
                                onClick={() => openEditCoordModal(section.key, item)}
                                style={{
                                  padding: '3px 8px', backgroundColor: 'rgba(59,130,246,0.10)',
                                  color: '#93c5fd', border: '1px solid rgba(59,130,246,0.18)',
                                  borderRadius: '4px', fontSize: '11px', fontWeight: '700', cursor: 'pointer',
                                }}
                              >Edit</button>
                              <button
                                onClick={() => delItem(section.key, item.id)}
                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0' }}
                              >×</button>
                            </div>
                            {(item.response || item.solvedBy) && (
                              <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                {item.response && (
                                  <div style={{ fontSize: '11px', color: '#d1fae5', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                                    <span style={{ color: '#86efac', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '6px' }}>Response:</span>
                                    {item.response}
                                  </div>
                                )}
                                {item.solvedBy && (
                                  <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--t3)' }}>
                                    Solved by <span style={{ color: '#86efac', fontWeight: '700' }}>{item.solvedBy}</span>
                                  </div>
                                )}
                              </div>
                            )}
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

      {/* EDIT COORDINATION ITEM MODAL */}
      {editingCoordId && editingCoordKey && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) closeEditCoordModal() }}
        >
          <div
            style={{
              width: '100%', maxWidth: '560px', margin: '0 16px', borderRadius: '16px',
              backgroundColor: 'var(--bg-card)', border: '1px solid rgba(59,130,246,0.28)',
              boxShadow: '0 24px 70px rgba(0,0,0,0.55)', maxHeight: '90vh', overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div>
                <h3 style={{ color: 'var(--t1)', fontSize: '16px', fontWeight: '700', margin: 0 }}>Edit Coordination Item</h3>
                <p style={{ color: 'var(--t3)', fontSize: '12px', margin: '4px 0 0 0' }}>Update text, status, response, and ownership</p>
              </div>
              <button
                onClick={closeEditCoordModal}
                style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: '2px' }}
                aria-label="Close"
              ><X size={18} /></button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700', marginBottom: '6px', letterSpacing: '0.07em' }}>Item Text</label>
                <textarea
                  value={editCoordForm.text}
                  onChange={e => setEditCoordForm(prev => ({ ...prev, text: e.target.value }))}
                  rows={3}
                  style={{
                    width: '100%', borderRadius: '8px', padding: '8px 12px', fontSize: '13px',
                    color: '#e2e8f0', border: '1px solid #4b5563', outline: 'none', resize: 'vertical',
                    backgroundColor: 'var(--bg-input)', fontFamily: 'inherit',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700', marginBottom: '6px', letterSpacing: '0.07em' }}>Status</label>
                <select
                  value={editCoordForm.status}
                  onChange={e => setEditCoordForm(prev => ({ ...prev, status: e.target.value }))}
                  style={{
                    width: '100%', borderRadius: '8px', padding: '8px 12px', fontSize: '13px',
                    color: '#e2e8f0', border: '1px solid #4b5563', outline: 'none',
                    backgroundColor: 'var(--bg-input)', cursor: 'pointer',
                  }}
                >
                  <option value="pending">Pending</option>
                  <option value="completed">Completed</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700', marginBottom: '6px', letterSpacing: '0.07em' }}>Response / Answer</label>
                <textarea
                  value={editCoordForm.response}
                  onChange={e => setEditCoordForm(prev => ({ ...prev, response: e.target.value }))}
                  rows={4}
                  placeholder="Optional response, resolution, or answer..."
                  style={{
                    width: '100%', borderRadius: '8px', padding: '8px 12px', fontSize: '13px',
                    color: '#e2e8f0', border: '1px solid #4b5563', outline: 'none', resize: 'vertical',
                    backgroundColor: 'var(--bg-input)', fontFamily: 'inherit',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700', marginBottom: '6px', letterSpacing: '0.07em' }}>Solved by / Responded by</label>
                <input
                  type="text"
                  value={editCoordForm.solvedBy}
                  onChange={e => setEditCoordForm(prev => ({ ...prev, solvedBy: e.target.value }))}
                  placeholder="Optional"
                  style={{
                    width: '100%', borderRadius: '8px', padding: '8px 12px', fontSize: '13px',
                    color: '#e2e8f0', border: '1px solid #4b5563', outline: 'none',
                    backgroundColor: 'var(--bg-input)', fontFamily: 'inherit',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <button
                onClick={closeEditCoordModal}
                style={{
                  padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                  color: '#94a3b8', border: '1px solid #4b5563', cursor: 'pointer',
                  backgroundColor: 'rgba(15,23,42,0.35)',
                }}
              >Cancel</button>
              <button
                onClick={saveEditCoordModal}
                style={{
                  padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '700',
                  color: 'white', border: '1px solid rgba(96,165,250,0.35)', cursor: 'pointer',
                  background: 'linear-gradient(135deg, rgba(37,99,235,0.95), rgba(16,185,129,0.92))',
                  boxShadow: '0 6px 16px rgba(37,99,235,0.22)',
                }}
              >Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
