/**
 * SPARK Role-Play Engine
 * 
 * Generates realistic character personas for call training with behavioral rules,
 * objections, and natural conversation patterns. Claude plays each character
 * responding to Christian's pitch and sales tactics.
 */

// Type stub for Anthropic client (available at runtime)
interface AnthropicMessageStream {
  [Symbol.asyncIterator](): AsyncIterator<any>;
}

interface AnthropicClient {
  messages: {
    stream(config: any): Promise<AnthropicMessageStream>;
  };
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface CharacterTemplate {
  name: string;
  title: string;
  personality: string;
  motivation: string;
  objectionStyle: 'direct' | 'passive' | 'aggressive' | 'analytical';
  responseSpeed: 'quick' | 'measured' | 'hesitant';
  responseLength: number; // target max words
}

export interface GeneratedCharacter {
  template: string;
  difficulty: 'easy' | 'medium' | 'hard';
  systemPrompt: string;
  characterName: string;
  characterTitle: string;
  keyBehaviors: string[];
}

export interface ConversationRound {
  userMessage: string;
  characterResponse: string;
  characterReflection: {
    detectedTactic?: string;
    reactionPattern: string;
    nextMove: string;
  };
}

export interface HunterLead {
  id: string;
  company?: string;
  contact?: string;
  jobType?: string;
  estimatedValue?: number;
  pitchAngles?: string[];
  likelyObjections?: string[];
}

// ============================================================================
// CHARACTER TEMPLATES
// ============================================================================

export const CHARACTER_TEMPLATES: Record<string, CharacterTemplate> = {
  FRIENDLY_HOMEOWNER: {
    name: 'Sarah',
    title: 'Homeowner',
    personality: 'Polite, considerate, genuinely interested but cautious about cost',
    motivation: 'Home improvement safety & comfort; budget-conscious',
    objectionStyle: 'passive',
    responseSpeed: 'measured',
    responseLength: 35,
  },
  SKEPTICAL_GC: {
    name: 'Mike',
    title: 'General Contractor',
    personality: 'Experienced, tests knowledge, skeptical of young contractors',
    motivation: 'Reliable sub who knows code; proven track record',
    objectionStyle: 'direct',
    responseSpeed: 'quick',
    responseLength: 25,
  },
  PROPERTY_MANAGER_HAS_GUY: {
    name: 'Janet',
    title: 'Property Manager',
    personality: 'Efficient, loyal to existing vendor, not actively seeking',
    motivation: 'Continuity with current electrician; minimal disruption',
    objectionStyle: 'passive',
    responseSpeed: 'quick',
    responseLength: 20,
  },
  HARDBALL_NEGOTIATOR: {
    name: 'David',
    title: 'Construction Manager',
    personality: 'Price-focused, compares multiple quotes, pushes hard',
    motivation: 'Lowest cost; proven quality at minimum price point',
    objectionStyle: 'aggressive',
    responseSpeed: 'quick',
    responseLength: 30,
  },
  NEC_TESTER: {
    name: 'Robert',
    title: 'Senior Electrician / Inspector Consultant',
    personality: 'Technical authority, tests depth of knowledge, respects competence',
    motivation: 'Code compliance; contractor who understands nuance',
    objectionStyle: 'analytical',
    responseSpeed: 'measured',
    responseLength: 40,
  },
  GATEKEEPER_GC: {
    name: 'Lisa',
    title: 'Subcontractor Coordinator',
    personality: 'Busy managing 5 subs, impatient, evaluating fit',
    motivation: 'Why pick you over the 3 we already use?',
    objectionStyle: 'direct',
    responseSpeed: 'quick',
    responseLength: 22,
  },
};

// ============================================================================
// BEHAVIORAL RULES & OBJECTION PATTERNS
// ============================================================================

const BEHAVIORAL_RULES = `
BEHAVIORAL RULES:
- If he offers discounts without being asked, push harder for more
- If he goes technical (NEC codes, specific experience), show more respect
- If he uses checkout language ('not a big deal', 'hopefully'), let the conversation die
- If he speeds up his speech pattern, you sense nervousness — test him more
- If he holds his price confidently, you respect that
- React realistically to what he says. You are a real person, not a training bot.
`;

const STANDARD_OBJECTIONS = [
  "You're kind of young for this, aren't you?",
  'My current guy charges $55/hr',
  'Can you do it for free as a trial?',
  "We'll think about it and get back to you",
  'Do you even have your own license?',
  'That seems expensive for this kind of work',
  "I've been burned by contractors before",
  "We're getting 3 quotes — what's your best price?",
  "My brother-in-law does electrical work",
  "We don't have budget for this right now",
  'Your website looks unprofessional',
  'What references do you have?',
  'How do I know you actually show up?',
  "Why should I hire you instead of [competitor]?",
  'Can you match their price?',
  "We're not taking on new work right now",
  "I'll need to ask my GC before committing",
  'Call back in a few months',
];

// ============================================================================
// MAIN ENGINE FUNCTIONS
// ============================================================================

/**
 * Generates a system prompt for Claude to play a character
 */
export function generateCharacterPrompt(
  template: string,
  difficulty: 'easy' | 'medium' | 'hard',
  customDescription?: string
): GeneratedCharacter {
  const char = CHARACTER_TEMPLATES[template];
  if (!char) {
    throw new Error(`Unknown template: ${template}`);
  }

  // Scale difficulty
  const difficultyModifiers = {
    easy: {
      patience: 'high patience, willing to listen',
      challengeLevel: 'asks 1-2 gentle objections',
      timeAllowed: 'extended timeline for decision',
    },
    medium: {
      patience: 'moderate patience, some pushback',
      challengeLevel: 'asks 2-3 real objections with some pressure',
      timeAllowed: 'wants to decide within 1-2 weeks',
    },
    hard: {
      patience: 'low patience, aggressive testing',
      challengeLevel: 'rapid-fire objections, hard to move',
      timeAllowed: 'expects answer today or walks',
    },
  };

  const modifiers = difficultyModifiers[difficulty];

  const systemPrompt = `
You are ${char.name}, ${char.title}.

CORE PERSONALITY:
${char.personality}

WHAT DRIVES YOU:
${char.motivation}

DIFFICULTY LEVEL: ${difficulty.toUpperCase()}
${modifiers.patience}
${modifiers.challengeLevel}
${modifiers.timeAllowed}

YOU ARE SPEAKING WITH: A young electrical contractor named Christian (looks younger than 24).

STYLE NOTES:
- Response style: ${char.responseSpeed}
- You are ${char.objectionStyle} in your objection style
- Keep responses under 40 words — this is a phone conversation
- ${customDescription ? `ADDITIONAL CONTEXT: ${customDescription}` : ''}

${BEHAVIORAL_RULES}

OBJECTIONS TO USE (pick 2-3 per conversation):
${STANDARD_OBJECTIONS.slice(0, 10).map((o) => `- "${o}"`).join('\n')}

Remember: You are a real person, not a training bot. React naturally to what he says.
React as you would in a real phone call. If something doesn't make sense, you'll say so.
`.trim();

  const keyBehaviors = [
    difficulty === 'easy' ? 'Listening actively' : 'Testing competence',
    char.responseSpeed === 'quick' ? 'Fast responses' : 'Thoughtful pauses',
    `${char.objectionStyle} objection style`,
    difficulty === 'hard' ? 'Push back on weak arguments' : 'Open to conversation',
  ];

  return {
    template,
    difficulty,
    systemPrompt,
    characterName: char.name,
    characterTitle: char.title,
    keyBehaviors,
  };
}

/**
 * Creates a custom character from free-text description
 *
 * Example input: "Property manager in Palm Springs, 40 units, thinks I'm too expensive"
 * Returns: Full character prompt with inferred personality, motivation, and behaviors
 */
export function customCharacterFromDescription(text: string): GeneratedCharacter {
  // Extract hints from description
  const isPropertyManager = /property manager|pm|manages|landlord|owns/i.test(text);
  const isGC = /gc|general|contractor|general contractor|construction/i.test(text);
  const isPriceSensitive = /expensive|cheap|cost|budget|afford|price|lower/i.test(text);
  const isYoungSkeptic = /young|too young|inexperienced|new|startup|brand new/i.test(text);
  const hasCurrent = /already|current|have a guy|happy with|using|other/i.test(text);

  // Infer template + customize
  let baseTemplate = 'FRIENDLY_HOMEOWNER';
  if (isPropertyManager && hasCurrent) baseTemplate = 'PROPERTY_MANAGER_HAS_GUY';
  if (isGC) baseTemplate = 'SKEPTICAL_GC';
  if (isPriceSensitive) baseTemplate = 'HARDBALL_NEGOTIATOR';

  const char = CHARACTER_TEMPLATES[baseTemplate];
  const customPrompt = `
You are a decision-maker based on this profile:
${text}

CORE PERSONALITY:
${char.personality}

WHAT DRIVES YOU:
${char.motivation}
${isYoungSkeptic ? '\nYou are skeptical of his age and experience.' : ''}
${isPriceSensitive ? '\nYou are very price-conscious and compare quotes carefully.' : ''}
${hasCurrent ? '\nYou are currently happy with your current vendor.' : ''}

STYLE NOTES:
- Response style: ${char.responseSpeed}
- You are ${char.objectionStyle} in your objection style
- Keep responses under 40 words — this is a phone conversation

${BEHAVIORAL_RULES}

OBJECTIONS TO USE (pick 2-3 per conversation):
${STANDARD_OBJECTIONS.slice(0, 10).map((o) => `- "${o}"`).join('\n')}

Remember: You are a real person. React naturally based on this profile.
`.trim();

  return {
    template: baseTemplate,
    difficulty: 'medium',
    systemPrompt: customPrompt,
    characterName: `Custom (${baseTemplate})`,
    characterTitle: char.title,
    keyBehaviors: [
      isYoungSkeptic ? 'Age skepticism' : 'Open assessment',
      isPriceSensitive ? 'Price focus' : 'Value focus',
      hasCurrent ? 'Status quo bias' : 'Open to change',
    ],
  };
}

/**
 * Loads HUNTER lead data and creates a character matching the lead's profile
 *
 * Maps lead attributes → character template, objections, and pitch vulnerabilities
 */
export function customCharacterFromHunterLead(lead: HunterLead): GeneratedCharacter {
  let baseTemplate = 'FRIENDLY_HOMEOWNER';

  // Infer from job type
  if (lead.jobType?.toLowerCase().includes('commercial')) {
    baseTemplate = 'GATEKEEPER_GC';
  } else if (lead.jobType?.toLowerCase().includes('residential')) {
    baseTemplate = 'FRIENDLY_HOMEOWNER';
  } else if (lead.jobType?.toLowerCase().includes('multi-unit')) {
    baseTemplate = 'PROPERTY_MANAGER_HAS_GUY';
  }

  const char = CHARACTER_TEMPLATES[baseTemplate];
  const estimatedValue = lead.estimatedValue || 5000;
  const isLargeJob = estimatedValue > 20000;

  const likelyObjectionsText = lead.likelyObjections
    ? lead.likelyObjections.join('\n- ')
    : 'Unknown';

  const customPrompt = `
You are a decision-maker from HUNTER lead data:
- Company: ${lead.company || 'Unknown'}
- Contact: ${lead.contact || 'Unknown'}
- Job Type: ${lead.jobType || 'General'}
- Est. Value: $${estimatedValue}
- Likely Objections: ${likelyObjectionsText}

CORE PERSONALITY:
${char.personality}

WHAT DRIVES YOU:
${char.motivation}
${isLargeJob ? '\nThis is a significant project — you will be careful in your vendor selection.' : ''}

${lead.pitchAngles ? `PITCH ANGLES CHRISTIAN MAY USE:\n- ${lead.pitchAngles.join('\n- ')}` : ''}

STYLE NOTES:
- Response style: ${char.responseSpeed}
- You are ${char.objectionStyle} in your objection style
- Keep responses under 40 words — this is a phone conversation

${BEHAVIORAL_RULES}

OBJECTIONS TO USE (prioritize these based on your lead profile):
${(lead.likelyObjections || STANDARD_OBJECTIONS.slice(0, 10)).map((o) => `- "${o}"`).join('\n')}

Remember: You are a real person. React naturally to what he says. This is a real business decision.
`.trim();

  return {
    template: baseTemplate,
    difficulty: isLargeJob ? 'hard' : 'medium',
    systemPrompt: customPrompt,
    characterName: lead.contact || `${lead.company} Contact`,
    characterTitle: lead.company || 'Prospect',
    keyBehaviors: [
      `Job Type: ${lead.jobType || 'General'}`,
      `Size: ${isLargeJob ? 'Large' : 'Standard'}`,
      'HUNTER-sourced lead',
    ],
  };
}

/**
 * Conducts one round of conversation with the character
 *
 * Sends user message to Claude playing the character role,
 * returns character response with internal reflection on tactics
 */
export async function conductRound(
  characterPrompt: GeneratedCharacter,
  userMessage: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  client?: any
): Promise<ConversationRound> {
  // Use provided client or try to get global Anthropic instance
  const anthropicClient = client || (globalThis as any).__ANTHROPIC_CLIENT;
  
  if (!anthropicClient) {
    throw new Error(
      'Anthropic client not available. This function requires Claude API access via Netlify functions.'
    );
  }

  // Build message history with system prompt
  const messages = [
    ...conversationHistory,
    { role: 'user' as const, content: userMessage },
  ];

  try {
    let characterResponse = '';

    // Use streaming for real-time response delivery
    const stream = await anthropicClient.messages.stream({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 200,
      system: characterPrompt.systemPrompt,
      messages: messages,
    });

    // Collect streamed response
    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        characterResponse += chunk.delta.text;
      }
    }

