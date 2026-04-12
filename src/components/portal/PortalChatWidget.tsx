// @ts-nocheck
/**
 * PortalChatWidget — AI scheduling chat bubble for the customer portal
 *
 * Renders a branded chat bubble (bottom-right corner) that opens a full
 * chat interface. Powers the AI scheduling assistant conversation.
 *
 * Features:
 *  - Floating chat bubble with unread indicator
 *  - Opens clean, professional, Power On branded chat panel
 *  - AI responses via Claude (claude-haiku-4-5 for speed) through PortalSchedulingAgent
 *  - Typing indicator while AI generates response
 *  - Chat history persists for the browser session (sessionStorage)
 *  - Collects: service type, urgency, preferred dates/times, address, contact info
 *  - Shows "Book Now" button when all info has been collected
 *  - Displays available time slots inline
 *  - Responsive: full-screen on mobile, panel on desktop
 *
 * Integration:
 *  - Calls PortalSchedulingAgent.getAIChatResponse() for AI chat
 *  - Calls PortalSchedulingAgent.getAvailableSlots() on open
 *  - Calls /.netlify/functions/portal-schedule for booking submission
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  MessageCircle,
  X,
  Send,
  Zap,
  Clock,
  CheckCircle,
  AlertCircle,
  ChevronDown,
} from 'lucide-react'
import {
  createNewSession,
  getAIChatResponse,
  getAvailableSlots,
  checkBookingReady,
  cleanAIResponse,
  formatSlotsForDisplay,
  type SchedulingSession,
  type AvailableSlot,
  type ChatMessage,
} from '@/services/portal/PortalSchedulingAgent'

// ── Session storage key ───────────────────────────────────────────────────────

const SESSION_KEY = 'poweron_scheduling_session'

function loadSession(): SchedulingSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveSession(session: SchedulingSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // sessionStorage unavailable — continue without persistence
  }
}

function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch { /* ignore */ }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface BookingFormData {
  name: string
  email: string
  phone: string
  address: string
  serviceType: string
  urgency: string
  selectedSlotIndex: number
}

type WidgetPhase =
  | 'chat'           // Normal chat flow
  | 'booking_form'   // Final form to confirm contact info
  | 'submitted'      // Booking submitted, awaiting approval
  | 'error'          // Submission error

