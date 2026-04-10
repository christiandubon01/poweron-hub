/**
 * SPARK Perception Defense System
 * 
 * Detects when the other person is:
 * - Testing Christian's technical knowledge
 * - Judging based on age/appearance
 * - Trying to negotiate price before scope is established
 * 
 * Coaches redirect toward technical competence instead of price cuts.
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type AlertPriority = 'EMERGENCY' | 'WARNING' | 'INFO';

export interface DetectionResult {
  pattern: string;
  priority: AlertPriority;
  confidence: number; // 0.0 to 1.0
  text: string; // The specific text that triggered detection
  lineIndex: number;
  coachingMessage: string;
  suggestedRedirect: string;
  timestamp: string;
}

export interface PatternAnalysisReport {
  totalLines: number;
  detections: DetectionResult[];
  egoWarnings: DetectionResult[];
  emergencyAlerts: DetectionResult[];
  coachingSummary: string;
}

// ============================================================================
// PATTERN DEFINITIONS
// ============================================================================

const TESTING_PATTERNS = [
  {
    pattern: /So what (?:gauge wire|amperage|code section|wire size|breaker size|conduit size|material) would you use for/gi,
    label: 'Technical Quiz Question',
    confidence: 0.95,
  },
  {
    pattern: /How many amps does a/gi,
    label: 'Basic Knowledge Test',
    confidence: 0.90,
  },
  {
    pattern: /What code section covers|What does NEC|According to NEC/gi,
    label: 'NEC Compliance Test',
    confidence: 0.92,
  },
  {
    pattern: /Do you have (?:your own license|your license|a license|insurance|workers comp)/gi,
    label: 'Credibility Test',
    confidence: 0.88,
  },
  {
    pattern: /How long have you been doing this|How many years/gi,
    label: 'Age/Experience Probe',
    confidence: 0.85,
  },
];

const PRICE_SHOPPING_PATTERNS = [
  {
    pattern: /What's your rate|What do you charge|What's your price/gi,
    label: 'Rate Question (Too Early)',
    confidence: 0.98,
    precondition: 'before_scope',
  },
  {
    pattern: /The other (?:guy|contractor|electrician) charges|We usually pay/gi,
    label: 'Price Anchoring to Lower Bid',
    confidence: 0.92,
  },
  {
    pattern: /That seems high|Can you do better|Can you come down|That's more than/gi,
    label: 'Price Objection',
    confidence: 0.90,
  },
  {
    pattern: /We usually pay our subs|Our previous contractor|Last guy charged/gi,
    label: 'Competitive Pressure',
    confidence: 0.87,
  },
  {
    pattern: /Is that your final price|What's the best you can do|Can you negotiate/gi,
    label: 'Discount Fishing',
    confidence: 0.93,
  },
];

const BIAS_DISMISSAL_PATTERNS = [
  {
    pattern: /(?:That's|I don't think|Nah|That won't|You won't be|That's not)/i,
    label: 'Dismissive Opener',
    confidence: 0.70,
  },
  {
    pattern: /(?:You're pretty young|You look young|You seem new|Haven't worked much)/gi,
    label: 'Age/Appearance Judgment',
    confidence: 0.95,
  },
  {
    pattern: /(?:Do you really|Are you sure|Have you actually|You probably haven't)/gi,
    label: 'Competence Questioning',
    confidence: 0.85,
  },
  {
    pattern: /(?:I'll just look it up|I know what|I've done this before)/gi,
    label: 'Knowledge Dismissal',
    confidence: 0.80,
  },
];

const EGO_TRIGGER_PATTERNS = [
  {
    pattern: /(?:I can do it for free|no charge|I'll do it for|trial|maybe we cross paths)/gi,
    label: 'Discount Offer (Christian Speaking)',
    confidence: 0.95,
    speaker: 'christian',
    triggerAction: 'EGO_CHECK',
  },
  {
    pattern: /not a big deal|hopefully we cross|might work out|we'll see|could work/gi,
    label: 'Low-Confidence Language (Christian Speaking)',
    confidence: 0.85,
    speaker: 'christian',
    triggerAction: 'EGO_CHECK',
  },
];

// ============================================================================
// TECHNICAL REDIRECT ARSENAL (10 Pre-written Responses)
// ============================================================================

export const TECHNICAL_REDIRECTS = [
  {
    id: 'nec_210_52_a1',
    label: 'Kitchen Receptacle Requirements',
    content: 'NEC 210.52(A)(1) requires receptacles no more than 6 feet apart on kitchen counters, with at least one receptacle for a small appliance circuit. If your current layout has the fridge running on general circuits, that\'s a code violation we should address.',
    category: 'residential',
  },
  {
    id: 'nec_210_8',
    label: 'GFCI Protection Requirements',
    content: 'NEC 210.8 mandates GFCI protection for all receptacles within 6 feet of a sink, all bathrooms, garages, basements, and wet locations. Most older homes don\'t meet this standard. We can identify which circuits need retrofitting.',
    category: 'residential',
  },
  {
    id: 'nec_230_6',
    label: 'Service Entrance Sizing',
    content: 'NEC 230.79 defines how we calculate service size based on your load profile. A 100-amp service is undersized for modern HVAC and EV-ready homes. We\'ll run a proper load calculation to determine if you need an upgrade to 150-200 amp.',
    category: 'residential',
  },
  {
    id: 'nec_300_3',
    label: 'Conduit Fill & Conductor Sizing',
    content: 'NEC 300.17 limits conduit fill to 40% for more than 2 conductors. Many DIY or cut-rate installations violate this, causing heat buildup and early failure. We calculate proper gauge and run accordingly.',
    category: 'commercial',
  },
  {
    id: 'project_complexity_panel',
    label: 'Service Panel Upgrade Complexity',
    content: 'A service panel upgrade requires a city permit, inspection, temporary power arrangement (sometimes with utility involvement), and precise main lug disconnection sequencing. It\'s a 2-3 day job with permitting. The coordination cost is substantial.',
    category: 'residential',
  },
  {
    id: 'project_complexity_solar',
    label: 'Solar Integration Complexity',
    content: 'Solar installations involve NEC Article 690, utility interconnect, engineering stamps, module spacing, racking engineering, conduit routing to manage voltage drop, and DCDB design. It\'s not a retrofit—it\'s a systems integration project.',
    category: 'commercial',
  },
  {
    id: 'license_insurance_value',
    label: 'License & Insurance Value Prop',
    content: 'My contractor\'s license means I carry $1M general liability, $1M property damage, and $500k workers comp. If something goes wrong—fire, injury, code violation—my insurance and my bond protect you. Unlicensed work voids your homeowner\'s policy and creates lender liability.',
    category: 'residential',
  },
  {
    id: 'warranty_accountability',
    label: 'Warranty & Accountability',
    content: 'I warranty all workmanship for 2 years. That means if a connection fails, a circuit acts up, or an inspection catches a mistake, I fix it for free. That accountability is worth the premium over a cash-and-carry contractor.',
    category: 'residential',
  },
  {
    id: 'safety_risk_analysis',
    label: 'Safety & Liability Risk',
    content: 'Undersized wire, overloaded circuits, and GFCI gaps cause 50,000+ electrical fires annually in the US. A botched retrofit can create a time-bomb—not just property damage but injury liability. The cost of doing it right once is cheaper than a lawsuit.',
    category: 'residential',
  },
  {
    id: 'material_sourcing_expertise',
    label: 'Material Sourcing & Code Compliance',
    content: 'I know which breakers are compatible with which panels, which wire gauges handle what amperage at what distance, and which materials pass local inspector scrutiny. Off-spec materials cost you twice: once for the bad install, again to correct it.',
    category: 'residential',
  },
];

// ============================================================================
// PATTERN DETECTION ENGINE
// ============================================================================

/**
 * Analyze transcript for testing patterns.
 * These are questions where the person likely knows the answer and is testing Christian.
 */
