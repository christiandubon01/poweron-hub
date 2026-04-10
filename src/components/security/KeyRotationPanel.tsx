import React, { useState, useMemo } from 'react';
import {
  KEY_INVENTORY,
  calculateKeyAge,
  getKeyStatusDisplay,
  getKeyHealthScore,
  generateRotationChecklist,
  generateBreachResponseProtocol,
  ApiKeyEntry,
  RotationChecklistStep,
  formatDuration
} from '../../services/security/KeyRotationManager';

interface RotationHistoryEntry {
  keyName: string;
  rotatedAt: string;
  reason: 'scheduled' | 'breach' | 'manual';
}

interface KeyRotationPanelProps {
  onRotationStart?: (keyName: string) => void;
  onBreachDetected?: (keyName: string) => void;
}

export const KeyRotationPanel: React.FC<KeyRotationPanelProps> = ({
  onRotationStart,
  onBreachDetected
}) => {
  const [keys, setKeys] = useState<ApiKeyEntry[]>(
    KEY_INVENTORY.map(key => ({
      ...key,
      ageDays: calculateKeyAge(key.lastRotated)
    }))
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showChecklist, setShowChecklist] = useState(false);
  const [checklistSteps, setChecklistSteps] = useState<RotationChecklistStep[]>([]);
  const [breachProtocol, setBreachProtocol] = useState<any[]>([]);
  const [showBreachAlert, setShowBreachAlert] = useState(false);
  const [compromisedKeys, setCompromisedKeys] = useState<string[]>([]);
  const [rotationHistory, setRotationHistory] = useState<RotationHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Calculate health score
  const healthScore = useMemo(() => getKeyHealthScore(keys), [keys]);

  // Count keys by status
  const keyCounts = useMemo(() => {
    return {
      total: keys.length,
      active: keys.filter(k => k.status === 'active').length,
      warning: keys.filter(k => {
        const display = getKeyStatusDisplay(k.ageDays);
        return display.color === 'amber';
      }).length,
      critical: keys.filter(k => {
        const display = getKeyStatusDisplay(k.ageDays);
        return display.color === 'red' && k.status !== 'expired';
      }).length,
      expired: keys.filter(k => k.status === 'expired').length,
      compromised: keys.filter(k => k.status === 'compromised').length
    };
  }, [keys]);

  const handleRotateNow = (keyName: string) => {
    const key = keys.find(k => k.name === keyName);
    if (!key) return;

    setSelectedKey(keyName);
    const steps = generateRotationChecklist(keyName);
    setChecklistSteps(steps);
    setShowChecklist(true);

    onRotationStart?.(keyName);
  };

  const handleBreachDetected = () => {
    const protocol = generateBreachResponseProtocol();
    setBreachProtocol(protocol);
    setShowBreachAlert(true);

    // Mark keys as compromised (demo: mark oldest keys)
    const oldestKeys = [...keys]
      .sort((a, b) => b.ageDays - a.ageDays)
      .slice(0, 2)
      .map(k => k.name);

    setCompromisedKeys(oldestKeys);
    setKeys(prev =>
      prev.map(k =>
        oldestKeys.includes(k.name) ? { ...k, status: 'compromised' } : k
      )
    );

    oldestKeys.forEach(keyName => onBreachDetected?.(keyName));
  };

  const handleCompleteRotation = (keyName: string) => {
    setKeys(prev =>
      prev.map(k =>
        k.name === keyName
          ? { ...k, lastRotated: new Date().toISOString(), ageDays: 0, status: 'active' }
          : k
      )
    );

    const newEntry: RotationHistoryEntry = {
      keyName,
      rotatedAt: new Date().toISOString(),
      reason: compromisedKeys.includes(keyName) ? 'breach' : 'scheduled'
    };
    setRotationHistory(prev => [newEntry, ...prev]);

    setShowChecklist(false);
    setSelectedKey(null);
  };

  const handleDismissBreachAlert = () => {
    setShowBreachAlert(false);
    setCompromisedKeys([]);
  };

  return (
    <div className="w-full h-full overflow-auto bg-slate-900 text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold">🔐 Key Rotation Manager</h1>
            <p className="text-gray-400 mt-2">
              Monitor API key lifecycle, detect breaches, and automate rotation
            </p>
          </div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
          >
            Rotation History ({rotationHistory.length})
          </button>
        </div>

        {/* Breach Alert Banner */}
        {showBreachAlert && (
          <div className="bg-red-900/40 border-2 border-red-500 rounded-lg p-4 flex justify-between items-start">
            <div className="flex-1">
              <h3 className="text-lg font-bold text-red-300">🚨 BREACH DETECTED</h3>
              <p className="text-red-200 mt-1">
                Unusual API patterns detected. Initiating 5-minute emergency rotation protocol.
              </p>
              <div className="mt-3 space-y-1">
                {compromisedKeys.map(key => (
                  <p key={key} className="text-sm text-red-300">
                    • {key}
                  </p>
                ))}
              </div>
            </div>
            <button
              onClick={handleDismissBreachAlert}
              className="ml-4 px-3 py-1 bg-red-700 hover:bg-red-800 rounded transition text-sm font-semibold flex-shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Health Score Card */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-xl font-bold">Overall Key Health</h2>
              <p className="text-gray-400">Based on key age and status</p>
            </div>
            <div className="text-right">
              <div className="text-4xl font-bold text-green-400">{healthScore}</div>
              <p className="text-gray-400 text-sm">/ 100</p>
            </div>
          </div>

          {/* Health Bar */}
          <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden mb-4">
            <div
              className={`h-full transition-all ${
                healthScore >= 75 ? 'bg-green-500' : healthScore >= 50 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${healthScore}%` }}
            />
          </div>

          {/* Status Counts */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-center">
            <div className="bg-slate-700 rounded p-3">
              <div className="text-2xl font-bold text-blue-400">{keyCounts.total}</div>
              <p className="text-xs text-gray-400 mt-1">Total Keys</p>
            </div>
            <div className="bg-slate-700 rounded p-3">
              <div className="text-2xl font-bold text-green-400">{keyCounts.active}</div>
              <p className="text-xs text-gray-400 mt-1">Active</p>
            </div>
            <div className="bg-slate-700 rounded p-3">
              <div className="text-2xl font-bold text-yellow-400">{keyCounts.warning}</div>
              <p className="text-xs text-gray-400 mt-1">Warning</p>
            </div>
            <div className="bg-slate-700 rounded p-3">
              <div className="text-2xl font-bold text-orange-400">{keyCounts.critical}</div>
              <p className="text-xs text-gray-400 mt-1">Critical</p>
            </div>
            <div className="bg-slate-700 rounded p-3">
              <div className="text-2xl font-bold text-red-400">{keyCounts.expired}</div>
              <p className="text-xs text-gray-400 mt-1">Expired</p>
            </div>
            <div className="bg-slate-700 rounded p-3">
              <div className="text-2xl font-bold text-pink-400">{keyCounts.compromised}</div>
              <p className="text-xs text-gray-400 mt-1">Compromised</p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={handleBreachDetected}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-semibold transition"
          >
            🚨 Simulate Breach Detection
          </button>
          <a
            href="https://github.com/christiandubon01/poweron-hub"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition"
          >
            GitHub Secret Scanning
          </a>
        </div>

        {/* Key Inventory Grid */}
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">API Key Inventory</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {keys.map(key => {
              const display = getKeyStatusDisplay(key.ageDays);
              const isCompromised = key.status === 'compromised';

              return (
                <div
                  key={key.name}
                  className={`bg-slate-800 border-l-4 rounded-lg p-4 transition ${
                    isCompromised
                      ? 'border-l-pink-500 bg-slate-800/80'
                      : display.color === 'green'
                        ? 'border-l-green-500'
                        : display.color === 'amber'
                          ? 'border-l-yellow-500'
                          : 'border-l-red-500'
                  }`}
                >
                  {/* Key Header */}
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="font-bold text-lg">{key.name}</h3>
                      <p className="text-sm text-gray-400">{key.service}</p>
                      {key.environment && (
                        <p className="text-xs text-gray-500 mt-1">
                          Environment: <span className="font-mono">{key.environment}</span>
                        </p>
                      )}
                    </div>
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold ${
                        isCompromised
                          ? 'bg-pink-600 text-pink-100'
                          : display.color === 'green'
                            ? 'bg-green-600 text-green-100'
                            : display.color === 'amber'
                              ? 'bg-yellow-600 text-yellow-100'
                              : 'bg-red-600 text-red-100'
                      }`}
                    >
                      {key.status === 'compromised' ? '🔴 Compromised' : display.message.split(' —')[0]}
                    </span>
                  </div>

                  {/* Age Bar */}
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Age: {key.ageDays} days</span>
                      <span className="text-gray-400">
                        {Math.max(0, 90 - key.ageDays)} days until rotation
                      </span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          isCompromised
                            ? 'bg-pink-500'
                            : display.color === 'green'
                              ? 'bg-green-500'
                              : display.color === 'amber'
                                ? 'bg-yellow-500'
                                : 'bg-red-500'
                        }`}
                        style={{ width: `${display.percentage}%` }}
                      />
                    </div>
                  </div>

                  {/* Last Rotated */}
                  <p className="text-xs text-gray-500 mb-4">
                    Last rotated: {new Date(key.lastRotated).toLocaleDateString()} (
                    {new Date(key.lastRotated).toLocaleTimeString()})
                  </p>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRotateNow(key.name)}
                      className={`flex-1 px-3 py-2 rounded font-semibold transition text-sm ${
                        isCompromised
                          ? 'bg-pink-600 hover:bg-pink-700 text-white'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      {isCompromised ? '🚨 Rotate Now' : 'Rotate Now'}
                    </button>
                    {key.rotationUrl && (
                      <a
                        href={key.rotationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded font-semibold transition text-sm"
                      >
                        🔗
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Rotation Checklist Modal */}
        {showChecklist && selectedKey && (
          <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-auto border border-slate-700">
              {/* Modal Header */}
              <div className="sticky top-0 bg-slate-800 border-b border-slate-700 p-6 flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold">Rotation Checklist</h2>
                  <p className="text-gray-400">{selectedKey}</p>
                </div>
                <button
                  onClick={() => setShowChecklist(false)}
                  className="text-gray-400 hover:text-white text-2xl"
                >
                  ✕
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 space-y-4">
                {checklistSteps.map((step, idx) => (
                  <div key={step.step} className="bg-slate-700 rounded-lg p-4 border border-slate-600">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-bold text-lg">
                          Step {step.step}: {step.title}
                        </h3>
                        <p className="text-gray-300 mt-1">{step.description}</p>
                      </div>
                      {step.minDuration && (
                        <div className="text-right text-sm text-gray-400">
                          ~{formatDuration(step.minDuration)}
                        </div>
                      )}
                    </div>

                    <ul className="space-y-2 ml-4">
                      {step.actions.map((action, aIdx) => (
                        <li key={aIdx} className="flex items-start text-gray-300">
                          <input
                            type="checkbox"
                            className="mt-1 mr-3 w-4 h-4 cursor-pointer"
                          />
                          <span className="text-sm">{action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* Modal Footer */}
              <div className="sticky bottom-0 bg-slate-800 border-t border-slate-700 p-6 flex justify-between">
                <button
                  onClick={() => setShowChecklist(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleCompleteRotation(selectedKey)}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition"
                >
                  ✓ Mark as Complete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Rotation History Panel */}
        {showHistory && (
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
            <h2 className="text-2xl font-bold mb-4">Rotation History</h2>
            {rotationHistory.length === 0 ? (
              <p className="text-gray-400">No rotations recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {rotationHistory.map((entry, idx) => (
                  <div
                    key={idx}
                    className={`bg-slate-700 p-3 rounded flex justify-between items-center border-l-4 ${
                      entry.reason === 'breach' ? 'border-l-red-500' : 'border-l-blue-500'
                    }`}
                  >
                    <div>
                      <p className="font-semibold">{entry.keyName}</p>
                      <p className="text-sm text-gray-400">
                        {new Date(entry.rotatedAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded text-sm font-semibold ${
                        entry.reason === 'breach'
                          ? 'bg-red-600 text-red-100'
                          : 'bg-blue-600 text-blue-100'
                      }`}
                    >
                      {entry.reason === 'breach' ? '🚨 Breach' : '📅 Scheduled'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Breach Response Protocol (if visible) */}
        {showBreachAlert && breachProtocol.length > 0 && (
          <div className="bg-slate-800 border border-red-600 rounded-lg p-6">
            <h2 className="text-2xl font-bold mb-4">5-Minute Emergency Response Protocol</h2>
            <div className="space-y-4">
              {breachProtocol.map(phase => (
                <div key={phase.phase} className="bg-slate-700 rounded-lg p-4 border-l-4 border-l-red-500">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="font-bold text-lg">
                        Phase {phase.phase} (0-{phase.targetMinutes} min): {phase.name}
                      </h3>
                      <p className="text-gray-300 mt-1">{phase.verification}</p>
                    </div>
                  </div>
                  <ul className="space-y-1 ml-4">
                    {phase.actions.map((action: string, idx: number) => (
                      <li key={idx} className="text-sm text-gray-300 flex items-start">
                        <span className="mr-2">•</span>
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default KeyRotationPanel;
