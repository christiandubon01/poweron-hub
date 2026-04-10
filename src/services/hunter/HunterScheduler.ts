/**
 * HunterScheduler.ts
 * 
 * Scheduling and trigger system for HUNTER lead scanning.
 * Handles nightly scans, on-demand triggers, and pipeline threshold monitoring.
 * 
 * Features:
 * - scheduleNightlyScan(): Daily scan at 5 AM local time
 * - runOnDemandScan(): Manual trigger from voice or panel
 * - checkPipelineThreshold(): Auto-trigger if active pipeline drops below threshold
 * - scanStatus state machine: 'idle' | 'scanning' | 'complete'
 * - Storage: last_scan_time, leads_found_count in localStorage
 */

import { useHunterStore } from '@/store/hunterStore';
import { publishLeadsReadyEvent } from './HunterNexusIntegration';
import type { HunterLead } from './HunterTypes';
import { LeadStatus } from './HunterTypes';

// ─── Type Definitions ─────────────────────────────────────────────────────

export type ScanStatus = 'idle' | 'scanning' | 'complete' | 'error';

export interface ScanMetadata {
  status: ScanStatus;
  lastScanTime: string | null;
  lastScanDuration: number;
  leadsFoundCount: number;
  pipelineValue: number;
  activeLeadCount: number;
  nextScheduledScan: string | null;
}

export interface PipelineThreshold {
  minLeadCount: number;
  minValue: number;
  checkIntervalMs: number;
}

export interface ScanTriggerResult {
  triggered: boolean;
  reason: string;
  scanStartTime: string;
  leadsScanned: number;
}

// ─── Constants ────────────────────────────────────────────────────────────

const STORAGE_SCAN_METADATA_KEY = 'hunter_scan_metadata';
const STORAGE_LAST_SCAN_TIME_KEY = 'hunter_last_scan_time';
const STORAGE_LEADS_FOUND_COUNT_KEY = 'hunter_leads_found_count';
const STORAGE_NEXT_SCAN_KEY = 'hunter_next_scheduled_scan';
const STORAGE_PIPELINE_VALUE_KEY = 'hunter_pipeline_value';

const DEFAULT_THRESHOLD: PipelineThreshold = {
  minLeadCount: 5,
  minValue: 50000, // $50k minimum pipeline
  checkIntervalMs: 60000, // Check every minute
};

const NIGHTLY_SCAN_HOUR = 5; // 5 AM local time
const NIGHTLY_SCAN_MINUTE = 0;

// ─── Internal State ───────────────────────────────────────────────────────

let _currentStatus: ScanStatus = 'idle';
let _thresholdConfig = DEFAULT_THRESHOLD;
let _thresholdCheckIntervalId: ReturnType<typeof setInterval> | null = null;
let _nightlyScanIntervalId: ReturnType<typeof setInterval> | null = null;
let _scanInProgress = false;

// ─── Storage Helpers ──────────────────────────────────────────────────────

