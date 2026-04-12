/**
 * src/components/diagnostics/DiagnosticReport.tsx
 * DIAG3 — Diagnostic Report
 *
 * Full report view for a single lead's complete pipeline journey.
 * Sections: Lead Card → Pre-Brief → Call Summary → Debrief → Lessons
 * Includes scores, timeline, export (PDF stub), and "Apply Lessons" action.
 *
 * Props:
 *   leadId             — which lead to report on
 *   onBack?            — back navigation callback
 *   onApplyLessons?    — callback when lessons are confirmed into HUNTER/SPARK
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Target,
  Mic,
  Radio,
  MessageSquare,
  Repeat,
  CheckCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Download,
  ArrowLeft,
  AlertTriangle,
  Zap,
  FileText,
  BarChart2,
} from 'lucide-react';
import {
  getDiagnosticReport,
  PipelineStage,
  CallOutcome,
  type DiagnosticReport as DiagReport,
  type DiagnosticPipelineRecord,
  type Stage1LeadDelivery,
  type Stage2PreBrief,
  type Stage3LiveMonitoring,
  type Stage4Debrief,
  type Stage5LearningLoop,
} from '@/services/diagnostics/LeadToClosePipeline';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function scoreColor(score: number): string {
  if (score >= 75) return 'text-green-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
}

function ScoreBar({ value, color }: { value: number; color: string }): React.ReactElement {
  return (
    <div className="h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color.replace('text-', 'bg-')}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  agentLabel,
  timestamp,
  accentColor,
}: {
  icon: React.ReactNode;
  title: string;
  agentLabel: string;
  timestamp?: string;
  accentColor: string;
}): React.ReactElement {
  return (
    <div className={`flex items-center justify-between pb-3 border-b border-slate-700/40 mb-4`}>
      <div className="flex items-center gap-2">
        <span className={accentColor}>{icon}</span>
        <span className="text-white font-semibold text-sm">{title}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${accentColor.replace('text', 'border').replace('-400', '-500/40')} ${accentColor.replace('text', 'bg').replace('-400', '-500/10')} ${accentColor}`}>
          {agentLabel}
        </span>
      </div>
      {timestamp && <span className="text-slate-600 text-[10px]">{formatTs(timestamp)}</span>}
    </div>
  );
}

// ─── Section Components ───────────────────────────────────────────────────────

function LeadCardSection({ stage1 }: { stage1: Stage1LeadDelivery }): React.ReactElement {
  const tierColors: Record<string, string> = {
    elite: 'text-amber-400',
    strong: 'text-blue-400',
    qualified: 'text-slate-300',
    expansion: 'text-slate-500',
  };
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
      <SectionHeader
        icon={<Target size={16} />}
        title="Lead Card"
        agentLabel="HUNTER"
        timestamp={stage1.logged_at}
        accentColor="text-blue-400"
      />
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="space-y-2">
          <div>
            <div className="text-slate-500 text-[10px] mb-0.5">Contact</div>
            <div className="text-white">{stage1.contact_name ?? '—'}</div>
          </div>
          <div>
            <div className="text-slate-500 text-[10px] mb-0.5">Source</div>
            <div className="text-white capitalize">{stage1.lead_source.replace(/_/g, ' ')}</div>
          </div>
          <div>
            <div className="text-slate-500 text-[10px] mb-0.5">Estimated Value</div>
            <div className="text-white font-semibold text-sm">
              ${stage1.estimated_value?.toLocaleString() ?? '—'}
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <div>
            <div className="text-slate-500 text-[10px] mb-0.5">Score</div>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-lg leading-none">{stage1.initial_score}</span>
              <span className={`text-xs font-semibold capitalize ${tierColors[stage1.score_tier] ?? 'text-slate-400'}`}>
                {stage1.score_tier}
              </span>
            </div>
            <ScoreBar value={stage1.initial_score} color={scoreColor(stage1.initial_score)} />
          </div>
          <div>
            <div className="text-slate-500 text-[10px] mb-0.5">Comparables</div>
            <div className="text-white">{stage1.comparable_jobs.length} similar job{stage1.comparable_jobs.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
      </div>

      {(stage1.pitch_angles.length > 0 || stage1.pitch_script) && (
        <div className="mt-3 space-y-2">
          {stage1.pitch_angles.length > 0 && (
            <div>
              <div className="text-slate-500 text-[10px] mb-1">Pitch Angles</div>
              <div className="flex flex-wrap gap-1">
                {stage1.pitch_angles.map((a) => (
                  <span key={a} className="text-[10px] bg-blue-500/15 text-blue-300 border border-blue-500/25 px-2 py-0.5 rounded uppercase tracking-wide">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}
          {stage1.pitch_script && (
            <div>
              <div className="text-slate-500 text-[10px] mb-1">Pitch Script</div>
              <div className="text-slate-300 text-xs leading-relaxed bg-slate-900/50 rounded p-2 border border-slate-700/30">
                "{stage1.pitch_script}"
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PreBriefSection({ stage2 }: { stage2: Stage2PreBrief }): React.ReactElement {
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
      <SectionHeader
        icon={<Mic size={16} />}
        title="Pre-Call Brief"
        agentLabel="SPARK"
        timestamp={stage2.briefing_delivered_time}
        accentColor="text-purple-400"
      />
      <div className="grid grid-cols-3 gap-3 text-xs mb-3">
        <div>
          <div className="text-slate-500 text-[10px] mb-0.5">Angle Selected</div>
          <div className="text-white capitalize font-medium">{stage2.pitch_angle_selected}</div>
        </div>
        <div>
          <div className="text-slate-500 text-[10px] mb-0.5">Floor Rate</div>
          <div className="text-white font-semibold">${stage2.floor_rate}/hr</div>
        </div>
        <div>
          <div className="text-slate-500 text-[10px] mb-0.5">Client History</div>
          <div className={stage2.client_history_found ? 'text-green-400' : 'text-slate-500'}>
            {stage2.client_history_found ? 'Found' : 'New client'}
          </div>
        </div>
      </div>

      {stage2.client_history_found && stage2.client_history_summary && (
        <div className="mb-3 bg-purple-500/10 border border-purple-500/20 rounded p-2 text-xs text-slate-300">
          <span className="text-purple-400 font-semibold">History: </span>
          {stage2.client_history_summary}
        </div>
      )}

      {stage2.objection_predictions.length > 0 && (
        <div className="mb-3">
          <div className="text-slate-500 text-[10px] mb-1">Predicted Objections</div>
          <ul className="space-y-1">
            {stage2.objection_predictions.map((o, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs">
                <AlertTriangle size={11} className="text-amber-400 mt-0.5 flex-shrink-0" />
                <span className="text-slate-300">{o}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-slate-900/50 rounded p-2 text-xs text-slate-300 italic border border-slate-700/30">
        "{stage2.briefing_text}"
      </div>
      <div className="text-slate-600 text-[10px] mt-2">
        Delivered via {stage2.delivery_method.replace(/_/g, ' ')}
      </div>
    </div>
  );
}

function CallSummarySection({ stage3 }: { stage3: Stage3LiveMonitoring }): React.ReactElement {
  const durMin = Math.round(stage3.call_duration_seconds / 60);
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
      <SectionHeader
        icon={<Radio size={16} />}
        title="Call Summary"
        agentLabel="NEXUS"
        timestamp={stage3.call_start_time}
        accentColor="text-green-400"
      />
      <div className="grid grid-cols-3 gap-3 text-xs mb-3">
        <div>
          <div className="text-slate-500 text-[10px] mb-0.5">Duration</div>
          <div className="text-white font-semibold">{durMin}m</div>
        </div>
        <div>
          <div className="text-slate-500 text-[10px] mb-0.5">Flags Raised</div>
          <div className={`font-semibold ${stage3.flags_raised.length > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
            {stage3.flags_raised.length}
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-[10px] mb-0.5">Alerts Delivered</div>
          <div className="text-white font-semibold">{stage3.alerts_delivered.length}</div>
        </div>
      </div>

      {stage3.flags_raised.length > 0 && (
        <div className="space-y-2">
          {stage3.flags_raised.map((flag, i) => (
            <div key={i} className="flex items-start gap-2 bg-slate-900/40 rounded p-2 border border-slate-700/30 text-xs">
              <span className="mt-0.5 flex-shrink-0">
                {flag.flag_type === 'pricing_alert' && <AlertTriangle size={12} className="text-amber-400" />}
                {flag.flag_type === 'ego_trigger' && <Zap size={12} className="text-red-400" />}
                {flag.flag_type === 'opportunity_detected' && <TrendingUp size={12} className="text-green-400" />}
                {!['pricing_alert', 'ego_trigger', 'opportunity_detected'].includes(flag.flag_type) && <AlertTriangle size={12} className="text-slate-500" />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5 capitalize">
                  {flag.flag_type.replace(/_/g, ' ')} · {flag.severity}
                </div>
                <div className="text-slate-300">{flag.message}</div>
                {flag.action_recommended && (
                  <div className="text-green-400 mt-0.5">→ {flag.action_recommended}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {stage3.transcript_snippet && (
        <div className="mt-3 bg-slate-900/50 rounded p-2 text-xs text-slate-400 italic border border-slate-700/30">
          {stage3.transcript_snippet}
        </div>
      )}
    </div>
  );
}

function DebriefSection({ stage4 }: { stage4: Stage4Debrief }): React.ReactElement {
  const outcomeColors: Record<CallOutcome, string> = {
    [CallOutcome.WON]: 'text-green-400',
    [CallOutcome.LOST]: 'text-red-400',
    [CallOutcome.FOLLOW_UP]: 'text-amber-400',
    [CallOutcome.NO_ANSWER]: 'text-slate-500',
    [CallOutcome.PENDING]: 'text-slate-500',
  };

  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
      <SectionHeader
        icon={<MessageSquare size={16} />}
        title="Debrief"
        agentLabel="Channel B"
        timestamp={stage4.debrief_time}
        accentColor="text-amber-400"
      />

      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1">
          <div className="text-slate-500 text-[10px] mb-1">Outcome</div>
          <div className={`text-xl font-bold uppercase ${outcomeColors[stage4.outcome]}`}>
            {stage4.outcome}
          </div>
        </div>
        <div className="flex-1">
          <div className="text-slate-500 text-[10px] mb-1">Script Alignment</div>
          <div className={`font-semibold ${scoreColor(stage4.transcript_vs_script_alignment)}`}>
            {stage4.transcript_vs_script_alignment}<span className="text-slate-600 font-normal">/100</span>
          </div>
          <ScoreBar value={stage4.transcript_vs_script_alignment} color={scoreColor(stage4.transcript_vs_script_alignment)} />
        </div>
        <div className="flex-1">
          <div className="text-slate-500 text-[10px] mb-1">Objection Handling</div>
          <div className={`font-semibold ${scoreColor(stage4.objection_handling_score)}`}>
            {stage4.objection_handling_score}<span className="text-slate-600 font-normal">/100</span>
          </div>
          <ScoreBar value={stage4.objection_handling_score} color={scoreColor(stage4.objection_handling_score)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 text-xs">
        <div className="bg-slate-900/50 rounded p-3 border border-slate-700/30">
          <div className="text-slate-500 text-[10px] mb-1">What Happened</div>
          <div className="text-slate-300 leading-relaxed">{stage4.what_happened}</div>
        </div>
        <div className="bg-slate-900/50 rounded p-3 border border-slate-700/30">
          <div className="text-slate-500 text-[10px] mb-1">Where It Went</div>
          <div className="text-slate-300 leading-relaxed">{stage4.where_it_went}</div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {stage4.what_worked.length > 0 && (
            <div className="bg-green-500/5 border border-green-500/20 rounded p-2">
              <div className="text-green-400 text-[10px] font-semibold mb-1.5 uppercase tracking-wide">What Worked</div>
              <ul className="space-y-1">
                {stage4.what_worked.map((w, i) => (
                  <li key={i} className="flex items-start gap-1 text-slate-300">
                    <CheckCircle size={10} className="text-green-400 mt-0.5 flex-shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {stage4.what_didnt.length > 0 && (
            <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
              <div className="text-red-400 text-[10px] font-semibold mb-1.5 uppercase tracking-wide">What Didn't</div>
              <ul className="space-y-1">
                {stage4.what_didnt.map((w, i) => (
                  <li key={i} className="flex items-start gap-1 text-slate-300">
                    <Minus size={10} className="text-red-400 mt-0.5 flex-shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {stage4.claude_analysis && (
          <div className="bg-amber-500/5 border border-amber-500/20 rounded p-3">
            <div className="text-amber-400 text-[10px] font-semibold mb-1 uppercase tracking-wide">Claude Analysis</div>
            <div className="text-slate-300 leading-relaxed">{stage4.claude_analysis}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function LessonsSection({
  stage5,
  onApplyLessons,
  lessonsApplied,
}: {
  stage5: Stage5LearningLoop;
  onApplyLessons: () => void;
  lessonsApplied: boolean;
}): React.ReactElement {
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
      <SectionHeader
        icon={<Repeat size={16} />}
        title="Lessons & Learning Loop"
        agentLabel="HUNTER + SPARK"
        timestamp={stage5.applied_at}
        accentColor="text-rose-400"
      />

      <div className="space-y-3 text-xs">
        {stage5.rules_written.length > 0 && (
          <div>
            <div className="text-slate-500 text-[10px] mb-1.5">Rules Written ({stage5.rules_written.length})</div>
            <ul className="space-y-1">
              {stage5.rules_written.map((rule, i) => (
                <li key={i} className="flex items-start gap-1.5 text-slate-300">
                  <span className="text-rose-400 mt-0.5 flex-shrink-0">◆</span>
                  <span className="break-all">{rule.replace(/^RULE_\d+_\d+:\s*/, '')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {stage5.scoring_adjustments.length > 0 && (
          <div>
            <div className="text-slate-500 text-[10px] mb-1.5">HUNTER Scoring Adjustments</div>
            <div className="space-y-1.5">
              {stage5.scoring_adjustments.map((adj, i) => (
                <div key={i} className="flex items-center gap-2 bg-slate-900/50 rounded p-2 border border-slate-700/30">
                  {adj.direction === 'up'
                    ? <TrendingUp size={12} className="text-green-400 flex-shrink-0" />
                    : <TrendingDown size={12} className="text-red-400 flex-shrink-0" />
                  }
                  <span className="text-white">{adj.factor.replace(/_/g, ' ')}</span>
                  <span className={`ml-auto text-[10px] font-mono ${adj.direction === 'up' ? 'text-green-400' : 'text-red-400'}`}>
                    {adj.direction === 'up' ? '+' : '-'}{Math.round(adj.magnitude * 100)}%
                  </span>
                  <span className="text-slate-600 text-[10px]">— {adj.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {stage5.objection_bank_additions.length > 0 && (
          <div>
            <div className="text-slate-500 text-[10px] mb-1.5">SPARK Objection Bank Additions</div>
            <ul className="space-y-1">
              {stage5.objection_bank_additions.map((o, i) => (
                <li key={i} className="flex items-start gap-1.5 text-slate-300">
                  <span className="text-purple-400 mt-0.5 flex-shrink-0">+</span>
                  {o}
                </li>
              ))}
            </ul>
          </div>
        )}

        {stage5.curriculum_updates.length > 0 && (
          <div>
            <div className="text-slate-500 text-[10px] mb-1.5">Curriculum Updates</div>
            <ul className="space-y-1">
              {stage5.curriculum_updates.map((c, i) => (
                <li key={i} className="flex items-start gap-1.5 text-slate-300">
                  <span className="text-blue-400 mt-0.5 flex-shrink-0">→</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Apply Lessons Button */}
        <div className="pt-2 flex gap-2">
          <button
            onClick={onApplyLessons}
            disabled={lessonsApplied}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
              lessonsApplied
                ? 'bg-green-500/20 text-green-400 border border-green-500/30 cursor-default'
                : 'bg-rose-600 hover:bg-rose-500 text-white'
            }`}
          >
            {lessonsApplied ? (
              <>
                <CheckCircle size={13} />
                Lessons Applied to HUNTER &amp; SPARK
              </>
            ) : (
              <>
                <Repeat size={13} />
                Apply Lessons to HUNTER &amp; SPARK
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Timeline Vis ─────────────────────────────────────────────────────────────

interface TimelineStep {
  label: string;
  ts?: string;
  durationMs: number;
  color: string;
}

function PipelineTimeline({ steps }: { steps: TimelineStep[] }): React.ReactElement {
  const totalMs = steps.reduce((s, t) => s + t.durationMs, 0);

  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <Clock size={15} className="text-slate-400" />
        <span className="text-white font-semibold text-sm">Pipeline Timeline</span>
        <span className="text-slate-500 text-xs ml-auto">Total: {formatDuration(totalMs)}</span>
      </div>
      <div className="space-y-2 text-xs">
        {steps.map((step, i) => {
          const pct = totalMs > 0 ? (step.durationMs / totalMs) * 100 : 20;
          return (
            <div key={i} className="flex items-center gap-2">
              <div className="w-24 text-slate-500 text-right shrink-0 text-[10px]">{step.label}</div>
              <div className="flex-1 h-4 bg-slate-700/40 rounded overflow-hidden">
                <div
                  className={`h-full ${step.color} opacity-70 rounded transition-all duration-500`}
                  style={{ width: `${Math.max(4, pct)}%` }}
                />
              </div>
              <div className="w-16 text-slate-400 text-[10px] font-mono">{formatDuration(step.durationMs)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Scores Overview ─────────────────────────────────────────────────────────

function ScoresOverview({
  techScore,
  salesScore,
  gapScore,
}: {
  techScore: number;
  salesScore: number;
  gapScore: number;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-3 gap-3">
      {[
        { label: 'Technical Accuracy', value: techScore, sub: 'Lead assembly & briefing quality' },
        { label: 'Sales Effectiveness', value: salesScore, sub: 'Script alignment & objection handling' },
        { label: 'Gap Score', value: gapScore, sub: 'Room for improvement', invert: true },
      ].map(({ label, value, sub, invert }) => {
        const color = invert
          ? value <= 25 ? 'text-green-400' : value <= 50 ? 'text-amber-400' : 'text-red-400'
          : scoreColor(value);
        return (
          <div key={label} className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-3">
            <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-2">{label}</div>
            <div className={`text-2xl font-bold leading-none mb-1 ${color}`}>{value}</div>
            <ScoreBar value={invert ? 100 - value : value} color={color} />
            <div className="text-slate-600 text-[10px] mt-1">{sub}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export interface DiagnosticReportProps {
  leadId: string;
  onBack?: () => void;
}

const DiagnosticReport: React.FC<DiagnosticReportProps> = ({ leadId, onBack }) => {
  const [report, setReport] = useState<DiagReport | null>(null);
  const [lessonsApplied, setLessonsApplied] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'done'>('idle');

  useEffect(() => {
    const r = getDiagnosticReport(leadId);
    setReport(r);
  }, [leadId]);

  const handleApplyLessons = useCallback(() => {
    setLessonsApplied(true);
    // In production: call HUNTER rule write API and SPARK objection bank update
  }, []);

  const handleExportPDF = useCallback(() => {
    setExportStatus('exporting');
    // PDF export stub — in production: generate via jsPDF or Puppeteer serverside
    setTimeout(() => {
      setExportStatus('done');
      setTimeout(() => setExportStatus('idle'), 3000);
    }, 1500);
  }, []);

  const timelineSteps = useMemo<TimelineStep[]>(() => {
    if (!report) return [];
    return [
      { label: 'Lead → Brief', ts: report.pipeline.stage1?.logged_at, durationMs: report.time_lead_to_brief_ms, color: 'bg-blue-400' },
      { label: 'Brief → Call', ts: report.pipeline.stage2?.briefing_delivered_time, durationMs: report.time_brief_to_call_ms, color: 'bg-purple-400' },
      { label: 'Call → Debrief', ts: report.pipeline.stage3?.call_end_time, durationMs: report.time_call_to_debrief_ms, color: 'bg-green-400' },
      { label: 'Debrief → Learn', ts: report.pipeline.stage4?.debrief_time, durationMs: report.time_debrief_to_learning_ms, color: 'bg-amber-400' },
    ].filter((s) => s.durationMs > 0);
  }, [report]);

  if (!report) {
    return (
      <div className="bg-slate-900 text-slate-300 min-h-full p-6 flex flex-col items-center justify-center">
        <FileText size={36} className="text-slate-700 mb-3" />
        <div className="text-slate-500 text-sm">No report found for lead ID: {leadId}</div>
        {onBack && (
          <button onClick={onBack} className="mt-4 flex items-center gap-1.5 text-slate-400 hover:text-slate-200 text-xs transition-colors">
            <ArrowLeft size={13} />
            Back to Pipeline
          </button>
        )}
      </div>
    );
  }

  const { pipeline, technical_accuracy_score, sales_effectiveness_score, gap_score } = report;

  return (
    <div className="bg-slate-900 text-slate-300 min-h-full">
      {/* Header */}
      <div className="border-b border-slate-800 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onBack && (
              <button onClick={onBack} className="text-slate-500 hover:text-slate-300 transition-colors">
                <ArrowLeft size={18} />
              </button>
            )}
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <BarChart2 size={16} className="text-blue-400" />
                <h2 className="text-white font-semibold text-base">Diagnostic Report</h2>
                <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${
                  pipeline.stage4?.outcome === CallOutcome.WON
                    ? 'bg-green-500/20 text-green-400'
                    : pipeline.stage4?.outcome === CallOutcome.LOST
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-slate-700 text-slate-400'
                }`}>
                  {pipeline.stage4?.outcome?.toUpperCase() ?? 'IN PROGRESS'}
                </span>
              </div>
              <div className="text-slate-500 text-xs">
                {pipeline.stage1?.contact_name ?? pipeline.lead_id}
                {' · '}
                {pipeline.stage1?.lead_source ?? 'unknown source'}
                {' · '}
                Started {formatTs(pipeline.started_at)}
              </div>
            </div>
          </div>

          {/* Export PDF */}
          <button
            onClick={handleExportPDF}
            disabled={exportStatus !== 'idle'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              exportStatus === 'done'
                ? 'border-green-500/40 bg-green-500/10 text-green-400'
                : 'border-slate-600 bg-slate-800/50 text-slate-300 hover:bg-slate-700'
            } disabled:opacity-70`}
          >
            {exportStatus === 'exporting' ? (
              <><Clock size={12} className="animate-spin" />Exporting…</>
            ) : exportStatus === 'done' ? (
              <><CheckCircle size={12} />Exported</>
            ) : (
              <><Download size={12} />Export PDF</>
            )}
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Scores Overview */}
        <ScoresOverview
          techScore={technical_accuracy_score}
          salesScore={sales_effectiveness_score}
          gapScore={gap_score}
        />

        {/* Timeline */}
        {timelineSteps.length > 0 && <PipelineTimeline steps={timelineSteps} />}

        {/* Lead Card */}
        {pipeline.stage1 && <LeadCardSection stage1={pipeline.stage1} />}

        {/* Pre-Brief */}
        {pipeline.stage2 && <PreBriefSection stage2={pipeline.stage2} />}

        {/* Call Summary */}
        {pipeline.stage3 && <CallSummarySection stage3={pipeline.stage3} />}

        {/* Debrief */}
        {pipeline.stage4 && <DebriefSection stage4={pipeline.stage4} />}

        {/* Lessons */}
        {pipeline.stage5 && (
          <LessonsSection
            stage5={pipeline.stage5}
            onApplyLessons={handleApplyLessons}
            lessonsApplied={lessonsApplied}
          />
        )}

        {/* Footer */}
        <div className="text-center text-slate-700 text-[10px] pt-2">
          Report generated {formatTs(report.generated_at)} · Pipeline ID: {pipeline.id}
        </div>
      </div>
    </div>
  );
};

export default DiagnosticReport;