export function detectTestingPatterns(
  transcript: string,
  lineIndex: number
): DetectionResult | null {
  for (const testPattern of TESTING_PATTERNS) {
    if (testPattern.pattern.test(transcript)) {
      return {
        pattern: 'TESTING_PATTERN',
        priority: 'WARNING',
        confidence: testPattern.confidence,
        text: transcript.substring(0, 80),
        lineIndex,
        coachingMessage: `He's testing you. He likely knows the answer to "${testPattern.label}" already. Go deep with a specific NEC reference.`,
        suggestedRedirect: `That's a good question. The answer depends on your specific application, but the relevant code is NEC Article [X]. Here's what I'd recommend for your situation...`,
        timestamp: new Date().toISOString(),
      };
    }
  }
  return null;
}

/**
 * Analyze for price shopping patterns.
 * These trigger when pricing is discussed before scope is fully established.
 */
export function detectPriceShoppingPatterns(
  transcript: string,
  lineIndex: number,
  scopeEstablished: boolean = false
): DetectionResult | null {
  for (const pricePattern of PRICE_SHOPPING_PATTERNS) {
    if (pricePattern.pattern.test(transcript)) {
      // Only fire "too early" alerts if scope hasn't been discussed yet
      if (pricePattern.precondition === 'before_scope' && scopeEstablished) {
        continue;
      }

      return {
        pattern: 'PRICE_SHOPPING_PATTERN',
        priority: scopeEstablished ? 'INFO' : 'WARNING',
        confidence: pricePattern.confidence,
        text: transcript.substring(0, 80),
        lineIndex,
        coachingMessage: scopeEstablished
          ? `Price question asked. You have scope data. Use it to justify your rate.`
          : `Price question too early. Don't quote yet. Ask about their actual scope first. "Before I give you a number, tell me about the project..."`,
        suggestedRedirect: `Great question. Before I quote, I need to understand the full scope—how many circuits, what's the existing panel capacity, do we need permits? Let me walk through that first.`,
        timestamp: new Date().toISOString(),
      };
    }
  }
  return null;
}

