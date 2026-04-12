/**
 * GuardianSoloProtocol.ts
 * 
 * Solo work safety protocol for GUARDIAN agent.
 * Detects solo work (1 worker clocked in via CHRONO), enforces safety assessment,
 * manages check-in timer, and escalates missed check-ins.
 * 
 * Supabase table: guardian_checklists (stores solo_safety assessments)
 */

import { supabase } from '../../lib/supabase';

export interface SafetyAssessment {
  id: string;
  projectId: string;
  workerId: string;
  date: string;
  workType: 'attic' | 'confined' | 'standard' | 'custom';
  hazardsIdentified: string[];
  ppeInUse: string[];
  deEnergizationVerified: boolean;
  deEnergizationPhotoUrl?: string;
  checkInContact: {
    name: string;
    phone: string;
  };
  checkInInterval: number; // minutes
  additionalNotes?: string;
  completedAt: string;
}

export interface SoloWorkSession {
  id: string;
  projectId: string;
  workerId: string;
  safetyAssessmentId: string;
  startTime: number; // timestamp ms
  lastCheckInTime: number; // timestamp ms
  nextCheckInDue: number; // timestamp ms
  checkInInterval: number; // minutes
  workType: 'attic' | 'confined' | 'standard' | 'custom';
  checkInContact: {
    name: string;
    phone: string;
  };
  projectAddress: string;
  missedCheckIns: MissedCheckInEscalation[];
  active: boolean;
}

export interface MissedCheckInEscalation {
  missedAt: number; // timestamp ms
  step: 1 | 2 | 3; // step 1: 2nd notif, step 2: text, step 3: emergency
  completedAt?: number;
  contactAttempted?: string;
}

// ===== SOLO WORK DETECTION =====

/**
 * detectSoloWork - Check if only 1 worker is clocked into a job via CHRONO
 * Returns true if solo, false if crew present
 */
export function detectSoloWork(clockedWorkers: any[]): boolean {
  return clockedWorkers && clockedWorkers.length === 1;
}

// ===== SAFETY ASSESSMENT =====

/**
 * createSafetyAssessment - Save safety assessment before solo work begins
 */
