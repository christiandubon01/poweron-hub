import React, { useEffect, useState, useCallback } from 'react'
import {
  CheckCircle,
  Clock,
  MapPin,
  MessageSquare,
  Phone,
  Shield,
  Star,
  Truck,
  User,
  Zap,
  AlertTriangle,
  ChevronRight,
  Send,
} from 'lucide-react'
import {
  type BookingRecord,
  type PipelineStage,
  type CommunicationEntry,
  PIPELINE_STAGES,
  buildMockBooking,
  fetchBookingByToken,
  pollBookingUpdates,
  getStageIndex,
  formatEta,
  etaToClockTime,
} from '../../services/portal/CustomerTrustPipeline'

// ── Props ──────────────────────────────────────────────────────────────────────

interface CustomerStatusPageProps {
  /** The unique booking token from the URL — e.g., from /status/[bookingId] */
  bookingId?: string
  /** Force demo mode for previewing in PowerOn Hub */
  demoMode?: boolean
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PowerOnLogo() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 bg-yellow-400 rounded-lg flex items-center justify-center">
        <Zap className="w-5 h-5 text-gray-900" />
      </div>
      <span className="text-lg font-bold text-white">Power On Solutions</span>
    </div>
  )
}

function StageProgressBar({ currentStage }: { currentStage: PipelineStage }) {
  const currentIndex = getStageIndex(currentStage)

  return (
    <div className="w-full">
      {/* Mobile: vertical list */}
      <div className="block sm:hidden space-y-2">
        {PIPELINE_STAGES.map((s, i) => {
          const isCompleted = i < currentIndex
          const isActive = i === currentIndex
          return (
            <div key={s.stage} className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 transition-all ${
                  isCompleted
                    ? 'bg-green-500 text-white'
                    : isActive
                    ? 'bg-yellow-400 text-gray-900 ring-2 ring-yellow-300 ring-offset-2 ring-offset-gray-900'
                    : 'bg-gray-700 text-gray-400'
                }`}
              >
                {isCompleted ? <CheckCircle className="w-4 h-4" /> : s.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-semibold truncate ${
                    isActive ? 'text-yellow-400' : isCompleted ? 'text-green-400' : 'text-gray-500'
                  }`}
                >
                  {s.label}
                </p>
                {isActive && (
                  <p className="text-xs text-gray-400 mt-0.5">{s.description}</p>
                )}
              </div>
              {isActive && (
                <span className="text-xs bg-yellow-400 text-gray-900 px-2 py-0.5 rounded-full font-bold">
                  NOW
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Desktop: horizontal progress bar */}
      <div className="hidden sm:block">
        <div className="flex items-center justify-between relative">
          {/* Connector line */}
          <div className="absolute top-4 left-4 right-4 h-0.5 bg-gray-700 z-0" />
          <div
            className="absolute top-4 left-4 h-0.5 bg-green-500 z-0 transition-all duration-700"
            style={{
              width: currentIndex === 0 ? '0%' : `${(currentIndex / (PIPELINE_STAGES.length - 1)) * 100}%`,
            }}
          />

          {PIPELINE_STAGES.map((s, i) => {
            const isCompleted = i < currentIndex
            const isActive = i === currentIndex
            return (
              <div key={s.stage} className="flex flex-col items-center z-10" style={{ width: '14.28%' }}>
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                    isCompleted
                      ? 'bg-green-500 text-white'
                      : isActive
                      ? 'bg-yellow-400 text-gray-900 ring-4 ring-yellow-400/30'
                      : 'bg-gray-700 text-gray-500'
                  }`}
                >
                  {isCompleted ? <CheckCircle className="w-4 h-4" /> : <span>{s.icon}</span>}
                </div>
                <p
                  className={`text-xs mt-2 text-center font-medium leading-tight ${
                    isActive ? 'text-yellow-400' : isCompleted ? 'text-green-400' : 'text-gray-600'
                  }`}
                >
                  {s.label}
                </p>
              </div>
            )
          })}
        </div>

        {/* Current stage description */}
        {(() => {
          const activeStage = PIPELINE_STAGES[currentIndex]
          return activeStage ? (
            <div className="mt-4 text-center">
              <p className="text-gray-300 text-sm">{activeStage.description}</p>
            </div>
          ) : null
        })()}
      </div>
    </div>
  )
}

function EtaCard({ booking }: { booking: BookingRecord }) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)

  useEffect(() => {
    if (!booking.etaTimestamp) return

    const compute = () => {
      const diff = Math.max(0, Math.floor((new Date(booking.etaTimestamp!).getTime() - Date.now()) / 1000))
      setSecondsLeft(diff)
    }

    compute()
    const t = setInterval(compute, 1000)
    return () => clearInterval(t)
  }, [booking.etaTimestamp])

  if (booking.currentStage !== 'EN_ROUTE' && booking.currentStage !== 'ARRIVING') return null

  const minsLeft = secondsLeft !== null ? Math.ceil(secondsLeft / 60) : booking.etaMinutes ?? null
  const clockTime = booking.etaTimestamp ? etaToClockTime(
    Math.max(0, Math.ceil((new Date(booking.etaTimestamp).getTime() - Date.now()) / 60000))
  ) : null

  return (
    <div className="bg-gradient-to-r from-yellow-400/10 to-amber-400/10 border border-yellow-400/30 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Truck className="w-5 h-5 text-yellow-400" />
        <span className="text-yellow-400 font-semibold">Technician En Route</span>
      </div>
      <div className="flex items-end gap-4">
        <div>
          <p className="text-4xl font-bold text-white">
            {minsLeft !== null ? `${minsLeft}` : '--'}
            <span className="text-xl text-gray-400 ml-1">min</span>
          </p>
          {clockTime && (
            <p className="text-gray-400 text-sm mt-1">Arriving around {clockTime}</p>
          )}
        </div>
        {booking.approximateLocation && booking.locationSharingEnabled && (
          <div className="flex items-center gap-1.5 text-gray-400 text-sm ml-auto">
            <MapPin className="w-4 h-4 text-yellow-400/70" />
            <span>Near {booking.approximateLocation.neighborhood}, {booking.approximateLocation.city}</span>
          </div>
        )}
      </div>
      {secondsLeft !== null && secondsLeft < 60 && (
        <div className="mt-3 bg-green-500/20 border border-green-500/40 rounded-lg px-3 py-2">
          <p className="text-green-400 text-sm font-medium">🏠 Your technician is arriving now!</p>
        </div>
      )}
    </div>
  )
}

function TechCard({ booking }: { booking: BookingRecord }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
      <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-4">Your Technician</h3>
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center flex-shrink-0">
          {booking.techPhoto ? (
            <img
              src={booking.techPhoto}
              alt={booking.techName}
              className="w-14 h-14 rounded-full object-cover"
            />
          ) : (
            <User className="w-7 h-7 text-gray-900" />
          )}
        </div>
        <div>
          <p className="text-white font-semibold text-lg">{booking.techName}</p>
          <p className="text-gray-400 text-sm">Licensed Electrician</p>
          {booking.techLicense && (
            <div className="flex items-center gap-1.5 mt-1">
              <Shield className="w-3.5 h-3.5 text-green-400" />
              <span className="text-green-400 text-xs font-medium">License #{booking.techLicense}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AppointmentCard({ booking }: { booking: BookingRecord }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
      <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Appointment</h3>
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <Clock className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-white text-sm font-medium">{booking.scheduledDate}</p>
            <p className="text-gray-400 text-sm">{booking.scheduledTime}</p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <MapPin className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
          <p className="text-white text-sm">{booking.address}</p>
        </div>
      </div>
    </div>
  )
}

function CommunicationFeed({
  entries,
  onReply,
}: {
  entries: CommunicationEntry[]
  onReply: (msg: string) => void
}) {
  const [replyText, setReplyText] = useState('')
  const [showReply, setShowReply] = useState(false)
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    if (!replyText.trim()) return
    setSending(true)
    await onReply(replyText.trim())
    setReplyText('')
    setShowReply(false)
    setSending(false)
  }

  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Updates & Messages</h3>
        <button
          onClick={() => setShowReply(!showReply)}
          className="flex items-center gap-1.5 text-xs text-yellow-400 hover:text-yellow-300 transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Reply
        </button>
      </div>

      {sorted.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-4">No messages yet.</p>
      )}

      <div className="space-y-3 max-h-72 overflow-y-auto">
        {sorted.map((entry) => (
          <div
            key={entry.id}
            className={`flex ${entry.direction === 'inbound' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-4 py-2.5 ${
                entry.direction === 'inbound'
                  ? 'bg-yellow-400/20 border border-yellow-400/30'
                  : entry.isIssueFlag
                  ? 'bg-amber-500/20 border border-amber-500/30'
                  : 'bg-gray-700 border border-gray-600'
              }`}
            >
              {entry.isIssueFlag && (
                <div className="flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-amber-400 text-xs font-semibold">Update</span>
                </div>
              )}
              <p className="text-white text-sm leading-relaxed">{entry.body}</p>
              <p className="text-gray-500 text-xs mt-1">
                {new Date(entry.timestamp).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                })}
                {entry.direction === 'inbound' && ' · You'}
              </p>
            </div>
          </div>
        ))}
      </div>

      {showReply && (
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type a message to your technician..."
            className="flex-1 bg-gray-700 border border-gray-600 text-white placeholder-gray-500 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-yellow-400/50"
          />
          <button
            onClick={handleSend}
            disabled={!replyText.trim() || sending}
            className="bg-yellow-400 text-gray-900 rounded-lg px-4 py-2 font-semibold text-sm hover:bg-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            {sending ? '...' : 'Send'}
          </button>
        </div>
      )}
    </div>
  )
}

function CredentialsFooter() {
  return (
    <div className="border-t border-gray-800 py-8 mt-8">
      <div className="max-w-2xl mx-auto px-4 text-center space-y-3">
        <div className="flex items-center justify-center gap-2 mb-4">
          <PowerOnLogo />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-gray-500">
          <div className="flex items-center gap-1.5">
            <Shield className="w-4 h-4 text-green-400" />
            <span>C-10 Licensed Electrician</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle className="w-4 h-4 text-green-400" />
            <span>Fully Insured</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Star className="w-4 h-4 text-yellow-400" />
            <span>5-Star Rated</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-600">
          <a
            href="https://www.cslb.ca.gov"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-yellow-400 transition-colors"
          >
            Verify License at CSLB.ca.gov
          </a>
          <span>·</span>
          <a
            href="tel:+14089991234"
            className="hover:text-yellow-400 transition-colors flex items-center gap-1"
          >
            <Phone className="w-3 h-3" />
            (408) 999-1234
          </a>
          <span>·</span>
          <span>Power On Solutions, LLC · San Jose, CA</span>
        </div>
      </div>
    </div>
  )
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-10 h-10 bg-yellow-400 rounded-lg flex items-center justify-center mx-auto animate-pulse">
          <Zap className="w-6 h-6 text-gray-900" />
        </div>
        <p className="text-gray-400 text-sm">Loading your job status...</p>
      </div>
    </div>
  )
}

function NotFoundState() {
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="text-center space-y-4 max-w-sm">
        <div className="w-14 h-14 bg-gray-800 rounded-full flex items-center justify-center mx-auto">
          <AlertTriangle className="w-7 h-7 text-amber-400" />
        </div>
        <h2 className="text-white text-xl font-bold">Booking Not Found</h2>
        <p className="text-gray-400 text-sm leading-relaxed">
          We couldn't find a job matching this link. Please check your confirmation email or contact us directly.
        </p>
        <a
          href="tel:+14089991234"
          className="inline-flex items-center gap-2 bg-yellow-400 text-gray-900 px-6 py-3 rounded-xl font-semibold text-sm hover:bg-yellow-300 transition-colors mt-4"
        >
          <Phone className="w-4 h-4" />
          Call Power On Solutions
        </a>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function CustomerStatusPage({ bookingId, demoMode = false }: CustomerStatusPageProps) {
  const [booking, setBooking] = useState<BookingRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  // Load booking on mount
  useEffect(() => {
    let cleanup: (() => void) | undefined

    const init = async () => {
      setLoading(true)

      if (demoMode || !bookingId) {
        // Use mock data for demo / preview
        const mock = buildMockBooking(bookingId ?? 'demo-001')
        setBooking(mock)
        setLoading(false)
        return
      }

      // Try to fetch real booking
      const data = await fetchBookingByToken(bookingId)
      if (!data) {
        setNotFound(true)
        setLoading(false)
        return
      }

      setBooking(data)
      setLoading(false)

      // Start polling for live updates
      cleanup = pollBookingUpdates(bookingId, (updated) => {
        setBooking(updated)
        setLastUpdated(new Date())
      })
    }

    init()
    return () => cleanup?.()
  }, [bookingId, demoMode])

  const handleCustomerReply = useCallback(
    async (msg: string) => {
      if (!booking) return

      // In production: POST to netlify/functions/portal-status-update with action=CUSTOMER_REPLY
      // For now, optimistically add to local communication log
      const entry = {
        id: `msg-${Date.now()}`,
        bookingId: booking.bookingId,
        direction: 'inbound' as const,
        channel: 'sms' as const,
        body: msg,
        timestamp: new Date().toISOString(),
      }

      setBooking((prev) =>
        prev
          ? { ...prev, communicationLog: [...prev.communicationLog, entry] }
          : prev
      )

      try {
        await fetch('/.netlify/functions/portal-status-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: booking.bookingId,
            action: 'CUSTOMER_REPLY',
            message: msg,
            customerPhone: booking.customerPhone,
          }),
        })
      } catch {
        // Silently fail — message shown optimistically
      }
    },
    [booking]
  )

  if (loading) return <LoadingSkeleton />
  if (notFound) return <NotFoundState />
  if (!booking) return <NotFoundState />

  const isCompleted = booking.currentStage === 'COMPLETE'

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 sticky top-0 z-20 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <PowerOnLogo />
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span>Live</span>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Status banner */}
        <div
          className={`rounded-xl p-5 ${
            isCompleted
              ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30'
              : 'bg-gradient-to-r from-yellow-400/10 to-amber-400/10 border border-yellow-400/20'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-sm font-semibold text-gray-400">Job Status</h1>
            <span className="text-xs text-gray-600">
              Updated {lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
            </span>
          </div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl font-bold text-white">
              {PIPELINE_STAGES.find((s) => s.stage === booking.currentStage)?.label ?? booking.currentStage}
            </span>
            {isCompleted && <CheckCircle className="w-6 h-6 text-green-400" />}
          </div>

          <StageProgressBar currentStage={booking.currentStage} />
        </div>

        {/* ETA card — only when en route or arriving */}
        <EtaCard booking={booking} />

        {/* Tech info */}
        <TechCard booking={booking} />

        {/* Appointment details */}
        <AppointmentCard booking={booking} />

        {/* Communication feed */}
        <CommunicationFeed
          entries={booking.communicationLog}
          onReply={handleCustomerReply}
        />

        {/* Completion CTA */}
        {isCompleted && (
          <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl p-6 text-center space-y-4">
            <div className="text-4xl">🎉</div>
            <div>
              <h2 className="text-white font-bold text-lg">Job Complete!</h2>
              <p className="text-gray-400 text-sm mt-1">
                Thank you for choosing Power On Solutions. We hope everything is working perfectly.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <a
                href="https://g.page/r/poweronsolutions/review"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 bg-yellow-400 text-gray-900 px-5 py-3 rounded-xl font-semibold text-sm hover:bg-yellow-300 transition-colors"
              >
                <Star className="w-4 h-4" />
                Leave a Review
              </a>
              <a
                href="https://poweronsolutionsllc.com"
                className="inline-flex items-center justify-center gap-2 bg-gray-700 text-white px-5 py-3 rounded-xl font-semibold text-sm hover:bg-gray-600 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
                Book Again
              </a>
            </div>
          </div>
        )}

        {/* Stage history */}
        {booking.stageHistory.length > 0 && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
            <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Timeline</h3>
            <div className="space-y-2">
              {[...booking.stageHistory].reverse().map((entry, i) => {
                const stageInfo = PIPELINE_STAGES.find((s) => s.stage === entry.stage)
                return (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs">
                      {stageInfo?.icon ?? '•'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{stageInfo?.label ?? entry.stage}</p>
                      {entry.note && <p className="text-gray-500 text-xs">{entry.note}</p>}
                    </div>
                    <p className="text-gray-600 text-xs flex-shrink-0">
                      {new Date(entry.timestamp).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      })}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <CredentialsFooter />
    </div>
  )
}

export default CustomerStatusPage
