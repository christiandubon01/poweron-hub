/**
 * src/services/hunter/HunterPlaybookGenerator.ts
 * HUNTER Agent — Expansion Playbook Generator (HT8)
 *
 * For leads scoring 40–59 ("Expansion" tier), generates a numbered step-by-step
 * playbook showing exactly how Power On Solutions can grow to win that job type.
 *
 * PUBLIC API:
 *   generatePlaybook(lead, capacityContext?)  → Promise<ExpansionPlaybookStep[]>
 *   savePlaybook(leadId, steps)               → Promise<SavedPlaybook>
 *   updateStepStatus(playbookId, stepId, checked, notes?)  → Promise<void>
 *   checkPlaybookProgress(playbookId)         → Promise<PlaybookProgress>
 *
 * Side-effects:
 *   - checkPlaybookProgress() auto-triggers HUNTER re-score when progress > 70%
 *
 * Supabase tables used:
 *   hunter_playbooks  — one row per lead, JSON column for steps array
 *   crew_members      — for current capacity context
 *   projects          — for active project context
 */

import { callClaude, extractText } from '@/services/claudeProxy';
import { supabase } from '@/lib/supabase';
import { fetchFromSupabase } from '@/services/supabaseService';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PlaybookCategory =
  | 'crew'
  | 'financial'
  | 'licensing'
  | 'timeline'
  | 'materials'
  | 'client'
  | 'subcontractor'
  | 'permitting'
  | 'gap_analysis';

export interface ExpansionPlaybookStep {
  /** Unique step identifier within the playbook, e.g. "step_001" */
  id: string;
  /** Step number (1-indexed display) */
  step_number: number;
  /** Human-readable action text */
  text: string;
  /** Category bucket for grouping and color-coding */
  category: PlaybookCategory;
  /** Rough number of days this step might take */
  estimated_days: number;
  /** Step IDs that must be completed before this step */
  dependencies: string[];
  /** Whether this step has been checked off */
  checked: boolean;
  /** Optional user notes on this step */
  notes?: string;
}

export interface SavedPlaybook {
  /** UUID from Supabase */
  id: string;
  lead_id: string;
  steps: ExpansionPlaybookStep[];
  created_at: string;
  updated_at: string;
}

export interface PlaybookProgress {
  playbook_id: string;
  lead_id: string;
  total_steps: number;
  completed_steps: number;
  completion_pct: number;
  /** True when completion_pct > 70 — triggers HUNTER re-score */
  rescore_triggered: boolean;
}

/** Minimal lead shape expected by the generator */
export interface PlaybookLeadInput {
  id: string;
  contact_name?: string;
  company_name?: string;
  lead_type?: string;
  description?: string;
  estimated_value?: number;
  score?: number;
  notes?: string;
  city?: string;
  address?: string;
}

