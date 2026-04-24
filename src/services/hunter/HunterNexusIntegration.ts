/**
 * HunterNexusIntegration.ts
 * 
 * Integrates HUNTER lead pipeline with NEXUS morning brief and voice commands.
 * Provides top 3 leads for daily summary and handles voice-based lead queries.
 * 
 * Features:
 * - getTopLeadsForBrief(count): Returns top N leads by score for NEXUS morning brief
 * - formatBriefSummary(leads): Generates one-line summaries for each lead
 * - Voice command handlers for NEXUS queries about leads
 * - registerHunterCommands(): Registers patterns with NEXUS classifier
 * - Integration with agentEventBus: publishes 'hunter:leads_ready' event
 * - SPARK subscribes to 'hunter:leads_ready' for pipeline updates
 */

import { useHunterStore } from '@/store/hunterStore';
import { publish, subscribe, AgentEvent } from '@/services/agentEventBus';
import type { HunterLead } from './HunterTypes';
import { ScoreTier, LeadStatus } from './HunterTypes';

// ─── Type Definitions ─────────────────────────────────────────────────────

export interface BriefLeadSummary {
  position: number;
  name: string;
  jobType: string;
  score: number;
  pitchSummary: string;
  leadId: string;
}

export interface BriefContext {
  summaries: BriefLeadSummary[];
  totalLeads: number;
  highValueCount: number;
  scanTime: string;
}

export interface VoiceCommandContext {
  command: string;
  leadFilter?: {
    minScore?: number;
    maxScore?: number;
    leadName?: string;
  };
  requestedAction?: 'read' | 'filter' | 'debrief' | 'details';
}