/**
 * Analyze for bias and dismissal patterns.
 * Short responses, dismissive tone, age probes, credibility tests.
 */
export function detectBiasDismissalPatterns(
  transcript: string,
  lineIndex: number
): DetectionResult | null {
  for (const biasPattern of BIAS_DISMISSAL_PATTERNS) {
    if (biasPattern.pattern.test(transcript)) {
      return {
        pattern: 'BIAS_DISMISSAL_PATTERN',
        priority: 'WARNING',
        confidence: biasPattern.confidence,
        text: transcript.substring(0, 80),
        lineIndex,
        coachingMessage: `He's sizing you up—checking your credibility, age, or experience. Drop a technical depth bomb: quote a specific NEC section or reference a complex project you completed.`,
        suggestedRedirect: `I hear the skepticism. Let me address that directly: [NEC reference] is why this approach is required. I've completed [# of similar projects] like this, and here's what I found...`,
        timestamp: new Date().toISOString(),
      };
    }
  }
  return null;
}

/**
 * Monitor CHRISTIAN's own speech patterns for ego triggers.
 * Increasing pace, offering discounts unsolicited, low-confidence language.
 */
export function detectEgoTriggers(
  christianTranscript: string,
  lineIndex: number,
  wordsPerMinute: number = 0
): DetectionResult | null {
  // Check for explicit discount language
  for (const egoPattern of EGO_TRIGGER_PATTERNS) {
    if (egoPattern.pattern.test(christianTranscript)) {
      return {
        pattern: 'EGO_TRIGGER',
        priority: 'EMERGENCY',
        confidence: egoPattern.confidence,
        text: christianTranscript.substring(0, 80),
        lineIndex,
        coachingMessage: `🚨 EGO CHECK: You're speeding up or offering discounts. Take a breath. You have leverage here. Don't leave money on the table.`,
        suggestedRedirect: `Hold on. Let me be clear about what we're quoting and why it's priced that way. This isn't a commodity install...`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Check for speech acceleration (30%+ increase in pace)
  if (wordsPerMinute > 0 && wordsPerMinute > 150) {
    // Normal speech ~120 wpm, above 150 indicates urgency/nervousness
    return {
      pattern: 'SPEECH_ACCELERATION',
      priority: 'EMERGENCY',
      confidence: 0.80,
      text: `Speech pace elevated: ${wordsPerMinute} wpm`,
      lineIndex,
      coachingMessage: `🚨 You're speaking too fast (${wordsPerMinute} wpm). This signals nervousness. Slow down. Pause. Breathe. You control the conversation.`,
      suggestedRedirect: `[Pause for 2 seconds] Let me break that down for you...`,
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}

// ============================================================================
// FULL TRANSCRIPT ANALYSIS
// ============================================================================

/**
 * Comprehensive transcript analysis.
 * Returns all detections ranked by priority and confidence.
 */
export function analyzeTranscript(
  fullTranscript: string,
  scopeEstablished: boolean = false
): PatternAnalysisReport {
  const lines = fullTranscript.split('\n').filter((line) => line.trim());
  const detections: DetectionResult[] = [];
  const egoWarnings: DetectionResult[] = [];
  const emergencyAlerts: DetectionResult[] = [];

  lines.forEach((line, index) => {
    // Detect testing patterns
    const testingResult = detectTestingPatterns(line, index);
    if (testingResult) {
      detections.push(testingResult);
      if (testingResult.priority === 'EMERGENCY') {
        emergencyAlerts.push(testingResult);
      }
    }

    // Detect price shopping
    const priceResult = detectPriceShoppingPatterns(line, index, scopeEstablished);
    if (priceResult) {
      detections.push(priceResult);
      if (priceResult.priority === 'EMERGENCY') {
        emergencyAlerts.push(priceResult);
      }
    }

    // Detect bias/dismissal
    const biasResult = detectBiasDismissalPatterns(line, index);
    if (biasResult) {
      detections.push(biasResult);
      if (biasResult.priority === 'EMERGENCY') {
        emergencyAlerts.push(biasResult);
      }
    }

    // Detect ego triggers
    const egoResult = detectEgoTriggers(line, index);
    if (egoResult) {
      detections.push(egoResult);
      egoWarnings.push(egoResult);
      if (egoResult.priority === 'EMERGENCY') {
        emergencyAlerts.push(egoResult);
      }
    }
  });

  // Sort by priority and confidence
  detections.sort((a, b) => {
    const priorityOrder = { EMERGENCY: 0, WARNING: 1, INFO: 2 };
    const priorityDiff =
      priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return b.confidence - a.confidence;
  });

  const coachingSummary = generateCoachingSummary(
    detections,
    egoWarnings,
    emergencyAlerts
  );

  return {
    totalLines: lines.length,
    detections,
    egoWarnings,
    emergencyAlerts,
    coachingSummary,
  };
}

// ============================================================================
// COACHING SUMMARY GENERATION
// ============================================================================

function generateCoachingSummary(
  detections: DetectionResult[],
  egoWarnings: DetectionResult[],
  emergencyAlerts: DetectionResult[]
): string {
  let summary = '';

  if (emergencyAlerts.length > 0) {
    summary += `🚨 EMERGENCY ALERTS (${emergencyAlerts.length}):\n`;
    emergencyAlerts.slice(0, 3).forEach((alert) => {
      summary += `  - ${alert.coachingMessage}\n`;
    });
    summary += '\n';
  }

  if (detections.some((d) => d.pattern === 'TESTING_PATTERN')) {
    summary += `⚠️ TESTING DETECTED:\n`;
    summary += `  He's probing your technical knowledge. Respond with a specific NEC reference.\n\n`;
  }

  if (detections.some((d) => d.pattern === 'PRICE_SHOPPING_PATTERN')) {
    summary += `💰 PRICE SHOPPING DETECTED:\n`;
    summary += `  Pricing discussion before scope. Don't quote until you've walked through the full scope.\n\n`;
  }

  if (detections.some((d) => d.pattern === 'BIAS_DISMISSAL_PATTERN')) {
    summary += `🔍 BIAS / DISMISSAL DETECTED:\n`;
    summary += `  He's sizing you up. Drop technical depth—quote a specific code section or project experience.\n\n`;
  }

  if (egoWarnings.length > 0) {
    summary += `🎯 EGO CHECK:\n`;
    summary += `  You're showing signs of nervousness (discounting, fast speech). Slow down. You control this conversation.\n\n`;
  }

  if (detections.length === 0) {
    summary += '✅ No major patterns detected. Call appears professional.\n';
  }

  return summary;
}

// ============================================================================
// LOGGING & COACH REVIEW
// ============================================================================

export interface DetectionLog {
  timestamp: string;
  callDate: string;
  detections: DetectionResult[];
  egoWarnings: DetectionResult[];
  emergencyAlerts: DetectionResult[];
  summary: string;
  sessionDuration: number; // in seconds
  otherPersonName?: string;
}

/**
 * Create a nightly coach review entry.
 * This log can be reviewed the next morning to reinforce coaching.
 */
export function createCoachReviewLog(
  report: PatternAnalysisReport,
  callDate: string,
  sessionDuration: number,
  otherPersonName?: string
): DetectionLog {
  return {
    timestamp: new Date().toISOString(),
    callDate,
    detections: report.detections,
    egoWarnings: report.egoWarnings,
    emergencyAlerts: report.emergencyAlerts,
    summary: report.coachingSummary,
    sessionDuration,
    otherPersonName,
  };
}

// ============================================================================
// REDIRECT LOOKUP & SUGGESTIONS
// ============================================================================

/**
 * Get a specific technical redirect by ID.
 */
export function getRedirectById(id: string) {
  return TECHNICAL_REDIRECTS.find((r) => r.id === id);
}

/**
 * Get all redirects for a category (residential vs commercial).
 */
export function getRedirectsByCategory(category: 'residential' | 'commercial') {
  return TECHNICAL_REDIRECTS.filter((r) => r.category === category);
}

/**
 * Get a random redirect to vary coaching responses.
 */
export function getRandomRedirect() {
  return TECHNICAL_REDIRECTS[
    Math.floor(Math.random() * TECHNICAL_REDIRECTS.length)
  ];
}

/**
 * Suggest the most relevant redirect based on detected pattern.
 */
export function suggestRedirectForPattern(
  pattern: string,
  category: 'residential' | 'commercial' = 'residential'
): typeof TECHNICAL_REDIRECTS[0] | null {
  const categoryMatches = getRedirectsByCategory(category);

  // Simple heuristic: if testing pattern, suggest code reference
  if (pattern === 'TESTING_PATTERN') {
    return (
      categoryMatches.find((r) => r.id.startsWith('nec_')) ||
      categoryMatches[0]
    );
  }

  // If bias/dismissal, suggest license/insurance value
  if (pattern === 'BIAS_DISMISSAL_PATTERN') {
    return (
      TECHNICAL_REDIRECTS.find((r) => r.id === 'license_insurance_value') ||
      categoryMatches[0]
    );
  }

  // Default to random from category
  return categoryMatches[Math.floor(Math.random() * categoryMatches.length)];
}

// ============================================================================
// LIVE COACHING ALERT FORMATTER
// ============================================================================

/**
 * Format detection results for real-time display during a call.
 */
export function formatRealTimeAlert(detection: DetectionResult): string {
  const emoji =
    detection.priority === 'EMERGENCY'
      ? '🚨'
      : detection.priority === 'WARNING'
        ? '⚠️'
        : 'ℹ️';

  return `${emoji} ${detection.coachingMessage}\n→ ${detection.suggestedRedirect}`;
}

/**
 * Format detection results for post-call nightly coach review.
 */
export function formatCoachReviewEntry(log: DetectionLog): string {
  let text = `═══════════════════════════════════════\n`;
  text += `📅 NIGHTLY COACH REVIEW\n`;
  text += `Date: ${log.callDate}\n`;
  text += `Duration: ${Math.floor(log.sessionDuration / 60)}m ${log.sessionDuration % 60}s\n`;
  if (log.otherPersonName) {
    text += `With: ${log.otherPersonName}\n`;
  }
  text += `═══════════════════════════════════════\n\n`;
  text += log.summary;
  text += `\nTotal Detections: ${log.detections.length}\n`;
  text += `Emergency Alerts: ${log.emergencyAlerts.length}\n`;
  text += `Ego Warnings: ${log.egoWarnings.length}\n`;

  return text;
}

// ============================================================================
// EXPORT DEFAULT ANALYSIS FUNCTION
// ============================================================================

/**
 * Main entry point: analyze a call transcript and return coaching.
 */
export function analyzeCallTranscript(
  transcript: string,
  scopeEstablished: boolean = false
): {
  report: PatternAnalysisReport;
  criticalAlerts: DetectionResult[];
  coachingMessage: string;
} {
  const report = analyzeTranscript(transcript, scopeEstablished);
  const criticalAlerts = report.emergencyAlerts.slice(0, 3);

  const coachingMessage =
    criticalAlerts.length > 0
      ? `🚨 CRITICAL: ${criticalAlerts
          .map((a) => a.coachingMessage)
          .join(' | ')}`
      : report.coachingSummary;

  return {
    report,
    criticalAlerts,
    coachingMessage,
  };
}
