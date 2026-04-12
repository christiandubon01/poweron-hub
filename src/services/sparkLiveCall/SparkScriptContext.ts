/**
 * SPARK Script Context Injection Service
 * 
 * Injects loaded scripts into SPARK's live call analysis context
 * Provides teleprompter guidance, decision tree awareness, and script deviation detection
 * 
 * When SPARK analyzes a live call transcript chunk, this service adds:
 * - Current script node context
 * - Suggested next lines from script
 * - Key weapons (strongest closing angles)
 * - Deviation warnings (when salesperson skips critical elements)
 * - Coaching hints about better approaches
 */

import {
  ScriptType,
  TeleprompterState,
  initTeleprompterSession,
  advanceToNextSentence,
  getCurrentNode,
  classifyLeadResponse,
  moveToNextNode,
  getDisplaySentences,
  getNodeIds,
  getScript
} from './SparkTeleprompter';

import {
  buildScriptContext,
  detectScriptDeviation,
  getObjectionResponse,
  getKeyWeapon,
  ScriptContext,
  getCurrentNode as getLibraryCurrentNode
} from './SparkScriptLibrary';

// ============================================================================
// SCRIPT CONTEXT FOR SPARK ANALYSIS
// ============================================================================

/**
 * Full script context injected into SPARK analysis prompt
 */
export interface SparkScriptContextPayload {
  enabled: boolean;
  scriptType?: ScriptType;
  activeScript?: string;
  currentNode?: {
    id: string;
    title: string;
    instruction: string;
  };
  suggestedNext?: string[];
  keyWeapon?: {
    trigger: string;
    text: string;
    context: string;
  };
  deviationAlert?: {
    detected: boolean;
    message: string;
  };
  coachingHint?: string;
  scriptProgress?: {
    currentPercent: number;
    nodesVisited: string[];
  };
}

/**
 * Initialize SPARK with script context for a specific call type
 */
export function initializeScriptContext(scriptType: ScriptType): {
  state: TeleprompterState;
  context: SparkScriptContextPayload;
} {
  const state = initTeleprompterSession(scriptType);
  
  const context: SparkScriptContextPayload = {
    enabled: true,
    scriptType,
    activeScript: `${scriptType} call script active`,
    currentNode: {
      id: state.currentNodeId,
      title: 'Opening',
      instruction: 'Start with opener - build rapport and permission to continue'
    },
    suggestedNext: [
      'Hi, this is Christian from Power On Solutions.',
      'I see you [context-specific detail].',
      'Do you have a quick minute to talk?'
    ],
    keyWeapon: {
      trigger: scriptType === 'vendor' ? 'emergency availability' : 'partnership opportunity',
      text: scriptType === 'vendor' 
        ? 'Is your contractor available for emergency calls after hours? Because that\'s usually the gap.'
        : 'How many [jobs/systems] do you handle per month?',
      context: 'Use when prospect hesitates or asks about capability'
    },
    deviationAlert: {
      detected: false,
      message: ''
    },
    coachingHint: `Welcome to ${scriptType} script. This call has 4-5 key decision points. Watch for the prospect's tone—that determines which branch you take.`,
    scriptProgress: {
      currentPercent: 0,
      nodesVisited: [state.currentNodeId]
    }
  };

  return { state, context };
}

/**
 * Update script context based on live transcript
 * Called after each transcript chunk from Whisper
 */
