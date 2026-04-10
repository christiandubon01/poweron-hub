/**
 * HunterPitchGenerator.ts
 * HUNTER Agent — Per-lead pitch script generator
 *
 * Generates human-level, closing-ready pitch scripts for Christian Dubon using
 * Claude API. Not templates — real scripts written for each specific lead,
 * trigger, and pain point with 7 detection-driven pitch angles.
 *
 * Flow:
 *   1. selectPitchAngles(lead) analyzes lead data → picks 1–3 strongest angles
 *   2. fetchComparableJobs(lead) queries Supabase → 2–3 anonymized reference jobs
 *   3. generatePitchScript(lead, history, rules) → sends everything to Claude
 *   4. Claude returns a structured, human-sounding closing script
 */

import { callClaude, extractText } from '@/services/claudeProxy';
import { fetchFromSupabase } from '@/services/supabaseService';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** The 7 HUNTER pitch angles with detection logic */
export type PitchAngle =
  | 'urgency'
  | 'pain'
  | 'opportunity'
  | 'competitor_gap'
  | 'relationship'
  | 'seasonal'
  | 'financial';

/** Lead data shape — covers both GC contacts and service leads */
export interface HunterLead {
  id: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  jobType?: string;
  /**
   * A short description of what's known about their situation:
   * "old panel", "permit expiring", "new solar addition", etc.
   */
  situation?: string;
  /** How this lead was sourced: 'referral' | 'cold' | 'past_client' | 'gc_network' | 'google' | string */
  leadSource?: string;
  /** Any documented pain points or problems on record */
  painPoints?: string[];
  /** Tags the ops team applied: 'solar', 'panel_upgrade', 'commercial', etc. */
  tags?: string[];
  /** Date of last contact, if any */
  lastContactDate?: string;
  /** Lead creation date (ISO) */
  createdAt?: string;
  /** Whether Christian has worked with this contact or referred them before */
  isPastClient?: boolean;
  /** Whether a permit is known to be expiring soon */
  permitExpiringSoon?: boolean;
  /** Whether there is a known violation, failed inspection, or stop-work order */
  hasViolationOrFailedInspection?: boolean;
  /** Whether the job is a new build, renovation, or solar addition */
  isNewBuildOrRenovation?: boolean;
  /** True if the area lacks competing licensed C-10 contractors */
  isUnderservedArea?: boolean;
  /** True if a referral or known GC relationship exists */
  hasReferralOrGCRelationship?: boolean;
  /** Season/timing flag: summer peak load, pre-winter, permit season */
  seasonalTiming?: 'summer_ac_load' | 'pre_winter' | 'permit_season' | string;
  /** Whether rebates, incentives, or financing programs are available for this job */
  financialIncentiveAvailable?: boolean;
}

/** Past call or job history for this lead */
export interface ClientHistory {
  leadId: string;
  priorCalls?: Array<{
    date: string;
    outcome: string;
    notes?: string;
  }>;
  priorJobs?: Array<{
    jobType: string;
    value: number;
    completedAt: string;
    notes?: string;
  }>;
  relationshipStrength?: 'cold' | 'warm' | 'strong';
}

/** A confirmed rule from Christian's debrief sessions */
export interface HunterRule {
  id: string;
  trigger: string;
  responseGuidance: string;
  angleAffinity?: PitchAngle[];
}

/** An anonymized comparable completed job for social proof */
export interface ComparableJob {
  jobType: string;
  areaDescription: string;   // e.g. "Desert Hot Springs area" — never the real address
  valueRange: string;         // e.g. "$4,000–$6,000" — bucketed, not exact
  outcomeNote?: string;       // e.g. "passed city inspection first attempt"
}

/** Scored pitch angle for a lead */
export interface ScoredAngle {
  angle: PitchAngle;
  score: number;    // 0–10
  rationale: string;
}

/** The structured pitch script returned by Claude */
export interface PitchScript {
  leadId: string;
  generatedAt: string;
  anglesUsed: PitchAngle[];
  script: {
    opener: string;
    valueProp: string;
    socialProof: string;
    softAsk: string;
    objectionAnticipation: Array<{ objection: string; response: string }>;
    close: string;
  };
  rawText: string;  // Full Claude response for fallback display
}

// ─────────────────────────────────────────────────────────────────────────────
// System Prompt
// ─────────────────────────────────────────────────────────────────────────────

