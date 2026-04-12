/**
 * HUNTER Digital Signals Service
 * Processes lead signals from community platforms and professional networks
 * Supports: Nextdoor, Facebook Marketplace/Groups, LinkedIn, Google Alerts, Craigslist
 */

import { HunterLead, LeadType, LeadStatus, ScoreTier } from './HunterTypes';

// =====================================================
// Types & Interfaces
// =====================================================

export enum SignalSource {
  NEXTDOOR = 'nextdoor',
  FACEBOOK_MARKETPLACE = 'facebook_marketplace',
  FACEBOOK_GROUPS = 'facebook_groups',
  LINKEDIN = 'linkedin',
  GOOGLE_ALERTS = 'google_alerts',
  CRAIGSLIST = 'craigslist',
  MANUAL = 'manual', // Manual copy-paste from user
}

export enum SignalIntent {
  REAL_LEAD = 'real_lead',
  NOISE = 'noise',
  UNCERTAIN = 'uncertain',
}

export interface RawSignal {
  source: SignalSource;
  rawText: string;
  url?: string;
  authorName?: string;
  postedDate?: string;
}

export interface ProcessedSignal {
  id: string;
  source: SignalSource;
  rawText: string;
  url?: string;
  authorName?: string;
  postedDate?: string;
  intent: SignalIntent;
  confidence: number; // 0-1
  urgency: number; // 1-5
  extractedName?: string;
  extractedPhone?: string;
  extractedEmail?: string;
  extractedCity?: string;
  extractedAddress?: string;
  detectedJobType?: string;
  keywordMatches: string[];
  dismissalReason?: string;
  isDismissed: boolean;
  processedAt: string;
  convertedLeadId?: string;
}

export interface SignalIntentResult {
  intent: SignalIntent;
  confidence: number;
  isRealLead: boolean;
  signals: string[];
  redFlags: string[];
}

// =====================================================
// Constants
// =====================================================

const REAL_LEAD_KEYWORDS = [
  'need electrician',
  'looking for electrician',
  'looking for contractor',
  'need contractor',
  'electrical problem',
  'electrical issue',
  'panel upgrade',
  'ev charger',
  'ev charging',
  'solar panel',
  'electrical work needed',
  'electrical repair',
  'licensed electrician',
  'electrical contractor',
  'wiring',
  'outlet',
  'breaker',
  'electric',
  'electrician needed',
  'anybody know electrician',
  'anybody recommend electrician',
  'circuit breaker',
  'rewiring',
  'roughin',
  'finishing',
];

const NOISE_KEYWORDS = [
  'i am electrician',
  'i am a electrician',
  "i'm an electrician",
  'selling electrical',
  'selling tools',
  'electrical tools',
  'tools for sale',
  'hiring electricians',
  'we are hiring',
  'job posting',
  'career opportunity',
  'looking for work',
  'looking for clients',
  'selling services',
  'promoting services',
  'general discussion',
  'how to become',
  'electrical apprentice',
  'electrical training',
];

const URGENCY_KEYWORDS_CRITICAL = [
  'emergency',
  'no power',
  'power out',
  'outage',
  'sparking',
  'smoking',
  'fire',
  'dangerous',
  'hazard',
  'urgent',
  'asap',
  'immediately',
  'right now',
  'today',
  'tonight',
];

const URGENCY_KEYWORDS_HIGH = [
  'need soon',
  'quick',
  'quickly',
  'soon as possible',
  'this week',
  'this weekend',
  'next few days',
];

const URGENCY_KEYWORDS_MEDIUM = [
  'looking for quotes',
  'comparing',
  'planning',
  'thinking about',
  'considering',
];

// =====================================================
// Signal Processor Class
// =====================================================

