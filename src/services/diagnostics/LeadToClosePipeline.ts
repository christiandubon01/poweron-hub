/**
 * src/services/diagnostics/LeadToClosePipeline.ts
 * DIAG3 — Lead-to-Close Diagnostic Pipeline
 *
 * Orchestrates the full 5-stage closed-loop pipeline from HUNTER lead delivery
 * through SPARK pre-brief, NEXUS live monitoring, Channel B debrief, and back
 * into the HUNTER/SPARK learning loop.
 *
 * STAGE 1 — HUNTER DELIVERS LEAD
 * STAGE 2 — SPARK PRE-BRIEF
 * STAGE 3 — LIVE CALL MONITORING (NEXUS)
 * STAGE 4 — POST-CALL DEBRIEF (Channel B)
 * STAGE 5 — LEARNING LOOP
 *
 * PUBLIC API:
 *   runFullDiagnostic(leadId)      → Promise<DiagnosticPipelineRecord>
 *   getPipelineStatus(leadId)      → PipelineStage
 *   getPipelineHistory()           → DiagnosticPipelineRecord[]
 *   getDiagnosticReport(leadId)    → DiagnosticReport | null
 *
 * All stage data is logged in-memory (with optional Supabase persistence hooks).
 * No external dependencies are required — all integrations are stubbed for offline use.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export enum PipelineStage {
  NOT_STARTED = 'not_started',
  STAGE_1_LEAD_DELIVERED = 'stage_1_lead_delivered',
  STAGE_2_PRE_BRIEF = 'stage_2_pre_brief',
  STAGE_3_LIVE_MONITORING = 'stage_3_live_monitoring',
  STAGE_4_DEBRIEF = 'stage_4_debrief',
  STAGE_5_LEARNING = 'stage_5_learning',
  COMPLETE = 'complete',
}

export enum CallOutcome {
  WON = 'won',
  LOST = 'lost',
  FOLLOW_UP = 'follow_up',
  NO_ANSWER = 'no_answer',
  PENDING = 'pending',
}

export enum PitchAngle {
  URGENCY = 'urgency',
  PAIN = 'pain',
  OPPORTUNITY = 'opportunity',
  COMPETITOR_GAP = 'competitor_gap',
  RELATIONSHIP = 'relationship',
  SEASONAL = 'seasonal',
  FINANCIAL = 'financial',
}

export enum LiveFlag {
  PRICING_ALERT = 'pricing_alert',
  EGO_TRIGGER = 'ego_trigger',
  OPPORTUNITY_DETECTED = 'opportunity_detected',
  OBJECTION_RAISED = 'objection_raised',
  CLOSING_SIGNAL = 'closing_signal',
  STALL_DETECTED = 'stall_detected',
}

// ─── Stage Data Interfaces ───────────────────────────────────────────────────

/** Stage 1: HUNTER delivers lead with full intelligence package */
export interface Stage1LeadDelivery {
  lead_id: string;
  lead_source: string;
  initial_score: number;
  score_tier: 'elite' | 'strong' | 'qualified' | 'expansion';
  contact_name?: string;
  company_name?: string;
  estimated_value?: number;
  pitch_script?: string;
  pitch_angles: PitchAngle[];
  comparable_jobs: string[];
  discovery_time: string;             // ISO timestamp
  logged_at: string;                  // ISO timestamp
}

/** Stage 2: SPARK pre-call briefing delivered before the call */
export interface Stage2PreBrief {
  lead_id: string;
  client_history_found: boolean;
  client_history_summary?: string;
  recommended_pitch_angle: PitchAngle;
  objection_predictions: string[];
  floor_rate: number;                 // minimum acceptable rate for this job type
  briefing_text: string;
  delivery_method: 'tts_airpod' | 'text_card' | 'both';
  briefing_delivered_time: string;    // ISO timestamp
  pitch_angle_selected: PitchAngle;
}

/** Stage 3: NEXUS live call monitoring flags and alerts */
export interface LiveCallFlag {
  flag_type: LiveFlag;
  message: string;
  timestamp: string;
  severity: 'low' | 'medium' | 'high';
  action_recommended?: string;
}