const HUNTER_SYSTEM_PROMPT = `You are generating a closing script for Christian Dubon, a C-10 licensed electrical contractor in Desert Hot Springs, CA. He is 24 with 7 years of field experience. Write a real human-level pitch — confident, direct, never robotic. The script must read like a contractor who knows his craft, not sales software.

Structure: Opener (why calling right now — the specific trigger), Value prop (what you solve for them), Social proof (comparable job without identifying client), Soft ask (natural next step — site visit or estimate), Objection anticipation (2-3 likely pushbacks with response language), Close (confirm appointment or next action).

Pitch angles available: urgency, pain, opportunity, competitor_gap, relationship, seasonal, financial.
Use the lead data to select the most persuasive angle combination.

Return your response as JSON matching this exact shape:
{
  "opener": "...",
  "value_prop": "...",
  "social_proof": "...",
  "soft_ask": "...",
  "objection_anticipation": [
    { "objection": "...", "response": "..." },
    { "objection": "...", "response": "..." }
  ],
  "close": "..."
}
Do not include markdown code fences. Return only the JSON object.`;

// ─────────────────────────────────────────────────────────────────────────────
// Angle Detection Logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyzes lead data and scores all 7 pitch angles.
 * Returns the 1–3 strongest angles ranked by score.
 *
 * Detection rules:
 * 1. URGENCY    — permit expiring, inspection window, violation notice
 * 2. PAIN       — old panel, failed inspection, documented problem
 * 3. OPPORTUNITY — new build, renovation, solar addition
 * 4. COMPETITOR_GAP — area underserved, local contractor dark/bad reviews
 * 5. RELATIONSHIP — past client, referral, GC worked with before
 * 6. SEASONAL   — summer AC load, pre-winter, permit season
 * 7. FINANCIAL  — incentive programs, rebates, financing available
 */
