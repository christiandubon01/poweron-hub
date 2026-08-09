/**
 * SYNC-02: field/group-level merge for the BackupData.settings singleton.
 *
 * Freshness is intentionally top-level. Scalars are independent fields; complex
 * values such as phaseWeights, mtoPhases, overhead, and user-managed arrays are
 * whole logical groups. Nested leaves are never timestamped independently.
 */

export const SETTINGS_UPDATED_AT_FIELD = 'fieldUpdatedAt'
export const SETTINGS_DELETED_AT_FIELD = 'fieldDeletedAt'

export type SettingsFreshnessMap = Record<string, string>
export type SettingsRecord = Record<string, any> & {
  fieldUpdatedAt?: SettingsFreshnessMap
  fieldDeletedAt?: SettingsFreshnessMap
}

type SettingsBackupShape = Record<string, any> & { settings?: SettingsRecord }

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value))
}

function timestampMs(value: unknown): number {
  return isValidTimestamp(value) ? Date.parse(value) : Number.NEGATIVE_INFINITY
}

function asSettings(value: unknown): SettingsRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as SettingsRecord : {}
}

function asFreshnessMap(value: unknown): SettingsFreshnessMap {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as SettingsFreshnessMap
    : {}
}

function hasOwn(record: SettingsRecord, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field)
}

function isMetadataField(field: string): boolean {
  return field === SETTINGS_UPDATED_AT_FIELD || field === SETTINGS_DELETED_AT_FIELD
}

function cloneValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function hasEffectiveBusinessField(settings: SettingsRecord, field: string): boolean {
  return hasOwn(settings, field) && settings[field] !== undefined && !isMetadataField(field)
}

function normalizeForComparison(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForComparison)
  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const nested = (value as Record<string, unknown>)[key]
      if (nested !== undefined) normalized[key] = normalizeForComparison(nested)
    }
    return normalized
  }
  return value
}

function settingsValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeForComparison(left)) === JSON.stringify(normalizeForComparison(right))
}

export function getSettingsDataFieldNames(settings: unknown): string[] {
  return Object.keys(asSettings(settings)).filter((field) => !isMetadataField(field))
}

/**
 * Return top-level business fields/groups whose effective persisted values differ.
 * Object keys are compared deterministically; array order remains significant.
 */
export function getChangedSettingsFieldNames(beforeValue: unknown, afterValue: unknown): string[] {
  const before = asSettings(beforeValue)
  const after = asSettings(afterValue)
  const fields = new Set([
    ...getSettingsDataFieldNames(before),
    ...getSettingsDataFieldNames(after),
  ])

  return [...fields].filter((field) => {
    const beforeHas = hasEffectiveBusinessField(before, field)
    const afterHas = hasEffectiveBusinessField(after, field)
    if (beforeHas !== afterHas) return true
    if (!beforeHas) return false
    return !settingsValuesEqual(before[field], after[field])
  })
}

/**
 * Stamp explicit setting/group edits. If a named field is absent, the stamp is an
 * intentional deletion tombstone. A present `null` is an explicit reset value.
 */
export function stampSettingsFields(
  settingsValue: unknown,
  fields: readonly string[],
  timestamp?: string,
): SettingsRecord {
  const settings = asSettings(settingsValue)
  const now = isValidTimestamp(timestamp) ? timestamp : new Date().toISOString()
  const updatedAt = { ...asFreshnessMap(settings[SETTINGS_UPDATED_AT_FIELD]) }
  const deletedAt = { ...asFreshnessMap(settings[SETTINGS_DELETED_AT_FIELD]) }

  for (const rawField of fields) {
    const field = String(rawField || '').trim()
    if (!field || isMetadataField(field)) continue
    if (hasOwn(settings, field)) {
      updatedAt[field] = now
      delete deletedAt[field]
    } else {
      deletedAt[field] = now
      delete updatedAt[field]
    }
  }

  settings[SETTINGS_UPDATED_AT_FIELD] = updatedAt
  settings[SETTINGS_DELETED_AT_FIELD] = deletedAt
  return settings
}

/**
 * SYNC-02B explicit replacement semantics for undo/redo and snapshot restore.
 * Business values come from the replacement, but historical replacement metadata
 * is ignored. Unchanged fields retain CURRENT metadata; changed values/removals are
 * stamped as edits occurring now.
 */
export function prepareSettingsForExplicitReplacement(
  currentValue: unknown,
  replacementValue: unknown,
  timestamp?: string,
): SettingsRecord {
  const current = asSettings(currentValue)
  const replacement = asSettings(replacementValue)
  const result: SettingsRecord = {}

  for (const field of getSettingsDataFieldNames(replacement)) {
    if (hasEffectiveBusinessField(replacement, field)) result[field] = cloneValue(replacement[field])
  }

  result[SETTINGS_UPDATED_AT_FIELD] = { ...asFreshnessMap(current[SETTINGS_UPDATED_AT_FIELD]) }
  result[SETTINGS_DELETED_AT_FIELD] = { ...asFreshnessMap(current[SETTINGS_DELETED_AT_FIELD]) }

  return stampSettingsFields(
    result,
    getChangedSettingsFieldNames(current, replacement),
    timestamp,
  )
}

