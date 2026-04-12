/**
 * DailyFieldLog — GUARDIAN daily field log component
 *
 * Quick entry (designed for 3 minutes max) at end of site visit.
 * Features:
 * - Structured textarea fields
 * - Voice input on all textareas via Whisper
 * - Auto-detection of scope changes and RFI triggers
 * - Photo upload button
 * - Hours on site (feeds PULSE labor cost tracking)
 * - Quick-submit button
 */

import React, { useState, useRef } from 'react'
import {
  Mic,
  Camera,
  Send,
  X,
  AlertCircle,
  Clock,
} from 'lucide-react'
import {
  saveFieldLog,
  detectScopeChangeLanguage,
  detectRFILanguage,
  generateChangeOrderPrompt,
  generateRFIPrompt,
  type DailyFieldLogData,
} from '@/services/guardian/GuardianFieldLogService'

interface DailyFieldLogProps {
  projectId: string
  projectName: string
  onSubmit?: (data: DailyFieldLogData) => void
  onCancel?: () => void
}

interface FormData {
  workCompletedToday: string
  workRemaining: string
  deviationsFromPlan: string
  verbalConversations: string
  hoursOnSite: number
  photos?: string[]
}

export function DailyFieldLog({
  projectId,
  projectName,
  onSubmit,
  onCancel,
}: DailyFieldLogProps) {
  const [form, setForm] = useState<FormData>({
    workCompletedToday: '',
    workRemaining: '',
    deviationsFromPlan: '',
    verbalConversations: '',
    hoursOnSite: 0,
    photos: [],
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recordingField, setRecordingField] = useState<keyof FormData | null>(null)
  const [scopeChangePrompt, setScopeChangePrompt] = useState<string | null>(null)
  const [rfiPrompt, setRfiPrompt] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  const updateField = (field: keyof FormData, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  // Start recording for a specific field
  const startRecording = async (field: keyof FormData) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data)

      recorder.start()
      mediaRecorderRef.current = recorder
      setRecordingField(field)
    } catch (err) {
      console.error('Error starting recording:', err)
      setError('Could not access microphone')
    }
  }

  // Stop recording and transcribe
  const stopRecording = async (field: keyof FormData) => {
    if (!mediaRecorderRef.current) return

    mediaRecorderRef.current.stop()
    mediaRecorderRef.current = null
    setRecordingField(null)

    // In production: send audio to Whisper API and update field with transcript
    // For now, we'll just show a placeholder
    console.log('Recording stopped for field:', field)
  }

  // Handle photo upload
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files
    if (!files || files.length === 0) return

    try {
      // In production: upload to Supabase Storage
      const newPhotos = form.photos || []
      // Placeholder URLs
      setForm(prev => ({
        ...prev,
        photos: newPhotos,
      }))
    } catch (err) {
      console.error('Error uploading photo:', err)
      setError('Could not upload photo')
    }
  }

  // Run detections and handle results
  const runDetections = async () => {
    // Check for scope changes in relevant fields
    const scopeCheckText = form.workRemaining || form.deviationsFromPlan
    if (scopeCheckText) {
      const scopeDetection = await detectScopeChangeLanguage(scopeCheckText)
      if (scopeDetection.detected && scopeDetection.scopeChangeText) {
        setScopeChangePrompt(
          generateChangeOrderPrompt(scopeDetection.scopeChangeText)
        )
      }
    }

    // Check for RFI language in relevant fields
    const rfiCheckText = form.deviationsFromPlan || form.verbalConversations
    if (rfiCheckText) {
      const rfiDetection = await detectRFILanguage(rfiCheckText)
      if (rfiDetection.detected && rfiDetection.rfiText) {
        setRfiPrompt(generateRFIPrompt(rfiDetection.rfiText))
      }
    }
  }

  // Submit field log
  const handleSubmit = async () => {
    if (!form.workCompletedToday.trim()) {
      setError('Please describe work completed today')
      return
    }

    setSaving(true)
    setError(null)

    try {
      // Run detections before saving
      await runDetections()

      const data: DailyFieldLogData = {
        projectId,
        projectName,
        checklistType: 'daily_field_log',
        workCompletedToday: form.workCompletedToday,
        workRemaining: form.workRemaining,
        deviationsFromPlan: form.deviationsFromPlan,
        verbalConversations: form.verbalConversations,
        hoursOnSite: form.hoursOnSite,
        photos: form.photos,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await saveFieldLog(projectId, data)

      if (onSubmit) {
        onSubmit(data)
      }
    } catch (err) {
      console.error('Error saving daily log:', err)
      setError('Failed to save log. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-cyan-700/40 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-cyan-700/40 p-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-2xl font-bold text-cyan-400">Daily Field Log</h2>
            <button
              onClick={onCancel}
              className="p-1 hover:bg-gray-800 rounded"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
          <p className="text-gray-400">Quick 3-minute entry for {projectName}</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-900/20 border border-red-600/40 rounded flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Form Fields */}
        <div className="p-6 space-y-4">
          {/* Work Completed Today */}
          <div>
            <label className="block text-sm font-medium text-cyan-400 mb-2">
              Work completed today
            </label>
            <div className="relative">
              <textarea
                value={form.workCompletedToday}
                onChange={e => updateField('workCompletedToday', e.target.value)}
                placeholder="Be specific (e.g., 'Ran 3/4 inch conduit from panel to kitchen, installed 8 outlets')"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-600 resize-none h-20"
              />
              <button
                onClick={() =>
                  recordingField === 'workCompletedToday'
                    ? stopRecording('workCompletedToday')
                    : startRecording('workCompletedToday')
                }
                className={`absolute top-2 right-2 p-2 rounded transition ${
                  recordingField === 'workCompletedToday'
                    ? 'bg-red-600/20 border border-red-600/40 text-red-300'
                    : 'bg-gray-700/50 text-gray-400 hover:text-gray-300'
                }`}
              >
                <Mic className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Work Remaining */}
          <div>
            <label className="block text-sm font-medium text-cyan-400 mb-2">
              Work remaining
            </label>
            <div className="relative">
              <textarea
                value={form.workRemaining}
                onChange={e => updateField('workRemaining', e.target.value)}
                placeholder="What's open going into next visit?"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-600 resize-none h-16"
              />
              <button
                onClick={() =>
                  recordingField === 'workRemaining'
                    ? stopRecording('workRemaining')
                    : startRecording('workRemaining')
                }
                className={`absolute top-2 right-2 p-2 rounded transition ${
                  recordingField === 'workRemaining'
                    ? 'bg-red-600/20 border border-red-600/40 text-red-300'
                    : 'bg-gray-700/50 text-gray-400 hover:text-gray-300'
                }`}
              >
                <Mic className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Deviations from Plan */}
          <div>
            <label className="block text-sm font-medium text-cyan-400 mb-2">
              Deviations from plan
            </label>
            <div className="relative">
              <textarea
                value={form.deviationsFromPlan}
                onChange={e => updateField('deviationsFromPlan', e.target.value)}
                placeholder="What changed and why? (Triggers scope change / RFI detection)"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-600 resize-none h-16"
              />
              <button
                onClick={() =>
                  recordingField === 'deviationsFromPlan'
                    ? stopRecording('deviationsFromPlan')
                    : startRecording('deviationsFromPlan')
                }
                className={`absolute top-2 right-2 p-2 rounded transition ${
                  recordingField === 'deviationsFromPlan'
                    ? 'bg-red-600/20 border border-red-600/40 text-red-300'
                    : 'bg-gray-700/50 text-gray-400 hover:text-gray-300'
                }`}
              >
                <Mic className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Verbal Conversations */}
          <div>
            <label className="block text-sm font-medium text-cyan-400 mb-2">
              Verbal conversations needing written follow-up
            </label>
            <div className="relative">
              <textarea
                value={form.verbalConversations}
                onChange={e => updateField('verbalConversations', e.target.value)}
                placeholder="With GC, customer, inspector, etc."
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-600 resize-none h-16"
              />
              <button
                onClick={() =>
                  recordingField === 'verbalConversations'
                    ? stopRecording('verbalConversations')
                    : startRecording('verbalConversations')
                }
                className={`absolute top-2 right-2 p-2 rounded transition ${
                  recordingField === 'verbalConversations'
                    ? 'bg-red-600/20 border border-red-600/40 text-red-300'
                    : 'bg-gray-700/50 text-gray-400 hover:text-gray-300'
                }`}
              >
                <Mic className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Hours On Site */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-cyan-400 mb-2">
                <Clock className="inline w-4 h-4 mr-1" />
                Hours on site
              </label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={form.hoursOnSite}
                onChange={e => updateField('hoursOnSite', parseFloat(e.target.value) || 0)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-600"
              />
            </div>

            {/* Photos */}
            <div>
              <label className="block text-sm font-medium text-cyan-400 mb-2">
                <Camera className="inline w-4 h-4 mr-1" />
                Progress photos
              </label>
              <label className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-400 cursor-pointer hover:text-gray-300 transition text-center">
                Upload
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={e => handlePhotoUpload(e)}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Photo Count */}
          {form.photos && form.photos.length > 0 && (
            <p className="text-xs text-gray-500">
              {form.photos.length} photo{form.photos.length !== 1 ? 's' : ''} attached
            </p>
          )}
        </div>

        {/* Scope Change Prompt */}
        {scopeChangePrompt && (
          <div className="mx-6 p-3 bg-amber-900/20 border border-amber-600/40 rounded flex items-center justify-between">
            <p className="text-amber-300 text-sm">{scopeChangePrompt}</p>
            <div className="flex gap-2 ml-4">
              <button className="px-2 py-1 text-xs bg-amber-600/30 text-amber-300 rounded hover:bg-amber-600/50">
                YES
              </button>
              <button
                onClick={() => setScopeChangePrompt(null)}
                className="px-2 py-1 text-xs bg-gray-700/50 text-gray-400 rounded hover:bg-gray-700"
              >
                NO
              </button>
            </div>
          </div>
        )}

        {/* RFI Prompt */}
        {rfiPrompt && (
          <div className="mx-6 mt-3 p-3 bg-blue-900/20 border border-blue-600/40 rounded flex items-center justify-between">
            <p className="text-blue-300 text-sm">{rfiPrompt}</p>
            <div className="flex gap-2 ml-4">
              <button className="px-2 py-1 text-xs bg-blue-600/30 text-blue-300 rounded hover:bg-blue-600/50">
                YES
              </button>
              <button
                onClick={() => setRfiPrompt(null)}
                className="px-2 py-1 text-xs bg-gray-700/50 text-gray-400 rounded hover:bg-gray-700"
              >
                NO
              </button>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="sticky bottom-0 bg-gray-900 border-t border-cyan-700/40 p-6 flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-800 border border-gray-600 text-gray-300 rounded hover:bg-gray-700 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !form.workCompletedToday.trim()}
            className={`flex items-center gap-2 px-4 py-2 rounded font-medium transition ${
              !saving && form.workCompletedToday.trim()
                ? 'bg-cyan-600 text-white hover:bg-cyan-700'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            <Send className="w-4 h-4" />
            {saving ? 'Saving...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default DailyFieldLog
