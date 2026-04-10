/**
 * SPARK Script Library
 * Comprehensive cold call script management for Christian's real sales methodology
 * Vendor, Sub, GC, Homeowner, and Solar scripts with decision tree branching
 * 
 * Scripts loaded from real-world cold call experience with property managers,
 * GCs, homeowners, and solar companies.
 */

import {
  Script,
  ScriptNode,
  ScriptType,
  LeadResponse,
  getScript as getTeleprompterScript,
  classifyLeadResponse as classifyResponse
} from './SparkTeleprompter';

// ============================================================================
// SCRIPT LIBRARY PUBLIC API
// ============================================================================

/**
 * Key weapon (strongest closing angle) for each script type at critical moments
 */
export interface KeyWeapon {
  trigger: string; // What triggers this weapon
  text: string; // The specific phrase to use
  context: string; // When/why to use it
}

/**
 * Script context for SPARK coaching
 */
export interface ScriptContext {
  scriptType: ScriptType;
  currentNodeId: string;
  currentNodeText: string;
  suggestedNext: string[]; // 2-3 sentences from script
  keyWeapon: KeyWeapon;
  scriptPath: string[]; // Breadcrumb trail of nodes
  progressPercent: number;
}

/**
 * Load a complete script by type
 * Returns the full decision tree for teleprompter display
 */
export function loadScript(type: ScriptType): Script {
  return getTeleprompterScript(type);
}

/**
 * Get all available scripts
 */
export function getAllScripts(): Record<ScriptType, Script> {
  return {
    vendor: loadScript('vendor'),
    sub: loadScript('sub'),
    homeowner: loadScript('homeowner'),
    solar: loadScript('solar')
  };
}

/**
 * Get script metadata for UI display
 */
export function getScriptMetadata(type: ScriptType) {
  const script = loadScript(type);
  return {
    type: script.type,
    name: script.name,
    description: script.description,
    nodeCount: Object.keys(script.nodes).length
  };
}

// ============================================================================
// KEY WEAPONS (STRONGEST CLOSES BY SCRIPT)
// ============================================================================

const VENDOR_KEY_WEAPONS: Record<string, KeyWeapon> = {
  emergency_availability: {
    trigger: 'prospect hesitates on after-hours support',
    text: 'Is your contractor available for emergency calls after hours? Because that\'s usually the gap.',
    context: 'Vendor script - use when property manager uncertain about emergency response'
  },
  social_proof: {
    trigger: 'prospect asks about experience',
    text: 'We\'ve handled 3 emergency calls this month alone on similar properties—always under 45 minutes.',
    context: 'Vendor script - use when prospect wants proof of capability'
  },
  pain_point: {
    trigger: 'prospect mentions tenant complaints',
    text: 'That\'s exactly why we do free audits—we find code issues before they become tenant emergencies.',
    context: 'Vendor script - strongest pain-point connection'
  }
};

const SUB_KEY_WEAPONS: Record<string, KeyWeapon> = {
  emergency_availability: {
    trigger: 'GC asks about turnaround on remodels',
    text: 'Is your contractor available for emergency calls after hours? Because that\'s usually the gap.',
    context: 'Sub script - use when GC worried about project delays'
  },
  compliance_angle: {
    trigger: 'GC worried about code violations',
    text: 'When you have a code violation or panel upgrade that needs inspection, you need someone licensed and bonded who can turn it around fast.',
    context: 'Sub script - strongest compliance/inspection angle'
  },
  volume_pricing: {
    trigger: 'GC asks about pricing',
    text: 'The more remodels you send, the better our rate. Volume pricing for regular subs.',
    context: 'Sub script - use when GC ready to commit to partnership'
  }
};

const HOMEOWNER_KEY_WEAPONS: Record<string, KeyWeapon> = {
  safety_angle: {
    trigger: 'homeowner hesitates on inspection',
    text: 'Free inspection takes 15 minutes and might catch something that could cost you thousands in a fire or injury claim.',
    context: 'Homeowner script - safety concern is strongest motivator'
  },
  local_trust: {
    trigger: 'homeowner skeptical',
    text: 'We\'re local, licensed, insured, and we stand behind every job. No surprise bills.',
    context: 'Homeowner script - trust/local presence is key'
  }
};

