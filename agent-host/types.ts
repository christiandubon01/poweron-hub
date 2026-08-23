export const SCHEMA_VERSION = 1 as const;
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_STALE_MS = 30_000;
export const REPO_STATUS_REFRESH_MS = 60_000;
export const DISCOVERY_TIMEOUT_MS = 5_000;
export const DISCOVERY_RESOLUTION_TIMEOUT_MS = 5_000;

export type HostRuntimeState = 'running' | 'stopping' | 'stopped' | 'error';

export interface HostIdentity {
  hostId: string;
  hostVersion: string;
  canonicalRepoPath: string;
  repoKey: string;
}

export interface InstanceIdentity {
  instanceId: string;
  pid: number;
  startedAt: string;
}

export interface RepoStatus {
  branch: string;
  headSha: string;
  dirty: boolean;
}

export type ToolKind = 'provider' | 'diagnostic';
export type HarnessKind = 'native-executable' | 'cmd-wrapper' | 'missing';

export interface DiscoveryError {
  code: 'missing' | 'timeout' | 'resolve-failed' | 'execution-failed';
  message: string;
}

export interface ProviderDiscoveryRecord {
  toolId: string;
  displayName: string;
  kind: ToolKind;
  command: string;
  harnessKind: HarnessKind;
  resolvedPath?: string;
  installed: boolean;
  workerCapable: boolean;
  cliVersion?: string;
  discoveredAt: string;
  error?: DiscoveryError;
  requestedModel?: string;
  reportedModel?: string;
  reportedModelSource?: string;
  reasoningEffort?: string;
  usageSource?: string;
  quotaSource?: string;
}

export function isWorkerAvailable(provider: Pick<ProviderDiscoveryRecord, 'installed' | 'workerCapable'>): boolean {
  return provider.installed && provider.workerCapable;
}

export interface LockDocument extends HostIdentity, InstanceIdentity {
  schemaVersion: typeof SCHEMA_VERSION;
}

export interface HeartbeatDocument extends HostIdentity, InstanceIdentity, RepoStatus {
  schemaVersion: typeof SCHEMA_VERSION;
  lastHeartbeatAt: string;
  state: HostRuntimeState;
  stoppedAt?: string;
  providers: ProviderDiscoveryRecord[];
}

export type LifecycleEventType =
  | 'host.started'
  | 'host.discovery.completed'
  | 'host.stopping'
  | 'host.stopped'
  | 'host.error';

export interface LifecycleEventDocument {
  schemaVersion: typeof SCHEMA_VERSION;
  eventId: string;
  seq: number;
  type: LifecycleEventType;
  hostId: string;
  instanceId: string;
  repoKey: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export type StatusKind =
  | 'never-started'
  | 'running'
  | 'stopped'
  | 'stale'
  | 'crashed'
  | 'state-corrupt';

export interface StatusReport {
  status: StatusKind;
  canonicalRepoPath: string;
  repoKey: string;
  stateDirectory: string;
  diagnostics: string[];
  lock: LockDocument | null;
  heartbeat: HeartbeatDocument | null;
}

export interface StatePaths {
  baseDir: string;
  hostIdPath: string;
  reposDir: string;
  repoStateDir: string;
  lockPath: string;
  recoveryPath: string;
  heartbeatPath: string;
  eventsPath: string;
  repoKey: string;
}

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

function isHostRuntimeState(value: unknown): value is HostRuntimeState {
  return value === 'running' || value === 'stopping' || value === 'stopped' || value === 'error';
}

function validateHostIdentity(value: Record<string, unknown>): string | null {
  if (!isString(value.hostId)) {
    return 'hostId is required';
  }
  if (!isString(value.hostVersion)) {
    return 'hostVersion is required';
  }
  if (!isString(value.canonicalRepoPath)) {
    return 'canonicalRepoPath is required';
  }
  if (!isString(value.repoKey)) {
    return 'repoKey is required';
  }
  return null;
}

function validateInstanceIdentity(value: Record<string, unknown>): string | null {
  if (!isString(value.instanceId)) {
    return 'instanceId is required';
  }
  if (!isNumber(value.pid)) {
    return 'pid is required';
  }
  if (!isString(value.startedAt)) {
    return 'startedAt is required';
  }
  return null;
}

function validateRepoStatus(value: Record<string, unknown>): string | null {
  if (!isString(value.branch)) {
    return 'branch is required';
  }
  if (!isString(value.headSha)) {
    return 'headSha is required';
  }
  if (!isBoolean(value.dirty)) {
    return 'dirty is required';
  }
  return null;
}

function validateProviders(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return 'providers must be an array';
  }

  for (const entry of value) {
    if (!isRecord(entry)) {
      return 'provider entry must be an object';
    }
    if (!isString(entry.toolId) || !isString(entry.command) || !isString(entry.displayName)) {
      return 'provider entry is missing required identifiers';
    }
    if (!isBoolean(entry.installed) || !isBoolean(entry.workerCapable)) {
      return 'provider entry is missing boolean flags';
    }
  }

  return null;
}

export function parseLockDocument(value: unknown): ValidationResult<LockDocument> {
  if (!isRecord(value)) {
    return { ok: false, error: 'lock.json must contain an object' };
  }

  if (value.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, error: `lock.json schemaVersion must be ${SCHEMA_VERSION}` };
  }

  const hostIdentityError = validateHostIdentity(value);
  if (hostIdentityError) {
    return { ok: false, error: hostIdentityError };
  }

  const instanceIdentityError = validateInstanceIdentity(value);
  if (instanceIdentityError) {
    return { ok: false, error: instanceIdentityError };
  }

  return { ok: true, value: value as unknown as LockDocument };
}

export function parseHeartbeatDocument(value: unknown): ValidationResult<HeartbeatDocument> {
  if (!isRecord(value)) {
    return { ok: false, error: 'heartbeat.json must contain an object' };
  }

  if (value.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, error: `heartbeat.json schemaVersion must be ${SCHEMA_VERSION}` };
  }

  const hostIdentityError = validateHostIdentity(value);
  if (hostIdentityError) {
    return { ok: false, error: hostIdentityError };
  }

  const instanceIdentityError = validateInstanceIdentity(value);
  if (instanceIdentityError) {
    return { ok: false, error: instanceIdentityError };
  }

  const repoStatusError = validateRepoStatus(value);
  if (repoStatusError) {
    return { ok: false, error: repoStatusError };
  }

  if (!isString(value.lastHeartbeatAt)) {
    return { ok: false, error: 'lastHeartbeatAt is required' };
  }

  if (!isHostRuntimeState(value.state)) {
    return { ok: false, error: 'state is invalid' };
  }

  if (value.stoppedAt !== undefined && !isString(value.stoppedAt)) {
    return { ok: false, error: 'stoppedAt must be a string when present' };
  }

  const providersError = validateProviders(value.providers);
  if (providersError) {
    return { ok: false, error: providersError };
  }

  return { ok: true, value: value as unknown as HeartbeatDocument };
}