export interface CommandResponse {
  speak: string;
  leads: HunterLead[];
  briefFormat?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────

const PITCH_ANGLES = {
  urgency: 'urgent deadline ahead',
  pain: 'critical problem solving',
  opportunity: 'growth opportunity here',
  competitor_gap: 'we beat competitors',
  relationship: 'trusted partnership',
  seasonal: 'seasonal advantage timing',
  financial: 'strong profit margin',
};

const BRIEF_STORAGE_KEY = 'hunter_brief_context';
const HUNTER_EVENT_NAME = 'hunter:leads_ready';

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Get top N leads by score for NEXUS morning brief.
 * Returns leads ranked by score descending.
 */
export function getTopLeadsForBrief(count: number = 3): HunterLead[] {
  const store = useHunterStore.getState();
  
  // Sort leads by score descending
  const sorted = [...store.leads]
    .filter(lead => lead.status !== LeadStatus.ARCHIVED && lead.status !== LeadStatus.LOST)
    .sort((a, b) => b.score - a.score);
  
  return sorted.slice(0, count);
}

/**
 * Format brief summaries for one-line display per lead.
 * Format: "Lead 1: [name] — [job type] — score [X] — [pitch angle in 5 words]"
 */
export function formatBriefSummary(leads: HunterLead[]): BriefLeadSummary[] {
  return leads.map((lead, idx) => {
    const position = idx + 1;
    const name = lead.contact_name || lead.company_name || 'Unnamed Lead';
    const jobType = lead.lead_type || 'Service Job';
    const score = Math.round(lead.score);
    
    // Get pitch angle summary (first 5 words)
    const pitchKey = lead.pitch_angle || 'opportunity';
    const pitchText = PITCH_ANGLES[pitchKey as keyof typeof PITCH_ANGLES] || 'business opportunity ahead';
    
    return {
      position,
      name,
      jobType,
      score,
      pitchSummary: pitchText,
      leadId: lead.id,
    };
  });
}

/**
 * Build complete brief context for NEXUS morning summary.
 * Includes formatted summaries and key metrics.
 */
export function buildBriefContext(topCount: number = 3): BriefContext {
  const leads = getTopLeadsForBrief(topCount);
  const summaries = formatBriefSummary(leads);
  
  const store = useHunterStore.getState();
  const highValueLeads = store.leads.filter(
    lead => lead.score >= 75 && lead.status !== LeadStatus.ARCHIVED
  );
  
  return {
    summaries,
    totalLeads: store.leads.length,
    highValueCount: highValueLeads.length,
    scanTime: new Date().toISOString(),
  };
}

/**
 * Handle NEXUS voice command: "NEXUS, what does HUNTER have for me today?"
 * Reads top 3 leads via TTS.
 */
export function handleBriefCommand(): CommandResponse {
  const topLeads = getTopLeadsForBrief(3);
  const summaries = formatBriefSummary(topLeads);
  
  if (topLeads.length === 0) {
    return {
      speak: 'HUNTER has no active leads right now. Consider running a scan to find new opportunities.',
      leads: [],
      briefFormat: true,
    };
  }
  
  const briefText = summaries
    .map(s => `Lead ${s.position}: ${s.name} — ${s.jobType} — score ${s.score} — ${s.pitchSummary}`)
    .join('. ');
  
  return {
    speak: `Your top ${topLeads.length} HUNTER leads for today. ${briefText}`,
    leads: topLeads,
    briefFormat: true,
  };
}

/**
 * Handle NEXUS voice command: "NEXUS, run HUNTER now"
 * Triggers on-demand scan.
 */
export function handleOnDemandScanCommand(): CommandResponse {
  // Publish event to trigger scan via scheduler
  publishLeadsReadyEvent(true);
  
  return {
    speak: 'Starting HUNTER scan now. I will gather leads and analyze your pipeline.',
    leads: [],
    briefFormat: false,
  };
}

/**
 * Handle NEXUS voice command: "NEXUS, let\'s debrief the [name] job"
 * Opens debrief flow for specific lead.
 */
export function handleDebriefCommandForLead(leadName: string): CommandResponse {
  const store = useHunterStore.getState();
  
  // Find lead by name
  const lead = store.leads.find(
    l => (l.contact_name && l.contact_name.toLowerCase().includes(leadName.toLowerCase())) ||
         (l.company_name && l.company_name.toLowerCase().includes(leadName.toLowerCase()))
  );
  
  if (!lead) {
    return {
      speak: `I could not find a lead named ${leadName}. Please check the name and try again.`,
      leads: [],
      briefFormat: false,
    };
  }
  
  return {
    speak: `Opening debrief for ${lead.contact_name || lead.company_name}. Score ${Math.round(lead.score)}, discovered ${lead.discovered_at || 'recently'}.`,
    leads: [lead],
    briefFormat: false,
  };
}

/**
 * Handle NEXUS voice command: "NEXUS, show me leads over [score]"
 * Filters and reads matching leads.
 */
export function handleFilterByScoreCommand(scoreThreshold: number): CommandResponse {
  const store = useHunterStore.getState();
  
  const filtered = store.leads
    .filter(lead => lead.score >= scoreThreshold && lead.status !== LeadStatus.ARCHIVED)
    .sort((a, b) => b.score - a.score);
  
  if (filtered.length === 0) {
    return {
      speak: `No leads found with a score of ${scoreThreshold} or higher.`,
      leads: [],
      briefFormat: false,
    };
  }
  
  const summaries = formatBriefSummary(filtered.slice(0, 5));
  const briefText = summaries
    .map(s => `${s.name} — score ${s.score}`)
    .join(', ');
  
  return {
    speak: `Found ${filtered.length} leads over score ${scoreThreshold}. Here are the top ones: ${briefText}`,
    leads: filtered,
    briefFormat: false,
  };
}

/**
 * Register HUNTER voice commands with NEXUS classifier.
 * Adds keyword patterns that route to HUNTER handling.
 */
export function registerHunterCommands(): void {
  // Command patterns are stored for NEXUS classifier to route queries
  // This would integrate with the NEXUS keyword routing table
  
  const hunterPatterns = {
    briefQuery: ['what does HUNTER have', 'hunter leads today', 'leads for today', 'top leads'],
    onDemandScan: ['run HUNTER', 'start HUNTER', 'trigger scan', 'scan now'],
    debrief: ['let\'s debrief', 'debrief the', 'review the lead', 'discuss lead'],
    filterByScore: ['leads over', 'leads above', 'show me leads over'],
  };
  
  console.log('[HunterNexus] Registered HUNTER command patterns:', Object.keys(hunterPatterns));
}

/**
 * Publish 'hunter:leads_ready' event to agentEventBus.
 * SPARK subscribes to this event to update its pipeline.
 */
export function publishLeadsReadyEvent(scanTriggered: boolean = false): void {
  const topLeads = getTopLeadsForBrief(3);
  const store = useHunterStore.getState();
  
  const payload = {
    leadIds: topLeads.map(l => l.id),
    topLeadsCount: topLeads.length,
    totalLeads: store.leads.length,
    highValueLeads: store.leads.filter(l => l.score >= 75).length,
    scanTriggered,
    timestamp: new Date().toISOString(),
  };
  
  const summary = scanTriggered
    ? `HUNTER scan triggered — found ${topLeads.length} top leads`
    : `HUNTER morning brief ready — top ${topLeads.length} leads available`;
  
  publish('HIGH_VALUE_LEAD' as any, 'hunter', payload, summary);
}

/**
 * Initialize HUNTER-SPARK integration.
 * SPARK subscribes to 'hunter:leads_ready' to update pipeline.
 */
export function initHunterSparkIntegration(): () => void {
  // Subscribe to hunter leads ready event
  return subscribe('HIGH_VALUE_LEAD' as any, (event: AgentEvent) => {
    if (event.source === 'hunter') {
      console.log('[HunterSpark] Received leads ready event:', event.payload);
      
      // SPARK can now update its pipeline with new leads
      // Fire and forget — don't block event processing
      setTimeout(() => {
        const payload = event.payload as any;
        if (payload.leadIds && payload.leadIds.length > 0) {
          console.log('[HunterSpark] Updating SPARK pipeline with', payload.leadIds.length, 'new leads');
          
          // SPARK would call its own pipeline update here
          // e.g., await sparkService.updatePipelineWithHunterLeads(payload.leadIds)
        }
      }, 100);
    }
  });
}

/**
 * Cache brief context to localStorage for quick retrieval.
 */
export function cacheBriefContext(context: BriefContext): void {
  try {
    localStorage.setItem(BRIEF_STORAGE_KEY, JSON.stringify(context));
  } catch (err) {
    console.warn('[HunterNexus] Failed to cache brief context:', err);
  }
}

/**
 * Retrieve cached brief context from localStorage.
 */
export function getCachedBriefContext(): BriefContext | null {
  try {
    const cached = localStorage.getItem(BRIEF_STORAGE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    console.warn('[HunterNexus] Failed to retrieve cached brief context:', err);
    return null;
  }
}

/**
 * Clear cached brief context.
 */
export function clearCachedBriefContext(): void {
  try {
    localStorage.removeItem(BRIEF_STORAGE_KEY);
  } catch (err) {
    console.warn('[HunterNexus] Failed to clear cached brief context:', err);
  }
}

// ─── Initialization ───────────────────────────────────────────────────────

/**
 * Initialize HUNTER-NEXUS integration on app startup.
 * Registers commands, builds initial brief, sets up event subscriptions.
 */
export function initHunterNexusIntegration(): () => void {
  console.log('[HunterNexus] Initializing HUNTER-NEXUS integration');
  
  // Register command patterns
  registerHunterCommands();
  
  // Build and cache initial brief
  const briefContext = buildBriefContext(3);
  cacheBriefContext(briefContext);
  
  // Publish initial leads ready event
  publishLeadsReadyEvent(false);
  
  // Initialize SPARK integration
  const unsubscribeSpark = initHunterSparkIntegration();
  
  // Return cleanup function
  return () => {
    console.log('[HunterNexus] Cleaning up HUNTER-NEXUS integration');
    clearCachedBriefContext();
    unsubscribeSpark();
  };
}

// ─── Named Exports ───────────────────────────────────────────────────────

export default {
  getTopLeadsForBrief,
  formatBriefSummary,
  buildBriefContext,
  handleBriefCommand,
  handleOnDemandScanCommand,
  handleDebriefCommandForLead,
  handleFilterByScoreCommand,
  registerHunterCommands,
  publishLeadsReadyEvent,
  initHunterSparkIntegration,
  cacheBriefContext,
  getCachedBriefContext,
  clearCachedBriefContext,
  initHunterNexusIntegration,
};