const SOLAR_KEY_WEAPONS: Record<string, KeyWeapon> = {
  permit_angle: {
    trigger: 'solar company worried about inspection delays',
    text: 'Permit paperwork and city inspections—that\'s where you lose 2-3 weeks per install. We handle it.',
    context: 'Solar script - time savings is strongest motivator'
  },
  volume_terms: {
    trigger: 'solar company asks about pricing',
    text: 'How many systems do you install per month? I can put together a volume pricing plan that saves you money per install.',
    context: 'Solar script - use when exploring partnership depth'
  }
};

/**
 * Get the key weapon for a specific script at a specific moment
 */
export function getKeyWeapon(scriptType: ScriptType, nodeId: string): KeyWeapon | null {
  const weapons = {
    vendor: VENDOR_KEY_WEAPONS,
    sub: SUB_KEY_WEAPONS,
    homeowner: HOMEOWNER_KEY_WEAPONS,
    solar: SOLAR_KEY_WEAPONS
  };

  const weaponMap = weapons[scriptType];
  
  // Map node context to weapon
  if (nodeId.includes('emergency')) {
    return weaponMap.emergency_availability || null;
  }
  if (nodeId.includes('safety') || nodeId.includes('inspection')) {
    return weaponMap.safety_angle || null;
  }
  if (nodeId.includes('schedule') || nodeId.includes('close')) {
    return weaponMap.volume_pricing || weaponMap.permit_angle || null;
  }

  return null;
}

// ============================================================================
// SCRIPT NAVIGATION & CONTEXT
// ============================================================================

/**
 * Track position in conversation and identify current node in script
 * Called by SPARK to understand where call is in the decision tree
 */
export function getCurrentNode(
  scriptType: ScriptType,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
): { nodeId: string; node: ScriptNode; confidence: number } {
  const script = loadScript(scriptType);
  
  if (conversationHistory.length === 0) {
    const startNode = script.nodes[script.startNodeId];
    return {
      nodeId: script.startNodeId,
      node: startNode,
      confidence: 1.0
    };
  }

  // Get last user message (prospect's response)
  const lastUserMsg = conversationHistory
    .reverse()
    .find(msg => msg.role === 'user')?.content || '';

  // Classify response to determine position in decision tree
  const response = classifyResponse(lastUserMsg);
  
  // Infer current node from conversation context
  // This is simplified; in production, use Claude to classify more accurately
  let currentNodeId = script.startNodeId;
  let confidence = 0.6;

  // Walk through conversation history to determine most likely current node
  for (const msg of conversationHistory) {
    if (msg.role === 'assistant') {
      // Check which node's sentences appear in assistant message
      for (const [nodeId, node] of Object.entries(script.nodes)) {
        const nodeText = node.sentences.join(' ').toLowerCase();
        const msgText = msg.content.toLowerCase();
        
        if (nodeText.includes(msgText.slice(0, 20))) {
          currentNodeId = nodeId;
          confidence = 0.8;
          break;
        }
      }
    }
  }

  const node = script.nodes[currentNodeId];
  return { nodeId: currentNodeId, node, confidence };
}

/**
 * Get next suggested lines from the script
 * Returns 2-3 sentences to say next
 */
export function getNextSuggestedLines(
  scriptType: ScriptType,
  nodeId: string
): string[] {
  const script = loadScript(scriptType);
  const node = script.nodes[nodeId];

  if (!node) {
    return [];
  }

  return node.sentences.slice(0, 3); // First 3 sentences of node
}

/**
 * Get objection response from script
 * Matches common objections to the script's canned responses
 */