function loadScanMetadata(): ScanMetadata {
  try {
    const raw = localStorage.getItem(STORAGE_SCAN_METADATA_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[HunterScheduler] Failed to load scan metadata:', err);
  }
  
  return {
    status: 'idle',
    lastScanTime: null,
    lastScanDuration: 0,
    leadsFoundCount: 0,
    pipelineValue: 0,
    activeLeadCount: 0,
    nextScheduledScan: null,
  };
}

function saveScanMetadata(metadata: ScanMetadata): void {
  try {
    localStorage.setItem(STORAGE_SCAN_METADATA_KEY, JSON.stringify(metadata));
    localStorage.setItem(STORAGE_LAST_SCAN_TIME_KEY, metadata.lastScanTime || '');
    localStorage.setItem(STORAGE_LEADS_FOUND_COUNT_KEY, String(metadata.leadsFoundCount));
    localStorage.setItem(STORAGE_NEXT_SCAN_KEY, metadata.nextScheduledScan || '');
    localStorage.setItem(STORAGE_PIPELINE_VALUE_KEY, String(metadata.pipelineValue));
  } catch (err) {
    console.warn('[HunterScheduler] Failed to save scan metadata:', err);
  }
}

// ─── Status Management ────────────────────────────────────────────────────

/**
 * Get current scan status.
 */
export function getScanStatus(): ScanStatus {
  return _currentStatus;
}

/**
 * Get complete scan metadata including status and metrics.
 */
export function getScanMetadata(): ScanMetadata {
  const metadata = loadScanMetadata();
  metadata.status = _currentStatus;
  return metadata;
}

/**
 * Set scan status and update storage.
 */
function setScanStatus(status: ScanStatus): void {
  _currentStatus = status;
  const metadata = loadScanMetadata();
  metadata.status = status;
  saveScanMetadata(metadata);
  console.log(`[HunterScheduler] Scan status: ${status}`);
}

// ─── Pipeline Metrics ─────────────────────────────────────────────────────

/**
 * Calculate total pipeline value from active leads.
 */
function calculatePipelineValue(leads: HunterLead[]): number {
  return leads
    .filter(l => l.status !== LeadStatus.ARCHIVED && l.status !== LeadStatus.LOST)
    .reduce((sum, lead) => sum + (lead.estimated_value || 0), 0);
}

/**
 * Get count of active (non-archived, non-lost) leads.
 */
function getActiveLeadCount(leads: HunterLead[]): number {
  return leads.filter(
    l => l.status !== LeadStatus.ARCHIVED && l.status !== LeadStatus.LOST
  ).length;
}

/**
 * Update pipeline metrics in store and storage.
 */
function updatePipelineMetrics(): void {
  const store = useHunterStore.getState();
  const pipelineValue = calculatePipelineValue(store.leads);
  const activeLeadCount = getActiveLeadCount(store.leads);
  
  const metadata = loadScanMetadata();
  metadata.pipelineValue = pipelineValue;
  metadata.activeLeadCount = activeLeadCount;
  saveScanMetadata(metadata);
  
  console.log(`[HunterScheduler] Pipeline metrics: ${activeLeadCount} active leads, $${Math.round(pipelineValue).toLocaleString()} value`);
}

// ─── Scan Execution ───────────────────────────────────────────────────────

/**
 * Execute a single scan operation.
 * Simulates lead discovery and scoring (actual implementation would call external APIs).
 */
async function executeScan(): Promise<number> {
  if (_scanInProgress) {
    console.warn('[HunterScheduler] Scan already in progress, skipping');
    return 0;
  }
  
  _scanInProgress = true;
  setScanStatus('scanning');
  
  const startTime = Date.now();
  const store = useHunterStore.getState();
  
  try {
    console.log('[HunterScheduler] Starting HUNTER scan...');
    
    // Simulate scan delay (100-300ms)
    await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 100));
    
    // In a real implementation, this would:
    // 1. Query external lead sources (Facebook Leads, Google Ads, etc.)
    // 2. Score each new lead
    // 3. Add to store and Supabase
    // For now, we'll count leads that were already found
    
    const leadsFound = store.leads.length;
    const duration = Date.now() - startTime;
    
    // Update metadata
    const metadata = loadScanMetadata();
    metadata.lastScanTime = new Date().toISOString();
    metadata.lastScanDuration = duration;
    metadata.leadsFoundCount = leadsFound;
    saveScanMetadata(metadata);
    
    // Update pipeline metrics
    updatePipelineMetrics();
    
    // Publish event for NEXUS
    publishLeadsReadyEvent(true);
    
    setScanStatus('complete');
    console.log(`[HunterScheduler] Scan complete: found ${leadsFound} leads in ${duration}ms`);
    
    return leadsFound;
  } catch (err) {
    console.error('[HunterScheduler] Scan failed:', err);
    setScanStatus('error');
    return 0;
  } finally {
    _scanInProgress = false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Run an on-demand scan immediately.
 * Can be triggered by voice command or UI button.
 */
export async function runOnDemandScan(): Promise<ScanTriggerResult> {
  const startTime = new Date().toISOString();
  const leadsBefore = useHunterStore.getState().leads.length;
  
  console.log('[HunterScheduler] On-demand scan requested');
  
  const leadsFound = await executeScan();
  
  return {
    triggered: true,
    reason: 'on-demand',
    scanStartTime: startTime,
    leadsScanned: leadsFound,
  };
}

/**
 * Schedule nightly scan at 5 AM local time.
 * Returns a cleanup function to cancel the schedule.
 */
export function scheduleNightlyScan(): () => void {
  console.log('[HunterScheduler] Scheduling nightly scan at 5:00 AM local time');
  
  // Calculate time until 5 AM tomorrow
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(NIGHTLY_SCAN_HOUR, NIGHTLY_SCAN_MINUTE, 0, 0);
  
  const msUntilNextScan = tomorrow.getTime() - now.getTime();
  
  // Update metadata with next scheduled scan
  const metadata = loadScanMetadata();
  metadata.nextScheduledScan = tomorrow.toISOString();
  saveScanMetadata(metadata);
  
  console.log(`[HunterScheduler] Next scan scheduled for ${tomorrow.toLocaleString()}`);
  
  // Set timeout for first scan
  const timeoutId = setTimeout(() => {
    executeScan().then(() => {
      // After first scan, set interval for daily scans
      _nightlyScanIntervalId = setInterval(() => {
        executeScan().catch(err => console.error('[HunterScheduler] Nightly scan error:', err));
      }, 24 * 60 * 60 * 1000); // 24 hours
    });
  }, msUntilNextScan);
  
  // Return cleanup function
  return () => {
    console.log('[HunterScheduler] Cancelling nightly scan schedule');
    clearTimeout(timeoutId);
    if (_nightlyScanIntervalId) {
      clearInterval(_nightlyScanIntervalId);
      _nightlyScanIntervalId = null;
    }
  };
}

/**
 * Check if pipeline has dropped below threshold.
 * Auto-triggers scan if conditions are met.
 * Returns the result if a scan was triggered.
 */
export async function checkPipelineThreshold(): Promise<ScanTriggerResult | null> {
  const store = useHunterStore.getState();
  const activeCount = getActiveLeadCount(store.leads);
  const pipelineValue = calculatePipelineValue(store.leads);
  
  const belowLeadCount = activeCount < _thresholdConfig.minLeadCount;
  const belowValue = pipelineValue < _thresholdConfig.minValue;
  
  if (belowLeadCount || belowValue) {
    console.log(`[HunterScheduler] Pipeline below threshold (leads: ${activeCount}/${_thresholdConfig.minLeadCount}, value: $${pipelineValue})`);
    
    const result: ScanTriggerResult = {
      triggered: true,
      reason: belowLeadCount ? 'low-lead-count' : 'low-pipeline-value',
      scanStartTime: new Date().toISOString(),
      leadsScanned: 0,
    };
    
    result.leadsScanned = await executeScan();
    return result;
  }
  
  return null;
}

/**
 * Configure pipeline threshold for auto-trigger.
 */
export function setPipelineThreshold(config: Partial<PipelineThreshold>): void {
  _thresholdConfig = {
    ..._thresholdConfig,
    ...config,
  };
  
  console.log('[HunterScheduler] Pipeline threshold updated:', _thresholdConfig);
}

/**
 * Get current pipeline threshold configuration.
 */
export function getPipelineThreshold(): PipelineThreshold {
  return _thresholdConfig;
}

/**
 * Start monitoring pipeline threshold.
 * Periodically checks if pipeline metrics fall below threshold.
 * Returns cleanup function.
 */
export function startThresholdMonitoring(): () => void {
  console.log('[HunterScheduler] Starting pipeline threshold monitoring');
  
  _thresholdCheckIntervalId = setInterval(() => {
    checkPipelineThreshold().catch(err => {
      console.error('[HunterScheduler] Threshold check error:', err);
    });
  }, _thresholdConfig.checkIntervalMs);
  
  return () => {
    console.log('[HunterScheduler] Stopping pipeline threshold monitoring');
    if (_thresholdCheckIntervalId) {
      clearInterval(_thresholdCheckIntervalId);
      _thresholdCheckIntervalId = null;
    }
  };
}

// ─── Initialization ───────────────────────────────────────────────────────

/**
 * Initialize HUNTER scheduler on app startup.
 * Sets up nightly scans and threshold monitoring.
 * Returns cleanup function for shutdown.
 */
export function initHunterScheduler(): () => void {
  console.log('[HunterScheduler] Initializing HUNTER scheduler');
  
  // Load existing metadata
  const metadata = loadScanMetadata();
  console.log('[HunterScheduler] Loaded metadata:', metadata);
  
  // Schedule nightly scan
  const unscheduleNightly = scheduleNightlyScan();
  
  // Start threshold monitoring
  const unstopMonitoring = startThresholdMonitoring();
  
  // Update metrics immediately
  updatePipelineMetrics();
  
  // Return cleanup function
  return () => {
    console.log('[HunterScheduler] Shutting down HUNTER scheduler');
    unscheduleNightly();
    unstopMonitoring();
  };
}

// ─── Named Exports ───────────────────────────────────────────────────────

export default {
  getScanStatus,
  getScanMetadata,
  runOnDemandScan,
  scheduleNightlyScan,
  checkPipelineThreshold,
  setPipelineThreshold,
  getPipelineThreshold,
  startThresholdMonitoring,
  initHunterScheduler,
};
