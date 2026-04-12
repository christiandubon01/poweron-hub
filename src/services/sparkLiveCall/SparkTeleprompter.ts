/**
 * SPARK Teleprompter Service
 * Adaptive cold call script delivery with speech rate synchronization
 * and decision tree branching based on lead responses
 */

// ============================================================================
// SCRIPT DATABASE
// ============================================================================

export type ScriptType = 'vendor' | 'sub' | 'homeowner' | 'solar';
export type LeadResponse = 'NOT_INTERESTED' | 'WORKABLE' | 'INTERESTED' | 'CONVINCED';

/**
 * Decision tree node for a script
 */
export interface ScriptNode {
  id: string;
  text: string;
  /** Sentences to display at once */
  sentences: string[];
  /** Keywords to match in transcript for auto-advance */
  keywords?: string[];
  /** Next nodes by response type */
  branches?: Partial<Record<LeadResponse, string>>;
  /** Final node - no further branches */
  isTerminal?: boolean;
}

/**
 * Complete script tree
 */
export interface Script {
  type: ScriptType;
  name: string;
  description: string;
  startNodeId: string;
  nodes: Record<string, ScriptNode>;
}

// VENDOR SCRIPT (Property Managers)
const VENDOR_SCRIPT: Script = {
  type: 'vendor',
  name: 'Vendor / Property Manager Script',
  description: 'Decision tree for property manager outreach',
  startNodeId: 'vendor_opener',
  nodes: {
    vendor_opener: {
      id: 'vendor_opener',
      text: 'Opening pitch',
      sentences: [
        'Hi, this is Christian from Power On Solutions. I see you manage several properties in the area.',
        'We specialize in emergency electrical service with same-day dispatch.',
        "I wanted to see if you'd be open to a quick conversation about how we handle tenant emergencies."
      ],
      keywords: ['yes', 'sure', 'okay', 'tell me more'],
      branches: {
        NOT_INTERESTED: 'vendor_not_interested_dead',
        WORKABLE: 'vendor_probe',
        INTERESTED: 'vendor_probe',
        CONVINCED: 'vendor_emergency'
      }
    },
    vendor_probe: {
      id: 'vendor_probe',
      text: 'Probe for electrical issues',
      sentences: [
        "When a tenant calls with an electrical issue—tripped breaker, outlet not working—how do you typically handle it?",
        "Do you usually call the same electrician each time, or do you shop around based on the emergency?"
      ],
      keywords: ['have to hire', 'depends', 'call someone', 'emergency calls'],
      branches: {
        NOT_INTERESTED: 'vendor_not_interested_workable',
        WORKABLE: 'vendor_emergency',
        INTERESTED: 'vendor_emergency',
        CONVINCED: 'vendor_emergency'
      }
    },
    vendor_emergency: {
      id: 'vendor_emergency',
      text: 'Emergency angle',
      sentences: [
        "Here's the issue: when it's 10 PM and a tenant is without power, you need someone you trust immediately.",
        'We keep two techs on call after hours and can reach most addresses in under 45 minutes.',
        'We bill hourly with no emergency surcharges—flat rate structure.'
      ],
      keywords: ['sounds good', 'interesting', 'could use'],
      branches: {
        NOT_INTERESTED: 'vendor_not_interested_workable',
        WORKABLE: 'vendor_free_inspection',
        INTERESTED: 'vendor_free_inspection',
        CONVINCED: 'vendor_schedule'
      }
    },
    vendor_free_inspection: {
      id: 'vendor_free_inspection',
      text: 'Offer inspection',
      sentences: [
        "I'd like to offer a free 30-minute electrical audit on one of your properties.",
        'No charge. We identify code issues, old wiring, or hazards that might trigger tenant complaints.',
        'Takes a morning or afternoon. What properties are on your list?'
      ],
      keywords: ['okay', 'could work', 'sure', 'let me think'],
      branches: {
        NOT_INTERESTED: 'vendor_graceful_exit',
        WORKABLE: 'vendor_schedule',
        INTERESTED: 'vendor_schedule',
        CONVINCED: 'vendor_schedule'
      }
    },
    vendor_schedule: {
      id: 'vendor_schedule',
      text: 'Schedule call',
      sentences: [
        'Great. Let me grab your calendar.',
        'What days work best next week for a quick site visit?'
      ],
      isTerminal: true
    },
    vendor_not_interested_dead: {
      id: 'vendor_not_interested_dead',
      text: 'Dead end',
      sentences: [
        "I understand. If that changes or you ever need after-hours electrical, you have my number.",
        'Take care.'
      ],
      isTerminal: true
    },
    vendor_not_interested_workable: {
      id: 'vendor_not_interested_workable',
      text: 'Graceful exit',
      sentences: [
        "No worries. We're here if you ever need us.",
        'Thanks for your time.'
      ],
      isTerminal: true
    },
    vendor_graceful_exit: {
      id: 'vendor_graceful_exit',
      text: 'Graceful exit',
      sentences: [
        "I totally understand. Here's my card—feel free to reach out when you're ready.",
        'Thanks for the time.'
      ],
      isTerminal: true
    }
  }
};