export function getObjectionResponse(
  scriptType: ScriptType,
  objection: string
): { response: string; nextNodeId: string } | null {
  const script = loadScript(scriptType);
  const lower = objection.toLowerCase();

  // Map objections to script paths
  const objectionMap: Record<string, { classification: LeadResponse; advice: string }> = {
    'too busy': { classification: 'WORKABLE', advice: 'Not interested today, but workable' },
    "don't need": { classification: 'NOT_INTERESTED', advice: 'Hard no - use graceful exit' },
    'already have': { classification: 'WORKABLE', advice: 'Has contractor, but could be backup' },
    'too expensive': { classification: 'WORKABLE', advice: 'Price objection - mention value' },
    'call back later': { classification: 'INTERESTED', advice: 'Interest, just timing' },
    'no thanks': { classification: 'NOT_INTERESTED', advice: 'Polite rejection' }
  };

  for (const [keyword, meta] of Object.entries(objectionMap)) {
    if (lower.includes(keyword)) {
      // Find a node that matches this objection type
      for (const [nodeId, node] of Object.entries(script.nodes)) {
        if (node.branches && node.branches[meta.classification]) {
          const nextNodeId = node.branches[meta.classification];
          if (nextNodeId) {
            return {
              response: meta.advice,
              nextNodeId
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Detect when salesperson skipped a critical script element
 */
export function detectScriptDeviation(
  scriptType: ScriptType,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  currentNodeId: string
): { deviated: boolean; message: string } {
  const script = loadScript(scriptType);
  const fullConversation = conversationHistory.map(msg => msg.content).join(' ').toLowerCase();

  // Check for missing key elements by script type
  const deviationChecks: Record<ScriptType, { phrase: string; message: string }[]> = {
    vendor: [
      {
        phrase: 'after hours',
        message: 'You skipped the emergency availability question—that\'s your strongest close'
      },
      {
        phrase: 'free inspection',
        message: 'Missing the free inspection offer—that\'s the conversion trigger'
      }
    ],
    sub: [
      {
        phrase: 'licensed and bonded',
        message: 'You skipped compliance angle—GCs care about code violations'
      },
      {
        phrase: 'emergency wiring',
        message: 'Missing emergency availability—that\'s your strongest positioning'
      }
    ],
    homeowner: [
      {
        phrase: 'safety',
        message: 'Safety angle not emphasized—that\'s the strongest motivator for homeowners'
      },
      {
        phrase: 'fire hazard',
        message: 'Missing the fire safety concern—use that to drive urgency'
      }
    ],
    solar: [
      {
        phrase: 'permit',
        message: 'Permit angle missing—inspections/paperwork is their biggest pain point'
      },
      {
        phrase: 'volume',
        message: 'Haven\'t discussed volume pricing—that\'s how you close the partnership'
      }
    ]
  };

  const checks = deviationChecks[scriptType];
  for (const check of checks) {
    if (!fullConversation.includes(check.phrase.toLowerCase())) {
      return {
        deviated: true,
        message: check.message
      };
    }
  }

  return { deviated: false, message: '' };
}

/**
 * Build full script context for SPARK coaching
 * Returns everything SPARK needs to coach the salesperson
 */
export function buildScriptContext(
  scriptType: ScriptType,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  currentNodeId?: string
): ScriptContext {
  const script = loadScript(scriptType);
  
  const { nodeId, node, confidence } = currentNodeId
    ? { nodeId: currentNodeId, node: script.nodes[currentNodeId], confidence: 1.0 }
    : getCurrentNode(scriptType, conversationHistory);

  const keyWeapon = getKeyWeapon(scriptType, nodeId);
  const suggestedNext = getNextSuggestedLines(scriptType, nodeId);

  // Calculate progress through script
  const nodeIds = Object.keys(script.nodes);
  const nodeIndex = nodeIds.indexOf(nodeId);
  const progressPercent = nodeIndex >= 0 ? Math.round((nodeIndex / nodeIds.length) * 100) : 0;

  // Build script path (breadcrumb trail)
  const scriptPath = ['start'];
  for (let i = 0; i <= nodeIndex && i < nodeIds.length; i++) {
    scriptPath.push(nodeIds[i]);
  }

  return {
    scriptType,
    currentNodeId: nodeId,
    currentNodeText: node.text,
    suggestedNext,
    keyWeapon: keyWeapon || { trigger: 'default', text: suggestedNext[0] || '', context: 'Next in script' },
    scriptPath: scriptPath.slice(-5), // Last 5 nodes
    progressPercent
  };
}

/**
 * Export all scripts as JSON (for backup/import)
 */
export function exportAllScripts(): string {
  const scripts = getAllScripts();
  return JSON.stringify(scripts, null, 2);
}

/**
 * Get script statistics for reporting
 */
export function getScriptStats(scriptType: ScriptType) {
  const script = loadScript(scriptType);
  const nodes = Object.values(script.nodes);
  
  const terminalNodes = nodes.filter(n => n.isTerminal).length;
  const branchNodes = nodes.filter(n => n.branches).length;
  const totalSentences = nodes.reduce((sum, n) => sum + n.sentences.length, 0);

  return {
    type: scriptType,
    totalNodes: nodes.length,
    terminalNodes,
    branchNodes,
    totalSentences,
    averageSentencesPerNode: Math.round(totalSentences / nodes.length * 10) / 10
  };
}
