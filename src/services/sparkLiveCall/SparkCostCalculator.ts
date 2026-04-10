/**
 * SparkCostCalculator.ts
 * Real-time cost margin detection and counter-offer generation
 * 
 * Detects dollar amounts, hourly rates, and time commitments in live call transcripts.
 * Calculates real costs vs. quoted prices and generates margin alerts.
 * 
 * Scenarios:
 * - Rate quoted: "$65/hr x 8 hours free" → detects 3% margin, suggests counter-offers
 * - Free offer: "Free 8 hours of consultation" → calculates $504 cost, suggests alternatives
 * - Project price: "$2500 for 30 hours" → calculates $83/hr effective, warns if <25%
 */

// ── Types & Interfaces ───────────────────────────────────────────────────────

export interface CostDetection {
  type: 'rate' | 'free' | 'project'
  raw: string
  quotedRate?: number
  estimatedHours?: number
  projectPrice?: number
  detectedAt: Date
}

export interface CostCalculation {
  baseRate: number // $43/hr base labor
  truckCost: number // $8 truck
  overheadCost: number // $12 overhead (derived from settings)
  totalCostPerHour: number // $63/hr
  quotedRate?: number
  estimatedHours?: number
  projectPrice?: number
  effectiveRate?: number
  margin?: number
  marginPercent?: number
  breakeven: number
  floor: number // $85/hr from VAULT
  analysis: string
  severity: 'success' | 'warning' | 'emergency'
}

export interface CounterOffer {
  title: string
  description: string
  benefit: string
  risk: string
}

export interface CostAlert {
  id: string
  type: 'rate' | 'free-offer' | 'project-price'
  severity: 'success' | 'warning' | 'emergency'
  message: string
  calculation: CostCalculation
  counterOffers: CounterOffer[]
  createdAt: Date
  transcriptChunk: string
}

// ── Configuration ────────────────────────────────────────────────────────────

const COST_CONFIG = {
  baseLaborRate: 43, // $/hr base labor
  truckCost: 8, // $ per trip
  overheadCostPerHour: 12, // $ per hour
  floorRate: 85, // $/hr minimum from VAULT
  marginThreshold: 0.25, // 25% minimum margin
  minEffectiveRate: 75, // below this is risky
}

// ── Detection Patterns ───────────────────────────────────────────────────────

