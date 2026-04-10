/**
 * GuardianSafetyAssessment.tsx
 * 
 * Safety assessment form required before solo work begins.
 * User must complete all fields before proceeding to work.
 */

import React, { useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { createSafetyAssessment, SafetyAssessment } from '../../services/guardian/GuardianSoloProtocol';

interface GuardianSafetyAssessmentProps {
  projectId: string;
  workerId: string;
  projectAddress: string;
  onAssessmentComplete: (assessment: SafetyAssessment) => void;
  onCancel: () => void;
}

export const GuardianSafetyAssessment: React.FC<GuardianSafetyAssessmentProps> = ({
  projectId,
  workerId,
  projectAddress,
  onAssessmentComplete,
  onCancel,
}) => {
  const [workType, setWorkType] = useState<'attic' | 'confined' | 'standard' | 'custom'>(
    'standard'
  );
  const [hazards, setHazards] = useState<Set<string>>(new Set());
  const [ppe, setPpe] = useState<Set<string>>(new Set());
  const [deEnergized, setDeEnergized] = useState(false);
  const [deEnergyPhotoUrl, setDeEnergyPhotoUrl] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [checkInInterval, setCheckInInterval] = useState(120); // minutes
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const hazardOptions = [
    { id: 'electrical', label: 'Electrical hazards' },
    { id: 'height', label: 'Height / fall risk' },
    { id: 'confined', label: 'Confined space' },
    { id: 'heat', label: 'Heat / temperature' },
    { id: 'unknown', label: 'Unknown conditions' },
  ];

  const ppeOptions = [
    { id: 'gloves', label: 'Safety gloves' },
    { id: 'glasses', label: 'Safety glasses' },
    { id: 'hardhat', label: 'Hard hat' },
    { id: 'arcflash', label: 'Arc flash gear' },
    { id: 'harness', label: 'Fall protection harness' },
  ];

  const toggleHazard = (id: string) => {
    const updated = new Set(hazards);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setHazards(updated);
  };

  const togglePpe = (id: string) => {
    const updated = new Set(ppe);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setPpe(updated);
  };

  const isFormComplete =
    hazards.size > 0 &&
    ppe.size > 0 &&
    deEnergized &&
    contactName.trim() &&
    contactPhone.trim();

  const handleSubmit = async () => {
    if (!isFormComplete) {
      setError('Please complete all required fields');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const assessmentInput = {
        projectId,
        workerId,
        workType,
        hazardsIdentified: Array.from(hazards),
        ppeInUse: Array.from(ppe),
        deEnergizationVerified: deEnergized,
        deEnergizationPhotoUrl: deEnergyPhotoUrl,
        checkInContact: {
          name: contactName,
          phone: contactPhone,
        },
        checkInInterval,
        additionalNotes: notes,
      };

      const assessment = await createSafetyAssessment(projectId, workerId, assessmentInput);

      onAssessmentComplete(assessment);
    } catch (err) {
      setError((err as Error).message || 'Failed to save assessment');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 p-6">
          <div className="flex items-center gap-3 mb-2">
            <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Solo Work Safety Assessment
            </h2>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            This assessment is required before beginning solo work. All fields must be
            completed.
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {/* Project Address */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
              Project Address
            </label>
            <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded text-gray-700 dark:text-gray-300">
              {projectAddress}
            </div>
          </div>

          {/* Work Type */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-3">
              Work Type <span className="text-red-600">*</span>
            </label>
            <div className="space-y-2">
              {(
                [
                  { id: 'attic', label: 'Attic or confined space' },
                  { id: 'standard', label: 'Standard field work' },
                  { id: 'custom', label: 'Custom (user-defined)' },
                ] as const
              ).map((type) => (
                <label key={type.id} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="workType"
                    value={type.id}
                    checked={workType === type.id}
                    onChange={(e) => setWorkType(e.target.value as any)}
                    className="w-4 h-4"
                  />
                  <span className="text-gray-700 dark:text-gray-300">{type.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Hazards Identified */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-3">
              Hazards Identified <span className="text-red-600">*</span>
            </label>
            <div className="space-y-2">
              {hazardOptions.map((hazard) => (
                <label key={hazard.id} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hazards.has(hazard.id)}
                    onChange={() => toggleHazard(hazard.id)}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-gray-700 dark:text-gray-300">{hazard.label}</span>
                </label>
              ))}
            </div>
            {hazards.size === 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                ⚠ At least one hazard must be identified
              </p>
            )}
          </div>

          {/* PPE in Use */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-3">
              Personal Protective Equipment <span className="text-red-600">*</span>
            </label>
            <div className="space-y-2">
              {ppeOptions.map((item) => (
                <label key={item.id} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ppe.has(item.id)}
                    onChange={() => togglePpe(item.id)}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-gray-700 dark:text-gray-300">{item.label}</span>
                </label>
              ))}
            </div>
            {ppe.size === 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                ⚠ At least one PPE item must be selected
              </p>
            )}
          </div>

          {/* De-energization Verification */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-3">
              De-energization Verification <span className="text-red-600">*</span>
            </label>
            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deEnergized}
                  onChange={(e) => setDeEnergized(e.target.checked)}
                  className="w-4 h-4 rounded mt-1"
                />
                <div>
                  <span className="text-gray-700 dark:text-gray-300">
                    Circuit breaker OFF and verified with meter
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Confirm power is de-energized before starting work
                  </p>
                </div>
              </label>
              {deEnergized && (
                <div>
                  <input
                    type="text"
                    placeholder="Photo URL (optional)"
                    value={deEnergyPhotoUrl}
                    onChange={(e) => setDeEnergyPhotoUrl(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded
                      bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Optional: Link to meter verification photo
                  </p>
                </div>
              )}
            </div>
            {!deEnergized && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                ⚠ De-energization verification is required
              </p>
            )}
          </div>

          {/* Check-in Contact */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                Check-in Contact Name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="e.g., Office Manager"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded
                  bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                Phone Number <span className="text-red-600">*</span>
              </label>
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="(760) 000-0000"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded
                  bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          {/* Check-in Interval */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-3">
              Check-in Interval <span className="text-red-600">*</span>
            </label>
            <div className="space-y-2">
              {[
                { value: 30, label: 'Every 30 minutes (attic/confined space)' },
                { value: 60, label: 'Every 1 hour' },
                { value: 120, label: 'Every 2 hours (standard field work)' },
              ].map((option) => (
                <label key={option.value} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="checkInInterval"
                    value={option.value}
                    checked={checkInInterval === option.value}
                    onChange={(e) => setCheckInInterval(parseInt(e.target.value))}
                    className="w-4 h-4"
                  />
                  <span className="text-gray-700 dark:text-gray-300">{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Additional Notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
              Additional Safety Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional safety observations or concerns..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded
                bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>

          {/* Completion Checklist */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">
              Completion Checklist
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                {hazards.size > 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                ) : (
                  <div className="w-4 h-4 border-2 border-gray-300 rounded-full" />
                )}
                <span className={hazards.size > 0 ? 'text-green-700 dark:text-green-300' : 'text-gray-600 dark:text-gray-400'}>
                  Hazards identified
                </span>
              </div>
              <div className="flex items-center gap-2">
                {ppe.size > 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                ) : (
                  <div className="w-4 h-4 border-2 border-gray-300 rounded-full" />
                )}
                <span className={ppe.size > 0 ? 'text-green-700 dark:text-green-300' : 'text-gray-600 dark:text-gray-400'}>
                  PPE selected
                </span>
              </div>
              <div className="flex items-center gap-2">
                {deEnergized ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                ) : (
                  <div className="w-4 h-4 border-2 border-gray-300 rounded-full" />
                )}
                <span className={deEnergized ? 'text-green-700 dark:text-green-300' : 'text-gray-600 dark:text-gray-400'}>
                  De-energization verified
                </span>
              </div>
              <div className="flex items-center gap-2">
                {contactName.trim() && contactPhone.trim() ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                ) : (
                  <div className="w-4 h-4 border-2 border-gray-300 rounded-full" />
                )}
                <span className={contactName.trim() && contactPhone.trim() ? 'text-green-700 dark:text-green-300' : 'text-gray-600 dark:text-gray-400'}>
                  Check-in contact info provided
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
              text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800
              font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isFormComplete || saving}
            className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg
              font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Start Work'}
          </button>
        </div>
      </div>
    </div>
  );
};
