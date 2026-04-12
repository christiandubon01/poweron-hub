/**
 * GuardianSoloCheckIn.tsx
 * 
 * Full-screen check-in prompt when timer fires.
 * Shows countdown, last check-in time, project address, contact name.
 * Large "I'M OK" button for gloved taps.
 * Visualizes timer with color change (amber → red as deadline approaches).
 */

import React, { useEffect, useState } from 'react';
import { AlertCircle, Phone, Clock, MapPin } from 'lucide-react';
import {
  recordCheckIn,
  SoloWorkSession,
  formatTimeRemaining,
  getCheckInStatusColor,
} from '../../services/guardian/GuardianSoloProtocol';

interface GuardianSoloCheckInProps {
  session: SoloWorkSession;
  onCheckIn: (session: SoloWorkSession) => void;
  onEndWork: () => void;
  missedCheckInStep?: 1 | 2 | 3;
}

export const GuardianSoloCheckIn: React.FC<GuardianSoloCheckInProps> = ({
  session,
  onCheckIn,
  onEndWork,
  missedCheckInStep,
}) => {
  const [timeRemaining, setTimeRemaining] = useState<number>(
    Math.max(0, session.nextCheckInDue - Date.now())
  );
  const [lastCheckInDisplay, setLastCheckInDisplay] = useState<string>('');

  // Update timer every second
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, session.nextCheckInDue - Date.now());
      setTimeRemaining(remaining);
    }, 1000);

    return () => clearInterval(interval);
  }, [session.nextCheckInDue]);

  // Format last check-in time
  useEffect(() => {
    const lastCheckTime = new Date(session.lastCheckInTime);
    const now = new Date();
    const diffMs = now.getTime() - lastCheckTime.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) {
      setLastCheckInDisplay('Just now');
    } else if (diffMins < 60) {
      setLastCheckInDisplay(`${diffMins}m ago`);
    } else {
      const hours = Math.floor(diffMins / 60);
      setLastCheckInDisplay(`${hours}h ago`);
    }
  }, [session.lastCheckInTime]);

  const percentTimeRemaining = timeRemaining / (session.checkInInterval * 60 * 1000);
  const statusColor = getCheckInStatusColor(percentTimeRemaining);
  const colorClasses = {
    green: 'from-green-500 to-green-600',
    amber: 'from-amber-500 to-amber-600',
    red: 'from-red-500 to-red-600',
  };

  const handleCheckIn = () => {
    const updatedSession = recordCheckIn(session);
    onCheckIn(updatedSession);
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      {/* Missed Check-in Escalation Alert */}
      {missedCheckInStep && (
        <div
          className={`absolute top-4 left-4 right-4 p-4 rounded-lg text-white font-semibold flex items-center gap-3 ${
            missedCheckInStep === 3
              ? 'bg-red-600 animate-pulse'
              : 'bg-orange-600 animate-bounce'
          }`}
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {missedCheckInStep === 1 && 'You missed your check-in! Audio alert sent.'}
          {missedCheckInStep === 2 && 'Text message sent to your contact.'}
          {missedCheckInStep === 3 && 'ESCALATED: Emergency contact alerted.'}
        </div>
      )}

      {/* Main Card */}
      <div className="w-full max-w-md">
        {/* Status Bar with Project Info */}
        <div className="bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4">
            <h2 className="text-lg font-bold">Solo Work Check-in</h2>
            <p className="text-blue-100 text-sm mt-1">Tap "I'M OK" to confirm you're safe</p>
          </div>

          {/* Project Details */}
          <div className="p-6 border-b border-gray-200 dark:border-gray-700 space-y-4">
            {/* Project Address */}
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-gray-500 dark:text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                  Location
                </p>
                <p className="text-gray-900 dark:text-white font-medium">
                  {session.projectAddress}
                </p>
              </div>
            </div>

            {/* Contact Info */}
            <div className="flex items-start gap-3">
              <Phone className="w-5 h-5 text-gray-500 dark:text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                  Check-in Contact
                </p>
                <p className="text-gray-900 dark:text-white font-medium">
                  {session.checkInContact.name}
                </p>
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  {session.checkInContact.phone}
                </p>
              </div>
            </div>

            {/* Last Check-in */}
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-gray-500 dark:text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                  Last Check-in
                </p>
                <p className="text-gray-900 dark:text-white font-medium">
                  {lastCheckInDisplay}
                </p>
              </div>
            </div>
          </div>

          {/* Timer Visualization */}
          <div className="p-6 border-b border-gray-200 dark:border-gray-700 space-y-4">
            {/* Countdown Text */}
            <div className="text-center">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                Time Until Next Check-in
              </p>
              <div className={`text-5xl font-bold bg-gradient-to-r ${colorClasses[statusColor]} bg-clip-text text-transparent`}>
                {formatTimeRemaining(timeRemaining)}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r ${colorClasses[statusColor]} transition-all duration-300`}
                style={{ width: `${Math.min(100, percentTimeRemaining * 100)}%` }}
              />
            </div>

            {/* Status Indicator */}
            <div className="text-center">
              <div
                className={`inline-block px-4 py-2 rounded-full text-sm font-semibold ${
                  statusColor === 'green'
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                    : statusColor === 'amber'
                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                    : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                }`}
              >
                {statusColor === 'green'
                  ? '✓ On Schedule'
                  : statusColor === 'amber'
                  ? '⚠ Check-in Soon'
                  : '⚠ Check-in Now'}
              </div>
            </div>
          </div>

          {/* Work Type & Interval */}
          <div className="p-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">
                Work Type: <span className="font-semibold text-gray-900 dark:text-white">{session.workType}</span>
              </span>
              <span className="text-gray-600 dark:text-gray-400">
                Interval: <span className="font-semibold text-gray-900 dark:text-white">{session.checkInInterval}m</span>
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="bg-white dark:bg-gray-900 rounded-b-2xl shadow-2xl p-4 space-y-3">
          {/* Primary "I'M OK" Button */}
          <button
            onClick={handleCheckIn}
            className="w-full bg-gradient-to-b from-green-400 to-green-600 hover:from-green-500 hover:to-green-700
              text-white font-bold text-2xl py-6 px-6 rounded-lg shadow-lg
              active:scale-95 transition-all duration-150
              flex items-center justify-center gap-2"
          >
            <span>✓</span>
            <span>I'M OK</span>
          </button>

          {/* Missed Check-in Warning */}
          {timeRemaining === 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
              <p className="text-xs text-red-700 dark:text-red-300 font-semibold">
                ⚠ You missed your check-in. Escalation in progress.
              </p>
            </div>
          )}

          {/* End Work Button */}
          <button
            onClick={onEndWork}
            className="w-full border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300
              font-semibold py-3 px-4 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800
              transition-all duration-150"
          >
            End Solo Work
          </button>
        </div>

        {/* Missed Check-in History */}
        {session.missedCheckIns.length > 0 && (
          <div className="mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <h3 className="text-sm font-bold text-red-900 dark:text-red-100 mb-2">
              Missed Check-in Log
            </h3>
            <div className="space-y-1 text-xs">
              {session.missedCheckIns.map((miss, idx) => (
                <div key={idx} className="text-red-700 dark:text-red-300">
                  <span className="font-semibold">Step {miss.step}:</span>{' '}
                  {miss.step === 1 && 'Audio alert sent'}
                  {miss.step === 2 && 'Text message sent'}
                  {miss.step === 3 && 'Emergency contact alerted'}
                  {miss.completedAt && ' - Resolved'}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