// SUB CONTRACTOR SCRIPT (GCs/Contractors)
const SUB_SCRIPT: Script = {
  type: 'sub',
  name: 'Sub / General Contractor Script',
  description: 'Decision tree for GC and sub-contractor outreach',
  startNodeId: 'sub_opener',
  nodes: {
    sub_opener: {
      id: 'sub_opener',
      text: 'Opening pitch',
      sentences: [
        'Hi, this is Christian from Power On Solutions. I saw your crew working on that renovation project on Oak Street.',
        'We provide electrical subcontracting and emergency support to GCs in the area.',
        "Quick question—do you typically use the same electrician on remodel jobs, or do you prefer to manage subs yourself?"
      ],
      keywords: ['yes', 'tell me more', 'sure', 'maybe'],
      branches: {
        NOT_INTERESTED: 'sub_not_interested_dead',
        WORKABLE: 'sub_remodels',
        INTERESTED: 'sub_remodels',
        CONVINCED: 'sub_remodels'
      }
    },
    sub_remodels: {
      id: 'sub_remodels',
      text: 'Ask about remodels',
      sentences: [
        'How often do your remodel jobs need electrical work?',
        'Panel upgrades, outlet additions, that kind of thing?'
      ],
      keywords: ['often', 'regularly', 'yes we do', 'quite a bit'],
      branches: {
        NOT_INTERESTED: 'sub_not_interested_workable',
        WORKABLE: 'sub_electrician_question',
        INTERESTED: 'sub_electrician_question',
        CONVINCED: 'sub_electrician_question'
      }
    },
    sub_electrician_question: {
      id: 'sub_electrician_question',
      text: 'Ask about current electrician',
      sentences: [
        'Are you working with someone now, or is that something you shop for job-to-job?',
        'Do you do your own electrical or rely on a sub?'
      ],
      keywords: ['have one', 'do my own', 'have an electrician', 'shop around'],
      branches: {
        NOT_INTERESTED: 'sub_emergency_angle',
        WORKABLE: 'sub_emergency_angle',
        INTERESTED: 'sub_emergency_angle',
        CONVINCED: 'sub_partnership'
      }
    },
    sub_emergency_angle: {
      id: 'sub_emergency_angle',
      text: 'Emergency angle',
      sentences: [
        "Here's why I'm calling: when you have a code violation or a panel upgrade that needs inspection, you need someone licensed and bonded who can turn it around fast.",
        'We can dispatch within 24 hours on new remodel jobs, and we do emergency wiring if a jobsite goes dark.',
        'All work is insured and pulls proper permits.'
      ],
      keywords: ['that works', 'could use', 'sounds good', 'interesting'],
      branches: {
        NOT_INTERESTED: 'sub_not_interested_workable',
        WORKABLE: 'sub_partnership',
        INTERESTED: 'sub_partnership',
        CONVINCED: 'sub_partnership'
      }
    },
    sub_partnership: {
      id: 'sub_partnership',
      text: 'Partnership proposal',
      sentences: [
        'What if I sent over our sub rate sheet so you can see our pricing on standard remodel work?',
        'Panel upgrade, rough-in labor, inspection coordination—all of it.',
        'That way you have our number for your next estimate.'
      ],
      keywords: ['okay', 'sure', 'sounds fair', 'okay i will'],
      branches: {
        NOT_INTERESTED: 'sub_graceful_exit',
        WORKABLE: 'sub_schedule',
        INTERESTED: 'sub_schedule',
        CONVINCED: 'sub_schedule'
      }
    },
    sub_schedule: {
      id: 'sub_schedule',
      text: 'Get contact info',
      sentences: [
        'Perfect. What\'s your email so I can get that over today?',
        'And the best phone number to reach you?'
      ],
      isTerminal: true
    },
    sub_not_interested_dead: {
      id: 'sub_not_interested_dead',
      text: 'Dead end',
      sentences: [
        "No problem. If that ever changes, you know where to find us.",
        'Take care.'
      ],
      isTerminal: true
    },
    sub_not_interested_workable: {
      id: 'sub_not_interested_workable',
      text: 'Graceful exit',
      sentences: [
        "I understand. We're always available if you need something down the road.",
        'Thanks for your time.'
      ],
      isTerminal: true
    },
    sub_graceful_exit: {
      id: 'sub_graceful_exit',
      text: 'Graceful exit',
      sentences: [
        "No worries. Here's my card—give me a call when you're planning your next project.",
        'Thanks.'
      ],
      isTerminal: true
    }
  }
};