export function updateScriptContextFromTranscript(
  state: TeleprompterState,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  newTranscriptChunk?: string
): {
  updatedState: TeleprompterState;
  contextUpdate: SparkScriptContextPayload;
  actionRequired?: {
    type: 'branch_decision' | 'objection_response' | 'script_deviation' | 'next_advance';
    message: string;
  };
} {
  // Classify the lead's response
  const lastUserMsg = conversationHistory
    .reverse()
    .find(msg => msg.role === 'user')?.content || '';
  
  const leadResponse = classifyLeadResponse(lastUserMsg);

  // Check for script deviations
  const deviation = detectScriptDeviation(state.scriptType, conversationHistory, state.currentNodeId);

  // Try to move to next node based on classification
  let updatedState = state;
  let actionRequired: { type: 'branch_decision' | 'objection_response' | 'script_deviation' | 'next_advance'; message: string } | undefined;

  const currentNode = getCurrentNode(state);
  if (currentNode.branches && currentNode.branches[leadResponse]) {
    // Auto-advance to next node based on lead response
    updatedState = moveToNextNode(state, leadResponse);
    actionRequired = {
      type: 'branch_decision',
      message: `Lead response: ${leadResponse}. Moving to ${updatedState.currentNodeId}.`
    };
  } else if (state.displayIndex < currentNode.sentences.length - 1) {
    // Advance to next sentence in current node
    updatedState = advanceToNextSentence(state);
    actionRequired = {
      type: 'next_advance',
      message: 'Advance to next sentence'
    };
  }

  // Build updated context
  const newNode = getCurrentNode(updatedState);
  const displaySentences = getDisplaySentences(updatedState);
  const contextUpdate = buildContextPayload(
    updatedState,
    conversationHistory,
    deviation,
    leadResponse
  );

  if (deviation.deviated) {
    actionRequired = {
      type: 'script_deviation',
      message: deviation.message
    };
  }

  return {
    updatedState,
    contextUpdate,
    actionRequired
  };
}

/**
 * Build the full context payload for SPARK analysis
 */
function buildContextPayload(
  state: TeleprompterState,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  deviation: { deviated: boolean; message: string },
  leadResponse: string
): SparkScriptContextPayload {
  const scriptContext = buildScriptContext(state.scriptType, conversationHistory, state.currentNodeId);
  const currentNode = getCurrentNode(state);
  const displaySentences = getDisplaySentences(state);

  let coachingHint = '';
  if (deviation.deviated) {
    coachingHint = `⚠️ ${deviation.message} Redirect to script key point.`;
  } else if (currentNode.isTerminal) {
    coachingHint = 'Call reached conclusion. Next: log outcome and follow-up notes.';
  } else {
    coachingHint = `Next: ${scriptContext.suggestedNext[0] || 'Continue script'}`;
  }

  // Calculate progress
  const script = getScript(state.scriptType);
  const allNodeIds = getNodeIds(script);
  const currentIndex = allNodeIds.indexOf(state.currentNodeId);
  const progressPercent = currentIndex >= 0 ? Math.round((currentIndex / allNodeIds.length) * 100) : 0;

  return {
    enabled: true,
    scriptType: state.scriptType,
    activeScript: `${state.scriptType} - ${currentNode.text}`,
    currentNode: {
      id: state.currentNodeId,
      title: currentNode.text,
      instruction: currentNode.sentences[0] || 'Continue conversation'
    },
    suggestedNext: scriptContext.suggestedNext,
    keyWeapon: scriptContext.keyWeapon,
    deviationAlert: {
      detected: deviation.deviated,
      message: deviation.message
    },
    coachingHint,
    scriptProgress: {
      currentPercent: progressPercent,
      nodesVisited: conversationHistory
        .filter(msg => msg.role === 'assistant')
        .map(() => state.currentNodeId)
    }
  };
}

/**
 * Inject script context into SPARK's analysis prompt
 * Returns the context section to append to system prompt
 */
export function injectScriptContextIntoPrompt(context: SparkScriptContextPayload): string {
  if (!context.enabled || !context.scriptType) {
    return '';
  }

  const sections: string[] = [
    '---',
    'ACTIVE SCRIPT CONTEXT',
    '---'
  ];

  sections.push(`SCRIPT TYPE: ${context.scriptType.toUpperCase()}`);
  sections.push(`ACTIVE SCRIPT: ${context.activeScript}`);
  
  if (context.currentNode) {
    sections.push(`\nCURRENT NODE: ${context.currentNode.id}`);
    sections.push(`NODE TITLE: ${context.currentNode.title}`);
    sections.push(`INSTRUCTION: ${context.currentNode.instruction}`);
  }

  if (context.suggestedNext && context.suggestedNext.length > 0) {
    sections.push(`\nSUGGESTED NEXT (2-3 sentences):`);
    context.suggestedNext.forEach(line => {
      sections.push(`  • "${line}"`);
    });
  }

  if (context.keyWeapon) {
    sections.push(`\nKEY WEAPON (Strongest Close):`);
    sections.push(`  Trigger: ${context.keyWeapon.trigger}`);
    sections.push(`  Use: "${context.keyWeapon.text}"`);
    sections.push(`  Context: ${context.keyWeapon.context}`);
  }

  if (context.deviationAlert && context.deviationAlert.detected) {
    sections.push(`\n⚠️ SCRIPT DEVIATION DETECTED:`);
    sections.push(`  ${context.deviationAlert.message}`);
  }

  if (context.coachingHint) {
    sections.push(`\nCOACHING: ${context.coachingHint}`);
  }

  if (context.scriptProgress) {
    sections.push(`\nPROGRESSION: ${context.scriptProgress.currentPercent}% through script`);
  }

  sections.push('---\n');
  return sections.join('\n');
}

