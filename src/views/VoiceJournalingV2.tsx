// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import type { JournalCategory, JournalEntry } from '../types';
import { mockJournalEntries } from '../mock';

// ─── Constants ────────────────────────────────────────────────────────────────

type RecordingState = 'idle' | 'recording' | 'processing' | 'saved';

const ALL_CATEGORIES: JournalCategory[] = [
  'field',
  'financial',
  'personal',
  'project',
  'general',
];

const CATEGORY_LABELS: Record<JournalCategory, string> = {
  field: 'Field',
  financial: 'Financial',
  personal: 'Personal',
  project: 'Project',
  general: 'General',
};

const CATEGORY_COLORS: Record<JournalCategory, { bg: string; text: string; border: string }> = {
  field: {
    bg: 'bg-amber-100',
    text: 'text-amber-800',
    border: 'border-amber-300',
  },
  financial: {
    bg: 'bg-emerald-100',
    text: 'text-emerald-800',
    border: 'border-emerald-300',
  },
  personal: {
    bg: 'bg-violet-100',
    text: 'text-violet-800',
    border: 'border-violet-300',
  },
  project: {
    bg: 'bg-sky-100',
    text: 'text-sky-800',
    border: 'border-sky-300',
  },
  general: {
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-300',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(seconds?: number): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen).trimEnd() + '…' : text;
}

// ─── Category Badge ───────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: JournalCategory }) {
  const colors = CATEGORY_COLORS[category];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${colors.bg} ${colors.text} ${colors.border}`}
    >
      {CATEGORY_LABELS[category]}
    </span>
  );
}

// ─── Playback Stub ────────────────────────────────────────────────────────────

function PlaybackStub({ duration }: { duration?: number }) {
  const [playing, setPlaying] = useState(false);

  const handlePlay = () => {
    setPlaying((prev) => !prev);
    // Wire to ElevenLabs during integration — trigger real audio playback from audioUrl
  };

  return (
    <div className="mt-3 flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
      {/* Play/Pause button */}
      <button
        onClick={handlePlay}
        className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-700 hover:bg-slate-900 flex items-center justify-center transition-colors"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          // Pause icon
          <svg className="w-3 h-3 text-white" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1" y="0" width="3" height="10" />
            <rect x="6" y="0" width="3" height="10" />
          </svg>
        ) : (
          // Play icon
          <svg className="w-3 h-3 text-white" viewBox="0 0 10 10" fill="currentColor">
            <polygon points="1,0 9,5 1,10" />
          </svg>
        )}
      </button>

      {/* Progress bar (static at 0) */}
      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div className="h-full w-0 bg-slate-500 rounded-full" />
      </div>

      {/* Duration */}
      <span className="flex-shrink-0 text-xs text-slate-500 tabular-nums">
        {formatDuration(duration)}
      </span>

      {/* Integration note */}
      <span className="flex-shrink-0 text-xs text-slate-400 italic">
        Audio wired during integration
      </span>
    </div>
  );
}

// ─── Journal Entry Card ───────────────────────────────────────────────────────

function EntryCard({ entry }: { entry: JournalEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      {/* Header row */}
      <button
        className="w-full text-left px-4 pt-4 pb-3 flex items-start justify-between gap-3"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <div className="flex-1 min-w-0">
          {/* Meta row */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <CategoryBadge category={entry.category} />
            <span className="text-xs text-slate-400">{formatTimestamp(entry.timestamp)}</span>
            {entry.duration !== undefined && (
              <span className="text-xs text-slate-400">· {formatDuration(entry.duration)}</span>
            )}
          </div>
          {/* Preview */}
          <p className="text-sm text-slate-700 leading-snug">
            {expanded ? entry.transcript : truncate(entry.transcript, 100)}
          </p>
        </div>
        {/* Chevron */}
        <svg
          className={`flex-shrink-0 w-4 h-4 text-slate-400 mt-0.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="4,6 8,10 12,6" />
        </svg>
      </button>

      {/* Expanded section */}
      {expanded && (
        <div className="px-4 pb-4">
          {/* Full transcript (already shown above when expanded, but add playback) */}
          <PlaybackStub duration={entry.duration} />
          {(entry.tags ?? []).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(entry.tags ?? []).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-xs border border-slate-200"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Record Panel ─────────────────────────────────────────────────────────────

interface RecordPanelProps {
  onSave: (entry: JournalEntry) => void;
}

function RecordPanel({ onSave }: RecordPanelProps) {
  const [recordState, setRecordState] = useState<RecordingState>('idle');
  const [selectedCategory, setSelectedCategory] = useState<JournalCategory>('general');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMicClick = () => {
    if (recordState === 'idle') {
      setRecordState('recording');
      // Simulate 3-second recording, then processing, then saved
      timerRef.current = setTimeout(() => {
        setRecordState('processing');
        setTimeout(() => {
          // Create a stub saved entry
          const newEntry: JournalEntry = {
            id: `jrn-stub-${Date.now()}`,
            timestamp: new Date().toISOString(),
            category: selectedCategory,
            transcript: '(Stub) Voice note recorded during this session — transcript will appear here after real API integration.',
            duration: 3,
            tags: ['stub'],
          };
          onSave(newEntry);
          setRecordState('saved');
          // Reset after 2 seconds
          setTimeout(() => setRecordState('idle'), 2000);
        }, 1000);
      }, 3000);
    } else if (recordState === 'recording') {
      // Allow early stop
      if (timerRef.current) clearTimeout(timerRef.current);
      setRecordState('processing');
      setTimeout(() => {
        const newEntry: JournalEntry = {
          id: `jrn-stub-${Date.now()}`,
          timestamp: new Date().toISOString(),
          category: selectedCategory,
          transcript: '(Stub) Voice note recorded during this session — transcript will appear here after real API integration.',
          duration: 1,
          tags: ['stub'],
        };
        onSave(newEntry);
        setRecordState('saved');
        setTimeout(() => setRecordState('idle'), 2000);
      }, 1000);
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const micColors: Record<RecordingState, string> = {
    idle: 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-200',
    recording: 'bg-red-600 animate-pulse shadow-lg shadow-red-300',
    processing: 'bg-amber-400 cursor-wait shadow-lg shadow-amber-200',
    saved: 'bg-emerald-500 cursor-default shadow-lg shadow-emerald-200',
  };

  const micLabel: Record<RecordingState, string> = {
    idle: 'Tap to record',
    recording: 'Recording… tap to stop',
    processing: 'Transcribing…',
    saved: 'Saved!',
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 flex flex-col items-center gap-5">
      <h2 className="text-base font-semibold text-slate-700 tracking-wide uppercase">
        New Voice Entry
      </h2>

      {/* Category selector */}
      <div className="flex flex-wrap justify-center gap-2">
        {ALL_CATEGORIES.map((cat) => {
          const colors = CATEGORY_COLORS[cat];
          const active = selectedCategory === cat;
          return (
            <button
              key={cat}
              disabled={recordState !== 'idle'}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-all
                ${active
                  ? `${colors.bg} ${colors.text} ${colors.border} shadow-sm`
                  : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                }
                ${recordState !== 'idle' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          );
        })}
      </div>

      {/* Mic button */}
      <button
        onClick={handleMicClick}
        disabled={recordState === 'processing' || recordState === 'saved'}
        className={`w-24 h-24 rounded-full flex items-center justify-center transition-all
          ${micColors[recordState]}
          ${recordState === 'processing' || recordState === 'saved' ? 'cursor-not-allowed' : 'cursor-pointer active:scale-95'}`}
        aria-label={micLabel[recordState]}
      >
        {recordState === 'saved' ? (
          // Checkmark
          <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="4,12 9,17 20,6" />
          </svg>
        ) : recordState === 'processing' ? (
          // Spinner
          <svg className="w-8 h-8 text-white animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </svg>
        ) : (
          // Mic icon
          <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" stroke="none" />
            <path d="M5 10a7 7 0 0 0 14 0" strokeLinecap="round" />
            <line x1="12" y1="17" x2="12" y2="21" strokeLinecap="round" />
            <line x1="8" y1="21" x2="16" y2="21" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {/* State label */}
      <p className="text-sm text-slate-500">{micLabel[recordState]}</p>
    </div>
  );
}

// ─── Filter Tabs ──────────────────────────────────────────────────────────────

type FilterValue = 'all' | JournalCategory;

interface FilterTabsProps {
  active: FilterValue;
  onChange: (val: FilterValue) => void;
}

function FilterTabs({ active, onChange }: FilterTabsProps) {
  const tabs: { value: FilterValue; label: string }[] = [
    { value: 'all', label: 'All' },
    ...ALL_CATEGORIES.map((c) => ({ value: c as FilterValue, label: CATEGORY_LABELS[c] })),
  ];

  return (
    <div className="flex flex-wrap gap-1.5">
      {tabs.map((tab) => {
        const isActive = active === tab.value;
        const catColors =
          tab.value !== 'all' ? CATEGORY_COLORS[tab.value as JournalCategory] : null;
        return (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            className={`px-3 py-1 rounded-full text-sm font-medium border transition-all
              ${isActive
                ? catColors
                  ? `${catColors.bg} ${catColors.text} ${catColors.border}`
                  : 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
              }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function VoiceJournalingV2() {
  // Replace with real Supabase query during integration
  const [entries, setEntries] = useState<JournalEntry[]>(() =>
    [...mockJournalEntries].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    ),
  );
  const [activeFilter, setActiveFilter] = useState<FilterValue>('all');

  const handleSave = (entry: JournalEntry) => {
    setEntries((prev) =>
      [entry, ...prev].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      ),
    );
  };

  const filtered =
    activeFilter === 'all'
      ? entries
      : entries.filter((e) => e.category === activeFilter);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Page header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <h1 className="text-xl font-bold text-slate-900">Voice Journal</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Record voice notes — auto-categorized and transcribed
        </p>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-6">
        {/* Record panel */}
        <RecordPanel onSave={handleSave} />

        {/* Entry list */}
        <div className="flex flex-col gap-4">
          {/* Filter tabs */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <FilterTabs active={activeFilter} onChange={setActiveFilter} />
            <span className="text-xs text-slate-400">
              {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>

          {/* Entries */}
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              No entries for this category yet.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filtered.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