// HOMEOWNER SCRIPT (Direct Residential)
const HOMEOWNER_SCRIPT: Script = {
  type: 'homeowner',
  name: 'Homeowner Script',
  description: 'Direct residential outreach',
  startNodeId: 'home_opener',
  nodes: {
    home_opener: {
      id: 'home_opener',
      text: 'Opening pitch',
      sentences: [
        "Hi, this is Christian from Power On Solutions, a local electrical company.",
        "I'm calling homeowners in the area about electrical safety.",
        "Do you have a quick minute?"
      ],
      keywords: ['yes', 'sure', 'okay', 'okay go ahead'],
      branches: {
        NOT_INTERESTED: 'home_graceful_exit',
        WORKABLE: 'home_safety_probe',
        INTERESTED: 'home_safety_probe',
        CONVINCED: 'home_safety_probe'
      }
    },
    home_safety_probe: {
      id: 'home_safety_probe',
      text: 'Safety concern probe',
      sentences: [
        'When was the last time someone checked your electrical panel or outlets for code violations?',
        "We do free 15-minute safety inspections to catch fire hazards or tripped breakers."
      ],
      keywords: ['years', 'never', 'not sure', 'long time'],
      branches: {
        NOT_INTERESTED: 'home_graceful_exit',
        WORKABLE: 'home_inspection_offer',
        INTERESTED: 'home_inspection_offer',
        CONVINCED: 'home_inspection_offer'
      }
    },
    home_inspection_offer: {
      id: 'home_inspection_offer',
      text: 'Inspection offer',
      sentences: [
        "I'd like to schedule a free inspection for your home.",
        'Takes about 15 minutes. We check the panel, outlets, and identify any issues.',
        'What day works best for you this week?'
      ],
      isTerminal: true
    },
    home_graceful_exit: {
      id: 'home_graceful_exit',
      text: 'Graceful exit',
      sentences: [
        "No problem. Have a great day.",
        'Thanks.'
      ],
      isTerminal: true
    }
  }
};

// SOLAR SCRIPT (Solar Companies)
const SOLAR_SCRIPT: Script = {
  type: 'solar',
  name: 'Solar Company Partnership Script',
  description: 'Partnership model for solar installers',
  startNodeId: 'solar_opener',
  nodes: {
    solar_opener: {
      id: 'solar_opener',
      text: 'Opening pitch',
      sentences: [
        'Hi, this is Christian from Power On Solutions. I see you install solar systems in the area.',
        "We specialize in electrical permitting and inspection support for solar contractors.",
        'Do you have a minute to talk about how we can streamline your inspection process?'
      ],
      keywords: ['yes', 'sure', 'maybe', 'okay'],
      branches: {
        NOT_INTERESTED: 'solar_graceful_exit',
        WORKABLE: 'solar_partnership',
        INTERESTED: 'solar_partnership',
        CONVINCED: 'solar_partnership'
      }
    },
    solar_partnership: {
      id: 'solar_partnership',
      text: 'Partnership model',
      sentences: [
        'Here\'s the problem we solve: when a homeowner gets a solar install, the city requires electrical inspection.',
        'We handle the permit paperwork, schedule inspections, and make sure everything passes code.',
        'We charge a flat rate per system. Your customer sees one invoice from you.'
      ],
      keywords: ['sounds good', 'interested', 'could work', 'tell me more'],
      branches: {
        NOT_INTERESTED: 'solar_graceful_exit',
        WORKABLE: 'solar_certification',
        INTERESTED: 'solar_certification',
        CONVINCED: 'solar_certification'
      }
    },
    solar_certification: {
      id: 'solar_certification',
      text: 'Certification discussion',
      sentences: [
        'Are your installers solar-certified, or do you partner with electricians for the electrical side?',
        'Either way, we can handle inspections and permitting to speed up your turnover.'
      ],
      keywords: ['certified', 'we do', 'partner', 'use electricians'],
      branches: {
        NOT_INTERESTED: 'solar_graceful_exit',
        WORKABLE: 'solar_volume_terms',
        INTERESTED: 'solar_volume_terms',
        CONVINCED: 'solar_volume_terms'
      }
    },
    solar_volume_terms: {
      id: 'solar_volume_terms',
      text: 'Volume terms',
      sentences: [
        'How many systems do you install per month?',
        'I can put together a volume pricing plan that saves you money per install.'
      ],
      keywords: ['5', '10', 'varies', 'couple', 'few'],
      branches: {
        NOT_INTERESTED: 'solar_graceful_exit',
        WORKABLE: 'solar_schedule',
        INTERESTED: 'solar_schedule',
        CONVINCED: 'solar_schedule'
      }
    },
    solar_schedule: {
      id: 'solar_schedule',
      text: 'Schedule follow-up',
      sentences: [
        'Perfect. Let me send over our solar partner rate sheet.',
        'Best email for you?'
      ],
      isTerminal: true
    },
    solar_graceful_exit: {
      id: 'solar_graceful_exit',
      text: 'Graceful exit',
      sentences: [
        "No problem. We're here if you need electrical support in the future.",
        'Thanks for your time.'
      ],
      isTerminal: true
    }
  }
};

