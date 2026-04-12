import React, { useState, useCallback } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  MapPin,
  MessageSquare,
  Navigation,
  Send,
  Truck,
  User,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import {
  type BookingRecord,
  type TechAction,
  type PipelineStage,
  PIPELINE_STAGES,
  ACTION_STAGE_MAP,
  getStageIndex,
  formatEta,
} from '../../services/portal/CustomerTrustPipeline'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ActiveBookingSummary {
  bookingId: string
  customerName: string
  address: string
  scheduledTime: string
  currentStage: PipelineStage
  etaMinutes?: number
}

interface TechActionBarProps {
  /** List of active bookings for today */
  activeBookings?: ActiveBookingSummary[]
  /** Currently selected booking (expanded view) */
  selectedBookingId?: string
  /** Full booking record for the selected booking */
  selectedBooking?: BookingRecord
  /** Called when tech performs an action */
  onAction?: (bookingId: string, action: TechAction, payload?: ActionPayload) => Promise<void>
  /** Called when tech switches active booking */
  onSelectBooking?: (bookingId: string) => void
  /** Demo mode — simulates actions without real API calls */
  demoMode?: boolean
}

interface ActionPayload {
  etaMinutes?: number
  message?: string
  issueReason?: string
  delayMinutes?: number
  updatedEta?: string
  locationEnabled?: boolean
}

// ── Quick action button definitions ───────────────────────────────────────────

interface QuickActionDef {
  action: TechAction
  label: string
  shortLabel: string
  icon: React.ReactNode
  color: string
  hoverColor: string
  textColor: string
  /** Only show when booking is in one of these stages */
  visibleIn: PipelineStage[]
  requiresInput?: boolean
  confirmLabel?: string
}

const QUICK_ACTIONS: QuickActionDef[] = [
  {
    action: 'MARK_EN_ROUTE',
    label: 'Mark En Route',
    shortLabel: 'En Route',
    icon: <Truck className="w-4 h-4" />,
    color: 'bg-blue-500',
    hoverColor: 'hover:bg-blue-400',
    textColor: 'text-white',
    visibleIn: ['BOOKED'],
    confirmLabel: 'SMS will be sent to customer',
  },
  {
    action: 'MARK_ARRIVED',
    label: 'Mark Arrived',
    shortLabel: 'Arrived',
    icon: <MapPin className="w-4 h-4" />,
    color: 'bg-green-500',
    hoverColor: 'hover:bg-green-400',
    textColor: 'text-white',
    visibleIn: ['EN_ROUTE', 'ARRIVING'],
    confirmLabel: 'Marks you on site — customer notified',
  },
  {
    action: 'MARK_IN_PROGRESS',
    label: 'In Progress',
    shortLabel: 'In Progress',
    icon: <Wrench className="w-4 h-4" />,
    color: 'bg-yellow-400',
    hoverColor: 'hover:bg-yellow-300',
    textColor: 'text-gray-900',
    visibleIn: ['ON_SITE'],
    confirmLabel: 'Notifies customer work has started',
  },
  {
    action: 'MARK_WRAPPING_UP',
    label: 'Wrapping Up',
    shortLabel: 'Wrapping',
    icon: <CheckCircle className="w-4 h-4" />,
    color: 'bg-purple-500',
    hoverColor: 'hover:bg-purple-400',
    textColor: 'text-white',
    visibleIn: ['IN_PROGRESS'],
  },
  {
    action: 'MARK_COMPLETE',
    label: 'Mark Complete',
    shortLabel: 'Complete',
    icon: <CheckCircle className="w-4 h-4" />,
    color: 'bg-green-600',
    hoverColor: 'hover:bg-green-500',
    textColor: 'text-white',
    visibleIn: ['WRAPPING_UP', 'ON_SITE', 'IN_PROGRESS'],
    confirmLabel: 'Invoice sent + review requested',
  },
  {
    action: 'FLAG_ISSUE',
    label: 'Flag Issue',
    shortLabel: 'Flag Issue',
    icon: <AlertTriangle className="w-4 h-4" />,
    color: 'bg-amber-500',
    hoverColor: 'hover:bg-amber-400',
    textColor: 'text-white',
    visibleIn: ['BOOKED', 'EN_ROUTE', 'ARRIVING', 'ON_SITE', 'IN_PROGRESS', 'WRAPPING_UP'],
    requiresInput: true,
  },
  {
    action: 'SEND_UPDATE',
    label: 'Send Update',
    shortLabel: 'Update',
    icon: <MessageSquare className="w-4 h-4" />,
    color: 'bg-gray-600',
    hoverColor: 'hover:bg-gray-500',
    textColor: 'text-white',
    visibleIn: ['BOOKED', 'EN_ROUTE', 'ARRIVING', 'ON_SITE', 'IN_PROGRESS', 'WRAPPING_UP'],
    requiresInput: true,
  },
]

