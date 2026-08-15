export const ACTIVE_INTERACTION_WINDOW_MS = 3 * 60 * 1000
export const HEARTBEAT_STALE_WINDOW_MS = 5 * 60 * 1000
export const FOUNDER_GUARDIAN_POLL_INTERVAL_MS = 90 * 1000
export const FOUNDER_GUARDIAN_SECURITY_LAST_SEEN_KEY = 'poweron_guardian_security_last_seen_at'

export type FounderPresenceStatus = 'active' | 'idle' | 'locked' | 'offline' | 'no_history'

export interface FounderPresenceSessionRow {
  session_id: string | null
  user_id: string
  org_id: string
  device_id: string | null
  device_type: string | null
  device_info: Record<string, unknown> | null
  module: string | null
  started_at: string | null
  last_active_at: string | null
  last_interaction_at: string | null
  visibility_state: string | null
  ended_reason: string | null
  ended_at: string | null
  user_full_name?: string | null
  user_email?: string | null
  user_role?: string | null
}

export interface FounderSecurityEventRow {
  session_id: string | null
  user_id: string
  org_id: string
  device_id: string | null
  event_type: string
  public_ip: string | null
  previous_public_ip: string | null
  is_new_device: boolean | null
  occurred_at: string
  user_full_name?: string | null
  user_email?: string | null
}

export interface FounderPresenceSummary {
  organizationId: string
  status: FounderPresenceStatus
  hasHistory: boolean
  liveDeviceCount: number
  liveSessionCount: number
  lastInteractionAt: string | null
  lastHeartbeatAt: string | null
  sessionCount: number
}

export interface FounderPresenceDeviceGroup {
  deviceKey: string
  deviceId: string | null
  deviceLabel: string
  deviceType: string
  status: FounderPresenceStatus
  liveSessionCount: number
  startedAt: string | null
  lastInteractionAt: string | null
  lastHeartbeatAt: string | null
  recentModule: string | null
  recentModuleLabel: string
}

export interface FounderPresenceSessionRecord {
  sessionId: string
  userId: string
  userLabel: string
  userRole: string | null
  deviceId: string | null
  deviceLabel: string
  deviceType: string
  module: string | null
  moduleLabel: string
  visibilityState: 'visible' | 'hidden'
  status: FounderPresenceStatus
  startedAt: string | null
  lastInteractionAt: string | null
  lastHeartbeatAt: string | null
  endedAt: string | null
  endedReason: string | null
}

export interface FounderSecurityAlert {
  organizationId: string
  organizationName: string
  sessionId: string | null
  userId: string
  userLabel: string
  deviceId: string | null
  deviceLabel: string
  eventType: 'session_started' | 'ip_changed'
  occurredAt: string
  publicIp: string | null
  previousPublicIp: string | null
  isNewDevice: boolean
  alertKind: 'new_device' | 'ip_changed'
}

export interface FounderSecurityHistoryEntry {
  sessionId: string | null
  userId: string
  userLabel: string
  deviceId: string | null
  deviceLabel: string
  eventType: 'session_started' | 'ip_changed'
  occurredAt: string
  publicIp: string | null
  previousPublicIp: string | null
  isNewDevice: boolean
  isAlert: boolean
}

/** Cross-organization security history used by the founder Security Center. */
export interface FounderGlobalSecurityHistoryEntry extends FounderSecurityHistoryEntry {
  organizationId: string
  organizationName: string
}

export interface FounderSecurityCenterMetrics {
  unreadAlerts: number
  newDevices30d: number
  ipChanges30d: number
  lastSecurityEventAt: string | null
}

type UserIdentity = {
  fullName?: string | null
  email?: string | null
  role?: string | null
}

const MODULE_LABELS: Record<string, string> = {
  home: 'Home',
  projects: 'Projects',
  blueprint: 'Blueprint',
  'material-takeoff': 'Material Takeoff',
  estimates: 'Estimates',
  'field-log': 'Field Log',
  guardian: 'Guardian',
  settings: 'Settings',
  team: 'Team',
  money: 'Money',
  activity: 'Activity',
  journal: 'Journal',
  'sales-intelligence': 'Sales Intelligence',
  'crew-portal': 'Crew Portal',
  'employee-portal': 'Employee Portal',
}

const STATUS_PRIORITY: Record<FounderPresenceStatus, number> = {
  active: 4,
  idle: 3,
  locked: 2,
  offline: 1,
  no_history: 0,
}

function toMillis(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const millis = Date.parse(value)
  return Number.isNaN(millis) ? Number.NEGATIVE_INFINITY : millis
}

