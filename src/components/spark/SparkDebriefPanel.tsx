/**
 * SparkDebriefPanel.tsx — Post-call debrief UI component
 *
 * Glassmorphic card displaying:
 * - Debrief summary (2-3 sentences)
 * - Flags (red/amber alert cards)
 * - Numbered action items with [APPROVE] [REJECT] [EDIT] buttons
 * - Draft follow-up message with [SEND] [EDIT] buttons
 * - [REPLAY DEBRIEF] button for TTS replay
 * - [SAVE TO ECHO] confirmation button
 */

// @ts-nocheck

import React, { useState, useCallback } from 'react'
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertOctagon,
  Volume2,
  Send,
  Edit2,
  Save,
  X,
  FileText,
} from 'lucide-react'
import clsx from 'clsx'

import {
  SparkDebrief,
  DebrieResponse,
  ActionItem,
  updateActionItemStatus,
  deliverDebrieefViaTTS,
  saveDebrieefToSupabase,
  countApprovedItems,
} from '@/services/sparkLiveCall/SparkDebrief'

// ── Component Props ──────────────────────────────────────────────────────────

interface SparkDebriefPanelProps {
  debrief: DebrieResponse
  contactName: string
  durationSeconds: number
  transcript: string
  analysisSummary: string
  onClose: () => void
  onItemsApproved?: (items: ActionItem[]) => void // Queue approved items for task creation
}

// ── Main Component ───────────────────────────────────────────────────────────