// ============================================================================
// SPEECH RATE TRACKING
// ============================================================================

export interface SpeechRateTracker {
  wordCount: number;
  chunkStartTime: number;
  wpmRollingAverage: number;
  wpmHistory: number[];
  maxHistoryLength: number;
}

const DEFAULT_WPM = 130;
const MIN_WPM = 80;
const MAX_WPM = 200;
const ROLLING_AVERAGE_WINDOW = 5;

/**
 * Initialize speech rate tracker
 */
export function initSpeechRateTracker(): SpeechRateTracker {
  return {
    wordCount: 0,
    chunkStartTime: Date.now(),
    wpmRollingAverage: DEFAULT_WPM,
    wpmHistory: [DEFAULT_WPM],
    maxHistoryLength: ROLLING_AVERAGE_WINDOW
  };
}

/**
 * Update tracker with new transcript chunk
 * Returns current WPM estimate
 */
export function updateSpeechRate(
  tracker: SpeechRateTracker,
  transcriptChunk: string
): number {
  const wordCount = transcriptChunk.trim().split(/\s+/).length;
  const elapsedMs = Date.now() - tracker.chunkStartTime;
  const elapsedMinutes = elapsedMs / 60000;

  if (elapsedMinutes > 0.05) {
    // Only calculate if we have at least 3 seconds of speech
    const wpm = Math.round(wordCount / elapsedMinutes);
    const clamped = Math.max(MIN_WPM, Math.min(MAX_WPM, wpm));

    tracker.wpmHistory.push(clamped);
    if (tracker.wpmHistory.length > tracker.maxHistoryLength) {
      tracker.wpmHistory.shift();
    }

    // Calculate rolling average
    tracker.wpmRollingAverage =
      Math.round(
        tracker.wpmHistory.reduce((a, b) => a + b, 0) / tracker.wpmHistory.length
      ) || DEFAULT_WPM;

    // Reset for next chunk
    tracker.wordCount = 0;
    tracker.chunkStartTime = Date.now();
  }

  return tracker.wpmRollingAverage;
}

/**
 * Get scroll speed in milliseconds per line
 */
export function getScrollSpeed(wpm: number): number {
  // At 130 WPM, scroll speed = 300ms per line (roughly 0.4 lines per second)
  // At 100 WPM, scroll speed = 390ms per line
  // At 200 WPM, scroll speed = 195ms per line
  const ratio = DEFAULT_WPM / wpm;
  return Math.round(300 * ratio);
}

// ============================================================================
// TELEPROMPTER STATE & NAVIGATION
// ============================================================================

export interface TeleprompterState {
  scriptType: ScriptType;
  currentNodeId: string;
  displayIndex: number; // Index into current node's sentences
  transcript: string;
  wpm: number;
  isPlaying: boolean;
}

export interface DisplaySentences {
  current: string;
  next?: string;
  following?: string;
}

/**
 * Get all available scripts
 */
export function getAllScripts(): Record<ScriptType, Script> {
  return {
    vendor: VENDOR_SCRIPT,
    sub: SUB_SCRIPT,
    homeowner: HOMEOWNER_SCRIPT,
    solar: SOLAR_SCRIPT
  };
}

/**
 * Get script by type
 */
export function getScript(type: ScriptType): Script {
  const scripts = getAllScripts();
  return scripts[type];
}

/**
 * Get current node from state
 */