function safeLower(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase()
}

function isLiveStatus(status: FounderPresenceStatus): boolean {
  return status === 'active' || status === 'idle'
}

function statusFromEndedReason(reason: string | null | undefined): FounderPresenceStatus | null {
  const normalized = safeLower(reason)
  if (normalized === 'manual_lock' || normalized === 'inactivity_timeout') return 'locked'
  if (normalized === 'signout') return 'offline'
  return null
}

function latestRelevantTimestamp(session: FounderPresenceSessionRow): number {
  return Math.max(
    toMillis(session.last_active_at),
    toMillis(session.last_interaction_at),
    toMillis(session.ended_at),
    toMillis(session.started_at),
  )
}

export function getFounderModuleLabel(moduleSlug: string | null | undefined): string {
  const normalized = safeLower(moduleSlug)
  if (!normalized) return 'Unknown'
  return MODULE_LABELS[normalized] ?? normalized
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function formatFounderUserLabel(identity: UserIdentity & { userId?: string | null }): string {
  const fullName = String(identity.fullName || '').trim()
  const email = String(identity.email || '').trim()
  if (fullName && email) return `${fullName} (${email})`
  if (fullName) return fullName
  if (email) return email
  return String(identity.userId || 'Unknown user')
}

export function formatFounderDeviceLabel(input: {
  deviceId?: string | null
  deviceType?: string | null
  deviceInfo?: Record<string, unknown> | null
}): { label: string; type: string } {
  const fallbackType = safeLower(input.deviceType) || safeLower(String(input.deviceInfo?.platform || '')) || 'unknown'
  const type = fallbackType || 'unknown'
  if (!input.deviceId) {
    return {
      label: 'Unknown device',
      type,
    }
  }

  const prefix = type === 'ios'
    ? 'iPhone / iPad'
    : type === 'android'
      ? 'Android device'
      : type === 'desktop'
        ? 'Desktop app'
        : type === 'web'
          ? 'Web browser'
          : 'Device'

  return {
    label: `${prefix} · ${String(input.deviceId).slice(0, 8)}`,
    type,
  }
}

export function deriveFounderPresenceStatus(
  session: Pick<
    FounderPresenceSessionRow,
    'ended_reason' | 'ended_at' | 'last_active_at' | 'last_interaction_at' | 'started_at' | 'visibility_state'
  >,
  serverNow: string | number | Date,
): FounderPresenceStatus {
  const now = typeof serverNow === 'string'
    ? Date.parse(serverNow)
    : serverNow instanceof Date
      ? serverNow.getTime()
      : serverNow

  const endedStatus = statusFromEndedReason(session.ended_reason)
  if (endedStatus) return endedStatus
  if (session.ended_at) return 'offline'

  const lastHeartbeatAt = Math.max(toMillis(session.last_active_at), toMillis(session.started_at))
  if (!Number.isFinite(lastHeartbeatAt) || now - lastHeartbeatAt > HEARTBEAT_STALE_WINDOW_MS) {
    return 'offline'
  }

  const visibility = safeLower(session.visibility_state) === 'hidden' ? 'hidden' : 'visible'
  const lastInteractionAt = Math.max(
    toMillis(session.last_interaction_at),
    toMillis(session.started_at),
  )

  if (visibility === 'visible' && Number.isFinite(lastInteractionAt) && now - lastInteractionAt <= ACTIVE_INTERACTION_WINDOW_MS) {
    return 'active'
  }

  return 'idle'
}

function summarizeCurrentStatuses(
  sessions: FounderPresenceSessionRow[],
  serverNow: string,
): Array<{ key: string; status: FounderPresenceStatus; session: FounderPresenceSessionRow }> {
  const groups = new Map<string, FounderPresenceSessionRow[]>()
  for (const session of sessions) {
    const key = `${session.user_id}::${session.device_id || 'unknown-device'}`
    const bucket = groups.get(key) ?? []
    bucket.push(session)
    groups.set(key, bucket)
  }

  const output: Array<{ key: string; status: FounderPresenceStatus; session: FounderPresenceSessionRow }> = []
  for (const [key, bucket] of groups.entries()) {
    const sorted = [...bucket].sort((left, right) => latestRelevantTimestamp(right) - latestRelevantTimestamp(left))
    const live = sorted
      .map((session) => ({ session, status: deriveFounderPresenceStatus(session, serverNow) }))
      .filter((entry) => isLiveStatus(entry.status))
      .sort((left, right) => latestRelevantTimestamp(right.session) - latestRelevantTimestamp(left.session))

    if (live.length > 0) {
      output.push({ key, status: live[0].status, session: live[0].session })
      continue
    }

    const latest = sorted[0]
    output.push({ key, status: deriveFounderPresenceStatus(latest, serverNow), session: latest })
  }

  return output
}

export function buildFounderPresenceSummary(
  sessions: FounderPresenceSessionRow[],
  organizationIds: string[],
  serverNow: string,
): Record<string, FounderPresenceSummary> {
  const byOrg = new Map<string, FounderPresenceSessionRow[]>()
  for (const session of sessions) {
    if (!session.session_id) continue
    const bucket = byOrg.get(session.org_id) ?? []
    bucket.push(session)
    byOrg.set(session.org_id, bucket)
  }

  const summaries: Record<string, FounderPresenceSummary> = {}
  for (const organizationId of organizationIds) {
    const orgSessions = byOrg.get(organizationId) ?? []
    if (orgSessions.length === 0) {
      summaries[organizationId] = {
        organizationId,
        status: 'no_history',
        hasHistory: false,
        liveDeviceCount: 0,
        liveSessionCount: 0,
        lastInteractionAt: null,
        lastHeartbeatAt: null,
        sessionCount: 0,
      }
      continue
    }

    const currentStatuses = summarizeCurrentStatuses(orgSessions, serverNow)
    const liveSessions = orgSessions.filter((session) => isLiveStatus(deriveFounderPresenceStatus(session, serverNow)))
    const deviceIds = new Set<string>()
    let hasUnknownLiveDevice = false

    for (const session of liveSessions) {
      if (session.device_id) deviceIds.add(session.device_id)
      else hasUnknownLiveDevice = true
    }

    const summaryStatus = currentStatuses.reduce<FounderPresenceStatus>(
      (best, entry) => STATUS_PRIORITY[entry.status] > STATUS_PRIORITY[best] ? entry.status : best,
      'offline',
    )

    const liveDeviceCount = deviceIds.size + (hasUnknownLiveDevice ? 1 : 0)

    summaries[organizationId] = {
      organizationId,
      status: summaryStatus,
      hasHistory: true,
      liveDeviceCount,
      liveSessionCount: liveSessions.length,
      lastInteractionAt: orgSessions
        .map((session) => session.last_interaction_at)
        .sort((left, right) => toMillis(right) - toMillis(left))[0] ?? null,
      lastHeartbeatAt: orgSessions
        .map((session) => session.last_active_at)
        .sort((left, right) => toMillis(right) - toMillis(left))[0] ?? null,
      sessionCount: orgSessions.length,
    }
  }

  return summaries
}

export function buildFounderPresenceDetail(input: {
  sessions: FounderPresenceSessionRow[]
  serverNow: string
}): {
  summary: FounderPresenceSummary
  deviceGroups: FounderPresenceDeviceGroup[]
  sessions: FounderPresenceSessionRecord[]
} {
  const summary = buildFounderPresenceSummary(
    input.sessions,
    input.sessions.length > 0 ? [input.sessions[0].org_id] : [''],
    input.serverNow,
  )[input.sessions[0]?.org_id || ''] ?? {
    organizationId: '',
    status: 'no_history',
    hasHistory: false,
    liveDeviceCount: 0,
    liveSessionCount: 0,
    lastInteractionAt: null,
    lastHeartbeatAt: null,
    sessionCount: 0,
  }

  const sessionRecords = [...input.sessions]
    .filter((session) => Boolean(session.session_id))
    .sort((left, right) => latestRelevantTimestamp(right) - latestRelevantTimestamp(left))
    .map<FounderPresenceSessionRecord>((session) => {
      const device = formatFounderDeviceLabel({
        deviceId: session.device_id,
        deviceType: session.device_type,
        deviceInfo: session.device_info,
      })
      return {
        sessionId: String(session.session_id),
        userId: session.user_id,
        userLabel: formatFounderUserLabel({
          fullName: session.user_full_name,
          email: session.user_email,
          userId: session.user_id,
        }),
        userRole: session.user_role ?? null,
        deviceId: session.device_id,
        deviceLabel: device.label,
        deviceType: device.type,
        module: safeLower(session.module) || null,
        moduleLabel: getFounderModuleLabel(session.module),
        visibilityState: safeLower(session.visibility_state) === 'hidden' ? 'hidden' : 'visible',
        status: deriveFounderPresenceStatus(session, input.serverNow),
        startedAt: session.started_at,
        lastInteractionAt: session.last_interaction_at,
        lastHeartbeatAt: session.last_active_at,
        endedAt: session.ended_at,
        endedReason: session.ended_reason,
      }
    })

  const deviceGroups = new Map<string, FounderPresenceSessionRecord[]>()
  for (const session of sessionRecords) {
    const key = session.deviceId || 'unknown-device'
    const bucket = deviceGroups.get(key) ?? []
    bucket.push(session)
    deviceGroups.set(key, bucket)
  }

  const devices = [...deviceGroups.entries()]
    .map<FounderPresenceDeviceGroup>(([deviceKey, sessions]) => {
      const sorted = [...sessions].sort(
        (left, right) => latestRelevantTimestamp({
          session_id: right.sessionId,
          user_id: right.userId,
          org_id: '',
          device_id: right.deviceId,
          device_type: right.deviceType,
          device_info: null,
          module: right.module,
          started_at: right.startedAt,
          last_active_at: right.lastHeartbeatAt,
          last_interaction_at: right.lastInteractionAt,
          visibility_state: right.visibilityState,
          ended_reason: right.endedReason,
          ended_at: right.endedAt,
        }) - latestRelevantTimestamp({
          session_id: left.sessionId,
          user_id: left.userId,
          org_id: '',
          device_id: left.deviceId,
          device_type: left.deviceType,
          device_info: null,
          module: left.module,
          started_at: left.startedAt,
          last_active_at: left.lastHeartbeatAt,
          last_interaction_at: left.lastInteractionAt,
          visibility_state: left.visibilityState,
          ended_reason: left.endedReason,
          ended_at: left.endedAt,
        }),
      )
      const live = sorted.filter((session) => isLiveStatus(session.status))
      const current = live[0] ?? sorted[0]
      return {
        deviceKey,
        deviceId: current?.deviceId ?? null,
        deviceLabel: current?.deviceLabel ?? 'Unknown device',
        deviceType: current?.deviceType ?? 'unknown',
        status: current?.status ?? 'no_history',
        liveSessionCount: live.length,
        startedAt: [...sorted]
          .map((session) => session.startedAt)
          .sort((left, right) => toMillis(left) - toMillis(right))[0] ?? null,
        lastInteractionAt: sorted
          .map((session) => session.lastInteractionAt)
          .sort((left, right) => toMillis(right) - toMillis(left))[0] ?? null,
        lastHeartbeatAt: sorted
          .map((session) => session.lastHeartbeatAt)
          .sort((left, right) => toMillis(right) - toMillis(left))[0] ?? null,
        recentModule: current?.module ?? null,
        recentModuleLabel: current?.moduleLabel ?? 'Unknown',
      }
    })
    .sort((left, right) => {
      const statusDiff = STATUS_PRIORITY[right.status] - STATUS_PRIORITY[left.status]
      if (statusDiff !== 0) return statusDiff
      return toMillis(right.lastHeartbeatAt) - toMillis(left.lastHeartbeatAt)
    })

  return { summary, deviceGroups: devices, sessions: sessionRecords }
}

export function isAlertWorthySecurityEvent(event: Pick<FounderSecurityEventRow, 'event_type' | 'is_new_device'>): boolean {
  return safeLower(event.event_type) === 'ip_changed'
    || (safeLower(event.event_type) === 'session_started' && event.is_new_device === true)
}

export function buildFounderSecurityHistory(
  events: FounderSecurityEventRow[],
): FounderSecurityHistoryEntry[] {
  return [...events]
    .sort((left, right) => toMillis(right.occurred_at) - toMillis(left.occurred_at))
    .map((event) => {
      const device = formatFounderDeviceLabel({ deviceId: event.device_id })
      return {
        sessionId: event.session_id,
        userId: event.user_id,
        userLabel: formatFounderUserLabel({
          fullName: event.user_full_name,
          email: event.user_email,
          userId: event.user_id,
        }),
        deviceId: event.device_id,
        deviceLabel: device.label,
        eventType: safeLower(event.event_type) === 'ip_changed' ? 'ip_changed' : 'session_started',
        occurredAt: event.occurred_at,
        publicIp: event.public_ip,
        previousPublicIp: event.previous_public_ip,
        isNewDevice: event.is_new_device === true,
        isAlert: isAlertWorthySecurityEvent(event),
      }
    })
}

export function buildFounderGlobalSecurityHistory(
  events: FounderSecurityEventRow[],
  organizationNames: Record<string, string>,
): FounderGlobalSecurityHistoryEntry[] {
  return [...events]
    .sort((left, right) => toMillis(right.occurred_at) - toMillis(left.occurred_at))
    .map((event) => {
      const device = formatFounderDeviceLabel({ deviceId: event.device_id })
      const organizationId = event.org_id || ''
      return {
        organizationId,
        organizationName: organizationNames[organizationId] || 'Unknown organization',
        sessionId: event.session_id,
        userId: event.user_id,
        userLabel: formatFounderUserLabel({
          fullName: event.user_full_name,
          email: event.user_email,
          userId: event.user_id,
        }),
        deviceId: event.device_id,
        deviceLabel: device.label,
        eventType: safeLower(event.event_type) === 'ip_changed' ? 'ip_changed' : 'session_started',
        occurredAt: event.occurred_at,
        publicIp: event.public_ip,
        previousPublicIp: event.previous_public_ip,
        isNewDevice: event.is_new_device === true,
        isAlert: isAlertWorthySecurityEvent(event),
      }
    })
}

export function buildFounderSecurityAlerts(
  events: FounderSecurityEventRow[],
  organizationNames: Record<string, string>,
): FounderSecurityAlert[] {
  return buildFounderGlobalSecurityHistory(events, organizationNames)
    .filter((event) => event.isAlert)
    .map((event): FounderSecurityAlert => ({
      organizationId: event.organizationId,
      organizationName: event.organizationName,
      sessionId: event.sessionId,
      userId: event.userId,
      userLabel: event.userLabel,
      deviceId: event.deviceId,
      deviceLabel: event.deviceLabel,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      publicIp: event.publicIp,
      previousPublicIp: event.previousPublicIp,
      isNewDevice: event.isNewDevice,
      alertKind: event.eventType === 'ip_changed' ? 'ip_changed' : 'new_device',
    }))
    .sort((left, right) => toMillis(right.occurredAt) - toMillis(left.occurredAt))
}

export function filterNewDeviceSecurityEvents<T extends Pick<FounderSecurityHistoryEntry, 'eventType' | 'isNewDevice'>>(
  events: T[],
): T[] {
  return events.filter((event) => event.eventType === 'session_started' && event.isNewDevice)
}

export function filterIpChangeSecurityEvents<T extends Pick<FounderSecurityHistoryEntry, 'eventType'>>(
  events: T[],
): T[] {
  return events.filter((event) => event.eventType === 'ip_changed')
}

export function buildFounderSecurityCenterMetrics(
  alerts: Array<Pick<FounderSecurityAlert, 'occurredAt'>>,
  history: Array<Pick<FounderSecurityHistoryEntry, 'eventType' | 'isNewDevice' | 'occurredAt'>>,
  lastSeenAt: string | null,
): FounderSecurityCenterMetrics {
  return {
    unreadAlerts: countUnreadGuardianSecurityAlerts(alerts, lastSeenAt),
    newDevices30d: filterNewDeviceSecurityEvents(history).length,
    ipChanges30d: filterIpChangeSecurityEvents(history).length,
    lastSecurityEventAt: history[0]?.occurredAt ?? null,
  }
}

export function readGuardianSecurityLastSeen(storage: Pick<Storage, 'getItem'> | null | undefined): string | null {
  try {
    return storage?.getItem(FOUNDER_GUARDIAN_SECURITY_LAST_SEEN_KEY) || null
  } catch {
    return null
  }
}

export function writeGuardianSecurityLastSeen(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  value: string,
): void {
  try {
    storage?.setItem(FOUNDER_GUARDIAN_SECURITY_LAST_SEEN_KEY, value)
  } catch {
    // ignore browser storage failures
  }
}

export function filterUnreadGuardianSecurityAlerts<T extends Pick<FounderSecurityAlert, 'occurredAt'>>(
  alerts: T[],
  lastSeenAt: string | null,
): T[] {
  const seenAt = toMillis(lastSeenAt)
  return alerts.filter((alert) => toMillis(alert.occurredAt) > seenAt)
}

export function countUnreadGuardianSecurityAlerts(
  alerts: Array<Pick<FounderSecurityAlert, 'occurredAt'>>,
  lastSeenAt: string | null,
): number {
  return filterUnreadGuardianSecurityAlerts(alerts, lastSeenAt).length
}

export function createGuardianPollingLoop(task: () => Promise<void>, intervalMs = FOUNDER_GUARDIAN_POLL_INTERVAL_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let running = false

  const schedule = () => {
    if (stopped) return
    timer = setTimeout(() => {
      void run()
    }, intervalMs)
  }

  const run = async () => {
    if (stopped || running) return
    running = true
    try {
      await task()
    } finally {
      running = false
      schedule()
    }
  }

  return {
    start() {
      void run()
    },
    trigger() {
      void run()
    },
    stop() {
      stopped = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