export const SparkDebriefPanel: React.FC<SparkDebriefPanelProps> = ({
  debrief,
  contactName,
  durationSeconds,
  transcript,
  analysisSummary,
  onClose,
  onItemsApproved,
}) => {
  // State management
  const [actionItems, setActionItems] = useState<ActionItem[]>(
    debrief.actionItems.map((item, idx) => ({
      ...item,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    }))
  )

  const [editingItemNumber, setEditingItemNumber] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const [draftMessageEditing, setDraftMessageEditing] = useState(false)
  const [draftMessage, setDraftMessage] = useState(debrief.draftMessage)
  const [isSaving, setIsSaving] = useState(false)
  const [showReplayConfirm, setShowReplayConfirm] = useState(false)
  const [ttsPlaying, setTtsPlaying] = useState(false)

  // Approve action item
  const handleApproveItem = useCallback((itemNumber: number) => {
    const updated = updateActionItemStatus(actionItems, itemNumber, 'approved')
    setActionItems(updated)
  }, [actionItems])

  // Reject action item
  const handleRejectItem = useCallback((itemNumber: number) => {
    const updated = updateActionItemStatus(actionItems, itemNumber, 'rejected', 'User rejected')
    setActionItems(updated)
  }, [actionItems])

  // Edit action item
  const handleEditItem = useCallback((itemNumber: number, currentText: string) => {
    setEditingItemNumber(itemNumber)
    setEditingText(currentText)
  }, [])

  // Save edited action item
  const handleSaveEditedItem = useCallback(() => {
    if (editingItemNumber !== null) {
      const updated = updateActionItemStatus(actionItems, editingItemNumber, 'edited', undefined, editingText)
      setActionItems(updated)
      setEditingItemNumber(null)
      setEditingText('')
    }
  }, [editingItemNumber, editingText, actionItems])

  // Cancel edit
  const handleCancelEdit = useCallback(() => {
    setEditingItemNumber(null)
    setEditingText('')
  }, [])

  // Replay debrief via TTS
  const handleReplayDebrief = useCallback(async () => {
    if (ttsPlaying) return
    setTtsPlaying(true)
    const result = await deliverDebrieefViaTTS(debrief)
    setTtsPlaying(false)
    if (result) {
      console.log('[SparkDebriefPanel] Replay completed')
    }
  }, [debrief, ttsPlaying])

  // Save to ECHO memory (Supabase)
  const handleSaveToEcho = useCallback(async () => {
    setIsSaving(true)
    const debrieefToSave: SparkDebrief = {
      contactName,
      date: new Date().toISOString().split('T')[0],
      durationSeconds,
      transcript,
      analysisSummary,
      summary: debrief.summary,
      flags: debrief.flags,
      actionItems,
      draftMessage,
      echoLog: debrief.echoLog,
    }

    const result = await saveDebrieefToSupabase(debrieefToSave)
    setIsSaving(false)

    if (result.success) {
      // Fire callback for approved items
      const approved = actionItems.filter(item => item.status === 'approved')
      if (approved.length > 0 && onItemsApproved) {
        onItemsApproved(approved)
      }
      alert(`Debrief saved! ${approved.length} action items approved.`)
      onClose()
    } else {
      alert(`Save failed: ${result.error}`)
    }
  }, [contactName, durationSeconds, transcript, analysisSummary, debrief, actionItems, draftMessage, onItemsApproved, onClose])

  // Send draft message
  const handleSendDraft = useCallback(() => {
    const isSMS = draftMessage.length < 160 // Simple heuristic
    const scheme = isSMS ? 'sms' : 'mailto'
    let url = ''

    if (isSMS) {
      // SMS: sms:?body=...
      url = `sms:?body=${encodeURIComponent(draftMessage)}`
    } else {
      // Email: mailto:email@example.com?subject=...&body=...
      // For now, use a generic mailto — in production, extract email from contact
      url = `mailto:?subject=Follow-up from Power On Solutions&body=${encodeURIComponent(draftMessage)}`
    }

    // Open native client
    window.location.href = url
  }, [draftMessage])

  const approvedCount = countApprovedItems(actionItems)

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-zinc-900/90 border border-zinc-700/50 rounded-2xl shadow-2xl backdrop-blur-xl">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-zinc-900 to-zinc-800 border-b border-zinc-700/50 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-xl font-bold text-white">Debrief: {contactName}</h2>
            <p className="text-sm text-zinc-400 mt-1">{durationSeconds} seconds • {new Date().toLocaleTimeString()}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-zinc-700 rounded-lg transition-colors"
          >
            <X size={20} className="text-zinc-400" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* SUMMARY */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide">Summary</h3>
            <p className="text-base text-zinc-100 leading-relaxed bg-zinc-800/50 rounded-lg p-4 border border-zinc-700/30">
              {debrief.summary}
            </p>
          </section>

          {/* FLAGS */}
          {debrief.flags.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide">Flags</h3>
              <div className="space-y-2">
                {debrief.flags.map((flag, idx) => (
                  <div
                    key={idx}
                    className={clsx(
                      'flex gap-3 p-3 rounded-lg border',
                      flag.type === 'red'
                        ? 'bg-red-500/10 border-red-500/30 text-red-300'
                        : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    )}
                  >
                    {flag.type === 'red' ? (
                      <AlertOctagon size={18} className="flex-shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="font-semibold text-sm">{flag.title}</div>
                      <div className="text-sm mt-1">{flag.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ACTION ITEMS */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide">
              Action Items ({approvedCount}/{actionItems.length} approved)
            </h3>
            <div className="space-y-2">
              {actionItems.map(item => (
                <div key={item.number} className="space-y-2">
                  {editingItemNumber === item.number ? (
                    // Editing mode
                    <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 space-y-3">
                      <textarea
                        value={editingText}
                        onChange={e => setEditingText(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveEditedItem}
                          className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white text-sm font-medium transition-colors"
                        >
                          <Save size={14} className="inline mr-2" />
                          Save Edit
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="flex-1 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-white text-sm font-medium transition-colors"
                        >
                          <X size={14} className="inline mr-2" />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    // View mode
                    <div
                      className={clsx(
                        'flex gap-3 p-3 rounded-lg border transition-colors',
                        item.status === 'approved'
                          ? 'bg-green-500/10 border-green-500/30'
                          : item.status === 'rejected'
                          ? 'bg-red-500/10 border-red-500/30'
                          : item.status === 'edited'
                          ? 'bg-blue-500/10 border-blue-500/30'
                          : 'bg-zinc-800/50 border-zinc-700/30'
                      )}
                    >
                      <div className="font-bold text-zinc-400 min-w-6">{item.number}.</div>
                      <div className="flex-1">
                        <p className="text-sm text-zinc-100">
                          {item.editedText || item.description}
                        </p>
                        {item.status === 'rejected' && (
                          <p className="text-xs text-red-400 mt-1">Rejected</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {item.status !== 'approved' && (
                          <button
                            onClick={() => handleApproveItem(item.number)}
                            className="p-2 hover:bg-green-500/20 rounded transition-colors"
                            title="Approve"
                          >
                            <CheckCircle2 size={16} className="text-green-400" />
                          </button>
                        )}
                        {item.status !== 'rejected' && (
                          <button
                            onClick={() => handleRejectItem(item.number)}
                            className="p-2 hover:bg-red-500/20 rounded transition-colors"
                            title="Reject"
                          >
                            <XCircle size={16} className="text-red-400" />
                          </button>
                        )}
                        <button
                          onClick={() => handleEditItem(item.number, item.editedText || item.description)}
                          className="p-2 hover:bg-blue-500/20 rounded transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={16} className="text-blue-400" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* DRAFT MESSAGE */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide">Draft Message</h3>
            {draftMessageEditing ? (
              <div className="space-y-3">
                <textarea
                  value={draftMessage}
                  onChange={e => setDraftMessage(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  rows={4}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setDraftMessageEditing(false)}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white text-sm font-medium transition-colors"
                  >
                    <Save size={14} className="inline mr-2" />
                    Done Editing
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-zinc-100 bg-zinc-800/50 rounded-lg p-4 border border-zinc-700/30 whitespace-pre-wrap">
                  {draftMessage}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleSendDraft}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Send size={14} />
                    Send via SMS/Email
                  </button>
                  <button
                    onClick={() => setDraftMessageEditing(true)}
                    className="flex-1 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Edit2 size={14} />
                    Edit
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Action Buttons */}
          <section className="flex gap-3 pt-4 border-t border-zinc-700/50">
            <button
              onClick={handleReplayDebrief}
              disabled={ttsPlaying}
              className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 rounded text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Volume2 size={14} />
              {ttsPlaying ? 'Playing...' : 'Replay Debrief'}
            </button>
            <button
              onClick={handleSaveToEcho}
              disabled={isSaving}
              className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 rounded text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              <FileText size={14} />
              {isSaving ? 'Saving...' : 'Save to ECHO'}
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}

export default SparkDebriefPanel