export async function createSafetyAssessment(
  projectId: string,
  workerId: string,
  assessment: {
    workType: 'attic' | 'confined' | 'standard' | 'custom';
    hazardsIdentified: string[];
    ppeInUse: string[];
    deEnergizationVerified: boolean;
    deEnergizationPhotoUrl?: string;
    checkInContact: { name: string; phone: string };
    checkInInterval: number;
    additionalNotes?: string;
  }
): Promise<SafetyAssessment> {
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  const newAssessment: SafetyAssessment = {
    id: `sa_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    projectId,
    workerId,
    date: today,
    workType: assessment.workType,
    hazardsIdentified: assessment.hazardsIdentified,
    ppeInUse: assessment.ppeInUse,
    deEnergizationVerified: assessment.deEnergizationVerified,
    deEnergizationPhotoUrl: assessment.deEnergizationPhotoUrl,
    checkInContact: assessment.checkInContact,
    checkInInterval: assessment.checkInInterval,
    additionalNotes: assessment.additionalNotes,
    completedAt: now,
  };

  // Save to guardian_checklists with type 'solo_safety'
  const payload = {
    id: newAssessment.id,
    project_id: projectId,
    worker_id: workerId,
    type: 'solo_safety',
    date: newAssessment.date,
    hazards: newAssessment.hazardsIdentified,
    ppe: newAssessment.ppeInUse,
    de_energized: newAssessment.deEnergizationVerified,
    de_energization_photo_url: newAssessment.deEnergizationPhotoUrl,
    checkin_contact_name: newAssessment.checkInContact.name,
    checkin_contact_phone: newAssessment.checkInContact.phone,
    checkin_interval_minutes: newAssessment.checkInInterval,
    notes: newAssessment.additionalNotes,
    completed_at: newAssessment.completedAt,
  };

  const { error } = await (supabase
    .from('guardian_checklists') as any)
    .insert([payload]);

  if (error) {
    throw new Error(`Failed to save safety assessment: ${error.message}`);
  }

  return newAssessment;
}

/**
 * getSoloSafetyAssessments - Fetch all solo safety assessments for a project
 */
export async function getSoloSafetyAssessments(
  projectId: string
): Promise<SafetyAssessment[]> {
  const { data, error } = await (supabase
    .from('guardian_checklists') as any)
    .select('*')
    .eq('project_id', projectId)
    .eq('type', 'solo_safety')
    .order('completed_at', { ascending: false });

  if (error) {
    console.warn(`Failed to fetch safety assessments: ${error.message}`);
    return [];
  }

  return (data || []).map((row: any) => ({
    id: row.id || '',
    projectId: row.project_id || '',
    workerId: row.worker_id || '',
    date: row.date || '',
    workType: (row.work_type || 'standard') as 'attic' | 'confined' | 'standard' | 'custom',
    hazardsIdentified: row.hazards || [],
    ppeInUse: row.ppe || [],
    deEnergizationVerified: row.de_energized || false,
    deEnergizationPhotoUrl: row.de_energization_photo_url,
    checkInContact: {
      name: row.checkin_contact_name || '',
      phone: row.checkin_contact_phone || '',
    },
    checkInInterval: row.checkin_interval_minutes || 120,
    additionalNotes: row.notes,
    completedAt: row.completed_at || '',
  }));
}

// ===== CHECK-IN TIMER & SESSIONS =====

/**
 * startSoloWorkSession - Initialize check-in timer after safety assessment
 */
export function startSoloWorkSession(
  projectId: string,
  workerId: string,
  safetyAssessmentId: string,
  assessment: SafetyAssessment,
  projectAddress: string
): SoloWorkSession {
  const now = Date.now();
  const intervalMs = assessment.checkInInterval * 60 * 1000;

  const session: SoloWorkSession = {
    id: `sws_${now}_${Math.random().toString(36).substr(2, 9)}`,
    projectId,
    workerId,
    safetyAssessmentId,
    startTime: now,
    lastCheckInTime: now,
    nextCheckInDue: now + intervalMs,
    checkInInterval: assessment.checkInInterval,
    workType: assessment.workType,
    checkInContact: assessment.checkInContact,
    projectAddress,
    missedCheckIns: [],
    active: true,
  };

  return session;
}

/**
 * recordCheckIn - User tapped "I'm OK" — reset timer
 */
export function recordCheckIn(session: SoloWorkSession): SoloWorkSession {
  const now = Date.now();
  const intervalMs = session.checkInInterval * 60 * 1000;

  return {
    ...session,
    lastCheckInTime: now,
    nextCheckInDue: now + intervalMs,
    missedCheckIns: session.missedCheckIns.filter(m => m.completedAt),
  };
}

/**
 * checkMissedCheckIn - Evaluate escalation after missed check-in
 * Returns the escalation step (1, 2, or 3)
 */
export function checkMissedCheckIn(
  session: SoloWorkSession,
  timeSinceMissedMs: number
): { step: 1 | 2 | 3; escalate: boolean } {
  // 5 min grace → step 1 (2nd notification + audio)
  // 10 min grace → step 2 (text message)
  // 25 min grace → step 3 (emergency contact)

  if (timeSinceMissedMs >= 25 * 60 * 1000) {
    return { step: 3, escalate: true };
  }
  if (timeSinceMissedMs >= 10 * 60 * 1000) {
    return { step: 2, escalate: true };
  }
  if (timeSinceMissedMs >= 5 * 60 * 1000) {
    return { step: 1, escalate: true };
  }

  return { step: 1, escalate: false };
}

/**
 * recordEscalation - Log escalation step taken
 */
export function recordEscalation(
  session: SoloWorkSession,
  step: 1 | 2 | 3,
  contactAttempted?: string
): SoloWorkSession {
  const escalation: MissedCheckInEscalation = {
    missedAt: Date.now(),
    step,
    contactAttempted,
  };

  return {
    ...session,
    missedCheckIns: [...session.missedCheckIns, escalation],
  };
}

/**
 * endSoloWork - Stop check-in timer and log completion
 */
export function endSoloWork(session: SoloWorkSession): SoloWorkSession {
  return {
    ...session,
    active: false,
  };
}

/**
 * formatEscalationMessage - Build text message for step 2 escalation
 */
export function formatEscalationMessage(
  session: SoloWorkSession,
  lastCheckInTime: string
): string {
  return (
    `Christian Dubon from Power On Solutions has not checked in from ${session.projectAddress}. ` +
    `He was expected to check in at ${session.checkInContact.name}. ` +
    `Last check-in was ${lastCheckInTime}. ` +
    `Work type: ${session.workType}. ` +
    `Please attempt to reach him at (760) 623-8962.`
  );
}

// ===== UTILITY =====

/**
 * getCheckInStatusColor - Color for timer visualization
 * amber → red as deadline approaches
 */
export function getCheckInStatusColor(
  percentTimeRemaining: number
): 'green' | 'amber' | 'red' {
  if (percentTimeRemaining > 0.33) return 'green';
  if (percentTimeRemaining > 0.1) return 'amber';
  return 'red';
}

/**
 * formatTimeRemaining - Human-readable countdown
 */
export function formatTimeRemaining(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}