// ── Stage badge ────────────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: PipelineStage }) {
  const info = PIPELINE_STAGES.find((s) => s.stage === stage)
  const colorMap: Record<PipelineStage, string> = {
    BOOKED: 'bg-gray-600 text-gray-200',
    EN_ROUTE: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
    ARRIVING: 'bg-green-500/20 text-green-300 border border-green-500/30',
    ON_SITE: 'bg-yellow-400/20 text-yellow-300 border border-yellow-400/30',
    IN_PROGRESS: 'bg-yellow-400/30 text-yellow-200 border border-yellow-400/50',
    WRAPPING_UP: 'bg-purple-500/20 text-purple-300 border border-purple-500/30',
    COMPLETE: 'bg-green-600/20 text-green-300 border border-green-600/30',
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${colorMap[stage]}`}>
      <span>{info?.icon}</span>
      {info?.label ?? stage}
    </span>
  )
}

// ── GPS toggle ─────────────────────────────────────────────────────────────────

function GpsToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-all ${
        enabled
          ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
          : 'bg-gray-700 border-gray-600 text-gray-500'
      }`}
    >
      <Navigation className={`w-3.5 h-3.5 ${enabled ? 'text-blue-400' : 'text-gray-600'}`} />
      <span>Location {enabled ? 'On' : 'Off'}</span>
    </button>
  )
}

// ── Issue flag input ────────────────────────────────────────────────────────────

function IssueFlagModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (payload: ActionPayload) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  const [delayMins, setDelayMins] = useState('15')
  const [updatedEta, setUpdatedEta] = useState('')

  const handleConfirm = () => {
    if (!reason.trim()) return
    onConfirm({
      issueReason: reason.trim(),
      delayMinutes: parseInt(delayMins, 10) || 15,
      updatedEta: updatedEta.trim() || undefined,
      message: updatedEta.trim()
        ? `Running ${delayMins} minutes behind due to previous job. Updated ETA: ${updatedEta}.`
        : reason.trim(),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 px-4 pb-4 sm:pb-0">
      <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <h3 className="text-white font-semibold">Flag Issue / Delay</h3>
          </div>
          <button onClick={onCancel} className="text-gray-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Delay (minutes)</label>
            <select
              value={delayMins}
              onChange={(e) => setDelayMins(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
            >
              {['5', '10', '15', '20', '30', '45', '60'].map((v) => (
                <option key={v} value={v}>{v} minutes</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Updated arrival time (optional)</label>
            <input
              type="text"
              value={updatedEta}
              onChange={(e) => setUpdatedEta(e.target.value)}
              placeholder="e.g. 2:15 PM"
              className="w-full bg-gray-700 border border-gray-600 text-white placeholder-gray-500 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Message to customer *</label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={`Running ${delayMins} minutes behind due to previous job. Updated ETA: ${updatedEta || '...'}`}
              className="w-full bg-gray-700 border border-gray-600 text-white placeholder-gray-500 rounded-lg px-3 py-2 text-sm resize-none"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 bg-gray-700 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!reason.trim()}
            className="flex-1 bg-amber-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Send to Customer
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Free-text update input ──────────────────────────────────────────────────────

function SendUpdateModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (payload: ActionPayload) => void
  onCancel: () => void
}) {
  const [message, setMessage] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 px-4 pb-4 sm:pb-0">
      <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-yellow-400" />
            <h3 className="text-white font-semibold">Send Update to Customer</h3>
          </div>
          <button onClick={onCancel} className="text-gray-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <textarea
          rows={4}
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message to the customer via SMS..."
          className="w-full bg-gray-700 border border-gray-600 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-yellow-400/50"
        />

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 bg-gray-700 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { if (message.trim()) onConfirm({ message: message.trim() }) }}
            disabled={!message.trim()}
            className="flex-1 bg-yellow-400 text-gray-900 rounded-xl py-2.5 text-sm font-semibold hover:bg-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            <Send className="w-3.5 h-3.5" />
            Send SMS
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Booking list item ───────────────────────────────────────────────────────────

function BookingListItem({
  booking,
  isSelected,
  onSelect,
}: {
  booking: ActiveBookingSummary
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-xl p-4 border transition-all ${
        isSelected
          ? 'bg-yellow-400/10 border-yellow-400/40'
          : 'bg-gray-800 border-gray-700 hover:border-gray-600'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <User className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <p className="text-white font-semibold text-sm truncate">{booking.customerName}</p>
          </div>
          <p className="text-gray-500 text-xs truncate pl-5">{booking.address}</p>
          <div className="flex items-center gap-2 mt-2 pl-5">
            <Clock className="w-3 h-3 text-gray-600" />
            <span className="text-gray-500 text-xs">{booking.scheduledTime}</span>
          </div>
        </div>
        <StageBadge stage={booking.currentStage} />
      </div>
    </button>
  )
}

// ── Main TechActionBar component ────────────────────────────────────────────────

export function TechActionBar({
  activeBookings = [],
  selectedBookingId,
  selectedBooking,
  onAction,
  onSelectBooking,
  demoMode = false,
}: TechActionBarProps) {
  const [loading, setLoading] = useState<TechAction | null>(null)
  const [activeModal, setActiveModal] = useState<TechAction | null>(null)
  const [locationEnabled, setLocationEnabled] = useState(true)
  const [expandedList, setExpandedList] = useState(false)
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null)
  const [etaInput, setEtaInput] = useState('25')

  const currentBooking = selectedBooking
  const currentStage = currentBooking?.currentStage ?? 'BOOKED'
  const stageIndex = getStageIndex(currentStage)

  // Show feedback toast briefly
  const showFeedback = useCallback((msg: string) => {
    setFeedbackMsg(msg)
    setTimeout(() => setFeedbackMsg(null), 3000)
  }, [])

  const handleAction = useCallback(
    async (action: TechAction, payload?: ActionPayload) => {
      if (!selectedBookingId) return
      setLoading(action)
      setActiveModal(null)

      try {
        if (demoMode) {
          // Simulate network delay
          await new Promise((r) => setTimeout(r, 800))
          showFeedback(`✅ ${action.replace(/_/g, ' ')} — SMS sent (demo)`)
        } else {
          await onAction?.(selectedBookingId, action, {
            ...payload,
            locationEnabled,
            etaMinutes: action === 'MARK_EN_ROUTE' ? parseInt(etaInput, 10) || 25 : undefined,
          })
          showFeedback(`✅ Action sent — customer notified`)
        }
      } catch {
        showFeedback('❌ Action failed — check connection')
      } finally {
        setLoading(null)
      }
    },
    [selectedBookingId, demoMode, onAction, locationEnabled, etaInput, showFeedback]
  )

  const handleModalConfirm = useCallback(
    async (action: TechAction, payload: ActionPayload) => {
      await handleAction(action, payload)
    },
    [handleAction]
  )

  // Visible quick actions for current stage
  const visibleActions = QUICK_ACTIONS.filter((a) => a.visibleIn.includes(currentStage))

  return (
    <>
      {/* Modals */}
      {activeModal === 'FLAG_ISSUE' && (
        <IssueFlagModal
          onConfirm={(p) => handleModalConfirm('FLAG_ISSUE', p)}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === 'SEND_UPDATE' && (
        <SendUpdateModal
          onConfirm={(p) => handleModalConfirm('SEND_UPDATE', p)}
          onCancel={() => setActiveModal(null)}
        />
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-gray-800 to-gray-850 px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-yellow-400 rounded-lg flex items-center justify-center">
              <Zap className="w-4 h-4 text-gray-900" />
            </div>
            <div>
              <h2 className="text-white font-bold text-sm">Tech Action Bar</h2>
              <p className="text-gray-500 text-xs">
                {activeBookings.length} active job{activeBookings.length !== 1 ? 's' : ''} today
              </p>
            </div>
          </div>
          <GpsToggle
            enabled={locationEnabled}
            onToggle={() => {
              setLocationEnabled(!locationEnabled)
              handleAction('TOGGLE_LOCATION', { locationEnabled: !locationEnabled })
            }}
          />
        </div>

        {/* Booking list selector */}
        {activeBookings.length > 0 && (
          <div className="px-4 py-3 border-b border-gray-800">
            {activeBookings.length === 1 ? (
              <BookingListItem
                booking={activeBookings[0]}
                isSelected
                onSelect={() => {}}
              />
            ) : (
              <>
                {/* Show selected booking */}
                {selectedBookingId && (
                  <div className="mb-2">
                    {activeBookings
                      .filter((b) => b.bookingId === selectedBookingId)
                      .map((b) => (
                        <BookingListItem
                          key={b.bookingId}
                          booking={b}
                          isSelected
                          onSelect={() => {}}
                        />
                      ))}
                  </div>
                )}
                {/* Toggle to show all */}
                <button
                  onClick={() => setExpandedList(!expandedList)}
                  className="w-full flex items-center justify-center gap-2 text-xs text-gray-500 hover:text-gray-300 py-2 transition-colors"
                >
                  {expandedList ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {expandedList ? 'Hide' : `Show all ${activeBookings.length} bookings`}
                </button>
                {expandedList && (
                  <div className="space-y-2 mt-2">
                    {activeBookings
                      .filter((b) => b.bookingId !== selectedBookingId)
                      .map((b) => (
                        <BookingListItem
                          key={b.bookingId}
                          booking={b}
                          isSelected={false}
                          onSelect={() => {
                            onSelectBooking?.(b.bookingId)
                            setExpandedList(false)
                          }}
                        />
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Main action area */}
        {currentBooking ? (
          <div className="p-5 space-y-4">
            {/* ETA input — only when about to go en route */}
            {currentStage === 'BOOKED' && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                <label className="text-xs text-blue-300 font-semibold mb-2 block">ETA to customer (minutes)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={etaInput}
                    onChange={(e) => setEtaInput(e.target.value)}
                    min={1}
                    max={240}
                    className="w-24 bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm text-center"
                  />
                  <span className="text-gray-400 text-sm">minutes</span>
                  {etaInput && (
                    <span className="text-blue-300 text-xs ml-auto">
                      ~{formatEta(parseInt(etaInput, 10) || 25)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Stage progress indicator */}
            <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-hide">
              {PIPELINE_STAGES.map((s, i) => (
                <div
                  key={s.stage}
                  className={`flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-all ${
                    i < stageIndex
                      ? 'bg-green-500/20 text-green-400'
                      : i === stageIndex
                      ? 'bg-yellow-400/20 text-yellow-300 ring-1 ring-yellow-400/40'
                      : 'text-gray-700'
                  }`}
                >
                  <span>{s.icon}</span>
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
              ))}
            </div>

            {/* Quick action buttons */}
            {visibleActions.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {visibleActions.map((qa) => {
                  const isLoading = loading === qa.action
                  const isDisabled = loading !== null && !isLoading

                  return (
                    <button
                      key={qa.action}
                      disabled={isDisabled}
                      onClick={() => {
                        if (qa.requiresInput) {
                          setActiveModal(qa.action)
                        } else {
                          handleAction(qa.action)
                        }
                      }}
                      className={`${qa.color} ${qa.hoverColor} ${qa.textColor} rounded-xl py-3 px-4 font-semibold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 ${
                        qa.action === 'MARK_EN_ROUTE' || qa.action === 'MARK_COMPLETE'
                          ? 'col-span-2'
                          : ''
                      }`}
                    >
                      {isLoading ? (
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        qa.icon
                      )}
                      {isLoading ? 'Sending...' : qa.label}
                      {qa.confirmLabel && !isLoading && (
                        <span className="opacity-60 text-xs font-normal hidden sm:inline">
                          · {qa.confirmLabel}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ) : currentStage === 'COMPLETE' ? (
              <div className="text-center py-6">
                <CheckCircle className="w-10 h-10 text-green-400 mx-auto mb-2" />
                <p className="text-green-400 font-semibold">Job Complete</p>
                <p className="text-gray-500 text-sm mt-1">Invoice sent · Review requested</p>
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-gray-500 text-sm">No actions available for current stage.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="px-5 py-10 text-center">
            <User className="w-10 h-10 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Select a booking to take action</p>
          </div>
        )}

        {/* Feedback toast */}
        {feedbackMsg && (
          <div className="mx-4 mb-4 bg-gray-700 border border-gray-600 rounded-xl px-4 py-3 text-sm text-white text-center transition-all">
            {feedbackMsg}
          </div>
        )}
      </div>
    </>
  )
}

export default TechActionBar