/**
 * Detect when salesperson needs immediate coaching
 */
export function detectCoachingOpportunity(
  context: SparkScriptContextPayload,
  transcript: string
): { urgent: boolean; message: string } | null {
  // Check for script deviation
  if (context.deviationAlert?.detected) {
    return {
      urgent: true,
      message: context.deviationAlert.message
    };
  }

  // Check for objection not handled
  const commonObjections = [
    'too expensive',
    'not interested',
    'already have',
    'call back later',
    'need to think about it'
  ];

  const lowerTranscript = transcript.toLowerCase();
  for (const objection of commonObjections) {
    if (lowerTranscript.includes(objection)) {
      return {
        urgent: false,
        message: `Objection detected: "${objection}". Use script's response path.`
      };
    }
  }

  // Check if at key decision point
  if (context.currentNode?.id.includes('emergency') || context.currentNode?.id.includes('free')) {
    return {
      urgent: false,
      message: 'You\'re at a key conversion point. Deliver strong close from script.'
    };
  }

  return null;
}

/**
 * Create SPARK coaching message based on script context
 */
export function generateSparkCoachingMessage(
  context: SparkScriptContextPayload,
  situation: 'mid_call' | 'objection' | 'deviation' | 'closing'
): string {
  const messages: Record<string, string> = {
    mid_call: `Continue with: "${context.suggestedNext?.[0] || 'Next point in script'}". Key weapon if they hesitate: "${context.keyWeapon?.text}"`,
    objection: `Match this objection to script. Best response path: "${context.suggestedNext?.[0] || 'Acknowledge and redirect'}". Key weapon: "${context.keyWeapon?.text}"`,
    deviation: `${context.deviationAlert?.message || 'Get back to script'} Suggested redirect: "${context.suggestedNext?.[0]}". Strongest close: "${context.keyWeapon?.text}"`,
    closing: `You're at the close. Say: "${context.suggestedNext?.[0] || 'Let\'s schedule a time.'}" Then move to ${context.currentNode?.id || 'next step'}.`
  };

  return messages[situation] || 'Continue with next script point.';
}

/**
 * Export complete script state for session recording/playback
 */
export function exportScriptSessionState(
  state: TeleprompterState,
  context: SparkScriptContextPayload,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  const session = {
    timestamp: new Date().toISOString(),
    scriptType: state.scriptType,
    currentNodeId: state.currentNodeId,
    context,
    conversationLength: conversationHistory.length,
    transcript: conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')
  };

  return JSON.stringify(session, null, 2);
}

/**
 * Validate that SPARK's response aligns with current script context
 */
export function validateSparkResponseAlignment(
  sparkResponse: string,
  context: SparkScriptContextPayload
): { aligned: boolean; feedback: string } {
  // Check if SPARK's response mentions script elements
  const response = sparkResponse.toLowerCase();
  const context_text = (context.currentNode?.instruction || '').toLowerCase();
  const suggested = (context.suggestedNext?.join(' ') || '').toLowerCase();

  // Check for alignment
  const hasAlignment = response.includes('script') || 
                       response.includes('next') ||
                       response.includes('say') ||
                       response.includes('ask');

  if (!hasAlignment && context.enabled) {
    return {
      aligned: false,
      feedback: 'Consider grounding response in current script context.'
    };
  }

  return {
    aligned: true,
    feedback: 'Response aligns with script context.'
  };
}
