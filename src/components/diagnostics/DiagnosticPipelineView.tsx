/**
 * src/components/diagnostics/DiagnosticPipelineView.tsx
 * DIAG3 — Diagnostic Pipeline View
 *
 * Visual 5-stage pipeline showing the lead-to-close journey.
 * Stages are connected steps — the active stage is highlighted.
 * Each stage is expandable to show logged data, timestamps, and decisions.
 *
 * Props:
 *   onStartDiagnostic?    — callback when "Start Diagnostic" is pressed
 *   onViewReport?         — callback to open DiagnosticReport for a lead
 */

import React, { useState, useCallback } from 'react';
import {
  Target,
  Mic,
  Radio,
  MessageSquare,
  Repeat,
  ChevronDown,
  ChevronRight,
  Play,
  CheckCircle,
  Clock,
  AlertTriangle,
  TrendingUp,
  Zap,
  BarChart2,
  FileText,
} from 'lucide-react';
import {
  runFullDiagnostic,
  getPipelineHistory,
  getPipelineMetrics,
  getDiagnosticReport,
  PipelineStage,
  CallOutcome,
  LiveFlag,
  type DiagnosticPipelineRecord,
  type PipelineMetrics,
} from '@/services/diagnostics/LeadToClosePipeline';

// ─── Stage Config ─────────────────────────────────────────────────────────────

interface StageConfig {
  id: PipelineStage;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
  agent: string;
}

const STAGE_CONFIGS: StageConfig[] = [
  {
    id: PipelineStage.STAGE_1_LEAD_DELIVERED,
    label: 'HUNTER Delivers Lead',
    shortLabel: 'Lead In',
    icon: <Target size={16} />,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/40',
    description: 'Lead arrives with score, pitch script, pitch angles, and comparable jobs.',
    agent: 'HUNTER',
  },
  {
    id: PipelineStage.STAGE_2_PRE_BRIEF,
    label: 'SPARK Pre-Brief',
    shortLabel: 'Pre-Brief',
    icon: <Mic size={16} />,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/40',
    description: 'SPARK delivers client history, pitch angle, objection predictions, floor rate.',
    agent: 'SPARK',
  },
  {
    id: PipelineStage.STAGE_3_LIVE_MONITORING,
    label: 'Live Call Monitoring',
    shortLabel: 'Live Call',
    icon: <Radio size={16} />,
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/40',
    description: 'NEXUS listens live — pricing alerts, ego triggers, opportunity detection.',
    agent: 'NEXUS',
  },
  {
    id: PipelineStage.STAGE_4_DEBRIEF,
    label: 'Channel B Debrief',
    shortLabel: 'Debrief',
    icon: <MessageSquare size={16} />,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/40',
    description: 'Structured post-call debrief. Claude analyzes transcript vs pitch script.',
    agent: 'NEXUS + Claude',
  },
  {
    id: PipelineStage.STAGE_5_LEARNING,
    label: 'Learning Loop',
    shortLabel: 'Learn',
    icon: <Repeat size={16} />,
    color: 'text-rose-400',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/40',
    description: 'Lessons feed HUNTER scoring weights, SPARK objection bank, solar curriculum.',
    agent: 'HUNTER + SPARK',
  },
];

const STAGE_ORDER: PipelineStage[] = [
  PipelineStage.STAGE_1_LEAD_DELIVERED,
  PipelineStage.STAGE_2_PRE_BRIEF,
  PipelineStage.STAGE_3_LIVE_MONITORING,
  PipelineStage.STAGE_4_DEBRIEF,
  PipelineStage.STAGE_5_LEARNING,
];

function stageIndex(stage: PipelineStage): number {
  return STAGE_ORDER.indexOf(stage);
}

function isStageComplete(recordStage: PipelineStage, checkStage: PipelineStage): boolean {
  if (recordStage === PipelineStage.COMPLETE) return true;
  return stageIndex(recordStage) > stageIndex(checkStage);
}

