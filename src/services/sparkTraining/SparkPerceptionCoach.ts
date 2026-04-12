/**
 * SPARK Perception Coach
 * Real-time monitoring of speech patterns during practice rounds
 * Detects ego triggers, price defense violations, pronunciation weaknesses, and lowballing
 * Provides immediate coaching alerts for skill development
 */

export interface SpeechAnalysis {
  turn: string;
  turnNumber: number;
  wordsPerMinute: number;
  fillerWords: string[];
  fillerCount: number;
  hedgeLanguage: string[];
  discountOffered: boolean;
  discountAmount?: number;
  freeLaborOffered: boolean;
  priceQuoted?: number;
  egoTriggerDetected: boolean;
  egoTriggerType?: string;
  checkoutLanguageDetected: boolean;
  agreeSpeed: 'immediate' | 'normal' | 'deliberate';
  technicalDepth: 'weak' | 'moderate' | 'strong';
  necReferenceMade: boolean;
  projectReferenceMade: boolean;
  licensingMentioned: boolean;
}

export interface CoachingAlert {
  id: string;
  priority: 'critical' | 'warning' | 'note';
  message: string;
  type: 'ego' | 'price' | 'delivery' | 'technical' | 'positive';
  timestamp: number;
  turnNumber: number;
  actionable: boolean;
  suggestion?: string;
}

export interface TrainingMetrics {
  discountCount: number;
  discountFrequency: number; // percentage across rounds
  avgFillerWordsPerTurn: number;
  hedgeLanguageRate: number; // percentage
  powerLanguageRatio: number; // assertive / total
  avgPaceWordsPerMinute: number;
  agreeImmediateCount: number;
  technicalStrengthScore: number; // 0-100
  neckReferenceCount: number;
  projectReferenceCount: number;
  licensingMentionCount: number;
}

const FILLER_WORDS = ['um', 'uh', 'like', 'you know', 'basically', 'honestly', 'sort of', 'kind of', 'actually', 'just'];
const HEDGE_WORDS = ['maybe', 'I think', 'sort of', 'hopefully', 'seems like', 'might be', 'could be'];
const CHECKOUT_LANGUAGE = ['not a big deal', 'no worries', 'hopefully', 'no problem'];

// Baseline speaking pace: typical business conversation ~140-160 wpm
const BASELINE_WPM = 150;
const BASELINE_VARIANCE_THRESHOLD = 0.30; // 30% increase triggers alert

export function analyzeSpeechPattern(
  turn: string,
  turnNumber: number,
  previousBaseline: number = BASELINE_WPM
): SpeechAnalysis {
  const wordCount = turn.trim().split(/\s+/).length;
  const estimatedMinutes = Math.max(10 / 60, 1 / 60); // rough estimate
  const wordsPerMinute = Math.round(wordCount / estimatedMinutes);
  
  // Filler word detection
  const fillerWords: string[] = [];
  const lowerTurn = turn.toLowerCase();
  FILLER_WORDS.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = lowerTurn.match(regex) || [];
    if (matches.length > 0) {
      fillerWords.push(...matches.map(m => m.toLowerCase()));
    }
  });

  // Hedge language detection
  const hedgeLanguage: string[] = [];
  HEDGE_WORDS.forEach(phrase => {
    if (lowerTurn.includes(phrase.toLowerCase())) {
      hedgeLanguage.push(phrase);
    }
  });

  // Discount detection
  const discountOffered = /discount|reduce|drop|lower|price down|can do|for less|deal/i.test(turn);
  const discountMatch = turn.match(/(\$?\d+(?:,\d{3})*(?:\.\d{2})?)/);
  const discountAmount = discountMatch ? parseFloat(discountMatch[1].replace(/[$,]/g, '')) : undefined;

  // Free labor detection
  const freeLaborOffered = /free|no charge|for free|gratis|trial|at no cost/i.test(turn);

  // Price quoting
  const priceMatch = turn.match(/\$?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:per|\/|for|an hour)?/);
  const priceQuoted = priceMatch ? parseFloat(priceMatch[1].replace(/[$,]/g, '')) : undefined;

  // Ego trigger detection - speech pace increase
  const paceIncrease = (wordsPerMinute - previousBaseline) / previousBaseline;
  const egoTriggerDetected = paceIncrease > BASELINE_VARIANCE_THRESHOLD;

  // Immediate agreement detection
  const agreePatterns = /^(yes|sure|absolutely|of course|no problem|you got it)/i;
  const agreeSpeed = agreePatterns.test(turn) ? 'immediate' : 'normal';

  // Checkout language detection
  const checkoutLanguageDetected = CHECKOUT_LANGUAGE.some(phrase =>
    lowerTurn.includes(phrase.toLowerCase())
  );

  // Technical depth scoring
  const hasNecRef = /NEC|national electrical code|code requirement|section \d+/i.test(turn);
  const hasProjectRef = /project|installation|site|client|customer|system|panel|wire|breaker|fixture|outlet/i.test(turn);
  const hasLicensing = /license|licensed|insured|bonded|certification|certified|permit/i.test(turn);
  
  const technicalMentions = [hasNecRef, hasProjectRef, hasLicensing].filter(Boolean).length;
  const technicalDepth = technicalMentions >= 2 ? 'strong' : technicalMentions === 1 ? 'moderate' : 'weak';

  return {
    turn,
    turnNumber,
    wordsPerMinute,
    fillerWords,
    fillerCount: fillerWords.length,
    hedgeLanguage,
    discountOffered,
    discountAmount,
    freeLaborOffered,
    priceQuoted,
    egoTriggerDetected,
    egoTriggerType: egoTriggerDetected ? 'pace_increase_30_percent' : undefined,
    checkoutLanguageDetected,
    agreeSpeed: agreeSpeed as 'immediate' | 'normal' | 'deliberate',
    technicalDepth: technicalDepth as 'weak' | 'moderate' | 'strong',
    necReferenceMade: hasNecRef,
    projectReferenceMade: hasProjectRef,
    licensingMentioned: hasLicensing,
  };
}