export function getCurrentNode(state: TeleprompterState): ScriptNode {
  const script = getScript(state.scriptType);
  return script.nodes[state.currentNodeId];
}

/**
 * Get sentences to display (current + next + following)
 */
export function getDisplaySentences(state: TeleprompterState): DisplaySentences {
  const node = getCurrentNode(state);
  const sentences = node.sentences;

  return {
    current: sentences[state.displayIndex] || '',
    next: sentences[state.displayIndex + 1],
    following: sentences[state.displayIndex + 2]
  };
}

/**
 * Advance to next sentence
 */
export function advanceToNextSentence(state: TeleprompterState): TeleprompterState {
  const node = getCurrentNode(state);
  const isLastSentence = state.displayIndex >= node.sentences.length - 1;

  if (isLastSentence) {
    // Move to next node (user must select via branch or manual)
    return state;
  }

  return {
    ...state,
    displayIndex: state.displayIndex + 1
  };
}

/**
 * Go to previous sentence
 */
export function goToPreviousSentence(state: TeleprompterState): TeleprompterState {
  if (state.displayIndex === 0) {
    return state;
  }

  return {
    ...state,
    displayIndex: state.displayIndex - 1
  };
}

/**
 * Classify response to determine branch
 * In a real system, this would call Claude Haiku to classify the lead's response
 */
export function classifyLeadResponse(transcript: string): LeadResponse {
  const lower = transcript.toLowerCase();

  // Simple heuristic classification (replace with Claude call in production)
  if (
    lower.includes('not interested') ||
    lower.includes("don't need") ||
    lower.includes('not interested') ||
    lower.includes('no thank you')
  ) {
    return 'NOT_INTERESTED';
  }

  if (
    lower.includes('maybe') ||
    lower.includes('could') ||
    lower.includes('might') ||
    lower.includes('possibly')
  ) {
    return 'WORKABLE';
  }

  if (
    lower.includes('interested') ||
    lower.includes('sounds good') ||
    lower.includes('tell me more')
  ) {
    return 'INTERESTED';
  }

  if (
    lower.includes('yes') ||
    lower.includes('definitely') ||
    lower.includes('great')
  ) {
    return 'CONVINCED';
  }

  return 'WORKABLE'; // Default
}

/**
 * Move to next node based on classification
 */
export function moveToNextNode(
  state: TeleprompterState,
  response: LeadResponse
): TeleprompterState {
  const node = getCurrentNode(state);

  if (!node.branches) {
    return state;
  }

  const nextNodeId = node.branches[response];

  if (!nextNodeId) {
    return state;
  }

  return {
    ...state,
    currentNodeId: nextNodeId,
    displayIndex: 0,
    transcript: ''
  };
}

/**
 * Initialize new teleprompter session
 */
export function initTeleprompterSession(scriptType: ScriptType): TeleprompterState {
  const script = getScript(scriptType);
  return {
    scriptType,
    currentNodeId: script.startNodeId,
    displayIndex: 0,
    transcript: '',
    wpm: DEFAULT_WPM,
    isPlaying: false
  };
}

/**
 * Update transcript in state
 */
export function updateTranscript(
  state: TeleprompterState,
  newTranscript: string,
  tracker: SpeechRateTracker
): TeleprompterState {
  const wpm = updateSpeechRate(tracker, newTranscript);

  return {
    ...state,
    transcript: newTranscript,
    wpm
  };
}

/**
 * Check if auto-advance is triggered by keyword match
 */
export function shouldAutoAdvance(
  state: TeleprompterState,
  transcript: string
): boolean {
  const node = getCurrentNode(state);

  if (!node.keywords) {
    return false;
  }

  const lowerTranscript = transcript.toLowerCase();
  return node.keywords.some(keyword =>
    lowerTranscript.includes(keyword.toLowerCase())
  );
}

/**
 * Export script to JSON (for backup/sharing)
 */
export function exportScript(script: Script): string {
  return JSON.stringify(script, null, 2);
}

/**
 * Get all node IDs for a script (for navigation)
 */
export function getNodeIds(script: Script): string[] {
  return Object.keys(script.nodes);
}

/**
 * Calculate visual progression (for progress indicator)
 */
export function calculateProgress(state: TeleprompterState): number {
  const script = getScript(state.scriptType);
  const nodeIds = getNodeIds(script);
  const currentIndex = nodeIds.indexOf(state.currentNodeId);

  if (currentIndex === -1) {
    return 0;
  }

  return Math.round((currentIndex / nodeIds.length) * 100);
}