const DETECTION_PATTERNS = {
  // Matches "$XX" or "XX dollars"
  dollarAmount: /\$(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*dollars/gi,
  
  // Matches "XX per hour", "XX/hr", "XX an hour"
  hourlyRate: /(\d+(?:\.\d{1,2})?)\s*(?:per\s+hour|\/hr|an\s+hour)/gi,
  
  // Matches "XX hours", "XX hrs", "XX hour"
  timeCommitment: /(\d+(?:\.\d{1,2})?)\s*(?:hours?|hrs?)\s*(?:of\s+work)?/gi,
  
  // Matches "free", "no charge", "on the house", "trial"
  freeIndicators: /\b(?:free|no\s+charge|on\s+the\s+house|trial|complimentary|gratis|pro\s+bono)\b/gi,
}

// ── Utility Functions ────────────────────────────────────────────────────────

/**
 * Extract all dollar amounts from text
 */
export function extractDollarAmounts(text: string): number[] {
  const matches = text.matchAll(DETECTION_PATTERNS.dollarAmount)
  const amounts: number[] = []
  
  for (const match of matches) {
    const amount = parseFloat(match[1] || match[2])
    if (!isNaN(amount) && amount > 0) {
      amounts.push(amount)
    }
  }
  
  return [...new Set(amounts)].sort((a, b) => b - a) // dedupe & sort desc
}

/**
 * Extract hourly rates from text
 */
export function extractHourlyRates(text: string): number[] {
  const matches = text.matchAll(DETECTION_PATTERNS.hourlyRate)
  const rates: number[] = []
  
  for (const match of matches) {
    const rate = parseFloat(match[1])
    if (!isNaN(rate) && rate > 0 && rate < 10000) { // sanity check
      rates.push(rate)
    }
  }
  
  return [...new Set(rates)].sort((a, b) => b - a)
}

/**
 * Extract time commitments (hours) from text
 */
export function extractTimeCommitments(text: string): number[] {
  const matches = text.matchAll(DETECTION_PATTERNS.timeCommitment)
  const times: number[] = []
  
  for (const match of matches) {
    const time = parseFloat(match[1])
    if (!isNaN(time) && time > 0 && time < 1000) { // sanity check
      times.push(time)
    }
  }
  
  return [...new Set(times)].sort((a, b) => b - a)
}

/**
 * Detect if text contains free indicators
 */
export function detectFreeOffer(text: string): boolean {
  return DETECTION_PATTERNS.freeIndicators.test(text)
}

// ── Core Cost Calculation ────────────────────────────────────────────────────

/**
 * Calculate total cost per hour including overhead
 */
export function calculateCostPerHour(
  baseRate = COST_CONFIG.baseLaborRate,
  overhead = COST_CONFIG.overheadCostPerHour
): number {
  return baseRate + COST_CONFIG.truckCost + overhead
}

/**
 * Analyze a quoted hourly rate
 * SCENARIO A: Rate quoted ($65/hr x 8 hours free)
 */
export function analyzeRateQuote(
  quotedRate: number,
  estimatedHours: number
): CostCalculation {
  const costPerHour = calculateCostPerHour()
  const totalCost = costPerHour * estimatedHours
  const totalBilled = quotedRate * estimatedHours
  const margin = totalBilled - totalCost
  const marginPercent = (margin / totalBilled) * 100
  
  let severity: 'success' | 'warning' | 'emergency' = 'success'
  let analysis = `✓ Good margin (${marginPercent.toFixed(0)}%)`
  
  if (marginPercent < COST_CONFIG.marginThreshold * 100) {
    severity = 'emergency'
    analysis = `❌ EMERGENCY: ${marginPercent.toFixed(0)}% margin = $${margin.toFixed(0)} profit`
  } else if (marginPercent < 20) {
    severity = 'warning'
    analysis = `⚠️ WARNING: Low margin (${marginPercent.toFixed(0)}%)`
  }
  
  return {
    baseRate: COST_CONFIG.baseLaborRate,
    truckCost: COST_CONFIG.truckCost,
    overheadCost: COST_CONFIG.overheadCostPerHour,
    totalCostPerHour: costPerHour,
    quotedRate,
    estimatedHours,
    effectiveRate: quotedRate,
    margin,
    marginPercent,
    breakeven: costPerHour,
    floor: COST_CONFIG.floorRate,
    analysis,
    severity,
  }
}

/**
 * Analyze a free offer
 * SCENARIO B: Free offer detected ("free 8 hours = $504 out of pocket")
 */
export function analyzeFreeTOffer(estimatedHours: number): CostCalculation {
  const costPerHour = calculateCostPerHour()
  const totalCost = costPerHour * estimatedHours
  const margin = -totalCost // negative = loss
  const marginPercent = -100 // you lose 100% of cost
  
  const analysis = `🚨 EMERGENCY: Free ${estimatedHours} hours = $${totalCost.toFixed(0)} out of your pocket`
  
  return {
    baseRate: COST_CONFIG.baseLaborRate,
    truckCost: COST_CONFIG.truckCost,
    overheadCost: COST_CONFIG.overheadCostPerHour,
    totalCostPerHour: costPerHour,
    estimatedHours,
    margin,
    marginPercent,
    breakeven: costPerHour,
    floor: COST_CONFIG.floorRate,
    analysis,
    severity: 'emergency',
  }
}

/**
 * Analyze a project price quote
 * SCENARIO C: Project price quoted ("$2500 for 30 hours")
 */
export function analyzeProjectPrice(
  projectPrice: number,
  estimatedHours: number
): CostCalculation {
  const costPerHour = calculateCostPerHour()
  const totalCost = costPerHour * estimatedHours
  const effectiveRate = projectPrice / estimatedHours
  const margin = projectPrice - totalCost
  const marginPercent = (margin / projectPrice) * 100
  
  let severity: 'success' | 'warning' | 'emergency' = 'success'
  let analysis = `✓ Good deal at $${effectiveRate.toFixed(0)}/hr (${marginPercent.toFixed(0)}% margin)`
  
  if (marginPercent < COST_CONFIG.marginThreshold * 100) {
    severity = 'warning'
    analysis = `⚠️ WARNING: Below 25% floor. $${effectiveRate.toFixed(0)}/hr = ${marginPercent.toFixed(0)}% margin`
  }
  
  if (effectiveRate < COST_CONFIG.floorRate) {
    severity = 'emergency'
    analysis = `❌ EMERGENCY: $${effectiveRate.toFixed(0)}/hr is below $${COST_CONFIG.floorRate}/hr floor`
  }
  
  return {
    baseRate: COST_CONFIG.baseLaborRate,
    truckCost: COST_CONFIG.truckCost,
    overheadCost: COST_CONFIG.overheadCostPerHour,
    totalCostPerHour: costPerHour,
    projectPrice,
    estimatedHours,
    effectiveRate,
    margin,
    marginPercent,
    breakeven: costPerHour,
    floor: COST_CONFIG.floorRate,
    analysis,
    severity,
  }
}

// ── Counter-Offer Generation ─────────────────────────────────────────────────

/**
 * Generate counter-offer suggestions for a free offer
 */
export function generateFreeOfferCounters(hours: number): CounterOffer[] {
  const costPerHour = calculateCostPerHour()
  const partialHours = Math.ceil(hours / 2)
  const partialCost = costPerHour * partialHours
  const partialRevenue = partialHours * COST_CONFIG.floorRate
  const partialNet = partialRevenue - partialCost
  
  return [
    {
      title: `${partialHours} hours at $50/hr`,
      description: `Instead of free ${hours} hours, counter with paid ${partialHours} hours`,
      benefit: `You earn $${partialNet.toFixed(0)}, client commits to half the time`,
      risk: 'Still below optimal rate but reduces exposure by 50%',
    },
    {
      title: 'Full rate first 2 hours, free remaining if they commit to 3 jobs',
      description: 'Require commitment to future work before giving away time',
      benefit: 'Qualify the lead, earn $126 now, lock in 3 more jobs worth $15k+',
      risk: 'Client may decline if they\'re just testing your boundaries',
    },
    {
      title: 'No free time. Full rate $85+/hr.',
      description: 'This GC manages subs at full rates — he\'s testing if you budge',
      benefit: 'Establish your value and pricing, protect margin on all jobs',
      risk: 'May lose this job, but maintains pricing integrity with their other subs',
    },
  ]
}

/**
 * Generate counter-offer suggestions for a low rate quote
 */
export function generateRateLowCounters(
  quotedRate: number,
  estimatedHours: number,
  marginPercent: number
): CounterOffer[] {
  const costPerHour = calculateCostPerHour()
  const shortage = COST_CONFIG.floorRate - quotedRate
  const countRate = COST_CONFIG.floorRate
  const difference = COST_CONFIG.floorRate - quotedRate
  
  return [
    {
      title: `Counter at $${countRate}/hr (standard rate)`,
      description: `This is our standard rate and covers all costs plus margin`,
      benefit: `Improves margin from ${marginPercent.toFixed(0)}% to 30%, adds $${(difference * estimatedHours).toFixed(0)} revenue`,
      risk: 'Client may shop around or negotiate further',
    },
    {
      title: `Accept at $${quotedRate}/hr for max 4 hours (partial job)`,
      description: `Limit exposure if they insist on low rate`,
      benefit: 'Total cost = $252, you lose $56 on this part but cap the damage',
      risk: 'Client may expect full job at that rate later',
    },
    {
      title: `Require deposit of 50% to proceed at $${quotedRate}/hr`,
      description: 'Reduce cash flow risk if you must accept the rate',
      benefit: 'De-risks payment issues and shows you take it seriously',
      risk: 'Client may see deposit requirement as red flag',
    },
  ]
}

/**
 * Generate counter-offer suggestions for a project price quote
 */
export function generateProjectCounters(
  projectPrice: number,
  estimatedHours: number,
  effectiveRate: number
): CounterOffer[] {
  const costPerHour = calculateCostPerHour()
  const shortage = COST_CONFIG.floorRate - effectiveRate
  const minPrice = costPerHour * estimatedHours * 1.3 // 30% margin target
  const minRate = COST_CONFIG.floorRate
  
  return [
    {
      title: `Counter at $${minPrice.toFixed(0)} ($${minRate}/hr × ${estimatedHours}h)`,
      description: 'Adjusted price for 30% margin (30% is electrical contractor industry standard)',
      benefit: `Adds $${(minPrice - projectPrice).toFixed(0)} to project, protects margin`,
      risk: 'Client may say no or ask for clarification on labor hours',
    },
    {
      title: `Revise scope: reduce hours or increase price`,
      description: 'Either tighten timeline (reduce labor) or increase budget',
      benefit: 'Preserves either margin or efficiency, client sees the trade-off',
      risk: 'Requires honest scoping conversation, client may resist',
    },
    {
      title: `Require 50% deposit at this price`,
      description: 'If you must accept low margin, de-risk with upfront cash',
      benefit: 'Covers your material costs and labor buffer, secures commitment',
      risk: 'May signal desperation or lack of confidence to client',
    },
  ]
}

// ── Main Detection & Alert Generation ────────────────────────────────────────

/**
 * Process a transcript chunk and detect cost-related mentions
 * Returns CostAlert if a mention is found, null otherwise
 */
export function detectAndAnalyzeTranscriptChunk(chunk: string): CostAlert | null {
  const timestamp = new Date()
  
  // Check for free offer first (highest priority)
  if (detectFreeOffer(chunk)) {
    const hours = extractTimeCommitments(chunk)
    const estimatedHours = hours.length > 0 ? hours[0] : 4 // default 4 hours if not specified
    const calculation = analyzeFreeTOffer(estimatedHours)
    const counterOffers = generateFreeOfferCounters(estimatedHours)
    
    return {
      id: `alert-free-${timestamp.getTime()}`,
      type: 'free-offer',
      severity: calculation.severity,
      message: calculation.analysis,
      calculation,
      counterOffers,
      createdAt: timestamp,
      transcriptChunk: chunk,
    }
  }
  
  // Check for hourly rate quote
  const rates = extractHourlyRates(chunk)
  const hours = extractTimeCommitments(chunk)
  
  if (rates.length > 0 && hours.length > 0) {
    const quotedRate = rates[0]
    const estimatedHours = hours[0]
    const calculation = analyzeRateQuote(quotedRate, estimatedHours)
    
    let counterOffers: CounterOffer[] = []
    if (calculation.marginPercent && calculation.marginPercent < 25) {
      counterOffers = generateRateLowCounters(quotedRate, estimatedHours, calculation.marginPercent)
    }
    
    return {
      id: `alert-rate-${timestamp.getTime()}`,
      type: 'rate',
      severity: calculation.severity,
      message: calculation.analysis,
      calculation,
      counterOffers,
      createdAt: timestamp,
      transcriptChunk: chunk,
    }
  }
  
  // Check for project price quote
  const amounts = extractDollarAmounts(chunk)
  if (amounts.length > 0 && hours.length > 0) {
    const projectPrice = amounts[0]
    const estimatedHours = hours[0]
    const calculation = analyzeProjectPrice(projectPrice, estimatedHours)
    
    let counterOffers: CounterOffer[] = []
    if (calculation.marginPercent && calculation.marginPercent < 25) {
      counterOffers = generateProjectCounters(projectPrice, estimatedHours, calculation.effectiveRate || 0)
    }
    
    return {
      id: `alert-project-${timestamp.getTime()}`,
      type: 'project-price',
      severity: calculation.severity,
      message: calculation.analysis,
      calculation,
      counterOffers,
      createdAt: timestamp,
      transcriptChunk: chunk,
    }
  }
  
  // No cost mention detected
  return null
}

/**
 * Format alert message for display (with haptic/audio cues)
 */
export function formatAlertMessage(alert: CostAlert): {
  title: string
  body: string
  hapticPattern: 'success' | 'warning' | 'error'
  audioTone: 'success' | 'warning' | 'error'
} {
  const severityMap = {
    success: { haptic: 'success' as const, audio: 'success' as const },
    warning: { haptic: 'warning' as const, audio: 'warning' as const },
    emergency: { haptic: 'error' as const, audio: 'error' as const },
  }
  
  const { haptic, audio } = severityMap[alert.severity]
  
  let title = 'Cost Alert'
  let body = alert.message
  
  if (alert.type === 'free-offer') {
    title = '🚨 FREE OFFER DETECTED'
  } else if (alert.type === 'rate') {
    title = alert.severity === 'emergency' ? '⚠️ MARGIN ALERT' : 'Rate Quote Detected'
  } else if (alert.type === 'project-price') {
    title = alert.severity === 'emergency' ? '🚨 LOW RATE ALERT' : 'Project Price Detected'
  }
  
  return { title, body, hapticPattern: haptic, audioTone: audio }
}

/**
 * Generate a summary card for visual display on phone
 */
export function generateCostCard(alert: CostAlert): {
  margin: string
  marginPercent: string
  floor: string
  counterOfferCount: number
  recommendation: string
} {
  const calc = alert.calculation
  const marginPercent = calc.marginPercent ? calc.marginPercent.toFixed(0) : 'N/A'
  const margin = calc.margin ? `$${Math.max(0, calc.margin).toFixed(0)}` : '$0'
  const floor = `$${calc.floor}/hr`
  
  let recommendation = ''
  if (alert.severity === 'emergency') {
    recommendation = '❌ Below floor. Counter with $85+/hr'
  } else if (alert.severity === 'warning') {
    recommendation = '⚠️ Low margin. Consider counter-offer'
  } else {
    recommendation = '✓ Acceptable margin'
  }
  
  return {
    margin,
    marginPercent,
    floor,
    counterOfferCount: alert.counterOffers.length,
    recommendation,
  }
}

// ── Logging & Storage ────────────────────────────────────────────────────────

/**
 * Log alert to SparkStore for debrief
 * (Mock implementation — wire to real SparkStore on integration)
 */
export function logAlertToStore(alert: CostAlert): void {
  // In production, this would write to SparkStore (Zustand or similar)
  const logEntry = {
    id: alert.id,
    type: alert.type,
    severity: alert.severity,
    message: alert.message,
    calculation: {
      quotedRate: alert.calculation.quotedRate,
      projectPrice: alert.calculation.projectPrice,
      estimatedHours: alert.calculation.estimatedHours,
      margin: alert.calculation.margin,
      marginPercent: alert.calculation.marginPercent,
    },
    createdAt: alert.createdAt.toISOString(),
  }
  
  console.log('[SparkCostCalculator] Alert logged:', logEntry)
  
  // TODO: Wire to SparkStore
  // sparkStore.addAlert(logEntry)
}

/**
 * Batch process multiple transcript chunks
 */
export function processTranscriptBatch(chunks: string[]): CostAlert[] {
  const alerts: CostAlert[] = []
  
  for (const chunk of chunks) {
    const alert = detectAndAnalyzeTranscriptChunk(chunk)
    if (alert) {
      alerts.push(alert)
      logAlertToStore(alert)
    }
  }
  
  return alerts
}


