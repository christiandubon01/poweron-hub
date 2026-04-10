/**
 * SPARK Pattern Engine
 * 
 * Analyzes conversation patterns across all interactions stored in ECHO.
 * Detects what works, what doesn't, and surfaces insights Christian can't see.
 * 
 * Pattern Categories:
 * - OPENING EFFECTIVENESS: which opener leads to conversations > 2 minutes?
 * - OBJECTION RESPONSE EFFECTIVENESS: which response to objections converts?
 * - PRICING PATTERNS: first quote vs floor rate, discount frequency
 * - TIME-OF-DAY PATTERNS: best cold call windows, engagement quality
 * - CONVERSION FUNNEL: calls → conversations → visits → closed jobs
 * - EMOTIONAL PATTERNS: when does ego get triggered? Friday fatigue?
 */

export interface ConversationLog {
  id: string
  date: string
  opener: string
  durationSeconds: number
  clientType: 'GC' | 'PM' | 'Homeowner' | 'Other'
  objectionRaised: string | null
  responseToObjection: string | null
  priceQuoted: number | null
  floorRate: number | null
  outcome: 'scheduled' | 'rejected' | 'pending' | 'other'
  notes: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface PatternInsight {
  category: string
  finding: string
  metric: string | number
  comparative?: string
  confidence: number // 0.0 - 1.0
}

export interface WeeklyInsightReport {
  weekEnding: string
  conversationCount: number
  topWorking: PatternInsight[]
  topIssues: PatternInsight[]
  missedOpportunity: string
  nextWeekFocus: string
  actionable: ActionItem[]
}

export interface ActionItem {
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  estimatedImpact: string
}

export interface ConversionFunnelMetrics {
  totalCalls: number
  conversationsOverOneMin: number
  conversationsOverTwoMin: number
  scheduledVisits: number
  closedJobs: number
  conversionRate: number // scheduled / conversations > 2min
  conversionByClientType: Record<string, number>
}

// ──────────────────────────────────────────────────────────────────────────────

const SPARK_INSIGHTS_KEY = 'spark_insights'
const SPARK_PATTERNS_KEY = 'spark_conversation_logs'
const MIN_CONVERSATIONS_FOR_ANALYSIS = 10

// ──────────────────────────────────────────────────────────────────────────────

/**
 * Load all conversation logs from ECHO memory and localStorage.
 * Returns the accumulated list of ConversationLog objects.
 */
export function loadConversationLogs(): ConversationLog[] {
  try {
    const raw = localStorage.getItem(SPARK_PATTERNS_KEY)
    if (!raw) return []
    return JSON.parse(raw) as ConversationLog[]
  } catch (err) {
    console.error('[SPARK Pattern] Failed to load conversation logs:', err)
    return []
  }
}

/**
 * Save conversation logs to localStorage.
 */
export function saveConversationLogs(logs: ConversationLog[]): void {
  try {
    localStorage.setItem(SPARK_PATTERNS_KEY, JSON.stringify(logs))
  } catch (err) {
    console.error('[SPARK Pattern] Failed to save conversation logs:', err)
  }
}

/**
 * Add a new conversation log and trigger analysis if threshold reached.
 */
export function addConversationLog(log: ConversationLog): void {
  const logs = loadConversationLogs()
  logs.push(log)
  saveConversationLogs(logs)

  // Trigger analysis every 10 conversations
  if (logs.length > 0 && logs.length % 10 === 0) {
    analyzePatterns(logs)
  }
}

/**
 * OPENING EFFECTIVENESS ANALYSIS
 * Which openers lead to conversations lasting > 2 minutes?
 * Which opener gets shut down in < 30 seconds?
 */
export function analyzeOpeningEffectiveness(
  logs: ConversationLog[]
): PatternInsight[] {
  const insights: PatternInsight[] = []

  if (logs.length < MIN_CONVERSATIONS_FOR_ANALYSIS) {
    return insights
  }

  // Group by opener
  const openerStats: Record<string, { count: number; over2min: number; avg: number }> = {}

  logs.forEach((log) => {
    if (!openerStats[log.opener]) {
      openerStats[log.opener] = { count: 0, over2min: 0, avg: 0 }
    }
    openerStats[log.opener].count++
    openerStats[log.opener].avg += log.durationSeconds
    if (log.durationSeconds > 120) {
      openerStats[log.opener].over2min++
    }
  })

  // Normalize averages
  Object.keys(openerStats).forEach((key) => {
    openerStats[key].avg = openerStats[key].avg / openerStats[key].count
  })

  // Find best and worst
  const sorted = Object.entries(openerStats).sort(
    (a, b) => b[1].over2min / b[1].count - a[1].over2min / a[1].count
  )

  if (sorted.length > 0) {
    const best = sorted[0]
    const worst = sorted[sorted.length - 1]

    const bestConversion = (best[1].over2min / best[1].count) * 100
    const worstConversion = (worst[1].over2min / worst[1].count) * 100

    insights.push({
      category: 'Opening Effectiveness',
      finding: `Your "${best[0]}" opener converts ${bestConversion.toFixed(1)}% to 2+ min conversations`,
      metric: `${bestConversion.toFixed(1)}%`,
      comparative: `vs ${worst[0]}: ${worstConversion.toFixed(1)}%`,
      confidence: Math.min(1.0, best[1].count / 20),
    })
  }

  return insights
}

/**
 * OBJECTION RESPONSE EFFECTIVENESS
 * When they say "we have a guy" — which response leads to continued conversation?
 */
export function analyzeObjectionResponses(logs: ConversationLog[]): PatternInsight[] {
  const insights: PatternInsight[] = []

  if (logs.length < MIN_CONVERSATIONS_FOR_ANALYSIS) {
    return insights
  }

  // Group by objection and response
  const responseStats: Record<string, { count: number; continued: number }> = {}

  logs
    .filter((log) => log.objectionRaised && log.responseToObjection)
    .forEach((log) => {
      const key = `${log.objectionRaised} → ${log.responseToObjection}`
      if (!responseStats[key]) {
        responseStats[key] = { count: 0, continued: 0 }
      }
      responseStats[key].count++
      if (log.outcome === 'scheduled' || log.outcome === 'pending') {
        responseStats[key].continued++
      }
    })

  const sorted = Object.entries(responseStats).sort(
    (a, b) => b[1].continued / b[1].count - a[1].continued / a[1].count
  )

  if (sorted.length > 0) {
    const best = sorted[0]
    const conversionRate = (best[1].continued / best[1].count) * 100

    insights.push({
      category: 'Objection Response',
      finding: `Your "${best[0]}" response converts ${conversionRate.toFixed(1)}% of objections`,
      metric: `${conversionRate.toFixed(1)}%`,
      confidence: Math.min(1.0, best[1].count / 15),
    })
  }

  return insights
}

/**
 * PRICING PATTERNS
 * Average first-quoted rate vs floor rate
 * How often do you discount below floor?
 * Which client types negotiate hardest?
 */
export function analyzePricingPatterns(logs: ConversationLog[]): PatternInsight[] {
  const insights: PatternInsight[] = []

  if (logs.length < MIN_CONVERSATIONS_FOR_ANALYSIS) {
    return insights
  }

  const withPricing = logs.filter((log) => log.priceQuoted !== null && log.floorRate !== null)

  if (withPricing.length === 0) return insights

  let discountCount = 0
  let averageQuote = 0
  let averageFloor = 0
  const clientTypeDiscounts: Record<string, { total: number; discounted: number }> = {}

  withPricing.forEach((log) => {
    const quote = log.priceQuoted || 0
    const floor = log.floorRate || 0

    averageQuote += quote
    averageFloor += floor

    if (quote < floor) {
      discountCount++
    }

    if (!clientTypeDiscounts[log.clientType]) {
      clientTypeDiscounts[log.clientType] = { total: 0, discounted: 0 }
    }
    clientTypeDiscounts[log.clientType].total++
    if (quote < floor) {
      clientTypeDiscounts[log.clientType].discounted++
    }
  })

  averageQuote /= withPricing.length
  averageFloor /= withPricing.length

  const discountRate = (discountCount / withPricing.length) * 100

  insights.push({
    category: 'Pricing Patterns',
    finding: `You discount ${discountRate.toFixed(1)}% of quotes below floor rate`,
    metric: `${discountRate.toFixed(1)}%`,
    confidence: Math.min(1.0, withPricing.length / 30),
  })

  // Find hardest negotiators
  const hardestType = Object.entries(clientTypeDiscounts).reduce((prev, current) =>
    (current[1].discounted / current[1].total) * 100 >
    (prev[1].discounted / prev[1].total) * 100
      ? current
      : prev
  )

  if (hardestType) {
    const hardestRate = (hardestType[1].discounted / hardestType[1].total) * 100
    insights.push({
      category: 'Client Negotiation',
      finding: `${hardestType[0]}s negotiate hardest: ${hardestRate.toFixed(1)}% discount rate`,
      metric: `${hardestRate.toFixed(1)}%`,
      confidence: Math.min(1.0, hardestType[1].total / 20),
    })
  }

  return insights
}

/**
 * TIME-OF-DAY PATTERNS
 * Best time to cold call (highest answer rate, best conversation quality)
 */
export function analyzeTimeOfDayPatterns(logs: ConversationLog[]): PatternInsight[] {
  const insights: PatternInsight[] = []

  if (logs.length < MIN_CONVERSATIONS_FOR_ANALYSIS) {
    return insights
  }

  // Extract hour from timestamp
  const hourStats: Record<number, { count: number; over2min: number; avg: number }> = {}

  logs.forEach((log) => {
    const date = new Date(log.timestamp)
    const hour = date.getHours()

    if (!hourStats[hour]) {
      hourStats[hour] = { count: 0, over2min: 0, avg: 0 }
    }
    hourStats[hour].count++
    hourStats[hour].avg += log.durationSeconds
    if (log.durationSeconds > 120) {
      hourStats[hour].over2min++
    }
  })

  // Normalize
  Object.keys(hourStats).forEach((key) => {
    const hourNum = parseInt(key, 10)
    hourStats[hourNum].avg = hourStats[hourNum].avg / hourStats[hourNum].count
  })

  // Find golden window
  const sorted = Object.entries(hourStats)
    .map(([hour, stats]) => ({
      hour: parseInt(hour, 10),
      ...stats,
      conversionRate: stats.over2min / stats.count,
    }))
    .sort((a, b) => b.conversionRate - a.conversionRate)

  if (sorted.length > 0) {
    const best = sorted[0]
    const goldenStart = best.hour
    const goldenEnd = best.hour + 2 // 2-hour window

    const goldenRate = (best.conversionRate * 100).toFixed(1)

    insights.push({
      category: 'Time-of-Day Pattern',
      finding: `Your golden window: ${goldenStart}am-${goldenEnd}am — ${goldenRate}% engagement rate`,
      metric: `${goldenRate}%`,
      confidence: Math.min(1.0, best.count / 25),
    })
  }

  return insights
}

/**
 * CONVERSION FUNNEL
 * Total calls → conversations > 1 min → scheduled visits → closed jobs
 */
export function analyzeConversionFunnel(logs: ConversationLog[]): ConversionFunnelMetrics {
  const totalCalls = logs.length
  const conversationsOver1Min = logs.filter((log) => log.durationSeconds > 60).length
  const conversationsOver2Min = logs.filter((log) => log.durationSeconds > 120).length
  const scheduledVisits = logs.filter((log) => log.outcome === 'scheduled').length

  // Assuming closed jobs are tracked elsewhere; for now, estimate from scheduled
  const closedJobs = Math.floor(scheduledVisits * 0.6) // Assume 60% of scheduled become closed

  const clientTypeStats: Record<string, number> = {}
  logs.forEach((log) => {
    if (!clientTypeStats[log.clientType]) {
      clientTypeStats[log.clientType] = 0
    }
    if (log.outcome === 'scheduled') {
      clientTypeStats[log.clientType]++
    }
  })

  const conversionByClientType: Record<string, number> = {}
  logs.forEach((log) => {
    const typeConversions = logs.filter(
      (l) => l.clientType === log.clientType && l.outcome === 'scheduled'
    ).length
    const typeTotal = logs.filter((l) => l.clientType === log.clientType).length
    conversionByClientType[log.clientType] = typeTotal > 0 ? typeConversions / typeTotal : 0
  })

  return {
    totalCalls,
    conversationsOverOneMin: conversationsOver1Min,
    conversationsOverTwoMin: conversationsOver2Min,
    scheduledVisits,
    closedJobs,
    conversionRate:
      conversationsOver2Min > 0 ? scheduledVisits / conversationsOver2Min : 0,
    conversionByClientType,
  }
}

/**
 * EMOTIONAL PATTERNS
 * When does ego get triggered? (time of day, client type, conversation topic)
 * How often do you discount on Fridays vs other days?
 */
export function analyzeEmotionalPatterns(logs: ConversationLog[]): PatternInsight[] {
  const insights: PatternInsight[] = []

  if (logs.length < MIN_CONVERSATIONS_FOR_ANALYSIS) {
    return insights
  }

  // Friday discounts vs other days
  const dayStats: Record<number, { total: number; discounts: number }> = {
    0: { total: 0, discounts: 0 }, // Sunday
    1: { total: 0, discounts: 0 }, // Monday
    2: { total: 0, discounts: 0 }, // Tuesday
    3: { total: 0, discounts: 0 }, // Wednesday
    4: { total: 0, discounts: 0 }, // Thursday
    5: { total: 0, discounts: 0 }, // Friday
    6: { total: 0, discounts: 0 }, // Saturday
  }

  logs
    .filter((log) => log.priceQuoted && log.floorRate)
    .forEach((log) => {
      const date = new Date(log.timestamp)
      const dayOfWeek = date.getDay()

      dayStats[dayOfWeek].total++
      if ((log.priceQuoted || 0) < (log.floorRate || 0)) {
        dayStats[dayOfWeek].discounts++
      }
    })

  const fridayRate = dayStats[5].total > 0 ? dayStats[5].discounts / dayStats[5].total : 0
  const weekdayAvg =
    (dayStats[1].discounts + dayStats[2].discounts + dayStats[3].discounts + dayStats[4].discounts) /
    (dayStats[1].total + dayStats[2].total + dayStats[3].total + dayStats[4].total || 1)

  if (fridayRate > weekdayAvg * 1.5) {
    insights.push({
      category: 'Emotional Pattern',
      finding: `You discount ${(fridayRate * 100).toFixed(1)}% on Fridays vs ${(weekdayAvg * 100).toFixed(1)}% weekdays — Friday fatigue detected`,
      metric: `${(fridayRate * 100).toFixed(1)}%`,
      confidence: Math.min(1.0, dayStats[5].total / 15),
    })
  }

  return insights
}

/**
 * ANALYZE ALL PATTERNS
 * Main entry point that runs all analyses and stores results.
 */
export function analyzePatterns(logs?: ConversationLog[]): WeeklyInsightReport | null {
  const allLogs = logs || loadConversationLogs()

  if (allLogs.length < MIN_CONVERSATIONS_FOR_ANALYSIS) {
    return null
  }

  const openingInsights = analyzeOpeningEffectiveness(allLogs)
  const objectionInsights = analyzeObjectionResponses(allLogs)
  const pricingInsights = analyzePricingPatterns(allLogs)
  const timeInsights = analyzeTimeOfDayPatterns(allLogs)
  const emotionalInsights = analyzeEmotionalPatterns(allLogs)
  const funnel = analyzeConversionFunnel(allLogs)

  const allInsights = [
    ...openingInsights,
    ...objectionInsights,
    ...pricingInsights,
    ...timeInsights,
    ...emotionalInsights,
  ]

  // Sort by confidence
  const sorted = allInsights.sort((a, b) => b.confidence - a.confidence)

  // Top 3 working + top 3 issues (simplified for MVP)
  const topWorking = sorted.slice(0, 3)
  const topIssues = sorted.slice(3, 6)

  // Missed opportunity
  const missedOpportunity =
    topIssues.length > 0
      ? `Focus on fixing: ${topIssues[0].finding}`
      : 'Your conversions are well-balanced.'

  // Next week focus
  const nextWeekFocus =
    topWorking.length > 0
      ? `Double down on "${topWorking[0].finding}" — it's your highest-converting pattern.`
      : 'Start tracking opening effectiveness to identify your best conversations.'

  const actionable: ActionItem[] = []

  // Build actionable items from patterns
  if (topIssues.find((i) => i.category === 'Pricing Patterns')) {
    actionable.push({
      title: 'Stop discounting before they ask',
      description: 'Practice leading with full rate on first quote. Document all asks.',
      priority: 'high',
      estimatedImpact: '10-15% margin improvement',
    })
  }

  if (topIssues.find((i) => i.category === 'Emotional Pattern')) {
    actionable.push({
      title: 'Friday off-the-clock rule',
      description: 'No pricing decisions after 3pm Friday. Save negotiations for Monday.',
      priority: 'medium',
      estimatedImpact: '5-8% fatigue-driven discount reduction',
    })
  }

  if (topWorking.find((i) => i.category === 'Opening Effectiveness')) {
    actionable.push({
      title: 'Replicate best opener',
      description: 'Use your highest-converting opener on all calls this week.',
      priority: 'high',
      estimatedImpact: '20-30% call quality improvement',
    })
  }

  const report: WeeklyInsightReport = {
    weekEnding: new Date().toISOString().split('T')[0],
    conversationCount: allLogs.length,
    topWorking,
    topIssues,
    missedOpportunity,
    nextWeekFocus,
    actionable,
  }

  saveInsightReport(report)
  return report
}

/**
 * Save insight report to localStorage (and optionally Supabase).
 */
export function saveInsightReport(report: WeeklyInsightReport): void {
  try {
    const reports = loadInsightReports()
    reports.push(report)
    // Keep only last 52 weeks
    if (reports.length > 52) {
      reports.shift()
    }
    localStorage.setItem(SPARK_INSIGHTS_KEY, JSON.stringify(reports))
  } catch (err) {
    console.error('[SPARK Pattern] Failed to save insight report:', err)
  }
}

/**
 * Load all insight reports from localStorage.
 */
export function loadInsightReports(): WeeklyInsightReport[] {
  try {
    const raw = localStorage.getItem(SPARK_INSIGHTS_KEY)
    if (!raw) return []
    return JSON.parse(raw) as WeeklyInsightReport[]
  } catch (err) {
    console.error('[SPARK Pattern] Failed to load insight reports:', err)
    return []
  }
}

/**
 * Get the latest insight report.
 */
export function getLatestInsightReport(): WeeklyInsightReport | null {
  const reports = loadInsightReports()
  return reports.length > 0 ? reports[reports.length - 1] : null
}

/**
 * Manually trigger pattern analysis (e.g., when user says "SPARK, show me patterns").
 */
export function triggerPatternAnalysis(): WeeklyInsightReport | null {
  const logs = loadConversationLogs()
  if (logs.length < MIN_CONVERSATIONS_FOR_ANALYSIS) {
    return null
  }
  return analyzePatterns(logs)
}

/**
 * Export all pattern data for external use or Supabase sync.
 */
export function exportPatternData(): {
  logs: ConversationLog[]
  reports: WeeklyInsightReport[]
} {
  return {
    logs: loadConversationLogs(),
    reports: loadInsightReports(),
  }
}

/**
 * Import pattern data from external source (Supabase or backup).
 */
export function importPatternData(data: {
  logs: ConversationLog[]
  reports: WeeklyInsightReport[]
}): void {
  saveConversationLogs(data.logs)
  data.reports.forEach((report) => saveInsightReport(report))
}