/**
 * Merge the incoming settings object onto a remote/base object field by field.
 * A strictly newer explicit timestamp wins. Remote wins timestamp ties. A side
 * with metadata beats a legacy unstamped side; with no metadata on either side,
 * the remote value wins when present while remote-missing incoming fields survive.
 */
export function mergeSettingsByField(remoteValue: unknown, incomingValue: unknown): SettingsRecord {
  const remote = asSettings(remoteValue)
  const incoming = asSettings(incomingValue)
  const remoteUpdated = asFreshnessMap(remote[SETTINGS_UPDATED_AT_FIELD])
  const incomingUpdated = asFreshnessMap(incoming[SETTINGS_UPDATED_AT_FIELD])
  const remoteDeleted = asFreshnessMap(remote[SETTINGS_DELETED_AT_FIELD])
  const incomingDeleted = asFreshnessMap(incoming[SETTINGS_DELETED_AT_FIELD])
  const result: SettingsRecord = {}
  const resultUpdated: SettingsFreshnessMap = {}
  const resultDeleted: SettingsFreshnessMap = {}

  const fields = new Set([
    ...getSettingsDataFieldNames(remote),
    ...getSettingsDataFieldNames(incoming),
    ...Object.keys(remoteUpdated),
    ...Object.keys(incomingUpdated),
    ...Object.keys(remoteDeleted),
    ...Object.keys(incomingDeleted),
  ])

  for (const field of fields) {
    if (!field || isMetadataField(field)) continue
    const remoteUpdatedMs = timestampMs(remoteUpdated[field])
    const incomingUpdatedMs = timestampMs(incomingUpdated[field])
    const remoteDeletedMs = timestampMs(remoteDeleted[field])
    const incomingDeletedMs = timestampMs(incomingDeleted[field])
    const remoteFreshness = Math.max(remoteUpdatedMs, remoteDeletedMs)
    const incomingFreshness = Math.max(incomingUpdatedMs, incomingDeletedMs)
    const remoteHasMetadata = remoteFreshness !== Number.NEGATIVE_INFINITY
    const incomingHasMetadata = incomingFreshness !== Number.NEGATIVE_INFINITY

    let source: SettingsRecord
    let sourceUpdated: SettingsFreshnessMap
    let sourceDeleted: SettingsFreshnessMap
    if (incomingHasMetadata && (!remoteHasMetadata || incomingFreshness > remoteFreshness)) {
      source = incoming
      sourceUpdated = incomingUpdated
      sourceDeleted = incomingDeleted
    } else if (!remoteHasMetadata && !incomingHasMetadata && !hasOwn(remote, field) && hasOwn(incoming, field)) {
      source = incoming
      sourceUpdated = incomingUpdated
      sourceDeleted = incomingDeleted
    } else {
      source = remote
      sourceUpdated = remoteUpdated
      sourceDeleted = remoteDeleted
    }

    const deletedMs = timestampMs(sourceDeleted[field])
    const updatedMs = timestampMs(sourceUpdated[field])
    const isDeleted = deletedMs !== Number.NEGATIVE_INFINITY && deletedMs >= updatedMs
    if (!isDeleted && hasOwn(source, field)) result[field] = cloneValue(source[field])
    if (isValidTimestamp(sourceUpdated[field]) && !isDeleted) resultUpdated[field] = sourceUpdated[field]
    if (isValidTimestamp(sourceDeleted[field]) && isDeleted) resultDeleted[field] = sourceDeleted[field]
  }

  result[SETTINGS_UPDATED_AT_FIELD] = resultUpdated
  result[SETTINGS_DELETED_AT_FIELD] = resultDeleted
  return result
}

/** Fresh-remote base plus explicit incoming settings edits. */
export function mergeSettingsIntoRemote<T extends SettingsBackupShape>(remoteBackup: T, incomingBackup: T): T {
  return {
    ...cloneValue(remoteBackup),
    settings: mergeSettingsByField(remoteBackup?.settings, incomingBackup?.settings),
  } as T
}

/**
 * Push/apply preservation fold: retain the outgoing backup, resolving only its
 * settings against a fresh remote snapshot.
 */
export function mergeRemoteSettingsIntoOutgoing<T extends SettingsBackupShape>(outgoingBackup: T, remoteBackup: T): T {
  return {
    ...cloneValue(outgoingBackup),
    settings: mergeSettingsByField(remoteBackup?.settings, outgoingBackup?.settings),
  } as T
}