export function generateCoachingAlert(
  analysis: SpeechAnalysis,
  discountCountInRound: number
): CoachingAlert | null {
  const timestamp = Date.now();
  const baseId = `alert-${analysis.turnNumber}-${timestamp}`;

  // Priority 1: Ego/Discount triggers → CRITICAL
  if (analysis.freeLaborOffered) {
    const freeCost = (63 * 4) * 1; // $63/hr baseline cost, 4 hours
    return {
      id: baseId,
      priority: 'critical',
      type: 'ego',
      message: `RED FLAG: $0 offer. Your cost is $63/hr. Free 4 hours = $${freeCost.toLocaleString()} out of your pocket`,
      timestamp,
      turnNumber: analysis.turnNumber,
      actionable: true,
      suggestion: 'Stop. Recalibrate your rate. Do not offer free work.',
    };
  }

  if (analysis.discountOffered && !analysis.freeLaborOffered) {
    if (analysis.priceQuoted && analysis.priceQuoted < 85) {
      return {
        id: baseId,
        priority: 'critical',
        type: 'price',
        message: `Below floor rate. Your cost is $63/hr minimum. Floor rate: $85/hr.`,
        timestamp,
        turnNumber: analysis.turnNumber,
        actionable: true,
        suggestion: 'Hold your rate. Your time has value.',
      };
    }
  }

  if (analysis.checkoutLanguageDetected && !analysis.egoTriggerDetected) {
    return {
      id: baseId,
      priority: 'warning',
      type: 'ego',
      message: `Checkout language detected. You're giving up authority.`,
      timestamp,
      turnNumber: analysis.turnNumber,
      actionable: true,
      suggestion: 'Replace with assertive language. "This is my rate."',
    };
  }

  if (analysis.egoTriggerDetected) {
    return {
      id: baseId,
      priority: 'critical',
      type: 'ego',
      message: `You're speeding up. Take a breath. Slow your pace.`,
      timestamp,
      turnNumber: analysis.turnNumber,
      actionable: true,
      suggestion: 'Reset to baseline pace. Breathe.',
    };
  }

  // Priority 2: Delivery issues
  if (analysis.fillerCount >= 3) {
    return {
      id: baseId,
      priority: 'warning',
      type: 'delivery',
      message: `${analysis.fillerCount} filler words this turn. Slow down and speak with intention.`,
      timestamp,
      turnNumber: analysis.turnNumber,
      actionable: true,
      suggestion: `Pause instead of saying "${analysis.fillerWords[0]}"`,
    };
  }

  if (analysis.hedgeLanguage.length >= 2) {
    return {
      id: baseId,
      priority: 'warning',
      type: 'delivery',
      message: `Hedge language detected: "${analysis.hedgeLanguage[0]}". Speak with certainty.`,
      timestamp,
      turnNumber: analysis.turnNumber,
      actionable: true,
      suggestion: 'Replace hedge with assertion: "I can" not "I think I can"',
    };
  }

  // Priority 3: Technical depth opportunity
  if (analysis.technicalDepth === 'weak' && analysis.turnNumber > 3) {
    return {
      id: baseId,
      priority: 'note',
      type: 'technical',
      message: `Generic response. Strengthen with specifics.`,
      timestamp,
      turnNumber: analysis.turnNumber,
      actionable: true,
      suggestion: 'Reference a past project or NEC code requirement.',
    };
  }

  // Positive reinforcement
  if (analysis.necReferenceMade) {
    return {
      id: baseId,
      priority: 'warning',
      type: 'positive',
      message: `Strong NEC reference. He's listening now.`,
      timestamp,
      turnNumber: analysis.turnNumber,
      actionable: false,
    };
  }

  if (analysis.technicalDepth === 'strong' && analysis.fillerCount === 0) {
    return {
      id: baseId,
      priority: 'warning',
      type: 'positive',
      message: `Good move: technical depth + clean delivery.`,
      timestamp,
      turnNumber: analysis.turnNumber,
      actionable: false,
    };
  }

  return null;
}