    // Generate reflection on the interaction
    const reflectionPrompt = `
Based on what Christian just said, analyze:
1. What tactic or question pattern did he use?
2. How did you (the character) react emotionally?
3. What will you do next in this conversation?

Keep analysis brief (2-3 sentences per section).
`;

    let reflection = '';
    const reflectionStream = await anthropicClient.messages.stream({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 150,
      system: `You are ${characterPrompt.characterName}. Reflect on the conversation.`,
      messages: [
        { role: 'user' as const, content: reflectionPrompt },
      ],
    });

    for await (const chunk of reflectionStream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        reflection += chunk.delta.text;
      }
    }

    return {
      userMessage,
      characterResponse: characterResponse.trim(),
      characterReflection: {
        detectedTactic: extractTactic(userMessage),
        reactionPattern: reflection.split('\n')[0] || 'Neutral',
        nextMove: reflection.split('\n')[2] || 'Continue conversation',
      },
    };
  } catch (error) {
    console.error('Error in conductRound:', error);
    throw error;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extracts detected sales tactic from user message
 */
function extractTactic(message: string): string {
  const tactics: Record<string, string> = {
    'free|trial|no cost': 'Offering discount/free service',
    'nec|code|compliance': 'Technical credibility play',
    'license|certified|insurance': 'Authority establishment',
    'reference|testimonial|happy client': 'Social proof',
    'hurry|today|right now|urgent': 'Urgency creation',
    'lower|match|beat.*price': 'Price negotiation',
    'experience|years|track record': 'Experience play',
  };

  const lowerMsg = message.toLowerCase();
  for (const [pattern, label] of Object.entries(tactics)) {
    if (new RegExp(pattern, 'i').test(lowerMsg)) {
      return label;
    }
  }

  return 'Information gathering';
}

export default {
  generateCharacterPrompt,
  customCharacterFromDescription,
  customCharacterFromHunterLead,
  conductRound,
  CHARACTER_TEMPLATES,
};
