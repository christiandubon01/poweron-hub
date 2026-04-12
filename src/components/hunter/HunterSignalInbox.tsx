/**
 * HUNTER Signal Inbox Component
 * UI for digital signal intake, processing, and conversion to leads
 * Supports manual copy-paste from Nextdoor, Facebook, LinkedIn, etc.
 */

import React, { useState, useMemo } from 'react';
import {
  SignalProcessor,
  SignalSource,
  ProcessedSignal,
  RawSignal,
  SignalIntent,
} from '@/services/hunter/HunterDigitalSignals';
import { useHunterStore } from '@/store/hunterStore';
import { LeadStatus } from '@/services/hunter/HunterTypes';

export interface HunterSignalInboxProps {
  userId?: string;
}

/**
 * HUNTER Signal Inbox Component
 * Primary interface for capturing digital signals from community platforms
 */
export const HunterSignalInbox: React.FC<HunterSignalInboxProps> = ({ userId }) => {
  // ===== State =====
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedSource, setSelectedSource] = useState<SignalSource>(SignalSource.MANUAL);
  const [pastedText, setPastedText] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [signals, setSignals] = useState<ProcessedSignal[]>([]);
  const [selectedSignal, setSelectedSignal] = useState<string | null>(null);
  const [filterByIntent, setFilterByIntent] = useState<SignalIntent | 'all'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'urgency'>('recent');

  // Zustand store
  const addLead = useHunterStore((state) => state.addLead);

  // ===== Computed =====
  const supportedSources = useMemo(() => SignalProcessor.getSupportedSources(), []);

  const filteredSignals = useMemo(() => {
    let filtered = signals;

    // Filter by intent
    if (filterByIntent !== 'all') {
      filtered = filtered.filter((s) => s.intent === filterByIntent);
    }

    // Filter out dismissed signals
    filtered = filtered.filter((s) => !s.isDismissed);

    // Sort
    if (sortBy === 'urgency') {
      filtered.sort((a, b) => (b.urgency || 0) - (a.urgency || 0));
    } else {
      filtered.sort((a, b) => new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime());
    }

    return filtered;
  }, [signals, filterByIntent, sortBy]);

  const signalStats = useMemo(() => {
    return {
      total: signals.length,
      realLeads: signals.filter((s) => s.intent === SignalIntent.REAL_LEAD).length,
      noise: signals.filter((s) => s.intent === SignalIntent.NOISE).length,
      uncertain: signals.filter((s) => s.intent === SignalIntent.UNCERTAIN).length,
      dismissed: signals.filter((s) => s.isDismissed).length,
    };
  }, [signals]);

  // ===== Handlers =====

  const handleAddSignal = () => {
    if (!pastedText.trim()) {
      alert('Please paste signal text');
      return;
    }

    const rawSignal: RawSignal = {
      source: selectedSource,
      rawText: pastedText,
      url: sourceUrl || undefined,
      authorName: authorName || undefined,
      postedDate: new Date().toISOString(),
    };

    // Process the signal
    const processed = SignalProcessor.processSignal(selectedSource, rawSignal);
    setSignals([processed, ...signals]);

    // Reset form
    setPastedText('');
    setAuthorName('');
    setSourceUrl('');
    setShowAddForm(false);
  };

  const handleConvertToLead = async (signal: ProcessedSignal) => {
    try {
      const leadData = SignalProcessor.convertSignalToLead(signal);
      const createdLead = await addLead(leadData);

      // Mark signal as converted
      setSignals(
        signals.map((s) =>
          s.id === signal.id ? { ...s, convertedLeadId: createdLead.id } : s
        )
      );

      alert(`Lead created successfully: ${createdLead.id}`);
    } catch (error) {
      console.error('Failed to convert signal to lead:', error);
      alert('Failed to create lead from signal');
    }
  };

  const handleDismissSignal = (signalId: string) => {
    setSignals(
      signals.map((s) =>
        s.id === signalId
          ? {
              ...s,
              isDismissed: true,
              dismissalReason: 'User marked as noise',
            }
          : s
      )
    );
    setSelectedSignal(null);
  };

  const handleDeleteSignal = (signalId: string) => {
    setSignals(signals.filter((s) => s.id !== signalId));
    setSelectedSignal(null);
  };

  // ===== Render =====

  const selectedSignalData = selectedSignal ? signals.find((s) => s.id === selectedSignal) : null;

  return (
    <div className="flex flex-col gap-4 p-4 bg-gradient-to-b from-slate-900 to-slate-950 rounded-lg border border-slate-700">
      {/* Header & Stats */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Signal Inbox</h2>
          <p className="text-sm text-slate-400">Nextdoor, Facebook, LinkedIn, Craigslist, Google Alerts</p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition"
        >
          {showAddForm ? 'Cancel' : '+ Add Signal'}
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-5 gap-2 text-center">
        <div className="p-2 bg-slate-800 rounded text-xs">
          <div className="text-slate-400">Total</div>
          <div className="text-lg font-semibold text-white">{signalStats.total}</div>
        </div>
        <div className="p-2 bg-green-900/30 rounded text-xs border border-green-800">
          <div className="text-green-300">Real</div>
          <div className="text-lg font-semibold text-green-400">{signalStats.realLeads}</div>
        </div>
        <div className="p-2 bg-red-900/30 rounded text-xs border border-red-800">
          <div className="text-red-300">Noise</div>
          <div className="text-lg font-semibold text-red-400">{signalStats.noise}</div>
        </div>
        <div className="p-2 bg-yellow-900/30 rounded text-xs border border-yellow-800">
          <div className="text-yellow-300">Uncertain</div>
          <div className="text-lg font-semibold text-yellow-400">{signalStats.uncertain}</div>
        </div>
        <div className="p-2 bg-slate-700 rounded text-xs">
          <div className="text-slate-300">Dismissed</div>
          <div className="text-lg font-semibold text-slate-400">{signalStats.dismissed}</div>
        </div>
      </div>

      {/* Add Signal Form */}
      {showAddForm && (
        <div className="p-3 bg-slate-800 rounded border border-slate-600 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Signal Source</label>
              <select
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value as SignalSource)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 text-white rounded text-sm"
              >
                {supportedSources.map((source) => (
                  <option key={source.value} value={source.value}>
                    {source.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Author Name (optional)</label>
              <input
                type="text"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="e.g., John D"
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 text-white rounded text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Source URL (optional)</label>
            <input
              type="text"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://nextdoor.com/..."
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 text-white rounded text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Paste Signal Text</label>
            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Copy and paste the post/message text here..."
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 text-white rounded text-sm h-24 resize-none"
            />
          </div>

          <button
            onClick={handleAddSignal}
            className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition font-medium"
          >
            Process Signal
          </button>
        </div>
      )}

      {/* Filter & Sort Controls */}
      {filteredSignals.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <select
            value={filterByIntent}
            onChange={(e) => setFilterByIntent(e.target.value as SignalIntent | 'all')}
            className="px-3 py-1 bg-slate-800 border border-slate-600 text-white text-sm rounded"
          >
            <option value="all">All Intents</option>
            <option value={SignalIntent.REAL_LEAD}>Real Leads</option>
            <option value={SignalIntent.NOISE}>Noise</option>
            <option value={SignalIntent.UNCERTAIN}>Uncertain</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'recent' | 'urgency')}
            className="px-3 py-1 bg-slate-800 border border-slate-600 text-white text-sm rounded"
          >
            <option value="recent">Most Recent</option>
            <option value="urgency">Highest Urgency</option>
          </select>
        </div>
      )}

      {/* Two-Column Layout: Signal Feed + Detail View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4 min-h-96">
        {/* Signal Activity Feed (Left) */}
        <div className="lg:col-span-1 flex flex-col gap-2 bg-slate-800 rounded border border-slate-700 p-3 max-h-96 overflow-y-auto">
          <h3 className="text-sm font-semibold text-white sticky top-0 bg-slate-800 py-1">Activity Feed</h3>
          {filteredSignals.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">No signals yet</div>
          ) : (
            filteredSignals.map((signal) => (
              <button
                key={signal.id}
                onClick={() => setSelectedSignal(signal.id)}
                className={`p-2 rounded text-left text-sm transition ${
                  selectedSignal === signal.id
                    ? 'bg-slate-600 border border-blue-500'
                    : 'bg-slate-700 border border-transparent hover:bg-slate-600'
                } ${
                  signal.intent === SignalIntent.REAL_LEAD ? 'border-l-2 border-l-green-500' : ''
                } ${signal.intent === SignalIntent.NOISE ? 'border-l-2 border-l-red-500' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white truncate">{signal.source}</div>
                    <div className="text-xs text-slate-400 line-clamp-2">
                      {signal.rawText.substring(0, 50)}...
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <span className={`text-xs px-2 py-1 rounded font-medium ${
                      signal.intent === SignalIntent.REAL_LEAD
                        ? 'bg-green-900/40 text-green-300'
                        : signal.intent === SignalIntent.NOISE
                          ? 'bg-red-900/40 text-red-300'
                          : 'bg-yellow-900/40 text-yellow-300'
                    }`}>
                      {signal.urgency}★
                    </span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Signal Detail View (Right) */}
        <div className="lg:col-span-2 flex flex-col gap-3 bg-slate-800 rounded border border-slate-700 p-4">
          {!selectedSignalData ? (
            <div className="flex items-center justify-center h-full text-slate-400">
              <p className="text-center">Select a signal to view details</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-start justify-between gap-2 border-b border-slate-700 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                      selectedSignalData.intent === SignalIntent.REAL_LEAD
                        ? 'bg-green-900 text-green-300'
                        : selectedSignalData.intent === SignalIntent.NOISE
                          ? 'bg-red-900 text-red-300'
                          : 'bg-yellow-900 text-yellow-300'
                    }`}>
                      {selectedSignalData.intent.toUpperCase()}
                    </span>
                    <span className="text-xs text-slate-400">
                      Confidence: {Math.round(selectedSignalData.confidence * 100)}%
                    </span>
                  </div>
                  <p className="text-sm text-slate-300 mt-2">
                    <strong>Source:</strong> {selectedSignalData.source}
                  </p>
                  {selectedSignalData.extractedCity && (
                    <p className="text-sm text-slate-300">
                      <strong>City:</strong> {selectedSignalData.extractedCity}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-blue-400">
                    {selectedSignalData.urgency}
                  </div>
                  <p className="text-xs text-slate-400">Urgency</p>
                </div>
              </div>

              {/* Full Text */}
              <div>
                <h4 className="text-sm font-semibold text-white mb-2">Full Signal Text</h4>
                <div className="p-3 bg-slate-700 rounded text-sm text-slate-200 max-h-32 overflow-y-auto">
                  {selectedSignalData.rawText}
                </div>
              </div>

              {/* Extracted Data */}
              {(selectedSignalData.extractedName ||
                selectedSignalData.extractedPhone ||
                selectedSignalData.extractedEmail ||
                selectedSignalData.detectedJobType) && (
                <div>
                  <h4 className="text-sm font-semibold text-white mb-2">Extracted Information</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {selectedSignalData.extractedName && (
                      <div className="p-2 bg-slate-700 rounded">
                        <p className="text-slate-400">Name</p>
                        <p className="text-white">{selectedSignalData.extractedName}</p>
                      </div>
                    )}
                    {selectedSignalData.extractedPhone && (
                      <div className="p-2 bg-slate-700 rounded">
                        <p className="text-slate-400">Phone</p>
                        <p className="text-white font-mono">{selectedSignalData.extractedPhone}</p>
                      </div>
                    )}
                    {selectedSignalData.extractedEmail && (
                      <div className="p-2 bg-slate-700 rounded">
                        <p className="text-slate-400">Email</p>
                        <p className="text-white text-xs">{selectedSignalData.extractedEmail}</p>
                      </div>
                    )}
                    {selectedSignalData.detectedJobType && (
                      <div className="p-2 bg-slate-700 rounded">
                        <p className="text-slate-400">Job Type</p>
                        <p className="text-white">{selectedSignalData.detectedJobType}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Keywords */}
              {selectedSignalData.keywordMatches.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-white mb-2">Matched Keywords</h4>
                  <div className="flex flex-wrap gap-1">
                    {selectedSignalData.keywordMatches.slice(0, 8).map((keyword) => (
                      <span key={keyword} className="px-2 py-1 bg-slate-700 text-slate-300 text-xs rounded">
                        {keyword}
                      </span>
                    ))}
                    {selectedSignalData.keywordMatches.length > 8 && (
                      <span className="px-2 py-1 text-slate-400 text-xs">
                        +{selectedSignalData.keywordMatches.length - 8} more
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 mt-auto pt-3 border-t border-slate-700">
                {!selectedSignalData.convertedLeadId && selectedSignalData.intent === SignalIntent.REAL_LEAD && (
                  <button
                    onClick={() => handleConvertToLead(selectedSignalData)}
                    className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition font-medium"
                  >
                    Convert to Lead
                  </button>
                )}
                {!selectedSignalData.convertedLeadId && (
                  <button
                    onClick={() => handleDismissSignal(selectedSignalData.id)}
                    className="flex-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition"
                  >
                    Dismiss as Noise
                  </button>
                )}
                <button
                  onClick={() => handleDeleteSignal(selectedSignalData.id)}
                  className="flex-1 px-3 py-2 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded transition"
                >
                  Delete
                </button>
              </div>

              {/* Converted Lead Badge */}
              {selectedSignalData.convertedLeadId && (
                <div className="p-2 bg-green-900/20 border border-green-800 rounded text-sm text-green-300 text-center">
                  ✓ Converted to Lead: {selectedSignalData.convertedLeadId}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default HunterSignalInbox;