export function getDiscountPattern(roundHistories: SpeechAnalysis[]): {
  count: number;
  frequency: number;
  pattern: string;
} {
  const discounts = roundHistories.filter(h => h.discountOffered).length;
  const frequency = roundHistories.length > 0 ? (discounts / roundHistories.length) * 100 : 0;

  let pattern = 'random';
  if (frequency > 66) pattern = 'frequent_habit';
  else if (frequency > 33) pattern = 'triggered_response';
  else if (frequency > 0) pattern = 'situational';

  return { count: discounts, frequency, pattern };
}

export function computeTrainingMetrics(
  rounds: Array<{ analyses: SpeechAnalysis[]; discountCount: number }>
): TrainingMetrics {
  const allAnalyses = rounds.flatMap(r => r.analyses);
  const totalDiscounts = rounds.reduce((sum, r) => sum + r.discountCount, 0);

  const totalPace = allAnalyses.reduce((sum, a) => sum + a.wordsPerMinute, 0);
  const avgPace = allAnalyses.length > 0 ? Math.round(totalPace / allAnalyses.length) : BASELINE_WPM;

  const totalFillers = allAnalyses.reduce((sum, a) => sum + a.fillerCount, 0);
  const avgFillers = allAnalyses.length > 0 ? totalFillers / allAnalyses.length : 0;

  const hedgeInstances = allAnalyses.filter(a => a.hedgeLanguage.length > 0).length;
  const hedgeRate = allAnalyses.length > 0 ? (hedgeInstances / allAnalyses.length) * 100 : 0;

  const techStrong = allAnalyses.filter(a => a.technicalDepth === 'strong').length;
  const techScore = allAnalyses.length > 0 ? (techStrong / allAnalyses.length) * 100 : 0;

  const immediateAgreements = allAnalyses.filter(a => a.agreeSpeed === 'immediate').length;
  const necRefs = allAnalyses.filter(a => a.necReferenceMade).length;
  const projectRefs = allAnalyses.filter(a => a.projectReferenceMade).length;
  const licensingMents = allAnalyses.filter(a => a.licensingMentioned).length;

  return {
    discountCount: totalDiscounts,
    discountFrequency: rounds.length > 0 ? (totalDiscounts / rounds.length) * 100 : 0,
    avgFillerWordsPerTurn: Math.round(avgFillers * 10) / 10,
    hedgeLanguageRate: Math.round(hedgeRate),
    powerLanguageRatio: (allAnalyses.length - hedgeInstances) / Math.max(1, allAnalyses.length),
    avgPaceWordsPerMinute: avgPace,
    agreeImmediateCount: immediateAgreements,
    technicalStrengthScore: Math.round(techScore),
    neckReferenceCount: necRefs,
    projectReferenceCount: projectRefs,
    licensingMentionCount: licensingMents,
  };
}

export function getScenarioMastery(
  scenarioName: string,
  roundScores: number[]
): { isMastered: boolean; score: number; consecutiveHighScores: number } {
  const recent = roundScores.slice(-3);
  const consecutiveHigh = recent.filter(s => s >= 8).length;
  const isMastered = consecutiveHigh >= 3;
  const avgScore = recent.length > 0 ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0;

  return {
    isMastered,
    score: avgScore,
    consecutiveHighScores: consecutiveHigh,
  };
}

export function formatCoachingAlert(alert: CoachingAlert): {
  displayText: string;
  bgColor: string;
  textColor: string;
  icon: string;
} {
  const colorMap = {
    critical: { bg: 'bg-red-900', text: 'text-red-100', icon: '🚨' },
    warning: { bg: 'bg-amber-900', text: 'text-amber-100', icon: '⚠️' },
    note: { bg: 'bg-blue-900', text: 'text-blue-100', icon: 'ℹ️' },
  };

  const colors = colorMap[alert.priority];
  const positiveColors = alert.type === 'positive' 
    ? { bg: 'bg-green-900', text: 'text-green-100', icon: '✅' }
    : colors;

  return {
    displayText: alert.message,
    bgColor: positiveColors.bg,
    textColor: positiveColors.text,
    icon: positiveColors.icon,
  };
}
