/**
 * PreJobChecklist — GUARDIAN pre-job checklist component
 *
 * Triggers before any project phase can begin. All 6 items must be completed.
 * Features:
 * - Card-based dark theme layout
 * - Progress bar (X/6 items complete)
 * - Photo upload per item
 * - Notes field with voice input
 * - Cannot mark project phase as "started" until complete
 */

import React, { useState, useEffect, useRef } from 'react'
import {
  CheckCircle2,
  Circle,
  Camera,
  Mic,
  AlertCircle,
  Save,
  X,
} from 'lucide-react'
import {
  saveFieldLog,
  isChecklistComplete,
  type ChecklistItem,
  type PreJobChecklistData,
} from '@/services/guardian/GuardianFieldLogService'

interface PreJobChecklistProps {
  projectId: string
  projectName: string
  onComplete?: (data: PreJobChecklistData) => void
  onCancel?: () => void
}

const DEFAULT_CHECKLIST_ITEMS: ChecklistItem[] = [
  {
    id: 'permit',
    label: 'Permit confirmed on site (for permitted work)',
    completed: false,
  },
  {
    id: 'plans',
    label: 'Approved plans reviewed and downloaded',
    completed: false,
  },
  {
    id: 'photos',
    label: 'Pre-existing condition photos taken (minimum 5, upload button per photo)',
    completed: false,
  },
  {
    id: 'safety',
    label: 'Safety assessment completed (confined space, live circuit, solo work protocol)',
    completed: false,
  },
  {
    id: 'briefing',
    label: 'Crew task briefing logged (what each person does, installation standard, escalation process)',
    completed: false,
  },
  {
    id: 'solo',
    label: 'Solo work check-in contact designated (if working alone — name + interval)',
    completed: false,
  },
]

export function PreJobChecklist({
  projectId,
  projectName,
  onComplete,
  onCancel,
}: PreJobChecklistProps) {
  const [items, setItems] = useState<ChecklistItem[]>(DEFAULT_CHECKLIST_ITEMS)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  const completedCount = items.filter(i => i.completed).length
  const isComplete = isChecklistComplete(items)
  const progressPercent = Math.round((completedCount / items.length) * 100)

  // Toggle item completion
  const toggleItem = (id: string) => {
    setItems(items.map(item =>
      item.id === id ? { ...item, completed: !item.completed } : item
    ))
  }

  // Update item notes
  const updateNotes = (id: string, notes: string) => {
    setItems(items.map(item =>
      item.id === id ? { ...item, notes } : item
    ))
  }

  // Start voice recording for notes
  const startRecording = async (id: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data)
      recorder.onstop = () => {
        // Transcription would happen here via Whisper
        console.log('Recording stopped for item:', id)
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      setRecordingId(id)
    } catch (err) {
      console.error('Error starting recording:', err)
      setError('Could not access microphone')
    }
  }

  // Stop voice recording
  const stopRecording = async (id: string) => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
      setRecordingId(null)
      // In production, send audio to Whisper API and update notes
    }
  }

  // Handle photo upload
  const handlePhotoUpload = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files
    if (!files || files.length === 0) return

    try {
      // In production, upload to Supabase Storage
      const item = items.find(i => i.id === id)
      if (item) {
        item.photos = item.photos || []
        // Placeholder for photo URLs
        setItems([...items])
      }
    } catch (err) {
      console.error('Error uploading photo:', err)
      setError('Could not upload photo')
    }
  }

  // Save checklist
  const handleSave = async () => {
    if (!isComplete) {
      setError('All items must be completed before saving')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const data: PreJobChecklistData = {
        projectId,
        projectName,
        checklistType: 'pre_job',
        items,
        completedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await saveFieldLog(projectId, data)
      
      if (onComplete) {
        onComplete(data)
      }
    } catch (err) {
      console.error('Error saving checklist:', err)
      setError('Failed to save checklist. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-cyan-700/40 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-cyan-700/40 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-cyan-400">Pre-Job Checklist</h2>
            <button
              onClick={onCancel}
              className="p-1 hover:bg-gray-800 rounded"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
          
          <p className="text-gray-400 mb-3">{projectName}</p>

          {/* Progress Bar */}
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div
              className="bg-cyan-500 h-2 rounded-full transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-sm text-gray-400 mt-2">
            {completedCount} of {items.length} items complete
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-900/20 border border-red-600/40 rounded flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Checklist Items */}
        <div className="p-6 space-y-4">
          {items.map(item => (
            <div
              key={item.id}
              className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 hover:border-cyan-600/40 transition"
            >
              {/* Checkbox + Label */}
              <div className="flex items-start gap-3 mb-3">
                <button
                  onClick={() => toggleItem(item.id)}
                  className="mt-1 flex-shrink-0 text-cyan-400 hover:text-cyan-300"
                >
                  {item.completed ? (
                    <CheckCircle2 className="w-6 h-6" />
                  ) : (
                    <Circle className="w-6 h-6" />
                  )}
                </button>
                <label
                  className="flex-1 cursor-pointer"
                  onClick={() => toggleItem(item.id)}
                >
                  <span
                    className={`text-sm font-medium ${
                      item.completed
                        ? 'text-cyan-300 line-through'
                        : 'text-gray-300'
                    }`}
                  >
                    {item.label}
                  </span>
                </label>
              </div>

              {/* Notes Field (if completed) */}
              {item.completed && (
                <div className="ml-9 space-y-2">
                  <textarea
                    value={item.notes || ''}
                    onChange={e => updateNotes(item.id, e.target.value)}
                    placeholder="Add notes... (optional)"
                    className="w-full bg-gray-700/50 border border-gray-600/50 rounded px-3 py-2 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-cyan-600/50 resize-none h-20"
                  />
                  
                  {/* Voice Input + Photo Upload */}
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        recordingId === item.id
                          ? stopRecording(item.id)
                          : startRecording(item.id)
                      }
                      className={`flex items-center gap-1 px-3 py-1 text-xs rounded transition ${
                        recordingId === item.id
                          ? 'bg-red-600/20 border border-red-600/40 text-red-300'
                          : 'bg-gray-700/50 border border-gray-600/50 text-gray-400 hover:text-gray-300'
                      }`}
                    >
                      <Mic className="w-4 h-4" />
                      {recordingId === item.id ? 'Stop' : 'Voice'}
                    </button>

                    <label className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-gray-700/50 border border-gray-600/50 text-gray-400 hover:text-gray-300 cursor-pointer transition">
                      <Camera className="w-4 h-4" />
                      Photo
                      <input
                        type="file"
                        accept="image/*"
                        onChange={e => handlePhotoUpload(item.id, e)}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {/* Photo Count */}
                  {item.photos && item.photos.length > 0 && (
                    <p className="text-xs text-gray-500">
                      {item.photos.length} photo{item.photos.length !== 1 ? 's' : ''} attached
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer Actions */}
        <div className="sticky bottom-0 bg-gray-900 border-t border-cyan-700/40 p-6 flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-800 border border-gray-600 text-gray-300 rounded hover:bg-gray-700 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!isComplete || saving}
            className={`flex items-center gap-2 px-4 py-2 rounded font-medium transition ${
              isComplete && !saving
                ? 'bg-cyan-600 text-white hover:bg-cyan-700'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save & Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PreJobChecklist