function isStageActive(recordStage: PipelineStage, checkStage: PipelineStage): boolean {
  return recordStage === checkStage;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

function formatTimestamp(iso: string): string {
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

function getOutcomeColor(outcome: CallOutcome): string {
  if (outcome === CallOutcome.WON) return 'text-green-400';
  if (outcome === CallOutcome.LOST) return 'text-red-400';
  if (outcome === CallOutcome.FOLLOW_UP) return 'text-amber-400';
  return 'text-slate-400';
}

function getFlagIcon(flag: LiveFlag): React.ReactNode {
  if (flag === LiveFlag.PRICING_ALERT) return <AlertTriangle size={12} className="text-amber-400" />;
  if (flag === LiveFlag.EGO_TRIGGER) return <Zap size={12} className="text-red-400" />;
  if (flag === LiveFlag.OPPORTUNITY_DETECTED) return <TrendingUp size={12} className="text-green-400" />;
  return <AlertTriangle size={12} className="text-slate-400" />;
}

// ─── Stage Detail Renderers ───────────────────────────────────────────────────

function Stage1Detail({ record }: { record: DiagnosticPipelineRecord }): React.ReactElement | null {
  const s = record.stage1;
  if (!s) return null;
  return (
    <div className="space-y-2 text-xs text-slate-300">
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Score</div>
          <div className="text-white font-semibold">{s.initial_score} <span className="text-slate-400 font-normal">({s.score_tier})</span></div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Est. Value</div>
          <div className="text-white font-semibold">${s.estimated_value?.toLocaleString() ?? '—'}</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Source</div>
          <div className="text-white">{s.lead_source}</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Comparables</div>
          <div className="text-white">{s.comparable_jobs.length} jobs</div>
        </div>
      </div>
      {s.pitch_angles.length > 0 && (
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Pitch Angles</div>
          <div className="flex flex-wrap gap-1">
            {s.pitch_angles.map((a) => (
              <span key={a} className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded text-[10px] uppercase tracking-wide">{a}</span>
            ))}
          </div>
        </div>
      )}
      {s.pitch_script && (
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Pitch Script</div>
          <div className="text-slate-300 leading-relaxed">{s.pitch_script}</div>
        </div>
      )}
      <div className="text-slate-600 text-[10px]">Logged {formatTimestamp(s.logged_at)}</div>
    </div>
  );
}

function Stage2Detail({ record }: { record: DiagnosticPipelineRecord }): React.ReactElement | null {
  const s = record.stage2;
  if (!s) return null;
  return (
    <div className="space-y-2 text-xs text-slate-300">
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Pitch Angle</div>
          <div className="text-white font-semibold capitalize">{s.pitch_angle_selected}</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Floor Rate</div>
          <div className="text-white font-semibold">${s.floor_rate}/hr</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Client History</div>
          <div className={s.client_history_found ? 'text-green-400' : 'text-slate-500'}>
            {s.client_history_found ? 'Found' : 'None on file'}
          </div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Delivery</div>
          <div className="text-white capitalize">{s.delivery_method.replace('_', ' ')}</div>
        </div>
      </div>
      {s.objection_predictions.length > 0 && (
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Objection Predictions</div>
          <ul className="space-y-1">
            {s.objection_predictions.map((o, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-purple-400 mt-0.5">•</span>
                <span>{o}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.briefing_text && (
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Briefing Text</div>
          <div className="text-slate-300 leading-relaxed italic">"{s.briefing_text}"</div>
        </div>
      )}
      <div className="text-slate-600 text-[10px]">Delivered {formatTimestamp(s.briefing_delivered_time)}</div>
    </div>
  );
}

function Stage3Detail({ record }: { record: DiagnosticPipelineRecord }): React.ReactElement | null {
  const s = record.stage3;
  if (!s) return null;
  const durMin = Math.round(s.call_duration_seconds / 60);
  return (
    <div className="space-y-2 text-xs text-slate-300">
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Duration</div>
          <div className="text-white font-semibold">{durMin}m</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Flags</div>
          <div className="text-white font-semibold">{s.flags_raised.length}</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Alerts</div>
          <div className="text-white font-semibold">{s.alerts_delivered.length}</div>
        </div>
      </div>
      {s.flags_raised.length > 0 && (
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-2">Live Flags</div>
          <div className="space-y-2">
            {s.flags_raised.map((flag, i) => (
              <div key={i} className="flex items-start gap-2 bg-slate-900/40 rounded p-2">
                <span className="mt-0.5">{getFlagIcon(flag.flag_type)}</span>
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
        </div>
      )}
      {s.transcript_snippet && (
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Transcript Snippet</div>
          <div className="text-slate-400 italic">{s.transcript_snippet}</div>
        </div>
      )}
      <div className="text-slate-600 text-[10px]">Call started {formatTimestamp(s.call_start_time)}</div>
    </div>
  );
}

function Stage4Detail({ record }: { record: DiagnosticPipelineRecord }): React.ReactElement | null {
  const s = record.stage4;
  if (!s) return null;
  return (
    <div className="space-y-2 text-xs text-slate-300">
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-slate-800/60 rounded p-2 col-span-1">
          <div className="text-slate-500 mb-1">Outcome</div>
          <div className={`font-semibold uppercase ${getOutcomeColor(s.outcome)}`}>{s.outcome}</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Script Align</div>
          <div className="text-white font-semibold">{s.transcript_vs_script_alignment}<span className="text-slate-500 font-normal">/100</span></div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Obj. Handling</div>
          <div className="text-white font-semibold">{s.objection_handling_score}<span className="text-slate-500 font-normal">/100</span></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">What Worked</div>
          <ul className="space-y-0.5">
            {s.what_worked.map((w, i) => <li key={i} className="flex gap-1"><span className="text-green-400">✓</span>{w}</li>)}
          </ul>
        </div>
        {s.what_didnt.length > 0 && (
          <div className="bg-slate-800/60 rounded p-2">
            <div className="text-slate-500 mb-1">What Didn't</div>
            <ul className="space-y-0.5">
              {s.what_didnt.map((w, i) => <li key={i} className="flex gap-1"><span className="text-red-400">✗</span>{w}</li>)}
            </ul>
          </div>
        )}
      </div>
      {s.lessons_extracted.length > 0 && (
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Lessons Extracted</div>
          <ul className="space-y-1">
            {s.lessons_extracted.map((l, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-amber-400 mt-0.5">◆</span>
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="text-slate-600 text-[10px]">Debriefed {formatTimestamp(s.debrief_time)}</div>
    </div>
  );
}

function Stage5Detail({ record }: { record: DiagnosticPipelineRecord }): React.ReactElement | null {
  const s = record.stage5;
  if (!s) return null;
  return (
    <div className="space-y-2 text-xs text-slate-300">
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Rules Written</div>
          <div className="text-white font-semibold">{s.rules_written.length}</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Score Adj.</div>
          <div className="text-white font-semibold">{s.scoring_adjustments.length}</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Obj. Bank +</div>
          <div className="text-white font-semibold">{s.objection_bank_additions.length}</div>
        </div>
      </div>
      {s.scoring_adjustments.length > 0 && (
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-2">Scoring Adjustments</div>
          <div className="space-y-1.5">
            {s.scoring_adjustments.map((adj, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className={adj.direction === 'up' ? 'text-green-400' : 'text-red-400'}>
                  {adj.direction === 'up' ? '↑' : '↓'}
                </span>
                <span className="text-white">{adj.factor}</span>
                <span className="text-slate-500">+{Math.round(adj.magnitude * 100)}%</span>
                <span className="text-slate-500 text-[10px]">— {adj.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {s.objection_bank_additions.length > 0 && (
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 mb-1">Objection Bank Additions</div>
          <ul className="space-y-1">
            {s.objection_bank_additions.map((o, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-rose-400 mt-0.5">+</span><span>{o}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="text-slate-600 text-[10px]">Applied {formatTimestamp(s.applied_at)}</div>
    </div>
  );
}

function renderStageDetail(stage: PipelineStage, record: DiagnosticPipelineRecord): React.ReactElement | null {
  if (stage === PipelineStage.STAGE_1_LEAD_DELIVERED) return <Stage1Detail record={record} />;
  if (stage === PipelineStage.STAGE_2_PRE_BRIEF) return <Stage2Detail record={record} />;
  if (stage === PipelineStage.STAGE_3_LIVE_MONITORING) return <Stage3Detail record={record} />;
  if (stage === PipelineStage.STAGE_4_DEBRIEF) return <Stage4Detail record={record} />;
  if (stage === PipelineStage.STAGE_5_LEARNING) return <Stage5Detail record={record} />;
  return null;
}

// ─── Metric Card ─────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }): React.ReactElement {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
      <div className="text-slate-500 text-[10px] uppercase tracking-widest mb-1">{label}</div>
      <div className="text-white font-semibold text-lg leading-none">{value}</div>
      {sub && <div className="text-slate-500 text-[10px] mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── History Row ─────────────────────────────────────────────────────────────

function HistoryRow({
  record,
  onView,
}: {
  record: DiagnosticPipelineRecord;
  onView: (leadId: string) => void;
}): React.ReactElement {
  const outcome = record.stage4?.outcome;
  const score = record.stage1?.initial_score;
  const value = record.stage1?.estimated_value;

  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-800/60 last:border-0">
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          record.current_stage === PipelineStage.COMPLETE
            ? outcome === CallOutcome.WON ? 'bg-green-500' : 'bg-red-500'
            : 'bg-amber-500'
        }`} />
        <div>
          <div className="text-slate-300 text-xs font-medium">
            {record.stage1?.contact_name ?? record.lead_id}
          </div>
          <div className="text-slate-600 text-[10px]">
            {formatTimestamp(record.started_at)} · Score {score ?? '—'}{value ? ` · $${value.toLocaleString()}` : ''}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {outcome && (
          <span className={`text-[10px] font-semibold uppercase ${getOutcomeColor(outcome)}`}>
            {outcome}
          </span>
        )}
        {!outcome && record.current_stage !== PipelineStage.COMPLETE && (
          <span className="text-[10px] text-amber-400 capitalize">
            {record.current_stage.replace(/_/g, ' ')}
          </span>
        )}
        <button
          onClick={() => onView(record.lead_id)}
          className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors px-2 py-0.5 rounded border border-slate-700/50 hover:border-slate-600"
        >
          Report
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export interface DiagnosticPipelineViewProps {
  onViewReport?: (leadId: string) => void;
}

const DiagnosticPipelineView: React.FC<DiagnosticPipelineViewProps> = ({ onViewReport }) => {
  const [activeRecord, setActiveRecord] = useState<DiagnosticPipelineRecord | null>(null);
  const [history, setHistory] = useState<DiagnosticPipelineRecord[]>(() => getPipelineHistory());
  const [metrics, setMetrics] = useState<PipelineMetrics>(() => getPipelineMetrics());
  const [isRunning, setIsRunning] = useState(false);
  const [expandedStages, setExpandedStages] = useState<Set<PipelineStage>>(new Set());
  const [activeTab, setActiveTab] = useState<'pipeline' | 'history' | 'metrics'>('pipeline');

  const toggleStage = useCallback((stage: PipelineStage) => {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  }, []);

  const handleStartDiagnostic = useCallback(async () => {
    setIsRunning(true);
    try {
      const leadId = `lead_${Date.now()}`;
      const record = await runFullDiagnostic(leadId);
      setActiveRecord(record);
      setHistory(getPipelineHistory());
      setMetrics(getPipelineMetrics());
      // Auto-expand all stages after completion
      setExpandedStages(new Set(STAGE_ORDER));
    } finally {
      setIsRunning(false);
    }
  }, []);

  const handleViewReport = useCallback((leadId: string) => {
    if (onViewReport) onViewReport(leadId);
  }, [onViewReport]);

  return (
    <div className="bg-slate-900 text-slate-300 min-h-full">
      {/* Header */}
      <div className="border-b border-slate-800 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <BarChart2 size={18} className="text-blue-400" />
              <h2 className="text-white font-semibold text-base">Diagnostic Pipeline</h2>
              <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/30">
                DIAG3
              </span>
            </div>
            <p className="text-slate-500 text-xs">
              Lead-to-close closed loop · HUNTER → SPARK → NEXUS → Channel B → Learning
            </p>
          </div>
          <button
            onClick={handleStartDiagnostic}
            disabled={isRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
          >
            {isRunning ? (
              <>
                <Clock size={13} className="animate-spin" />
                Running…
              </>
            ) : (
              <>
                <Play size={13} />
                Start Diagnostic
              </>
            )}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {(['pipeline', 'history', 'metrics'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 rounded text-xs capitalize transition-colors ${
                activeTab === tab
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {/* PIPELINE TAB */}
        {activeTab === 'pipeline' && (
          <div className="space-y-3">
            {!activeRecord && (
              <div className="text-center py-10">
                <Target size={32} className="text-slate-700 mx-auto mb-3" />
                <div className="text-slate-500 text-sm mb-1">No diagnostic running</div>
                <div className="text-slate-600 text-xs">Press "Start Diagnostic" to pick the top HUNTER lead and begin Stage 1.</div>
              </div>
            )}

            {activeRecord && STAGE_CONFIGS.map((cfg, idx) => {
              const complete = isStageComplete(activeRecord.current_stage, cfg.id);
              const active = isStageActive(activeRecord.current_stage, cfg.id);
              const unlocked = complete || active;
              const expanded = expandedStages.has(cfg.id);

              return (
                <div key={cfg.id} className="relative">
                  {/* Connector line */}
                  {idx < STAGE_CONFIGS.length - 1 && (
                    <div className={`absolute left-5 top-full w-0.5 h-3 z-10 ${unlocked ? cfg.borderColor.replace('border', 'bg') : 'bg-slate-800'}`} />
                  )}

                  <div className={`border rounded-lg overflow-hidden transition-all ${
                    active
                      ? `${cfg.borderColor} ${cfg.bgColor}`
                      : complete
                      ? 'border-slate-700/50 bg-slate-800/30'
                      : 'border-slate-800/50 bg-slate-900/50 opacity-40'
                  }`}>
                    {/* Stage Header */}
                    <button
                      onClick={() => unlocked && toggleStage(cfg.id)}
                      disabled={!unlocked}
                      className="w-full flex items-center gap-3 p-3 text-left"
                    >
                      {/* Stage number / status icon */}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border ${
                        complete
                          ? 'border-green-500/50 bg-green-500/10'
                          : active
                          ? `${cfg.borderColor} ${cfg.bgColor}`
                          : 'border-slate-700 bg-slate-800/60'
                      }`}>
                        {complete ? (
                          <CheckCircle size={15} className="text-green-400" />
                        ) : active ? (
                          <div className="w-2 h-2 bg-current rounded-full animate-pulse" style={{ color: 'inherit' }} />
                        ) : (
                          <span className="text-slate-600 text-xs font-bold">{idx + 1}</span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`${unlocked ? cfg.color : 'text-slate-600'}`}>{cfg.icon}</span>
                          <span className={`font-medium text-sm ${unlocked ? 'text-white' : 'text-slate-600'}`}>
                            {cfg.label}
                          </span>
                          {active && (
                            <span className={`text-[9px] uppercase tracking-widest ${cfg.color} font-semibold`}>
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Agent: {cfg.agent} · {cfg.description}
                        </div>
                      </div>

                      {unlocked && (
                        expanded
                          ? <ChevronDown size={14} className="text-slate-500 flex-shrink-0" />
                          : <ChevronRight size={14} className="text-slate-500 flex-shrink-0" />
                      )}
                    </button>

                    {/* Stage Detail (expanded) */}
                    {expanded && unlocked && (
                      <div className="px-3 pb-3 border-t border-slate-700/30 pt-3">
                        {renderStageDetail(cfg.id, activeRecord)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Completion Banner */}
            {activeRecord?.current_stage === PipelineStage.COMPLETE && (
              <div className="mt-4 border border-green-500/30 bg-green-500/10 rounded-lg p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle size={18} className="text-green-400" />
                  <div>
                    <div className="text-green-300 font-semibold text-sm">Pipeline Complete</div>
                    <div className="text-slate-400 text-xs">
                      Outcome: <span className={`font-semibold ${getOutcomeColor(activeRecord.stage4?.outcome ?? CallOutcome.PENDING)}`}>
                        {activeRecord.stage4?.outcome?.toUpperCase() ?? '—'}
                      </span>
                      {' · '}
                      {activeRecord.stage5?.rules_written.length ?? 0} rules written to HUNTER/SPARK
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleViewReport(activeRecord.lead_id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 border border-slate-600 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <FileText size={12} />
                  Full Report
                </button>
              </div>
            )}
          </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === 'history' && (
          <div>
            {history.length === 0 ? (
              <div className="text-center py-10 text-slate-600 text-sm">
                No pipeline history yet. Run a diagnostic to begin.
              </div>
            ) : (
              <div>
                <div className="text-xs text-slate-500 mb-3">{history.length} pipeline{history.length !== 1 ? 's' : ''} total</div>
                {history.map((record) => (
                  <HistoryRow key={record.id} record={record} onView={handleViewReport} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* METRICS TAB */}
        {activeTab === 'metrics' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <MetricCard
                label="Pipelines Run"
                value={metrics.total_pipelines_run}
                sub={`${metrics.total_completed} completed`}
              />
              <MetricCard
                label="Conversion Rate"
                value={`${metrics.conversion_rate}%`}
                sub="won / completed"
              />
              <MetricCard
                label="Top Pitch Angle"
                value={metrics.top_winning_pitch_angle ?? '—'}
                sub="highest win rate"
              />
            </div>

            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
              <div className="text-slate-500 text-[10px] uppercase tracking-widest mb-3">Avg Time Per Stage</div>
              <div className="space-y-2 text-xs">
                {[
                  { label: 'Lead → Pre-Brief', value: metrics.avg_time_stage1_to_stage2_ms },
                  { label: 'Pre-Brief → Call', value: metrics.avg_time_stage2_to_stage3_ms },
                  { label: 'Call → Debrief', value: metrics.avg_time_stage3_to_stage4_ms },
                  { label: 'Debrief → Learning', value: metrics.avg_time_stage4_to_stage5_ms },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-center">
                    <span className="text-slate-400">{label}</span>
                    <span className="text-white font-mono">{formatDuration(value)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
              <div className="text-slate-500 text-[10px] uppercase tracking-widest mb-3">Most Common Loss Point</div>
              <div className="text-white text-sm">
                {metrics.most_common_loss_stage
                  ? metrics.most_common_loss_stage.replace(/_/g, ' ').replace('stage ', 'Stage ')
                  : 'Not enough data'}
              </div>
              {metrics.most_common_loss_reason && (
                <div className="text-slate-500 text-xs mt-1">{metrics.most_common_loss_reason}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DiagnosticPipelineView;