/** Capacity context pulled from Supabase crew / project tables */
export interface CapacityContext {
  active_crew_count?: number;
  crew_skills?: string[];
  active_project_count?: number;
  active_project_types?: string[];
  bonding_limit?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildStepId(index: number): string {
  return `step_${String(index + 1).padStart(3, '0')}`;
}

/**
 * Fetch current capacity context from Supabase.
 * Gracefully falls back to empty context if tables don't exist yet.
 */
async function fetchCapacityContext(): Promise<CapacityContext> {
  try {
    const [crewResult, projectResult] = await Promise.all([
      (supabase as any).from('crew_members').select('id, role, skills').limit(50),
      (supabase as any)
        .from('projects')
        .select('id, type, status')
        .eq('status', 'active')
        .limit(50),
    ]);

    const crew = crewResult.data ?? [];
    const projects = projectResult.data ?? [];

    const allSkills: string[] = [];
    for (const member of crew as Array<Record<string, unknown>>) {
      if (Array.isArray(member.skills)) {
        for (const skill of member.skills) {
          if (typeof skill === 'string') allSkills.push(skill);
        }
      } else if (typeof member.role === 'string') {
        allSkills.push(member.role);
      }
    }

    const uniqueSkills: string[] = [...new Set(allSkills)];
    const projectTypes: string[] = [
      ...new Set(
        (projects as Array<Record<string, unknown>>)
          .map((p) => p.type)
          .filter((t): t is string => typeof t === 'string')
      ),
    ];

    return {
      active_crew_count: crew.length,
      crew_skills: uniqueSkills,
      active_project_count: projects.length,
      active_project_types: projectTypes,
    };
  } catch (_err) {
    // Tables may not exist in dev — return empty context
    return {};
  }
}

/**
 * Parse the raw Claude JSON response into typed steps.
 * Robust to partial / malformed Claude output.
 */
function parseClaudeSteps(raw: string): ExpansionPlaybookStep[] {
  let parsed: unknown;

  try {
    // Claude may wrap in markdown code fences
    const cleaned = raw
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    parsed = JSON.parse(cleaned);
  } catch (_parseErr) {
    // Attempt to extract a JSON array from the text
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  const VALID_CATEGORIES: PlaybookCategory[] = [
    'crew',
    'financial',
    'licensing',
    'timeline',
    'materials',
    'client',
    'subcontractor',
    'permitting',
    'gap_analysis',
  ];

  return (parsed as unknown[]).slice(0, 50).map((item, index) => {
    const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const rawCategory = (typeof obj.category === 'string' ? obj.category : 'gap_analysis').toLowerCase();
    const category: PlaybookCategory = VALID_CATEGORIES.includes(rawCategory as PlaybookCategory)
      ? (rawCategory as PlaybookCategory)
      : 'gap_analysis';

    return {
      id: typeof obj.id === 'string' ? obj.id : buildStepId(index),
      step_number: typeof obj.step_number === 'number' ? obj.step_number : index + 1,
      text: typeof obj.text === 'string' ? obj.text : String(obj.text ?? `Step ${index + 1}`),
      category,
      estimated_days: typeof obj.estimated_days === 'number' ? obj.estimated_days : 7,
      dependencies: Array.isArray(obj.dependencies) ? (obj.dependencies as string[]) : [],
      checked: false,
      notes: '',
    };
  });
}

// ─── Core Functions ────────────────────────────────────────────────────────────

/**
 * generatePlaybook
 *
 * Calls Claude to produce a numbered expansion playbook (up to 50 steps) for a
 * lead that scored 40–59, covering gap analysis through final close sequence.
 *
 * @param lead            — the expansion lead
 * @param capacityContext — optional override; auto-fetched from Supabase if omitted
 */
export async function generatePlaybook(
  lead: PlaybookLeadInput,
  capacityContext?: CapacityContext
): Promise<ExpansionPlaybookStep[]> {
  const capacity = capacityContext ?? (await fetchCapacityContext());

  const capacitySummary = JSON.stringify(
    {
      active_crew: capacity.active_crew_count ?? 'unknown',
      skills_on_hand: capacity.crew_skills?.slice(0, 20) ?? [],
      active_projects: capacity.active_project_count ?? 'unknown',
      current_job_types: capacity.active_project_types?.slice(0, 10) ?? [],
    },
    null,
    2
  );

  const leadSummary = JSON.stringify(
    {
      id: lead.id,
      contact: lead.contact_name ?? 'Unknown',
      company: lead.company_name ?? 'N/A',
      job_type: lead.lead_type ?? 'General electrical',
      estimated_value: lead.estimated_value ?? 'Unknown',
      description: lead.description ?? '',
      score: lead.score ?? 'N/A',
      city: lead.city ?? '',
      notes: lead.notes ?? '',
    },
    null,
    2
  );

  const systemPrompt = `You are the HUNTER expansion playbook engine for Power On Solutions LLC, a California electrical contractor.
Your job is to create a concrete, actionable numbered expansion playbook for a lead that scored 40–59.
This score means the lead is valuable but outside current capacity or expertise.
Return ONLY a valid JSON array — no markdown, no extra text.`;

  const userPrompt = `This lead scored ${lead.score ?? '40-59'} — valuable but outside current capacity.

Lead data:
${leadSummary}

Current capacity context:
${capacitySummary}

Generate a numbered expansion playbook (up to 50 steps) covering ALL of the following areas:
1. Gap analysis — what you have vs what this job needs
2. Crew requirements — headcount, skills, equipment
3. Financial requirements — working capital, bonding
4. Timeline — realistic readiness date
5. Permitting/licensing if outside current scope
6. Material/supplier needs
7. Subcontractor partnerships to bridge gaps
8. Client warmth maintenance — keep lead engaged while preparing
9. Final close sequence — how to re-engage when ready

Return a JSON array where each element has exactly these fields:
{
  "id": "step_001",
  "step_number": 1,
  "text": "Concrete action step text",
  "category": "gap_analysis" | "crew" | "financial" | "licensing" | "timeline" | "materials" | "client" | "subcontractor" | "permitting",
  "estimated_days": <integer number of days for this step>,
  "dependencies": ["step_001", "step_002"]
}

Rules:
- Each step must be specific and actionable for an electrical contractor
- Distribute steps across all 9 categories
- estimated_days must be a realistic integer (1–90)
- dependencies must reference valid step IDs that appear earlier in the array
- Return 20–50 steps — the more specific the better
- NO markdown. Return only the raw JSON array.`;

  try {
    const response = await callClaude({
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
      max_tokens: 4096,
    });

    const rawText = extractText(response);
    const steps = parseClaudeSteps(rawText);

    if (steps.length === 0) {
      console.warn('[HunterPlaybookGenerator] Claude returned no parseable steps — using fallback');
      return buildFallbackSteps(lead);
    }

    return steps;
  } catch (err) {
    console.warn('[HunterPlaybookGenerator] generatePlaybook error:', err);
    return buildFallbackSteps(lead);
  }
}

/**
 * Fallback playbook if Claude is unavailable.
 * Covers the 9 required categories with generic electrical contractor steps.
 */
function buildFallbackSteps(lead: PlaybookLeadInput): ExpansionPlaybookStep[] {
  const jobType = lead.lead_type ?? 'this job type';
  const items: Array<[string, PlaybookCategory, number, string[]]> = [
    [`Conduct gap analysis: list skills/equipment needed for ${jobType} vs what you currently have`, 'gap_analysis', 3, []],
    [`Document exact licensing requirements for ${jobType} in ${lead.city ?? 'your jurisdiction'}`, 'licensing', 2, ['step_001']],
    [`Identify 2–3 subcontractors who specialize in ${jobType} as potential partners`, 'subcontractor', 5, ['step_001']],
    [`Get quotes from potential subcontractor partners to estimate job costs`, 'subcontractor', 7, ['step_003']],
    [`Calculate working capital needed to take on this job type`, 'financial', 3, ['step_001']],
    [`Review bonding limits — determine if increase is needed`, 'financial', 5, ['step_005']],
    [`Identify crew training or certifications required`, 'crew', 3, ['step_001']],
    [`Research training programs or trade schools for required certifications`, 'crew', 5, ['step_007']],
    [`Enroll key crew member(s) in required training`, 'crew', 14, ['step_008']],
    [`Identify required permits and inspections for this job type`, 'permitting', 3, ['step_002']],
    [`Research permit timeline in ${lead.city ?? 'your jurisdiction'}`, 'permitting', 2, ['step_010']],
    [`Identify material suppliers who stock materials for ${jobType}`, 'materials', 5, ['step_001']],
    [`Get supplier accounts / pricing established for required materials`, 'materials', 7, ['step_012']],
    [`Source and price any specialty tools or equipment needed`, 'materials', 7, ['step_001']],
    [`Build realistic project timeline from permit-to-closeout`, 'timeline', 3, ['step_011']],
    [`Set internal readiness target date`, 'timeline', 1, ['step_015']],
    [`Send a warm check-in to the lead — acknowledge interest and share timeline`, 'client', 1, ['step_016']],
    [`Provide the lead with a rough estimate range to maintain engagement`, 'client', 2, ['step_017']],
    [`Schedule a follow-up call or meeting 2 weeks before your readiness date`, 'client', 1, ['step_016']],
    [`Complete crew certification/training milestones`, 'crew', 30, ['step_009']],
    [`Obtain any required licenses or endorsements`, 'licensing', 21, ['step_002']],
    [`Secure bonding at appropriate level`, 'financial', 14, ['step_006']],
    [`Run a dry-run project or shadow job with subcontractor partner`, 'subcontractor', 14, ['step_004', 'step_020']],
    [`Update your company capability statement to include ${jobType}`, 'gap_analysis', 2, ['step_021']],
    [`Re-contact lead with updated capability and availability`, 'client', 1, ['step_024']],
    [`Present detailed proposal to lead`, 'client', 3, ['step_025']],
    [`Close the job or negotiate terms`, 'client', 5, ['step_026']],
  ];

  return items.map(([text, category, estimated_days, deps], index) => ({
    id: buildStepId(index),
    step_number: index + 1,
    text,
    category,
    estimated_days,
    dependencies: deps,
    checked: false,
    notes: '',
  }));
}

// ─── Persistence ───────────────────────────────────────────────────────────────

/**
 * savePlaybook
 *
 * Upserts the playbook to the `hunter_playbooks` Supabase table.
 * Uses lead_id as the conflict key so one lead = one active playbook.
 */
export async function savePlaybook(
  leadId: string,
  steps: ExpansionPlaybookStep[]
): Promise<SavedPlaybook> {
  const now = new Date().toISOString();

  const record = {
    lead_id: leadId,
    steps: steps as unknown as Record<string, unknown>[],
    updated_at: now,
  };

  try {
    // Try upsert on lead_id
    const { data, error } = await (supabase as any)
      .from('hunter_playbooks')
      .upsert({ ...record, created_at: now }, { onConflict: 'lead_id' })
      .select()
      .single();

    if (error) {
      console.warn('[HunterPlaybookGenerator] savePlaybook Supabase error:', error.message);
      // Return a locally-generated object so the UI doesn't crash
      return {
        id: `local_${leadId}_${Date.now()}`,
        lead_id: leadId,
        steps,
        created_at: now,
        updated_at: now,
      };
    }

    return {
      id: data.id,
      lead_id: data.lead_id,
      steps: data.steps as ExpansionPlaybookStep[],
      created_at: data.created_at ?? now,
      updated_at: data.updated_at ?? now,
    };
  } catch (err) {
    console.warn('[HunterPlaybookGenerator] savePlaybook exception:', err);
    return {
      id: `local_${leadId}_${Date.now()}`,
      lead_id: leadId,
      steps,
      created_at: now,
      updated_at: now,
    };
  }
}

/**
 * updateStepStatus
 *
 * Toggles a single step's checked state and optional notes on the
 * stored playbook in Supabase.
 */
export async function updateStepStatus(
  playbookId: string,
  stepId: string,
  checked: boolean,
  notes?: string
): Promise<void> {
  try {
    // Fetch current steps
    const { data, error } = await (supabase as any)
      .from('hunter_playbooks')
      .select('steps')
      .eq('id', playbookId)
      .single();

    if (error || !data) {
      console.warn('[HunterPlaybookGenerator] updateStepStatus fetch error:', error?.message);
      return;
    }

    const steps = (data.steps ?? []) as ExpansionPlaybookStep[];
    const updated = steps.map((step) => {
      if (step.id !== stepId) return step;
      return {
        ...step,
        checked,
        notes: notes !== undefined ? notes : step.notes,
      };
    });

    const { error: updateError } = await (supabase as any)
      .from('hunter_playbooks')
      .update({ steps: updated, updated_at: new Date().toISOString() })
      .eq('id', playbookId);

    if (updateError) {
      console.warn('[HunterPlaybookGenerator] updateStepStatus update error:', updateError.message);
    }
  } catch (err) {
    console.warn('[HunterPlaybookGenerator] updateStepStatus exception:', err);
  }
}

/**
 * checkPlaybookProgress
 *
 * Reads the stored playbook and computes completion percentage.
 * When completion exceeds 70%, emits a `lead_rescore_needed` event via
 * the agent event bus so HUNTER can re-evaluate this lead.
 */
export async function checkPlaybookProgress(playbookId: string): Promise<PlaybookProgress> {
  const fallback: PlaybookProgress = {
    playbook_id: playbookId,
    lead_id: '',
    total_steps: 0,
    completed_steps: 0,
    completion_pct: 0,
    rescore_triggered: false,
  };

  try {
    const { data, error } = await (supabase as any)
      .from('hunter_playbooks')
      .select('id, lead_id, steps')
      .eq('id', playbookId)
      .single();

    if (error || !data) {
      console.warn('[HunterPlaybookGenerator] checkPlaybookProgress fetch error:', error?.message);
      return fallback;
    }

    const steps = (data.steps ?? []) as ExpansionPlaybookStep[];
    const total = steps.length;
    const completed = steps.filter((s) => s.checked).length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    const rescore = pct > 70;

    // Auto-trigger re-score via agent event bus when threshold is crossed
    if (rescore) {
      try {
        const eventBus = await import('@/services/agentEventBus');
        eventBus.publish(
          'LEAD_SCORED',
          'hunter',
          { leadId: data.lead_id, status: 'rescore_needed', completion_pct: pct },
          `Playbook ${playbookId} reached ${pct}% — re-score needed`
        );
      } catch (_busErr) {
        // Event bus may not be available in all contexts
        console.info(
          `[HunterPlaybookGenerator] Playbook ${playbookId} progress ${pct}% — re-score needed for lead ${data.lead_id}`
        );
      }
    }

    return {
      playbook_id: playbookId,
      lead_id: data.lead_id,
      total_steps: total,
      completed_steps: completed,
      completion_pct: pct,
      rescore_triggered: rescore,
    };
  } catch (err) {
    console.warn('[HunterPlaybookGenerator] checkPlaybookProgress exception:', err);
    return fallback;
  }
}

/**
 * loadPlaybook
 *
 * Fetches a saved playbook for a given lead from Supabase.
 * Returns null if no playbook exists yet.
 */
export async function loadPlaybook(leadId: string): Promise<SavedPlaybook | null> {
  try {
    const { data, error } = await (supabase as any)
      .from('hunter_playbooks')
      .select('*')
      .eq('lead_id', leadId)
      .maybeSingle();

    if (error) {
      console.warn('[HunterPlaybookGenerator] loadPlaybook error:', error.message);
      return null;
    }

    if (!data) return null;

    return {
      id: data.id,
      lead_id: data.lead_id,
      steps: (data.steps ?? []) as ExpansionPlaybookStep[],
      created_at: data.created_at ?? '',
      updated_at: data.updated_at ?? '',
    };
  } catch (err) {
    console.warn('[HunterPlaybookGenerator] loadPlaybook exception:', err);
    return null;
  }
}