// ── Sub-components ────────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 mb-3">
      <div className="w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0">
        <Zap className="w-4 h-4 text-slate-900" />
      </div>
      <div className="bg-slate-700 rounded-2xl rounded-bl-sm px-4 py-3">
        <div className="flex gap-1 items-center h-4">
          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isAssistant = message.role === 'assistant'
  const displayText = cleanAIResponse(message.content)

  if (isAssistant) {
    return (
      <div className="flex items-end gap-2 mb-3">
        <div className="w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0">
          <Zap className="w-4 h-4 text-slate-900" />
        </div>
        <div className="max-w-[80%] bg-slate-700 rounded-2xl rounded-bl-sm px-4 py-3">
          <p className="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap">{displayText}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-end mb-3">
      <div className="max-w-[80%] bg-amber-500 rounded-2xl rounded-br-sm px-4 py-3">
        <p className="text-sm text-slate-900 font-medium leading-relaxed">{message.content}</p>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export interface PortalChatWidgetProps {
  /** Override position (default: bottom-right) */
  position?: 'bottom-right' | 'bottom-left'
  /** Custom z-index (default: 9999) */
  zIndex?: number
}

export function PortalChatWidget({
  position = 'bottom-right',
  zIndex = 9999,
}: PortalChatWidgetProps) {
  // Widget state
  const [isOpen, setIsOpen] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)
  const [phase, setPhase] = useState<WidgetPhase>('chat')

  // Chat state
  const [session, setSession] = useState<SchedulingSession>(() => loadSession() || createNewSession())
  const [inputValue, setInputValue] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([])
  const [slotsLoaded, setSlotsLoaded] = useState(false)
  const [bookingReady, setBookingReady] = useState(false)
  const [confirmationNumber, setConfirmationNumber] = useState('')

  // Booking form state
  const [bookingForm, setBookingForm] = useState<BookingFormData>({
    name: '',
    email: '',
    phone: '',
    address: '',
    serviceType: '',
    urgency: 'medium',
    selectedSlotIndex: 0,
  })
  const [submitting, setSubmitting] = useState(false)

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const chatPanelRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session.messages, isTyping])

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Load available slots once on first open
  useEffect(() => {
    if (isOpen && !slotsLoaded) {
      setSlotsLoaded(true)
      getAvailableSlots().then((slots) => {
        setAvailableSlots(slots)
        setSession(prev => ({ ...prev, availableSlots: slots }))
      })
    }
  }, [isOpen, slotsLoaded])

  // Persist session to sessionStorage on every change
  useEffect(() => {
    saveSession(session)
  }, [session])

  // Show unread indicator after 3 seconds if chat hasn't been opened
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isOpen) setHasUnread(true)
    }, 3000)
    return () => clearTimeout(timer)
  }, [isOpen])

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleOpen = useCallback(() => {
    setIsOpen(true)
    setHasUnread(false)
  }, [])

  const handleClose = useCallback(() => {
    setIsOpen(false)
  }, [])

  const handleReset = useCallback(() => {
    clearSession()
    const fresh = createNewSession()
    setSession(fresh)
    setPhase('chat')
    setBookingReady(false)
    setConfirmationNumber('')
    setBookingForm({
      name: '',
      email: '',
      phone: '',
      address: '',
      serviceType: '',
      urgency: 'medium',
      selectedSlotIndex: 0,
    })
    setSlotsLoaded(false)
  }, [])

  const handleSendMessage = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || isTyping) return

    // Add user message
    const userMessage: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }

    const updatedSession: SchedulingSession = {
      ...session,
      messages: [...session.messages, userMessage],
      phase: 'collecting',
    }

    setSession(updatedSession)
    setInputValue('')
    setIsTyping(true)

    try {
      // Get AI response
      const aiText = await getAIChatResponse(updatedSession, availableSlots)
      const isReady = checkBookingReady(aiText)

      const aiMessage: ChatMessage = {
        role: 'assistant',
        content: aiText,
        timestamp: Date.now(),
      }

      const finalSession: SchedulingSession = {
        ...updatedSession,
        messages: [...updatedSession.messages, aiMessage],
        phase: isReady ? 'confirming' : 'collecting',
      }

      setSession(finalSession)

      if (isReady) {
        setBookingReady(true)
      }
    } catch (err) {
      console.error('[PortalChatWidget] handleSendMessage: AI error', err)
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: "I'm having a brief connection issue. Please try again or call us at (760) 555-0100.",
        timestamp: Date.now(),
      }
      setSession(prev => ({
        ...prev,
        messages: [...prev.messages, errorMessage],
      }))
    } finally {
      setIsTyping(false)
    }
  }, [inputValue, isTyping, session, availableSlots])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }, [handleSendMessage])

  const handleShowBookingForm = useCallback(() => {
    setPhase('booking_form')
  }, [])

  const handleSubmitBooking = useCallback(async () => {
    if (submitting) return
    if (!bookingForm.name || !bookingForm.email || !bookingForm.phone || !bookingForm.address) {
      alert('Please fill in all required fields.')
      return
    }

    setSubmitting(true)

    try {
      const selectedSlot = availableSlots[bookingForm.selectedSlotIndex] || availableSlots[0]

      const response = await fetch('/.netlify/functions/portal-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_booking',
          serviceType: bookingForm.serviceType || session.collectedData?.serviceType || 'electrical_service',
          urgency: bookingForm.urgency,
          selectedSlot,
          contact: {
            name: bookingForm.name,
            email: bookingForm.email,
            phone: bookingForm.phone,
            address: bookingForm.address,
          },
          notes: session.messages
            .filter(m => m.role === 'user')
            .map(m => m.content)
            .join(' | ')
            .slice(0, 500),
        }),
      })

      const result = await response.json()

      if (result.success && result.confirmationNumber) {
        setConfirmationNumber(result.confirmationNumber)
        setPhase('submitted')

        // Publish a final AI message about next steps
        const confirmMsg: ChatMessage = {
          role: 'assistant',
          content: `✅ Your booking request has been submitted! Confirmation #${result.confirmationNumber}. Christian will review it and you'll hear back within 1 business day. Check your email for details.`,
          timestamp: Date.now(),
        }
        setSession(prev => ({
          ...prev,
          messages: [...prev.messages, confirmMsg],
          phase: 'complete',
        }))
      } else {
        setPhase('error')
      }
    } catch (err) {
      console.error('[PortalChatWidget] handleSubmitBooking: Error', err)
      setPhase('error')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, bookingForm, availableSlots, session])

  // ── Positioning ──────────────────────────────────────────────────────────────

  const positionClass = position === 'bottom-left'
    ? 'bottom-6 left-6'
    : 'bottom-6 right-6'

  const panelPositionClass = position === 'bottom-left'
    ? 'bottom-20 left-0'
    : 'bottom-20 right-0'

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className={`fixed ${positionClass} flex flex-col items-end`}
      style={{ zIndex }}
      role="region"
      aria-label="Scheduling Assistant"
    >
      {/* Chat Panel */}
      {isOpen && (
        <div
          ref={chatPanelRef}
          className={`absolute ${panelPositionClass} w-[360px] sm:w-[400px] max-h-[600px] flex flex-col bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl overflow-hidden`}
          style={{ maxHeight: 'min(600px, calc(100vh - 100px))' }}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-3 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-slate-900/30 rounded-full flex items-center justify-center">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Power On Scheduling</p>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                  <p className="text-xs text-slate-800">AI Assistant Online</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {phase === 'chat' && session.messages.length > 2 && (
                <button
                  onClick={handleReset}
                  className="text-slate-800 hover:text-slate-900 text-xs px-2 py-1 rounded-lg hover:bg-amber-400 transition-colors"
                  title="Start over"
                >
                  Start Over
                </button>
              )}
              <button
                onClick={handleClose}
                className="text-slate-800 hover:text-slate-900 p-1 rounded-lg hover:bg-amber-400 transition-colors"
                aria-label="Close chat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Submitted Success State */}
          {phase === 'submitted' && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="w-8 h-8 text-green-400" />
              </div>
              <h3 className="text-lg font-bold text-slate-100 mb-2">Booking Requested!</h3>
              <p className="text-sm text-slate-400 mb-3">
                Confirmation <span className="font-mono font-bold text-amber-400">{confirmationNumber}</span>
              </p>
              <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                Christian will review your request and you'll hear back within 1 business day.
                Check your email for details.
              </p>
              <div className="w-full bg-slate-700 rounded-xl p-4 text-left">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Next Steps</p>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  1. Christian reviews and approves your slot<br />
                  2. You receive a confirmation email<br />
                  3. SMS reminders sent 24h and 2h before visit
                </p>
              </div>
              <button
                onClick={handleReset}
                className="mt-4 text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                Start a new request
              </button>
            </div>
          )}

          {/* Error State */}
          {phase === 'error' && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
                <AlertCircle className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="text-lg font-bold text-slate-100 mb-2">Submission Error</h3>
              <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                We couldn't submit your booking. Please try again or call us directly.
              </p>
              <a
                href="tel:7605550100"
                className="bg-amber-500 text-slate-900 font-bold text-sm px-6 py-3 rounded-xl hover:bg-amber-400 transition-colors"
              >
                Call (760) 555-0100
              </a>
              <button
                onClick={() => setPhase('booking_form')}
                className="mt-3 text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {/* Booking Confirmation Form */}
          {phase === 'booking_form' && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-4">
                <h3 className="text-base font-bold text-slate-100 mb-1">Confirm Your Booking</h3>
                <p className="text-xs text-slate-400">Fill in your contact info to submit the request.</p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Full Name *</label>
                  <input
                    type="text"
                    value={bookingForm.name}
                    onChange={e => setBookingForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="John Smith"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Email *</label>
                  <input
                    type="email"
                    value={bookingForm.email}
                    onChange={e => setBookingForm(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="john@example.com"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Phone *</label>
                  <input
                    type="tel"
                    value={bookingForm.phone}
                    onChange={e => setBookingForm(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="(760) 555-0100"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Property Address *</label>
                  <input
                    type="text"
                    value={bookingForm.address}
                    onChange={e => setBookingForm(prev => ({ ...prev, address: e.target.value }))}
                    placeholder="123 Main St, Desert Hot Springs, CA"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>

                {/* Slot Selection */}
                {availableSlots.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">Preferred Time *</label>
                    <div className="space-y-2">
                      {availableSlots.slice(0, 4).map((slot, idx) => (
                        <button
                          key={slot.date + slot.startTime}
                          onClick={() => setBookingForm(prev => ({ ...prev, selectedSlotIndex: idx }))}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors border ${
                            bookingForm.selectedSlotIndex === idx
                              ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                              : 'bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-500'
                          }`}
                        >
                          {slot.displayLabel}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Urgency */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Urgency</label>
                  <select
                    value={bookingForm.urgency}
                    onChange={e => setBookingForm(prev => ({ ...prev, urgency: e.target.value }))}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500 transition-colors"
                  >
                    <option value="low">Low — No rush, schedule at convenience</option>
                    <option value="medium">Medium — Within the next week</option>
                    <option value="high">High — Within 1–2 days</option>
                    <option value="emergency">Emergency — Today if possible</option>
                  </select>
                </div>

                <button
                  onClick={handleSubmitBooking}
                  disabled={submitting}
                  className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-slate-600 disabled:text-slate-400 text-slate-900 font-bold text-sm py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-900/40 border-t-slate-900 rounded-full animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Submit Booking Request
                    </>
                  )}
                </button>

                <button
                  onClick={() => setPhase('chat')}
                  className="w-full text-sm text-slate-500 hover:text-slate-300 py-2 transition-colors"
                >
                  ← Back to chat
                </button>
              </div>
            </div>
          )}

          {/* Chat Messages */}
          {phase === 'chat' && (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-1 min-h-0">
                {session.messages.map((msg, idx) => (
                  <MessageBubble key={`${msg.timestamp}-${idx}`} message={msg} />
                ))}
                {isTyping && <TypingIndicator />}
                <div ref={messagesEndRef} />
              </div>

              {/* Available Slots Display (shown when AI has responded but no booking ready yet) */}
              {availableSlots.length > 0 && !bookingReady && session.messages.length > 2 && (
                <div className="px-4 py-2 border-t border-slate-700 flex-shrink-0">
                  <p className="text-xs text-slate-500 mb-1.5 font-medium">Available slots:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {availableSlots.slice(0, 3).map((slot, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setInputValue(slot.displayLabel)
                          inputRef.current?.focus()
                        }}
                        className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded-lg transition-colors border border-slate-600"
                      >
                        {slot.dayLabel}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Book Now CTA */}
              {bookingReady && (
                <div className="px-4 py-3 border-t border-slate-700 flex-shrink-0">
                  <button
                    onClick={handleShowBookingForm}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold text-sm py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Book Now — Confirm Your Info
                  </button>
                </div>
              )}

              {/* Input Area */}
              <div className="px-4 py-3 border-t border-slate-700 flex items-center gap-2 flex-shrink-0">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your message..."
                  disabled={isTyping}
                  className="flex-1 bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors disabled:opacity-50"
                  aria-label="Chat message input"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() || isTyping}
                  className="w-10 h-10 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-600 disabled:text-slate-400 text-slate-900 rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
                  aria-label="Send message"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>

              {/* Trust footer */}
              <div className="px-4 py-2 border-t border-slate-700/50 flex-shrink-0">
                <p className="text-center text-xs text-slate-600">
                  Power On Solutions LLC · C-10 #1151468 · Coachella Valley, CA
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Chat Bubble Button */}
      <button
        onClick={isOpen ? handleClose : handleOpen}
        className="w-14 h-14 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-full shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center relative group"
        aria-label={isOpen ? 'Close scheduling chat' : 'Open scheduling chat'}
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <ChevronDown className="w-6 h-6" />
        ) : (
          <MessageCircle className="w-6 h-6" />
        )}

        {/* Unread indicator */}
        {!isOpen && hasUnread && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
            <span className="text-white text-xs font-bold">1</span>
          </span>
        )}

        {/* Tooltip (desktop only) */}
        {!isOpen && (
          <span className="absolute right-16 bg-slate-800 text-slate-100 text-xs font-medium px-3 py-1.5 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none border border-slate-600 shadow-lg">
            Schedule a visit
          </span>
        )}
      </button>
    </div>
  )
}

export default PortalChatWidget
