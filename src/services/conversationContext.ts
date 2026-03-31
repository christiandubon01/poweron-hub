// @ts-nocheck
/**
 * Conversation Context Service — V3 Session 2
 *
 * Analyzes voice journal transcripts for completeness before saving.
 * NEXUS uses this to ask clarifying questions when context is incomplete,
 * ensuring the voice journal stores complete pictures, not fragments.
 *
 * Additive only — no existing service modified.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContextFragment {
  topic: string
  known: Record<string, string>
  missing: string[]
  complete: boolean
}

// ── Topic detection ───────────────────────────────────────────────────────────

function detectTopic(transcript: string): string {
  const t = transcript.toLowerCase()
  if (/conduit|emt|wire|wiring|cable|romex|flex/.test(t)) return 'materials'
  if (/panel|circuit|breaker|load center|amp|subpanel/.test(t)) return 'electrical'
  if (/estimate|bid|quote|proposal|takeoff/.test(t)) return 'estimating'
  if (/schedule|dispatch|crew|job\s+start|mobilize/.test(t)) return 'scheduling'
  if (/material|order|buy|purchase|supply|supplier|vendor/.test(t)) return 'procurement'
  return 'general'
}

// ── Known value extraction ────────────────────────────────────────────────────

function extractKnownValues(transcript: string): Record<string, string> {
  const known: Record<string, string> = {}
  const t = transcript

  // Sizes — "1/2", "3/4", "1 inch", "half inch", "three quarter", etc.
  const sizeMatch = t.match(
    /\b(?:1\/2|3\/4|1["\s]?inch|half[- ]?inch|three[- ]?quarter[- ]?inch|\d+["\s]?inch|\d+mm|\d+\/\d+"?)\b/i
  )
  if (sizeMatch) known.size = sizeMatch[0].trim()

  // Quantities — "200 feet", "50 lf", "3 rolls", etc.
  const qtyMatch = t.match(
    /\b(\d+(?:\.\d+)?)\s*(feet|foot|ft|lf|linear\s*feet?|pieces?|pcs|units?|rolls?|sticks?|lengths?|sections?|boxes?)\b/i
  )
  if (qtyMatch) known.quantity = `${qtyMatch[1]} ${qtyMatch[2]}`

  // Locations — rooms, areas, structural zones
  const locMatch = t.match(
    /\b(main\s+hall(?:way)?|panel\s+room|mechanical\s+room|ceiling(?:\s+run)?|wall(?:\s+run)?|kitchen|bathroom|office|warehouse|suite\s+\w+|room\s+\w+|unit\s+\w+|building\s+\w+|floor\s+\w+)\b/i
  )
  if (locMatch) known.location = locMatch[0].trim()

  // Dates — weekday names, tomorrow, next week, relative dates
  const dateMatch = t.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|next\s+\w+|this\s+(?:week|monday|friday)|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i
  )
  if (dateMatch) known.date = dateMatch[0].trim()

  // Client / job — "TI job", "for the Sunset job", "Palm Springs project", etc.
  const clientMatch =
    t.match(/\bfor\s+(?:the\s+)?([A-Z][A-Za-z\s\-]+?)\s+(?:job|project|TI|tenant\s+improvement|account)\b/) ||
    t.match(/\b(TI|[A-Z]{2,})\s+job\b/) ||
    t.match(/\bon\s+(?:the\s+)?([A-Z][A-Za-z\s]+?)\s+(?:job|project)\b/)
  if (clientMatch) known.client = (clientMatch[1] || '').trim()

  return known
}

// ── Missing value detection ───────────────────────────────────────────────────

function detectMissing(topic: string, known: Record<string, string>): string[] {
  const missing: string[] = []

  switch (topic) {
    case 'materials':
    case 'electrical':
    case 'procurement':
      if (!known.size)     missing.push('size')
      if (!known.quantity) missing.push('quantity')
      if (!known.location) missing.push('location')
      break

    case 'estimating':
      if (!known.client) missing.push('client')
      if (!known.size && !known.quantity) missing.push('scope')
      break

    case 'scheduling':
      if (!known.date)   missing.push('date')
      if (!known.client) missing.push('client')
      break

    default:
      // 'general' — no mandatory fields; treat as complete
      break
  }

  return missing
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyze a voice transcript for topic completeness.
 * Returns a ContextFragment with known values, missing fields,
 * and whether the fragment is complete enough to save.
 */
export function analyzeCompleteness(transcript: string): ContextFragment {
  const topic = detectTopic(transcript)
  const known = extractKnownValues(transcript)
  const missing = detectMissing(topic, known)

  return {
    topic,
    known,
    missing,
    complete: missing.length === 0,
  }
}

/**
 * Generate a single clarifying question targeting the first missing value.
 */
export function generateClarifyingQuestion(fragment: ContextFragment): string {
  const first = fragment.missing[0]

  switch (first) {
    case 'size':     return 'What size — half inch or three quarter?'
    case 'quantity': return 'How many feet do you need?'
    case 'location': return 'Which room or area?'
    case 'date':     return 'When do you need this done?'
    case 'client':   return 'Which job is this for?'
    case 'crew':     return 'Who is handling this?'
    case 'duration': return 'How long will this take?'
    case 'scope':    return 'What is the scope — square footage or unit count?'
    default:         return 'Can you give me more details?'
  }
}

/**
 * Merge a follow-up answer into an existing ContextFragment.
 * Extracts new known values from the answer and updates missing fields.
 * If the answer is free text for the first missing field, capture it directly.
 */
export function mergeContext(existing: ContextFragment, answer: string): ContextFragment {
  // Extract structured values from the answer
  const newValues = extractKnownValues(answer)
  const merged = { ...existing.known, ...newValues }

  // Free-text fallback: if the answer doesn't match a known pattern,
  // assign it directly to the first missing field
  if (existing.missing.length > 0) {
    const first = existing.missing[0]
    const answerText = answer.trim()
    if (answerText.length > 1 && !merged[first]) {
      merged[first] = answerText
    }
  }

  // Re-compute missing fields with updated known values
  const finalMissing = detectMissing(existing.topic, merged)

  return {
    topic:    existing.topic,
    known:    merged,
    missing:  finalMissing,
    complete: finalMissing.length === 0,
  }
}