export interface Stage3LiveMonitoring {
  lead_id: string;
  monitoring_active: boolean;
  call_start_time: string;            // ISO timestamp
  call_end_time?: string;             // ISO timestamp
  call_duration_seconds: number;
  flags_raised: LiveCallFlag[];
  alerts_delivered: string[];         // brief text of each delivered alert
  transcript_snippet?: string;        // partial transcript if captured
}

/** Stage 4: Channel B post-call structured debrief */
export interface Stage4Debrief {
  lead_id: string;
  debrief_time: string;               // ISO timestamp
  outcome: CallOutcome;
  what_happened: string;
  where_it_went: string;
  what_worked: string[];
  what_didnt: string[];
  transcript_vs_script_alignment: number; // 0–100 score
  objection_handling_score: number;       // 0–100 score
  lessons_extracted: string[];
  claude_analysis?: string;
}

/** Stage 5: Learning loop — rules and scoring adjustments written back */
export interface ScoringAdjustment {
  factor: string;
  direction: 'up' | 'down';
  magnitude: number;                  // 0–1
  reason: string;
}

export interface Stage5LearningLoop {
  lead_id: string;
  rules_written: string[];            // rule text entries added to HUNTER/SPARK banks
  scoring_adjustments: ScoringAdjustment[];
  objection_bank_additions: string[]; // new objection entries for SPARK
  curriculum_updates: string[];       // solar/sales training notes
  applied_at: string;                 // ISO timestamp
}

// ─── Pipeline Record ─────────────────────────────────────────────────────────

/** Full pipeline record for one lead across all 5 stages */
export interface DiagnosticPipelineRecord {
  id: string;
  lead_id: string;
  current_stage: PipelineStage;
  started_at: string;
  completed_at?: string;

  stage1?: Stage1LeadDelivery;
  stage2?: Stage2PreBrief;
  stage3?: Stage3LiveMonitoring;
  stage4?: Stage4Debrief;
  stage5?: Stage5LearningLoop;
}

/** Full diagnostic report exported for one lead */
export interface DiagnosticReport {
  pipeline: DiagnosticPipelineRecord;

  // Computed scores
  technical_accuracy_score: number;   // 0–100: how well the lead data was assembled
  sales_effectiveness_score: number;  // 0–100: based on objection handling + pitch alignment
  gap_score: number;                  // 0–100: areas for improvement

  // Timeline (milliseconds elapsed between stages)
  time_lead_to_brief_ms: number;
  time_brief_to_call_ms: number;
  time_call_to_debrief_ms: number;
  time_debrief_to_learning_ms: number;
  total_pipeline_duration_ms: number;

  // Stage summaries for report rendering
  lead_card_summary: string;
  pre_brief_summary: string;
  call_summary: string;
  debrief_summary: string;
  lessons_summary: string;

  generated_at: string;
}

// ─── Pipeline Metrics ────────────────────────────────────────────────────────

export interface PipelineMetrics {
  total_pipelines_run: number;
  total_completed: number;
  conversion_rate: number;            // won / completed
  avg_time_stage1_to_stage2_ms: number;
  avg_time_stage2_to_stage3_ms: number;
  avg_time_stage3_to_stage4_ms: number;
  avg_time_stage4_to_stage5_ms: number;
  most_common_loss_stage: PipelineStage | null;
  most_common_loss_reason: string;
  top_winning_pitch_angle: PitchAngle | null;
}

// ─── Internal Store ──────────────────────────────────────────────────────────

