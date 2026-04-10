/**
 * Coaching Overlay Component
 * Real-time coaching alerts during SPARK practice rounds
 * Non-intrusive alert banner that slides in and auto-dismisses
 */

import React, { useState, useEffect } from 'react';
import { CoachingAlert, formatCoachingAlert } from '../../../services/sparkTraining/SparkPerceptionCoach';

export interface CoachingOverlayProps {
  alert: CoachingAlert | null;
  onDismiss?: () => void;
  autoDismissMs?: number;
  enabled?: boolean;
}

export const CoachingOverlay: React.FC<CoachingOverlayProps> = ({
  alert,
  onDismiss,
  autoDismissMs = 3000,
  enabled = true,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [displayAlert, setDisplayAlert] = useState<CoachingAlert | null>(null);

  useEffect(() => {
    if (!alert || !enabled) {
      setIsVisible(false);
      setDisplayAlert(null);
      return;
    }

    setDisplayAlert(alert);
    setIsVisible(true);

    const timer = setTimeout(() => {
      setIsVisible(false);
      if (onDismiss) {
        setTimeout(onDismiss, 300); // Allow animation to complete
      }
    }, autoDismissMs);

    return () => clearTimeout(timer);
  }, [alert, enabled, onDismiss, autoDismissMs]);

  if (!displayAlert || !isVisible) {
    return null;
  }

  const formatted = formatCoachingAlert(displayAlert);

  return (
    <div
      className={`
        fixed top-4 left-1/2 -translate-x-1/2 z-50
        transition-all duration-300 ease-out
        ${isVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'}
      `}
    >
      <div
        className={`
          ${formatted.bgColor} ${formatted.textColor}
          px-4 py-3 rounded-lg shadow-lg
          max-w-md min-w-xs
          backdrop-blur-sm
          border border-opacity-30 border-current
          flex items-start gap-3
          animate-pulse-subtle
        `}
      >
        <span className="text-xl flex-shrink-0 mt-0.5">{formatted.icon}</span>
        <div className="flex-1 text-sm leading-snug">
          <p className="font-semibold">{formatted.displayText}</p>
          {displayAlert.suggestion && (
            <p className="mt-1 opacity-90 text-xs italic">{displayAlert.suggestion}</p>
          )}
        </div>
        <button
          onClick={() => setIsVisible(false)}
          className="flex-shrink-0 text-lg opacity-60 hover:opacity-100 transition-opacity"
          aria-label="Dismiss alert"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export interface CoachingOverlayStackProps {
  alerts: CoachingAlert[];
  maxVisible?: number;
  enabled?: boolean;
  onDismissAlert?: (alertId: string) => void;
}

/**
 * Stack multiple alerts with smart queuing
 * Shows highest priority first, dismisses older ones as new ones arrive
 */
export const CoachingOverlayStack: React.FC<CoachingOverlayStackProps> = ({
  alerts,
  maxVisible = 1,
  enabled = true,
  onDismissAlert,
}) => {
  const priorityOrder = { critical: 0, warning: 1, note: 2 };
  const sortedAlerts = [...alerts].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
  );

  const visibleAlerts = sortedAlerts.slice(0, maxVisible);

  return (
    <div className="fixed top-0 left-0 right-0 pointer-events-none">
      {visibleAlerts.map((alert) => (
        <CoachingOverlay
          key={alert.id}
          alert={alert}
          enabled={enabled}
          onDismiss={() => onDismissAlert?.(alert.id)}
          autoDismissMs={alert.priority === 'critical' ? 5000 : 3000}
        />
      ))}
    </div>
  );
};

export interface AlertHistoryProps {
  alerts: CoachingAlert[];
  maxItems?: number;
  onClear?: () => void;
}

/**
 * Display a scrollable history of coaching alerts from the session
 */
export const AlertHistory: React.FC<AlertHistoryProps> = ({
  alerts,
  maxItems = 10,
  onClear,
}) => {
  const displayAlerts = alerts.slice(0, maxItems);

  if (displayAlerts.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <p>No coaching alerts yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-96 overflow-y-auto">
      {displayAlerts.map((alert) => {
        const formatted = formatCoachingAlert(alert);
        return (
          <div
            key={alert.id}
            className={`
              ${formatted.bgColor} ${formatted.textColor}
              p-3 rounded border-l-4
              text-sm
              opacity-75 hover:opacity-100 transition-opacity
            `}
          >
            <div className="flex gap-2 items-start">
              <span className="text-lg flex-shrink-0">{formatted.icon}</span>
              <div className="flex-1">
                <p className="font-semibold text-xs">Turn {alert.turnNumber}</p>
                <p>{alert.message}</p>
                {alert.suggestion && (
                  <p className="mt-1 text-xs italic opacity-75">{alert.suggestion}</p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export interface CoachingSettingsProps {
  coachingEnabled: boolean;
  onToggle: (enabled: boolean) => void;
  autoDismissMs?: number;
  onAutoDismissChange?: (ms: number) => void;
}

/**
 * Settings panel for coaching overlay behavior
 */
export const CoachingSettings: React.FC<CoachingSettingsProps> = ({
  coachingEnabled,
  onToggle,
  autoDismissMs = 3000,
  onAutoDismissChange,
}) => {
  return (
    <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
      <div className="flex items-center justify-between">
        <label htmlFor="coaching-toggle" className="text-sm font-semibold">
          Real-time Coaching Alerts
        </label>
        <button
          id="coaching-toggle"
          onClick={() => onToggle(!coachingEnabled)}
          className={`
            relative inline-flex h-6 w-11 items-center rounded-full
            transition-colors
            ${coachingEnabled ? 'bg-green-600' : 'bg-gray-300'}
          `}
        >
          <span
            className={`
              inline-block h-4 w-4 transform rounded-full
              bg-white transition-transform
              ${coachingEnabled ? 'translate-x-6' : 'translate-x-1'}
            `}
          />
        </button>
      </div>

      <div className="text-xs text-gray-600 dark:text-gray-400">
        <p>
          {coachingEnabled
            ? 'Coaching alerts enabled. Alerts appear during practice rounds.'
            : 'Coaching alerts disabled. Turn on for real-time guidance.'}
        </p>
      </div>

      {coachingEnabled && (
        <div className="space-y-2">
          <label htmlFor="dismiss-timer" className="block text-xs font-semibold">
            Auto-dismiss after (seconds):
          </label>
          <select
            id="dismiss-timer"
            value={autoDismissMs}
            onChange={(e) => onAutoDismissChange?.(parseInt(e.target.value))}
            className="w-full px-2 py-1 text-xs border rounded bg-white dark:bg-gray-800"
          >
            <option value={2000}>2 seconds</option>
            <option value={3000}>3 seconds</option>
            <option value={5000}>5 seconds</option>
            <option value={10000}>10 seconds</option>
            <option value={Infinity}>Never auto-dismiss</option>
          </select>
        </div>
      )}

      <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1 pt-2 border-t">
        <p>
          <strong>Critical alerts:</strong> Ego triggers, discount offers, free work
        </p>
        <p>
          <strong>Warning alerts:</strong> Filler words, hedge language, weak delivery
        </p>
        <p>
          <strong>Notes:</strong> Opportunities, technical depth suggestions
        </p>
      </div>
    </div>
  );
};

export default CoachingOverlay;