export function selectPitchAngles(lead: HunterLead): ScoredAngle[] {
  const scores: Record<PitchAngle, number> = {
    urgency: 0,
    pain: 0,
    opportunity: 0,
    competitor_gap: 0,
    relationship: 0,
    seasonal: 0,
    financial: 0,
  };

  const rationales: Record<PitchAngle, string[]> = {
    urgency: [],
    pain: [],
    opportunity: [],
    competitor_gap: [],
    relationship: [],
    seasonal: [],
    financial: [],
  };

  const situation = (lead.situation ?? '').toLowerCase();
  const tags = (lead.tags ?? []).map(t => t.toLowerCase());
  const painPoints = (lead.painPoints ?? []).map(p => p.toLowerCase());
  const source = (lead.leadSource ?? '').toLowerCase();

  // ── URGENCY ────────────────────────────────────────────────────────────────
  if (lead.permitExpiringSoon) {
    scores.urgency += 5;
    rationales.urgency.push('permit expiring soon');
  }
  if (lead.hasViolationOrFailedInspection) {
    scores.urgency += 4;
    rationales.urgency.push('violation or failed inspection on record');
  }
  if (/permit|expir|inspection window|stop.?work|violation|notice/i.test(situation)) {
    scores.urgency += 3;
    rationales.urgency.push('situation mentions urgent compliance event');
  }
  if (tags.some(t => ['permit_expiring', 'violation', 'stop_work', 'failed_inspection'].includes(t))) {
    scores.urgency += 2;
    rationales.urgency.push('urgency tag applied to lead');
  }

  // ── PAIN ──────────────────────────────────────────────────────────────────
  if (lead.hasViolationOrFailedInspection) {
    scores.pain += 4;
    rationales.pain.push('documented violation or failed inspection');
  }
  if (/old panel|outdated|federal pacific|pushmatic|60 amp|knob.?and.?tube|aluminum wiring|panel problem|tripping|flickering|burning smell|no ground/i.test(situation)) {
    scores.pain += 4;
    rationales.pain.push('old or dangerous electrical system mentioned');
  }
  if (painPoints.length > 0) {
    scores.pain += Math.min(painPoints.length * 2, 5);
    rationales.pain.push(`${painPoints.length} documented pain point(s)`);
  }
  if (/fail|problem|issue|broken|trip|overload|code violation/i.test(situation)) {
    scores.pain += 2;
    rationales.pain.push('problem language in situation notes');
  }

  // ── OPPORTUNITY ────────────────────────────────────────────────────────────
  if (lead.isNewBuildOrRenovation) {
    scores.opportunity += 6;
    rationales.opportunity.push('new build or renovation project');
  }
  if (/solar|ev charger|panel upgrade|remodel|addition|adu|accessory dwelling|new build|new construction/i.test(situation)) {
    scores.opportunity += 4;
    rationales.opportunity.push('growth/expansion job type in situation');
  }
  if (tags.some(t => ['solar', 'ev_charger', 'panel_upgrade', 'remodel', 'new_build', 'adu'].includes(t))) {
    scores.opportunity += 3;
    rationales.opportunity.push('opportunity job type tag');
  }

  // ── COMPETITOR_GAP ─────────────────────────────────────────────────────────
  if (lead.isUnderservedArea) {
    scores.competitor_gap += 6;
    rationales.competitor_gap.push('area flagged as underserved for C-10');
  }
  if (/no local|no electrician|bad reviews|last electrician|couldn't find|ghosted|overpriced|unlicensed/i.test(situation)) {
    scores.competitor_gap += 4;
    rationales.competitor_gap.push('competitor weakness or absence mentioned');
  }
  if (/desert hot springs|dhs|cathedral city|desert edge|sky valley|north palm springs/i.test((lead.city ?? '') + ' ' + situation)) {
    // DHS area is historically underserved by C-10 contractors
    scores.competitor_gap += 2;
    rationales.competitor_gap.push('geographic area typical competitor gap zone');
  }

  // ── RELATIONSHIP ───────────────────────────────────────────────────────────
  if (lead.isPastClient) {
    scores.relationship += 7;
    rationales.relationship.push('past client — known trust baseline');
  }
  if (source === 'referral') {
    scores.relationship += 6;
    rationales.relationship.push('referred lead — third-party credibility');
  }
  if (lead.hasReferralOrGCRelationship) {
    scores.relationship += 5;
    rationales.relationship.push('GC or trade relationship on record');
  }
  if (source === 'gc_network') {
    scores.relationship += 4;
    rationales.relationship.push('sourced through GC network');
  }
  if (/referral|referred|knows christian|worked with|past client|repeat/i.test(situation)) {
    scores.relationship += 3;
    rationales.relationship.push('relationship language in situation notes');
  }

  // ── SEASONAL ──────────────────────────────────────────────────────────────
  const now = new Date();
  const month = now.getMonth() + 1; // 1-indexed

  if (lead.seasonalTiming === 'summer_ac_load' || (month >= 5 && month <= 9)) {
    scores.seasonal += 4;
    rationales.seasonal.push('summer season — peak AC load, panel demand high');
  }
  if (lead.seasonalTiming === 'pre_winter' || month === 10 || month === 11) {
    scores.seasonal += 3;
    rationales.seasonal.push('pre-winter — heating loads, code compliance rush');
  }
  if (lead.seasonalTiming === 'permit_season' || month === 3 || month === 4) {
    scores.seasonal += 3;
    rationales.seasonal.push('spring permit season — city backlogs starting');
  }
  if (/summer|heat|ac load|cooling|winter prep|season/i.test(situation)) {
    scores.seasonal += 2;
    rationales.seasonal.push('seasonal language in situation notes');
  }

  // ── FINANCIAL ─────────────────────────────────────────────────────────────
  if (lead.financialIncentiveAvailable) {
    scores.financial += 6;
    rationales.financial.push('known rebate, incentive, or financing available');
  }
  if (/solar|battery|sce|sce rebate|ira|inflation reduction|utility rebate|financing|0%|zero percent/i.test(situation)) {
    scores.financial += 4;
    rationales.financial.push('financial incentive language in situation');
  }
  if (tags.some(t => ['solar', 'ev_charger', 'sce_rebate', 'ira_credit', 'financing'].includes(t))) {
    scores.financial += 3;
    rationales.financial.push('financial incentive tag on lead');
  }
  if (/cost|price|budget|expensive|afford/i.test(situation)) {
    scores.financial += 1;
    rationales.financial.push('cost sensitivity language — financial angle may help');
  }

  // ── Rank and return top 1–3 ────────────────────────────────────────────────
  const scored: ScoredAngle[] = (Object.keys(scores) as PitchAngle[])
    .filter(angle => scores[angle] > 0)
    .map(angle => ({
      angle,
      score: scores[angle],
      rationale: rationales[angle].join('; '),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  // Always return at least one angle — default to opportunity for cold leads
  if (scored.length === 0) {
    scored.push({
      angle: 'opportunity',
      score: 1,
      rationale: 'no strong signals detected — defaulting to opportunity angle',
    });
  }

  return scored;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparable Jobs Fetcher
// ─────────────────────────────────────────────────────────────────────────────

/** Supabase projects row shape (minimal — only what we need) */
interface ProjectRow {
  id: string;
  type?: string;
  status?: string;
  contract_value?: number | null;
  estimated_value?: number | null;
  address?: { city?: string; region?: string } | null;
  actual_end?: string | null;
  tags?: string[] | null;
}

/**
 * Query Supabase projects for 2–3 completed jobs similar to this lead.
 * Matches on: job type, value range, location proximity.
 * NEVER exposes client names — returns anonymized reference objects only.
 */
export async function fetchComparableJobs(lead: HunterLead): Promise<ComparableJob[]> {
  try {
    const rows = await fetchFromSupabase<ProjectRow>('projects', {
      status: 'completed',
    });

    if (!rows || rows.length === 0) return [];

    const leadJobType = (lead.jobType ?? '').toLowerCase();

    // Score each completed project for similarity
    const scored = rows
      .filter(row => row.status === 'completed')
      .map(row => {
        let sim = 0;
        const rowType = (row.type ?? '').toLowerCase().replace(/_/g, ' ');

        // Job type similarity
        if (leadJobType && rowType && rowType.includes(leadJobType.split(' ')[0])) sim += 3;
        if (
          (leadJobType.includes('solar') && rowType.includes('solar')) ||
          (leadJobType.includes('panel') && rowType.includes('panel')) ||
          (leadJobType.includes('service') && rowType.includes('service'))
        ) sim += 2;

        // Value proximity
        const val = row.contract_value ?? row.estimated_value ?? 0;
        const leadValGuess = 5000; // default estimate for unknowns
        const ratio = val > 0 ? Math.min(val, leadValGuess) / Math.max(val, leadValGuess) : 0;
        if (ratio > 0.7) sim += 2;
        else if (ratio > 0.4) sim += 1;

        // Location proximity (crude: same city or region keyword)
        const addrStr = JSON.stringify(row.address ?? '').toLowerCase();
        const leadCity = (lead.city ?? '').toLowerCase();
        if (leadCity && addrStr.includes(leadCity)) sim += 2;
        else if (addrStr.includes('desert') || addrStr.includes('palm springs') || addrStr.includes('coachella')) sim += 1;

        return { row, sim, val };
      })
      .filter(item => item.sim > 0)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 3);

    return scored.map(({ row, val }) => {
      const rowType = (row.type ?? 'electrical').replace(/_/g, ' ');
      const addrObj = row.address as { city?: string; region?: string } | null;
      const areaCity = addrObj?.city ?? addrObj?.region ?? 'the valley area';

      // Bucket the value — never expose exact contract amounts
      let valueRange: string;
      if (val <= 0) valueRange = 'custom range';
      else if (val < 2000) valueRange = 'under $2,000';
      else if (val < 5000) valueRange = '$2,000–$5,000';
      else if (val < 10000) valueRange = '$5,000–$10,000';
      else if (val < 25000) valueRange = '$10,000–$25,000';
      else valueRange = '$25,000+';

      return {
        jobType: rowType,
        areaDescription: `${areaCity} area`,
        valueRange,
        outcomeNote: row.actual_end ? 'completed on schedule' : undefined,
      } satisfies ComparableJob;
    });
  } catch (err) {
    console.warn('[HunterPitchGenerator] fetchComparableJobs error:', err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pitch Script Generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the user prompt for Claude, injecting lead data, angles, comparable
 * jobs, and any confirmed debrief rules.
 */
function buildUserPrompt(
  lead: HunterLead,
  history: ClientHistory | null,
  rules: HunterRule[],
  angles: ScoredAngle[],
  comparableJobs: ComparableJob[]
): string {
  const parts: string[] = [];

  parts.push('=== LEAD DATA ===');
  parts.push(`Name: ${lead.name}`);
  if (lead.company) parts.push(`Company: ${lead.company}`);
  if (lead.jobType) parts.push(`Job Type: ${lead.jobType}`);
  if (lead.city) parts.push(`City: ${lead.city}`);
  if (lead.situation) parts.push(`Situation: ${lead.situation}`);
  if (lead.leadSource) parts.push(`Lead Source: ${lead.leadSource}`);
  if (lead.painPoints && lead.painPoints.length > 0) {
    parts.push(`Documented Pain Points: ${lead.painPoints.join('; ')}`);
  }
  if (lead.tags && lead.tags.length > 0) {
    parts.push(`Tags: ${lead.tags.join(', ')}`);
  }
  if (lead.isPastClient) parts.push('Status: PAST CLIENT');
  if (lead.permitExpiringSoon) parts.push('⚠ PERMIT EXPIRING SOON');
  if (lead.hasViolationOrFailedInspection) parts.push('⚠ VIOLATION OR FAILED INSPECTION ON RECORD');
  if (lead.isNewBuildOrRenovation) parts.push('Project Type: New Build / Renovation');
  if (lead.financialIncentiveAvailable) parts.push('Financial Incentives: Available (rebates/financing)');

  parts.push('');
  parts.push('=== PITCH ANGLES SELECTED ===');
  angles.forEach((a, i) => {
    parts.push(`${i + 1}. ${a.angle.toUpperCase()} (score: ${a.score}/10) — ${a.rationale}`);
  });

  if (comparableJobs.length > 0) {
    parts.push('');
    parts.push('=== COMPARABLE COMPLETED JOBS (anonymized — never use real names) ===');
    comparableJobs.forEach((job, i) => {
      parts.push(
        `${i + 1}. ${job.jobType} in ${job.areaDescription}, ${job.valueRange}${job.outcomeNote ? ', ' + job.outcomeNote : ''}`
      );
    });
  }

  if (history) {
    parts.push('');
    parts.push('=== CONTACT HISTORY ===');
    parts.push(`Relationship Strength: ${history.relationshipStrength ?? 'unknown'}`);
    if (history.priorCalls && history.priorCalls.length > 0) {
      parts.push('Prior Calls:');
      history.priorCalls.forEach(c => {
        parts.push(`  - ${c.date}: ${c.outcome}${c.notes ? ' (' + c.notes + ')' : ''}`);
      });
    }
    if (history.priorJobs && history.priorJobs.length > 0) {
      parts.push('Prior Jobs:');
      history.priorJobs.forEach(j => {
        parts.push(`  - ${j.jobType} ($${j.value.toLocaleString()}) completed ${j.completedAt}`);
      });
    }
  }

  if (rules.length > 0) {
    parts.push('');
    parts.push('=== CONFIRMED DEBRIEF RULES (incorporate naturally) ===');
    rules.forEach(r => {
      parts.push(`• Trigger: "${r.trigger}" → ${r.responseGuidance}`);
    });
  }

  parts.push('');
  parts.push(
    'Write the pitch script now. Every line must sound like something a confident 24-year-old C-10 contractor with 7 years in the field would actually say — not a script reader.'
  );

  return parts.join('\n');
}

/**
 * Parse Claude's JSON response into the PitchScript shape.
 * Falls back gracefully if Claude returns malformed output.
 */
function parsePitchResponse(raw: string, lead: HunterLead, angles: ScoredAngle[]): PitchScript {
  const now = new Date().toISOString();
  const anglesUsed = angles.map(a => a.angle);

  // Attempt JSON parse
  try {
    // Strip markdown fences if Claude forgot
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    return {
      leadId: lead.id,
      generatedAt: now,
      anglesUsed,
      script: {
        opener: String(parsed.opener ?? ''),
        valueProp: String(parsed.value_prop ?? ''),
        socialProof: String(parsed.social_proof ?? ''),
        softAsk: String(parsed.soft_ask ?? ''),
        objectionAnticipation: Array.isArray(parsed.objection_anticipation)
          ? (parsed.objection_anticipation as Array<Record<string, unknown>>).map(o => ({
              objection: String(o.objection ?? ''),
              response: String(o.response ?? ''),
            }))
          : [],
        close: String(parsed.close ?? ''),
      },
      rawText: raw,
    };
  } catch {
    // If parse fails, return raw text only — calling code can display rawText
    return {
      leadId: lead.id,
      generatedAt: now,
      anglesUsed,
      script: {
        opener: '',
        valueProp: '',
        socialProof: '',
        softAsk: '',
        objectionAnticipation: [],
        close: '',
      },
      rawText: raw,
    };
  }
}

/**
 * Generate a human-level pitch script for a specific lead.
 *
 * @param lead          - The lead data record
 * @param clientHistory - Prior contact/job history for this lead (or null)
 * @param rules         - Confirmed HUNTER debrief rules to incorporate
 * @returns             A structured PitchScript with raw text fallback
 */
export async function generatePitchScript(
  lead: HunterLead,
  clientHistory: ClientHistory | null,
  rules: HunterRule[]
): Promise<PitchScript> {
  // Step 1: Detect strongest pitch angles
  const angles = selectPitchAngles(lead);

  // Step 2: Fetch comparable completed jobs from Supabase
  const comparableJobs = await fetchComparableJobs(lead);

  // Step 3: Build the user prompt
  const userPrompt = buildUserPrompt(lead, clientHistory, rules, angles, comparableJobs);

  // Step 4: Call Claude
  const response = await callClaude({
    messages: [{ role: 'user', content: userPrompt }],
    system: HUNTER_SYSTEM_PROMPT,
    max_tokens: 1800,
  });

  const rawText = extractText(response);

  // Step 5: Parse and return
  return parsePitchResponse(rawText, lead, angles);
}