export class SignalProcessor {
  /**
   * Process a raw signal from any platform
   */
  static processSignal(source: SignalSource, rawData: RawSignal): ProcessedSignal {
    const id = `signal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Detect intent
    const intentResult = this.detectIntent(rawData.rawText);
    
    // Assign urgency
    const urgency = this.assignUrgency(rawData.rawText);
    
    // Extract contact information
    const enriched = this.enrichWithContext(rawData);
    
    // Detect job type
    const jobType = this.detectJobType(rawData.rawText);
    
    // Extract keywords that matched
    const keywordMatches = this.extractMatchedKeywords(rawData.rawText);

    return {
      id,
      source,
      rawText: rawData.rawText,
      url: rawData.url,
      authorName: rawData.authorName,
      postedDate: rawData.postedDate,
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      urgency,
      extractedName: enriched.name,
      extractedPhone: enriched.phone,
      extractedEmail: enriched.email,
      extractedCity: enriched.city,
      extractedAddress: enriched.address,
      detectedJobType: jobType,
      keywordMatches,
      isDismissed: false,
      processedAt: new Date().toISOString(),
    };
  }

  /**
   * Detect if the signal represents a real lead vs noise
   */
  static detectIntent(text: string): SignalIntentResult {
    const lowerText = text.toLowerCase();
    const realLeadMatches: string[] = [];
    const noiseMatches: string[] = [];
    const redFlags: string[] = [];

    // Check for real lead keywords
    for (const keyword of REAL_LEAD_KEYWORDS) {
      if (lowerText.includes(keyword)) {
        realLeadMatches.push(keyword);
      }
    }

    // Check for noise keywords
    for (const keyword of NOISE_KEYWORDS) {
      if (lowerText.includes(keyword)) {
        noiseMatches.push(keyword);
        redFlags.push(`Contains noise keyword: "${keyword}"`);
      }
    }

    // Determine intent
    let intent = SignalIntent.UNCERTAIN;
    let confidence = 0.5;
    let isRealLead = false;

    if (noiseMatches.length > 0) {
      // If any noise keywords, likely not a real lead
      intent = SignalIntent.NOISE;
      confidence = 0.85;
      isRealLead = false;
    } else if (realLeadMatches.length > 0) {
      // If has real lead keywords and no noise
      intent = SignalIntent.REAL_LEAD;
      confidence = Math.min(0.95, 0.6 + realLeadMatches.length * 0.15);
      isRealLead = true;
    } else if (text.length > 100) {
      // Long context without explicit keywords could be a lead
      intent = SignalIntent.UNCERTAIN;
      confidence = 0.4;
      isRealLead = false;
    }

    return {
      intent,
      confidence,
      isRealLead,
      signals: realLeadMatches,
      redFlags,
    };
  }

  /**
   * Assign urgency level 1-5 based on language
   */
  static assignUrgency(text: string): number {
    const lowerText = text.toLowerCase();

    // Critical urgency (5)
    for (const keyword of URGENCY_KEYWORDS_CRITICAL) {
      if (lowerText.includes(keyword)) {
        return 5;
      }
    }

    // High urgency (4)
    for (const keyword of URGENCY_KEYWORDS_HIGH) {
      if (lowerText.includes(keyword)) {
        return 4;
      }
    }

    // Medium urgency (2)
    for (const keyword of URGENCY_KEYWORDS_MEDIUM) {
      if (lowerText.includes(keyword)) {
        return 2;
      }
    }

    // Default: low urgency
    return 1;
  }

  /**
   * Extract contact info from the signal text
   */
  static enrichWithContext(rawData: RawSignal): {
    name?: string;
    phone?: string;
    email?: string;
    city?: string;
    address?: string;
  } {
    const text = rawData.rawText;

    // Phone number pattern (US)
    const phoneMatch = text.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/);
    const phone = phoneMatch ? phoneMatch[1] : undefined;

    // Email pattern
    const emailMatch = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
    const email = emailMatch ? emailMatch[1] : undefined;

    // City/address patterns (generic)
    const cityMatch = text.match(/(?:in|at|located in|area|zone)\s+([A-Z][a-zA-Z\s]+?)(?:[,.]|$)/);
    const city = cityMatch ? cityMatch[1].trim() : undefined;

    // Address pattern (very basic)
    const addressMatch = text.match(/(\d+\s+[A-Z][a-zA-Z\s]+(?:St|Ave|Rd|Blvd|Lane|Court|Drive|Way|Road|Street|Avenue))/i);
    const address = addressMatch ? addressMatch[1] : undefined;

    return {
      name: rawData.authorName,
      phone,
      email,
      city,
      address,
    };
  }

  /**
   * Detect the type of electrical job
   */
  static detectJobType(text: string): string | undefined {
    const lowerText = text.toLowerCase();

    const jobTypes: Record<string, string[]> = {
      'EV Charger Installation': ['ev charger', 'electric vehicle', 'ev charging', 'charging station', 'tesla charger'],
      'Solar Panel': ['solar panel', 'solar installation', 'pv system', 'solar power'],
      'Panel Upgrade': ['panel upgrade', 'service upgrade', 'amp upgrade', 'electrical panel', '200 amp'],
      'Troubleshooting/Repair': ['troubleshoot', 'not working', 'broken', 'repair', 'fix'],
      'GFCI/Receptacles': ['gfci', 'receptacle', 'outlet', 'breaker'],
      'Lighting': ['lighting', 'light fixture', 'pendant', 'recessed light'],
      'General Wiring': ['rewiring', 'wiring', 'rough-in', 'roughin', 'finishing'],
    };

    for (const [jobType, keywords] of Object.entries(jobTypes)) {
      for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
          return jobType;
        }
      }
    }

    return undefined;
  }

  /**
   * Extract all matched keywords for reference
   */
  static extractMatchedKeywords(text: string): string[] {
    const lowerText = text.toLowerCase();
    const matched: string[] = [];
    const allKeywords = [...REAL_LEAD_KEYWORDS, ...NOISE_KEYWORDS, ...URGENCY_KEYWORDS_CRITICAL, ...URGENCY_KEYWORDS_HIGH, ...URGENCY_KEYWORDS_MEDIUM];

    for (const keyword of allKeywords) {
      if (lowerText.includes(keyword) && !matched.includes(keyword)) {
        matched.push(keyword);
      }
    }

    return matched;
  }

  /**
   * Convert a processed signal into a draft HUNTER lead
   */
  static convertSignalToLead(signal: ProcessedSignal): Omit<HunterLead, 'id' | 'created_at' | 'user_id'> {
    // Infer lead type from context
    let leadType = LeadType.SERVICE;
    if (signal.detectedJobType?.toLowerCase().includes('solar')) {
      leadType = LeadType.SOLAR;
    } else if (signal.extractedAddress && signal.extractedAddress.match(/commercial|office|building/i)) {
      leadType = LeadType.COMMERCIAL;
    }

    // Calculate initial score based on intent and urgency
    let baseScore = 30;
    if (signal.intent === SignalIntent.REAL_LEAD) {
      baseScore = 60 + Math.random() * 15; // 60-75
    }
    baseScore += (signal.urgency - 1) * 5; // Urgency adds up to 20 points
    baseScore = Math.min(100, baseScore);

    return {
      source: signal.source,
      source_tag: signal.detectedJobType,
      lead_type: leadType,
      contact_name: signal.extractedName,
      phone: signal.extractedPhone,
      email: signal.extractedEmail,
      address: signal.extractedAddress,
      city: signal.extractedCity,
      description: signal.rawText.substring(0, 500),
      urgency_level: signal.urgency,
      urgency_reason: signal.urgency >= 4 ? 'High priority from signal keywords' : undefined,
      score: Math.round(baseScore),
      score_tier: this.computeScoreTierFromScore(Math.round(baseScore)),
      score_factors: {
        intent_confidence: signal.confidence * 100,
        urgency: signal.urgency * 10,
        keyword_match_count: signal.keywordMatches.length * 5,
      },
      status: LeadStatus.NEW,
      discovered_at: signal.postedDate || new Date().toISOString(),
      notes: `Extracted from ${signal.source}. ${signal.intent === SignalIntent.REAL_LEAD ? 'Real lead signal detected.' : 'Uncertain signal - manual review recommended.'}`,
    };
  }

  /**
   * Map score value to tier
   */
  static computeScoreTierFromScore(score: number): ScoreTier {
    if (score >= 85) return ScoreTier.ELITE;
    if (score >= 75) return ScoreTier.STRONG;
    if (score >= 60) return ScoreTier.QUALIFIED;
    if (score >= 40) return ScoreTier.EXPANSION;
    return ScoreTier.ARCHIVED;
  }

  /**
   * Get a list of all supported signal sources
   */
  static getSupportedSources(): { value: SignalSource; label: string }[] {
    return [
      { value: SignalSource.NEXTDOOR, label: 'Nextdoor' },
      { value: SignalSource.FACEBOOK_MARKETPLACE, label: 'Facebook Marketplace' },
      { value: SignalSource.FACEBOOK_GROUPS, label: 'Facebook Groups' },
      { value: SignalSource.LINKEDIN, label: 'LinkedIn' },
      { value: SignalSource.GOOGLE_ALERTS, label: 'Google Alerts' },
      { value: SignalSource.CRAIGSLIST, label: 'Craigslist' },
      { value: SignalSource.MANUAL, label: 'Manual Entry' },
    ];
  }
}

export default SignalProcessor;