const _pipelines: Map<string, DiagnosticPipelineRecord> = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid(): string {
  return `diag_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function now(): string {
  return new Date().toISOString();
}

function computeScoreTier(score: number): Stage1LeadDelivery['score_tier'] {
  if (score >= 90) return 'elite';
  if (score >= 75) return 'strong';
  if (score >= 60) return 'qualified';
  return 'expansion';
}

function computeTechnicalAccuracyScore(record: DiagnosticPipelineRecord): number {
  let score = 0;
  if (record.stage1) {
    score += 20;
    if (record.stage1.pitch_script) score += 10;
    if (record.stage1.comparable_jobs.length > 0) score += 10;
    if (record.stage1.pitch_angles.length > 0) score += 10;
  }
  if (record.stage2) {
    score += 15;
    if (record.stage2.client_history_found) score += 10;
    if (record.stage2.objection_predictions.length > 0) score += 5;
  }
  if (record.stage3 && record.stage3.monitoring_active) score += 10;
  if (record.stage4) score += 10;
  return Math.min(100, score);
}

function computeSalesEffectivenessScore(record: DiagnosticPipelineRecord): number {
  if (!record.stage4) return 0;
  const alignment = record.stage4.transcript_vs_script_alignment;
  const objection = record.stage4.objection_handling_score;
  const won = record.stage4.outcome === CallOutcome.WON ? 20 : 0;
  return Math.min(100, Math.round((alignment + objection) / 2 + won));
}

function computeGapScore(record: DiagnosticPipelineRecord): number {
  const tech = computeTechnicalAccuracyScore(record);
  const sales = computeSalesEffectivenessScore(record);
  // Gap score = 100 minus the average of tech and sales (higher = more room to improve)
  return Math.min(100, Math.max(0, 100 - Math.round((tech + sales) / 2)));
}

// ─── Stage Runners ───────────────────────────────────────────────────────────

/**
 * Stage 1: HUNTER delivers lead into the pipeline.
 * In production this would pull from the Supabase hunter_leads table.
 * Here we build a realistic Stage1 from a lead ID.
 */
function runStage1(leadId: string): Stage1LeadDelivery {
  const mockScore = 72 + Math.floor(Math.random() * 25);
  return {
    lead_id: leadId,
    lead_source: 'google_lsa',
    initial_score: mockScore,
    score_tier: computeScoreTier(mockScore),
    contact_name: 'Homeowner',
    company_name: undefined,
    estimated_value: 1800 + Math.floor(Math.random() * 3200),
    pitch_script:
      "Hi, I'm Christian with Power On Solutions. I saw you reached out about an electrical issue — " +
      "I specialize in exactly this type of work and I'm available this week. Can I get you a quick quote?",
    pitch_angles: [PitchAngle.URGENCY, PitchAngle.PAIN],
    comparable_jobs: ['lead_abc123', 'lead_def456'],
    discovery_time: now(),
    logged_at: now(),
  };
}

/**
 * Stage 2: SPARK generates the pre-call briefing.
 * Checks client history, selects pitch angle, predicts objections, sets floor rate.
 */
function runStage2(record: DiagnosticPipelineRecord): Stage2PreBrief {
  const pitchAngle = record.stage1?.pitch_angles[0] ?? PitchAngle.URGENCY;
  return {
    lead_id: record.lead_id,
    client_history_found: Math.random() > 0.6,
    client_history_summary:
      'Previous quote for panel upgrade declined — price sensitivity noted. No active service calls.',
    recommended_pitch_angle: pitchAngle,
    objection_predictions: [
      'Price too high — needs to check with spouse',
      'Already got a quote from another electrician',
      'Wants to wait until next month',
    ],
    floor_rate: 175,
    briefing_text:
      `Pre-call for ${record.stage1?.contact_name ?? 'contact'}: ` +
      `Lean into ${pitchAngle} angle. Floor rate $175/hr. ` +
      `Watch for price objection — have financing mention ready. ` +
      `Comparable job won at $${record.stage1?.estimated_value ?? 2000} last quarter.`,
    delivery_method: 'both',
    briefing_delivered_time: now(),
    pitch_angle_selected: pitchAngle,
  };
}

/**
 * Stage 3: NEXUS live call monitoring.
 * In production, SPARK listens and emits flags in real time.
 */
function runStage3(record: DiagnosticPipelineRecord): Stage3LiveMonitoring {
  const callStart = now();
  const duration = 300 + Math.floor(Math.random() * 600); // 5–15 min
  const flags: LiveCallFlag[] = [
    {
      flag_type: LiveFlag.PRICING_ALERT,
      message: 'Price anchor set too low — customer repeated $500 twice.',
      timestamp: callStart,
      severity: 'high',
      action_recommended: 'Reframe value before confirming price.',
    },
    {
      flag_type: LiveFlag.OPPORTUNITY_DETECTED,
      message: 'Customer mentioned panel box is 40 years old — upsell opportunity.',
      timestamp: callStart,
      severity: 'medium',
      action_recommended: 'Ask about panel age and permit status.',
    },
  ];

  return {
    lead_id: record.lead_id,
    monitoring_active: true,
    call_start_time: callStart,
    call_end_time: now(),
    call_duration_seconds: duration,
    flags_raised: flags,
    alerts_delivered: flags.map((f) => f.message),
    transcript_snippet: 'Customer: "I just need the outlet fixed, nothing too crazy." ...',
  };
}

/**
 * Stage 4: Channel B post-call debrief.
 * Structured debrief with Claude analysis of transcript vs pitch script.
 */
function runStage4(record: DiagnosticPipelineRecord): Stage4Debrief {
  const outcome = Math.random() > 0.4 ? CallOutcome.WON : CallOutcome.LOST;
  const alignmentScore = 55 + Math.floor(Math.random() * 40);
  const objectionScore = 50 + Math.floor(Math.random() * 45);

  return {
    lead_id: record.lead_id,
    debrief_time: now(),
    outcome,
    what_happened:
      outcome === CallOutcome.WON
        ? 'Customer agreed to the quote on the spot. Panel upgrade booked for next Tuesday.'
        : 'Customer said they needed to get two more quotes. Follow-up scheduled.',
    where_it_went:
      outcome === CallOutcome.WON
        ? 'Urgency angle landed well. Customer had been without power on one circuit for 3 weeks.'
        : 'Lost momentum when price came up — did not counter with financing option.',
    what_worked: [
      'Opened with specific job type knowledge',
      'Set floor rate early — held it',
      'Mentioned comparable job timeline',
    ],
    what_didnt:
      outcome === CallOutcome.LOST
        ? ['Did not use financing reframe', 'Skipped SPARK alert on panel age upsell']
        : [],
    transcript_vs_script_alignment: alignmentScore,
    objection_handling_score: objectionScore,
    lessons_extracted: [
      'When customer anchors low on price, immediately introduce value + financing before reconfirming.',
      'Panel age question should always be in first 90 seconds of call.',
      outcome === CallOutcome.LOST
        ? 'Follow up within 48 hours with specific material cost breakdown.'
        : 'Book same-week job while customer is still warm.',
    ],
    claude_analysis:
      `Transcript alignment at ${alignmentScore}/100. ` +
      `Pitch script was followed for opening and urgency framing but diverged at price objection handling. ` +
      `Objection handling score ${objectionScore}/100 — strongest area: anchoring value early. ` +
      `Weakest area: financing reframe was available but not used.`,
  };
}

/**
 * Stage 5: Learning loop.
 * Extracts rules for HUNTER scoring and SPARK objection bank.
 */
function runStage5(record: DiagnosticPipelineRecord): Stage5LearningLoop {
  const lessons = record.stage4?.lessons_extracted ?? [];
  const outcome = record.stage4?.outcome ?? CallOutcome.PENDING;
  const won = outcome === CallOutcome.WON;

  const adjustments: ScoringAdjustment[] = [
    {
      factor: 'urgency_signals',
      direction: won ? 'up' : 'down',
      magnitude: 0.08,
      reason: won
        ? 'Urgency-angle lead converted — reinforce weight.'
        : 'Urgency angle did not convert — review triggers.',
    },
    {
      factor: 'contact_quality',
      direction: 'up',
      magnitude: 0.05,
      reason: 'Direct homeowner contact with active problem — strong signal.',
    },
  ];

  return {
    lead_id: record.lead_id,
    rules_written: lessons.map((l, i) => `RULE_${Date.now()}_${i}: ${l}`),
    scoring_adjustments: adjustments,
    objection_bank_additions: [
      'Price objection + spouse check → introduce monthly financing comparison.',
      'Two-quote stall → offer to email detailed breakdown within 2 hours.',
    ],
    curriculum_updates: [
      'Add panel age opener to SPARK script library.',
      'Add financing reframe module to SPARK training track.',
    ],
    applied_at: now(),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * runFullDiagnostic — orchestrates all 5 stages for one lead in sequence.
 * Creates a new pipeline record, runs each stage, logs all data.
 */
export async function runFullDiagnostic(leadId: string): Promise<DiagnosticPipelineRecord> {
  const record: DiagnosticPipelineRecord = {
    id: uid(),
    lead_id: leadId,
    current_stage: PipelineStage.NOT_STARTED,
    started_at: now(),
  };

  _pipelines.set(leadId, record);

  // Stage 1
  record.current_stage = PipelineStage.STAGE_1_LEAD_DELIVERED;
  record.stage1 = runStage1(leadId);
  _pipelines.set(leadId, { ...record });

  // Stage 2
  record.current_stage = PipelineStage.STAGE_2_PRE_BRIEF;
  record.stage2 = runStage2(record);
  _pipelines.set(leadId, { ...record });

  // Stage 3
  record.current_stage = PipelineStage.STAGE_3_LIVE_MONITORING;
  record.stage3 = runStage3(record);
  _pipelines.set(leadId, { ...record });

  // Stage 4
  record.current_stage = PipelineStage.STAGE_4_DEBRIEF;
  record.stage4 = runStage4(record);
  _pipelines.set(leadId, { ...record });

  // Stage 5
  record.current_stage = PipelineStage.STAGE_5_LEARNING;
  record.stage5 = runStage5(record);
  record.current_stage = PipelineStage.COMPLETE;
  record.completed_at = now();
  _pipelines.set(leadId, { ...record });

  return record;
}

/**
 * getPipelineStatus — returns the current pipeline stage for a lead.
 */
export function getPipelineStatus(leadId: string): PipelineStage {
  const record = _pipelines.get(leadId);
  if (!record) return PipelineStage.NOT_STARTED;
  return record.current_stage;
}

/**
 * getPipelineHistory — returns all leads that have gone through the pipeline.
 */
export function getPipelineHistory(): DiagnosticPipelineRecord[] {
  return Array.from(_pipelines.values()).sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );
}

/**
 * getDiagnosticReport — builds and returns the full report for one lead.
 */
export function getDiagnosticReport(leadId: string): DiagnosticReport | null {
  const pipeline = _pipelines.get(leadId);
  if (!pipeline) return null;

  const s1Time = pipeline.stage1 ? new Date(pipeline.stage1.logged_at).getTime() : 0;
  const s2Time = pipeline.stage2 ? new Date(pipeline.stage2.briefing_delivered_time).getTime() : 0;
  const s3Time = pipeline.stage3 ? new Date(pipeline.stage3.call_start_time).getTime() : 0;
  const s4Time = pipeline.stage4 ? new Date(pipeline.stage4.debrief_time).getTime() : 0;
  const s5Time = pipeline.stage5 ? new Date(pipeline.stage5.applied_at).getTime() : 0;
  const startTime = new Date(pipeline.started_at).getTime();
  const endTime = pipeline.completed_at ? new Date(pipeline.completed_at).getTime() : Date.now();

  const techScore = computeTechnicalAccuracyScore(pipeline);
  const salesScore = computeSalesEffectivenessScore(pipeline);
  const gapScore = computeGapScore(pipeline);

  return {
    pipeline,

    technical_accuracy_score: techScore,
    sales_effectiveness_score: salesScore,
    gap_score: gapScore,

    time_lead_to_brief_ms: s2Time && s1Time ? s2Time - s1Time : 0,
    time_brief_to_call_ms: s3Time && s2Time ? s3Time - s2Time : 0,
    time_call_to_debrief_ms: s4Time && s3Time ? s4Time - s3Time : 0,
    time_debrief_to_learning_ms: s5Time && s4Time ? s5Time - s4Time : 0,
    total_pipeline_duration_ms: endTime - startTime,

    lead_card_summary: pipeline.stage1
      ? `${pipeline.stage1.contact_name ?? 'Lead'} · Score ${pipeline.stage1.initial_score} ` +
        `(${pipeline.stage1.score_tier}) · Est. $${pipeline.stage1.estimated_value?.toLocaleString() ?? '—'} · ` +
        `Source: ${pipeline.stage1.lead_source}`
      : 'No lead data',

    pre_brief_summary: pipeline.stage2
      ? `Pitch angle: ${pipeline.stage2.pitch_angle_selected} · ` +
        `Floor rate: $${pipeline.stage2.floor_rate}/hr · ` +
        `${pipeline.stage2.objection_predictions.length} objection(s) predicted · ` +
        `Delivered via ${pipeline.stage2.delivery_method}`
      : 'No pre-brief data',

    call_summary: pipeline.stage3
      ? `Duration: ${Math.round(pipeline.stage3.call_duration_seconds / 60)}m · ` +
        `${pipeline.stage3.flags_raised.length} flag(s) raised · ` +
        `${pipeline.stage3.alerts_delivered.length} alert(s) delivered`
      : 'No call data',

    debrief_summary: pipeline.stage4
      ? `Outcome: ${pipeline.stage4.outcome.toUpperCase()} · ` +
        `Script alignment: ${pipeline.stage4.transcript_vs_script_alignment}/100 · ` +
        `Objection handling: ${pipeline.stage4.objection_handling_score}/100`
      : 'No debrief data',

    lessons_summary: pipeline.stage5
      ? `${pipeline.stage5.rules_written.length} rule(s) written · ` +
        `${pipeline.stage5.scoring_adjustments.length} scoring adjustment(s) · ` +
        `${pipeline.stage5.objection_bank_additions.length} objection bank addition(s)`
      : 'No learning data',

    generated_at: now(),
  };
}

/**
 * getPipelineMetrics — aggregated metrics across all pipeline runs.
 */
export function getPipelineMetrics(): PipelineMetrics {
  const all = getPipelineHistory();
  const completed = all.filter((r) => r.current_stage === PipelineStage.COMPLETE);
  const won = completed.filter((r) => r.stage4?.outcome === CallOutcome.WON);

  const avgMs = (getter: (r: DiagnosticPipelineRecord) => number): number => {
    const values = completed.map(getter).filter((v) => v > 0);
    return values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  };

  // Find most common loss stage (stage where pipeline stopped without completion)
  const incomplete = all.filter((r) => r.current_stage !== PipelineStage.COMPLETE);
  const stageCounts: Partial<Record<PipelineStage, number>> = {};
  for (const r of incomplete) {
    stageCounts[r.current_stage] = (stageCounts[r.current_stage] ?? 0) + 1;
  }
  let mostCommonLossStage: PipelineStage | null = null;
  let maxCount = 0;
  for (const [stage, count] of Object.entries(stageCounts) as [PipelineStage, number][]) {
    if (count > maxCount) {
      maxCount = count;
      mostCommonLossStage = stage;
    }
  }

  // Find top winning pitch angle
  const angleWins: Partial<Record<PitchAngle, number>> = {};
  for (const r of won) {
    const angle = r.stage2?.pitch_angle_selected;
    if (angle) angleWins[angle] = (angleWins[angle] ?? 0) + 1;
  }
  let topAngle: PitchAngle | null = null;
  let topAngleCount = 0;
  for (const [angle, count] of Object.entries(angleWins) as [PitchAngle, number][]) {
    if (count > topAngleCount) {
      topAngleCount = count;
      topAngle = angle;
    }
  }

  return {
    total_pipelines_run: all.length,
    total_completed: completed.length,
    conversion_rate: completed.length > 0 ? Math.round((won.length / completed.length) * 100) : 0,
    avg_time_stage1_to_stage2_ms: avgMs((r) => {
      if (!r.stage1 || !r.stage2) return 0;
      return (
        new Date(r.stage2.briefing_delivered_time).getTime() -
        new Date(r.stage1.logged_at).getTime()
      );
    }),
    avg_time_stage2_to_stage3_ms: avgMs((r) => {
      if (!r.stage2 || !r.stage3) return 0;
      return (
        new Date(r.stage3.call_start_time).getTime() -
        new Date(r.stage2.briefing_delivered_time).getTime()
      );
    }),
    avg_time_stage3_to_stage4_ms: avgMs((r) => {
      if (!r.stage3 || !r.stage3.call_end_time || !r.stage4) return 0;
      return (
        new Date(r.stage4.debrief_time).getTime() -
        new Date(r.stage3.call_end_time).getTime()
      );
    }),
    avg_time_stage4_to_stage5_ms: avgMs((r) => {
      if (!r.stage4 || !r.stage5) return 0;
      return (
        new Date(r.stage5.applied_at).getTime() -
        new Date(r.stage4.debrief_time).getTime()
      );
    }),
    most_common_loss_stage: mostCommonLossStage,
    most_common_loss_reason: 'Price objection not handled with financing reframe',
    top_winning_pitch_angle: topAngle,
  };
}
