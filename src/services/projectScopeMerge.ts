/**
 * Project inner-scope merge helpers.
 *
 * Phase 6B implements delete-safe, item-level scoped merge for
 * project.changeOrders. Phase 6F adds the same scoped tombstone merge pattern
 * for project.rfis. Phase 6H adds project.materials / MTO row support. This
 * module is intentionally pure: no React, localStorage, Supabase client, or
 * side effects.
 */
import type { BackupData, BackupEstimateVersion, ChangeOrder } from './backupDataService'

const EPOCH_FALLBACK_ISO = '1970-01-01T00:00:00.000Z'

export function isValidDateString(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return !Number.isNaN(Date.parse(trimmed))
}

export function parseTimestampMs(value: unknown): number {
  if (typeof value !== 'string') return Number.NaN
  const trimmed = value.trim()
  if (!trimmed) return Number.NaN
  const ms = Date.parse(trimmed)
  return Number.isNaN(ms) ? Number.NaN : ms
}

function comparableMs(value: unknown): number {
  const ms = parseTimestampMs(value)
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

export function normalizeChangeOrderCreatedAt(co: any): string {
  if (isValidDateString(co?.createdAt)) return String(co.createdAt)
  if (isValidDateString(co?.approvalAt)) return String(co.approvalAt)
  return EPOCH_FALLBACK_ISO
}

export function normalizeChangeOrderUpdatedAt(co: any): string {
  let base: string
  if (isValidDateString(co?.updatedAt)) base = String(co.updatedAt)
  else if (isValidDateString(co?.approvalAt)) base = String(co.approvalAt)
  else if (isValidDateString(co?.createdAt)) base = String(co.createdAt)
  else base = EPOCH_FALLBACK_ISO

  if (isValidDateString(co?.deletedAt) && parseTimestampMs(co.deletedAt) > parseTimestampMs(base)) {
    return String(co.deletedAt)
  }

  return base
}

export type MergeableChangeOrder = ChangeOrder & {
  updatedAt: string
  deletedAt?: string
  deletedBy?: string
}

export function sanitizeChangeOrderForMerge(co: any): MergeableChangeOrder | null {
  const id = String(co?.id || '').trim()
  if (!id) return null
  return {
    ...co,
    id,
    createdAt: normalizeChangeOrderCreatedAt(co),
    updatedAt: normalizeChangeOrderUpdatedAt(co),
  } as MergeableChangeOrder
}

export function isDeletedChangeOrder(co: any): boolean {
  return isValidDateString(co?.deletedAt)
}

export function getLiveChangeOrders(changeOrders: any[]): ChangeOrder[] {
  const out: ChangeOrder[] = []
  for (const co of Array.isArray(changeOrders) ? changeOrders : []) {
    const clean = sanitizeChangeOrderForMerge(co)
    if (!clean || isDeletedChangeOrder(clean)) continue
    out.push(clean)
  }
  return out
}

export function createChangeOrderTombstone(existingCO: any, deletedBy?: string): ChangeOrder {
  const now = new Date().toISOString()
  const tombstone: any = {
    ...existingCO,
    deletedAt: now,
    updatedAt: now,
  }
  if (deletedBy) tombstone.deletedBy = deletedBy
  else if (existingCO?.deletedBy) tombstone.deletedBy = existingCO.deletedBy
  return tombstone
}

function pickChangeOrderWinner(
  remote: MergeableChangeOrder,
  incoming: MergeableChangeOrder,
): ChangeOrder {
  const remoteDeleted = isDeletedChangeOrder(remote)
  const incomingDeleted = isDeletedChangeOrder(incoming)

  if (remoteDeleted && incomingDeleted) {
    return comparableMs(incoming.deletedAt) > comparableMs(remote.deletedAt) ? incoming : remote
  }

  if (remoteDeleted !== incomingDeleted) {
    const tombstone = remoteDeleted ? remote : incoming
    const live = remoteDeleted ? incoming : remote
    return comparableMs(live.updatedAt) > comparableMs(tombstone.deletedAt) ? live : tombstone
  }

  return comparableMs(incoming.updatedAt) > comparableMs(remote.updatedAt) ? incoming : remote
}

export function mergeChangeOrdersById(remoteItems: any[], incomingItems: any[]): ChangeOrder[] {
  const remoteSanitized = (Array.isArray(remoteItems) ? remoteItems : [])
    .map(sanitizeChangeOrderForMerge)
    .filter((co): co is MergeableChangeOrder => co != null)
  const incomingSanitized = (Array.isArray(incomingItems) ? incomingItems : [])
    .map(sanitizeChangeOrderForMerge)
    .filter((co): co is MergeableChangeOrder => co != null)

  const remoteById = new Map<string, MergeableChangeOrder>()
  for (const co of remoteSanitized) remoteById.set(String(co.id), co)

  const result: ChangeOrder[] = []
  const used = new Set<string>()

  for (const incoming of incomingSanitized) {
    const id = String(incoming.id)
    if (used.has(id)) continue
    used.add(id)
    const remote = remoteById.get(id)
    result.push(remote ? pickChangeOrderWinner(remote, incoming) : incoming)
  }

  for (const remote of remoteSanitized) {
    const id = String(remote.id)
    if (used.has(id)) continue
    used.add(id)
    result.push(remote)
  }

  return result
}

export function mergeProjectChangeOrdersIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
  projectId: string,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const targetId = String(projectId || '').trim()
  if (!targetId) return merged

  const remoteProjects = Array.isArray(merged.projects) ? merged.projects : []
  const remoteIndex = remoteProjects.findIndex((p: any) => String(p?.id || '') === targetId)
  if (remoteIndex === -1) return merged

  const incomingProjects = Array.isArray(incomingBackup?.projects) ? incomingBackup.projects : []
  const incomingProject: any = incomingProjects.find((p: any) => String(p?.id || '') === targetId)
  if (!incomingProject) return merged

  const remoteProject: any = remoteProjects[remoteIndex]
  const remoteCOs = Array.isArray(remoteProject.changeOrders) ? remoteProject.changeOrders : []
  const incomingCOs = Array.isArray(incomingProject.changeOrders) ? incomingProject.changeOrders : []

  remoteProject.changeOrders = mergeChangeOrdersById(remoteCOs, incomingCOs)
  return merged
}

export interface ProjectRFI {
  rfiId?: string
  rfiNumber?: string
  id?: string
  question?: string
  directedTo?: string
  submitted?: string
  createdAt?: string
  created_at?: string
  created?: string
  questionAt?: string
  response?: string
  answer?: string
  status?: string
  label?: string
  critical?: boolean
  updatedAt?: string
  deletedAt?: string
  deletedBy?: string
  [key: string]: any
}

export type RFIIdentityContext = {
  duplicateLegacyKeys: ReadonlySet<string>
}

export type MergeableProjectRFI = ProjectRFI & {
  rfiId: string
  updatedAt: string
}

function normalizeProjectId(projectId?: string): string {
  return String(projectId || '').trim() || 'unknown-project'
}

function normalizeRFIText(value: unknown): string {
  return String(value ?? '').trim()
}

function legacyRFIIdentityBase(rfi: any, projectId?: string): string {
  const legacyId = normalizeRFIText(rfi?.id || rfi?.rfiNumber || 'missing')
  return `legacy:${normalizeProjectId(projectId)}:${legacyId || 'missing'}`
}

function shortStableHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8)
}

function stableRFIFingerprint(rfi: any): string {
  const parts = [
    rfi?.id,
    rfi?.rfiNumber,
    rfi?.question,
    rfi?.submitted,
    rfi?.createdAt,
    rfi?.created_at,
    rfi?.created,
    rfi?.questionAt,
    rfi?.response,
    rfi?.answer,
    rfi?.status,
    rfi?.label,
    rfi?.stageRecorded,
    rfi?.stageApplies,
    rfi?.directedTo,
  ].map(value => normalizeRFIText(value))
  return shortStableHash(parts.join('|'))
}

export function createRFIIdentityContext(rfis: any[], projectId?: string): RFIIdentityContext {
  const counts = new Map<string, number>()
  for (const rfi of Array.isArray(rfis) ? rfis : []) {
    if (normalizeRFIText(rfi?.rfiId)) continue
    const base = legacyRFIIdentityBase(rfi, projectId)
    counts.set(base, (counts.get(base) || 0) + 1)
  }

  const duplicateLegacyKeys = new Set<string>()
  for (const [base, count] of counts) {
    if (count > 1) duplicateLegacyKeys.add(base)
  }
  return { duplicateLegacyKeys }
}

export function getRFIStableId(
  rfi: any,
  projectId?: string,
  duplicateContext?: RFIIdentityContext,
): string {
  const existing = normalizeRFIText(rfi?.rfiId)
  if (existing) return existing

  const base = legacyRFIIdentityBase(rfi, projectId)
  if (duplicateContext?.duplicateLegacyKeys?.has(base)) {
    return `${base}:${stableRFIFingerprint(rfi)}`
  }
  return base
}

export function getRFIDisplayNumber(rfi: any): string {
  return normalizeRFIText(rfi?.rfiNumber || rfi?.id || 'RFI') || 'RFI'
}

export function normalizeRFIUpdatedAt(rfi: any): string {
  let base: string
  if (isValidDateString(rfi?.updatedAt)) base = String(rfi.updatedAt)
  else if (isValidDateString(rfi?.submitted)) base = String(rfi.submitted)
  else if (isValidDateString(rfi?.createdAt)) base = String(rfi.createdAt)
  else if (isValidDateString(rfi?.created_at)) base = String(rfi.created_at)
  else if (isValidDateString(rfi?.created)) base = String(rfi.created)
  else if (isValidDateString(rfi?.questionAt)) base = String(rfi.questionAt)
  else base = EPOCH_FALLBACK_ISO

  if (isValidDateString(rfi?.deletedAt) && parseTimestampMs(rfi.deletedAt) > parseTimestampMs(base)) {
    return String(rfi.deletedAt)
  }

  return base
}

export function sanitizeRFIForMerge(
  rfi: any,
  projectId?: string,
  duplicateContext?: RFIIdentityContext,
): MergeableProjectRFI | null {
  if (!rfi || typeof rfi !== 'object') return null
  const rfiId = getRFIStableId(rfi, projectId, duplicateContext)
  if (!rfiId) return null
  return {
    ...rfi,
    rfiId,
    rfiNumber: normalizeRFIText(rfi.rfiNumber || rfi.id) || undefined,
    updatedAt: normalizeRFIUpdatedAt(rfi),
  } as MergeableProjectRFI
}

export function isDeletedRFI(rfi: any): boolean {
  return isValidDateString(rfi?.deletedAt)
}

export function getLiveRFIs(rfis: any[], projectId?: string): ProjectRFI[] {
  const context = createRFIIdentityContext(rfis, projectId)
  const out: ProjectRFI[] = []
  for (const rfi of Array.isArray(rfis) ? rfis : []) {
    const clean = sanitizeRFIForMerge(rfi, projectId, context)
    if (!clean || isDeletedRFI(clean)) continue
    out.push(clean)
  }
  return out
}

export function createRFITombstone(
  existingRFI: any,
  projectId?: string,
  deletedBy?: string,
  duplicateContext?: RFIIdentityContext,
): ProjectRFI {
  const context = duplicateContext || createRFIIdentityContext([existingRFI], projectId)
  const clean = sanitizeRFIForMerge(existingRFI, projectId, context) || existingRFI || {}
  const now = new Date().toISOString()
  const tombstone: ProjectRFI = {
    ...clean,
    rfiId: getRFIStableId(clean, projectId, context),
    rfiNumber: normalizeRFIText(clean?.rfiNumber || clean?.id) || undefined,
    deletedAt: now,
    updatedAt: now,
  }
  if (deletedBy) tombstone.deletedBy = deletedBy
  else if (clean?.deletedBy) tombstone.deletedBy = clean.deletedBy
  return tombstone
}

function pickRFIWinner(
  remote: MergeableProjectRFI,
  incoming: MergeableProjectRFI,
): ProjectRFI {
  const remoteDeleted = isDeletedRFI(remote)
  const incomingDeleted = isDeletedRFI(incoming)

  if (remoteDeleted && incomingDeleted) {
    return comparableMs(incoming.deletedAt) > comparableMs(remote.deletedAt) ? incoming : remote
  }

  if (remoteDeleted !== incomingDeleted) {
    const tombstone = remoteDeleted ? remote : incoming
    const live = remoteDeleted ? incoming : remote
    return comparableMs(live.updatedAt) > comparableMs(tombstone.deletedAt) ? live : tombstone
  }

  return comparableMs(incoming.updatedAt) > comparableMs(remote.updatedAt) ? incoming : remote
}

export function mergeRFIsByStableId(
  remoteItems: any[],
  incomingItems: any[],
  projectId?: string,
): ProjectRFI[] {
  const combinedContext = createRFIIdentityContext(
    [
      ...(Array.isArray(remoteItems) ? remoteItems : []),
      ...(Array.isArray(incomingItems) ? incomingItems : []),
    ],
    projectId,
  )
  const remoteSanitized = (Array.isArray(remoteItems) ? remoteItems : [])
    .map(rfi => sanitizeRFIForMerge(rfi, projectId, combinedContext))
    .filter((rfi): rfi is MergeableProjectRFI => rfi != null)
  const incomingSanitized = (Array.isArray(incomingItems) ? incomingItems : [])
    .map(rfi => sanitizeRFIForMerge(rfi, projectId, combinedContext))
    .filter((rfi): rfi is MergeableProjectRFI => rfi != null)

  const remoteById = new Map<string, MergeableProjectRFI>()
  for (const rfi of remoteSanitized) remoteById.set(String(rfi.rfiId), rfi)

  const result: ProjectRFI[] = []
  const used = new Set<string>()

  for (const incoming of incomingSanitized) {
    const id = String(incoming.rfiId)
    if (used.has(id)) continue
    used.add(id)
    const remote = remoteById.get(id)
    result.push(remote ? pickRFIWinner(remote, incoming) : incoming)
  }

  for (const remote of remoteSanitized) {
    const id = String(remote.rfiId)
    if (used.has(id)) continue
    used.add(id)
    result.push(remote)
  }

  return result
}

export function mergeProjectRFIsIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
  projectId: string,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const targetId = String(projectId || '').trim()
  if (!targetId) return merged

  const remoteProjects = Array.isArray(merged.projects) ? merged.projects : []
  const remoteIndex = remoteProjects.findIndex((p: any) => String(p?.id || '') === targetId)
  if (remoteIndex === -1) return merged

  const incomingProjects = Array.isArray(incomingBackup?.projects) ? incomingBackup.projects : []
  const incomingProject: any = incomingProjects.find((p: any) => String(p?.id || '') === targetId)
  if (!incomingProject) return merged

  const remoteProject: any = remoteProjects[remoteIndex]
  const remoteRFIs = Array.isArray(remoteProject.rfis) ? remoteProject.rfis : []
  const incomingRFIs = Array.isArray(incomingProject.rfis) ? incomingProject.rfis : []

  remoteProject.rfis = mergeRFIsByStableId(remoteRFIs, incomingRFIs, targetId)
  return merged
}

export type ProjectMaterialBucket = 'mtoRows' | 'matRows' | string

export interface ProjectMaterialRow {
  materialId?: string
  mtoId?: string
  id?: string
  name?: string
  desc?: string
  description?: string
  qty?: number
  quantity?: number
  unit?: string
  price?: number
  cost?: number
  total?: number
  createdAt?: string
  updatedAt?: string
  deletedAt?: string
  deletedBy?: string
  [key: string]: any
}

export type MaterialIdentityContext = {
  duplicateLegacyKeys: ReadonlySet<string>
}

export type MergeableProjectMaterialRow = ProjectMaterialRow & {
  materialId: string
  updatedAt: string
}

function normalizeMaterialText(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeMaterialBucket(bucket?: ProjectMaterialBucket): string {
  return normalizeMaterialText(bucket || 'materials') || 'materials'
}

function timestampFromMaterialId(row: any): string | null {
  const candidates = [
    row?.id,
    row?.materialId,
    row?.mtoId,
  ]

  for (const candidate of candidates) {
    const text = normalizeMaterialText(candidate)
    const match = text.match(/(\d{13})/)
    if (!match) continue
    const ms = Number(match[1])
    if (!Number.isFinite(ms)) continue
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }

  return null
}

function legacyMaterialIdentityBase(
  row: any,
  projectId?: string,
  bucket?: ProjectMaterialBucket,
): string {
  const legacyId = normalizeMaterialText(row?.id || 'missing') || 'missing'
  return `legacy:${normalizeProjectId(projectId)}:${normalizeMaterialBucket(bucket)}:${legacyId}`
}

function stableMaterialFingerprint(row: any): string {
  const parts = [
    row?.id,
    row?.name,
    row?.desc,
    row?.description,
    row?.phase,
    row?.matId,
    row?.qty,
    row?.quantity,
    row?.unit,
    row?.unitCost,
    row?.price,
    row?.cost,
    row?.total,
    row?.placement,
    row?.note,
    row?.supplierNote,
    row?.createdAt,
  ].map(value => normalizeMaterialText(value))
  return shortStableHash(parts.join('|'))
}

export function createMaterialIdentityContext(
  rows: any[],
  projectId?: string,
  bucket?: ProjectMaterialBucket,
): MaterialIdentityContext {
  const counts = new Map<string, number>()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (normalizeMaterialText(row?.materialId) || normalizeMaterialText(row?.mtoId)) continue
    const base = legacyMaterialIdentityBase(row, projectId, bucket)
    counts.set(base, (counts.get(base) || 0) + 1)
  }

  const duplicateLegacyKeys = new Set<string>()
  for (const [base, count] of counts) {
    if (count > 1) duplicateLegacyKeys.add(base)
  }
  return { duplicateLegacyKeys }
}

export function getMaterialStableId(
  row: any,
  projectId?: string,
  bucket?: ProjectMaterialBucket,
  duplicateContext?: MaterialIdentityContext,
): string {
  const materialId = normalizeMaterialText(row?.materialId)
  if (materialId) return materialId

  const mtoId = normalizeMaterialText(row?.mtoId)
  if (mtoId) return mtoId

  const base = legacyMaterialIdentityBase(row, projectId, bucket)
  if (duplicateContext?.duplicateLegacyKeys?.has(base)) {
    return `${base}:${stableMaterialFingerprint(row)}`
  }
  return base
}

export function normalizeMaterialCreatedAt(row: any): string {
  if (isValidDateString(row?.createdAt)) return String(row.createdAt)
  const fromId = timestampFromMaterialId(row)
  if (fromId) return fromId
  return EPOCH_FALLBACK_ISO
}

export function normalizeMaterialUpdatedAt(row: any): string {
  let base: string
  if (isValidDateString(row?.updatedAt)) base = String(row.updatedAt)
  else if (isValidDateString(row?.createdAt)) base = String(row.createdAt)
  else base = timestampFromMaterialId(row) || EPOCH_FALLBACK_ISO

  if (isValidDateString(row?.deletedAt) && parseTimestampMs(row.deletedAt) > parseTimestampMs(base)) {
    return String(row.deletedAt)
  }

  return base
}

export function sanitizeMaterialRowForMerge(
  row: any,
  projectId?: string,
  bucket?: ProjectMaterialBucket,
  duplicateContext?: MaterialIdentityContext,
): MergeableProjectMaterialRow | null {
  if (!row || typeof row !== 'object') return null
  const materialId = getMaterialStableId(row, projectId, bucket, duplicateContext)
  if (!materialId) return null
  const normalizedBucket = normalizeMaterialBucket(bucket)
  const clean: ProjectMaterialRow = {
    ...row,
    materialId,
    createdAt: normalizeMaterialCreatedAt(row),
    updatedAt: normalizeMaterialUpdatedAt(row),
  }
  if (normalizedBucket === 'mtoRows' && !normalizeMaterialText(clean.mtoId)) {
    clean.mtoId = materialId
  }
  return clean as MergeableProjectMaterialRow
}

export function isDeletedMaterialRow(row: any): boolean {
  return isValidDateString(row?.deletedAt)
}

export function getLiveMaterialRows(
  rows: any[],
  projectId?: string,
  bucket?: ProjectMaterialBucket,
): ProjectMaterialRow[] {
  const context = createMaterialIdentityContext(rows, projectId, bucket)
  const out: ProjectMaterialRow[] = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const clean = sanitizeMaterialRowForMerge(row, projectId, bucket, context)
    if (!clean || isDeletedMaterialRow(clean)) continue
    out.push(clean)
  }
  return out
}

export function createMaterialRowTombstone(
  existingRow: any,
  projectId?: string,
  bucket?: ProjectMaterialBucket,
  deletedBy?: string,
  duplicateContext?: MaterialIdentityContext,
): ProjectMaterialRow {
  const context = duplicateContext || createMaterialIdentityContext([existingRow], projectId, bucket)
  const clean = sanitizeMaterialRowForMerge(existingRow, projectId, bucket, context) || existingRow || {}
  const now = new Date().toISOString()
  const materialId = getMaterialStableId(clean, projectId, bucket, context)
  const tombstone: ProjectMaterialRow = {
    ...clean,
    materialId,
    deletedAt: now,
    updatedAt: now,
  }
  if (normalizeMaterialBucket(bucket) === 'mtoRows' && !normalizeMaterialText(tombstone.mtoId)) {
    tombstone.mtoId = materialId
  }
  if (deletedBy) tombstone.deletedBy = deletedBy
  else if (clean?.deletedBy) tombstone.deletedBy = clean.deletedBy
  return tombstone
}

function pickMaterialRowWinner(
  remote: MergeableProjectMaterialRow,
  incoming: MergeableProjectMaterialRow,
): ProjectMaterialRow {
  const remoteDeleted = isDeletedMaterialRow(remote)
  const incomingDeleted = isDeletedMaterialRow(incoming)

  if (remoteDeleted && incomingDeleted) {
    return comparableMs(incoming.deletedAt) > comparableMs(remote.deletedAt) ? incoming : remote
  }

  if (remoteDeleted !== incomingDeleted) {
    const tombstone = remoteDeleted ? remote : incoming
    const live = remoteDeleted ? incoming : remote
    return comparableMs(live.updatedAt) > comparableMs(tombstone.deletedAt) ? live : tombstone
  }

  return comparableMs(incoming.updatedAt) > comparableMs(remote.updatedAt) ? incoming : remote
}

export function mergeMaterialRowsByStableId(
  remoteRows: any[],
  incomingRows: any[],
  projectId?: string,
  bucket?: ProjectMaterialBucket,
): ProjectMaterialRow[] {
  const combinedContext = createMaterialIdentityContext(
    [
      ...(Array.isArray(remoteRows) ? remoteRows : []),
      ...(Array.isArray(incomingRows) ? incomingRows : []),
    ],
    projectId,
    bucket,
  )
  const remoteSanitized = (Array.isArray(remoteRows) ? remoteRows : [])
    .map(row => sanitizeMaterialRowForMerge(row, projectId, bucket, combinedContext))
    .filter((row): row is MergeableProjectMaterialRow => row != null)
  const incomingSanitized = (Array.isArray(incomingRows) ? incomingRows : [])
    .map(row => sanitizeMaterialRowForMerge(row, projectId, bucket, combinedContext))
    .filter((row): row is MergeableProjectMaterialRow => row != null)

  const remoteById = new Map<string, MergeableProjectMaterialRow>()
  for (const row of remoteSanitized) remoteById.set(String(row.materialId), row)

  const result: ProjectMaterialRow[] = []
  const used = new Set<string>()

  for (const incoming of incomingSanitized) {
    const id = String(incoming.materialId)
    if (used.has(id)) continue
    used.add(id)
    const remote = remoteById.get(id)
    result.push(remote ? pickMaterialRowWinner(remote, incoming) : incoming)
  }

  for (const remote of remoteSanitized) {
    const id = String(remote.materialId)
    if (used.has(id)) continue
    used.add(id)
    result.push(remote)
  }

  return result
}

export function mergeProjectMaterialsIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
  projectId: string,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const targetId = String(projectId || '').trim()
  if (!targetId) return merged

  const remoteProjects = Array.isArray(merged.projects) ? merged.projects : []
  const remoteIndex = remoteProjects.findIndex((p: any) => String(p?.id || '') === targetId)
  if (remoteIndex === -1) return merged

  const incomingProjects = Array.isArray(incomingBackup?.projects) ? incomingBackup.projects : []
  const incomingProject: any = incomingProjects.find((p: any) => String(p?.id || '') === targetId)
  if (!incomingProject) return merged

  const remoteProject: any = remoteProjects[remoteIndex]
  const remoteMTORows = Array.isArray(remoteProject.mtoRows) ? remoteProject.mtoRows : []
  const incomingMTORows = Array.isArray(incomingProject.mtoRows) ? incomingProject.mtoRows : []
  remoteProject.mtoRows = mergeMaterialRowsByStableId(remoteMTORows, incomingMTORows, targetId, 'mtoRows')

  if (Array.isArray(remoteProject.matRows) || Array.isArray(incomingProject.matRows)) {
    const remoteMatRows = Array.isArray(remoteProject.matRows) ? remoteProject.matRows : []
    const incomingMatRows = Array.isArray(incomingProject.matRows) ? incomingProject.matRows : []
    remoteProject.matRows = mergeMaterialRowsByStableId(remoteMatRows, incomingMatRows, targetId, 'matRows')
  }

  return merged
}

export interface ProjectLaborRow {
  laborId?: string
  id?: string
  desc?: string
  empId?: string
  hrs?: number
  rate?: number
  phase?: string
  employees?: unknown
  employeeAllocations?: unknown
  createdAt?: string
  updatedAt?: string
  deletedAt?: string
  deletedBy?: string
  [key: string]: any
}

export interface ProjectOverheadRow {
  overheadId?: string
  id?: string
  desc?: string
  hrs?: number
  rate?: number
  createdAt?: string
  updatedAt?: string
  deletedAt?: string
  deletedBy?: string
  [key: string]: any
}

export type EstimateRowIdentityContext = {
  duplicateLegacyKeys: ReadonlySet<string>
}

export type MergeableProjectLaborRow = ProjectLaborRow & {
  laborId: string
  updatedAt: string
}

export type MergeableProjectOverheadRow = ProjectOverheadRow & {
  overheadId: string
  updatedAt: string
}

function normalizeEstimateText(value: unknown): string {
  return String(value ?? '').trim()
}

function timestampFromEstimateRowId(row: any): string | null {
  const candidates = [
    row?.id,
    row?.laborId,
    row?.overheadId,
  ]

  for (const candidate of candidates) {
    const text = normalizeEstimateText(candidate)
    const match = text.match(/(\d{13})/)
    if (!match) continue
    const ms = Number(match[1])
    if (!Number.isFinite(ms)) continue
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }

  return null
}

function legacyEstimateIdentityBase(
  row: any,
  projectId: string | undefined,
  bucket: 'laborRows' | 'ohRows',
): string {
  const legacyId = normalizeEstimateText(row?.id || 'missing') || 'missing'
  return `legacy:${normalizeProjectId(projectId)}:${bucket}:${legacyId}`
}

function stableLaborFingerprint(row: any): string {
  const parts = [
    row?.id,
    row?.desc,
    row?.empId,
    row?.hrs,
    row?.rate,
    row?.phase,
    JSON.stringify(row?.employees || null),
    JSON.stringify(row?.employeeAllocations || null),
    row?.createdAt,
  ].map(value => normalizeEstimateText(value))
  return shortStableHash(parts.join('|'))
}

function stableOverheadFingerprint(row: any): string {
  const parts = [
    row?.id,
    row?.desc,
    row?.hrs,
    row?.rate,
    row?.createdAt,
  ].map(value => normalizeEstimateText(value))
  return shortStableHash(parts.join('|'))
}

function createEstimateIdentityContext(
  rows: any[],
  projectId: string | undefined,
  bucket: 'laborRows' | 'ohRows',
  canonicalField: 'laborId' | 'overheadId',
): EstimateRowIdentityContext {
  const counts = new Map<string, number>()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (normalizeEstimateText(row?.[canonicalField])) continue
    const base = legacyEstimateIdentityBase(row, projectId, bucket)
    counts.set(base, (counts.get(base) || 0) + 1)
  }

  const duplicateLegacyKeys = new Set<string>()
  for (const [base, count] of counts) {
    if (count > 1) duplicateLegacyKeys.add(base)
  }
  return { duplicateLegacyKeys }
}

export function createLaborIdentityContext(rows: any[], projectId?: string): EstimateRowIdentityContext {
  return createEstimateIdentityContext(rows, projectId, 'laborRows', 'laborId')
}

export function createOverheadIdentityContext(rows: any[], projectId?: string): EstimateRowIdentityContext {
  return createEstimateIdentityContext(rows, projectId, 'ohRows', 'overheadId')
}

export function getLaborStableId(
  row: any,
  projectId?: string,
  duplicateContext?: EstimateRowIdentityContext,
): string {
  const existing = normalizeEstimateText(row?.laborId)
  if (existing) return existing

  const base = legacyEstimateIdentityBase(row, projectId, 'laborRows')
  if (duplicateContext?.duplicateLegacyKeys?.has(base)) {
    return `${base}:${stableLaborFingerprint(row)}`
  }
  return base
}

export function getOverheadStableId(
  row: any,
  projectId?: string,
  duplicateContext?: EstimateRowIdentityContext,
): string {
  const existing = normalizeEstimateText(row?.overheadId)
  if (existing) return existing

  const base = legacyEstimateIdentityBase(row, projectId, 'ohRows')
  if (duplicateContext?.duplicateLegacyKeys?.has(base)) {
    return `${base}:${stableOverheadFingerprint(row)}`
  }
  return base
}

export function normalizeEstimateRowCreatedAt(row: any): string {
  if (isValidDateString(row?.createdAt)) return String(row.createdAt)
  return timestampFromEstimateRowId(row) || EPOCH_FALLBACK_ISO
}

export function normalizeEstimateRowUpdatedAt(row: any): string {
  let base: string
  if (isValidDateString(row?.updatedAt)) base = String(row.updatedAt)
  else if (isValidDateString(row?.createdAt)) base = String(row.createdAt)
  else base = timestampFromEstimateRowId(row) || EPOCH_FALLBACK_ISO

  if (isValidDateString(row?.deletedAt) && parseTimestampMs(row.deletedAt) > parseTimestampMs(base)) {
    return String(row.deletedAt)
  }

  return base
}

export function sanitizeLaborRowForMerge(
  row: any,
  projectId?: string,
  duplicateContext?: EstimateRowIdentityContext,
): MergeableProjectLaborRow | null {
  if (!row || typeof row !== 'object') return null
  const laborId = getLaborStableId(row, projectId, duplicateContext)
  if (!laborId) return null
  return {
    ...row,
    laborId,
    createdAt: normalizeEstimateRowCreatedAt(row),
    updatedAt: normalizeEstimateRowUpdatedAt(row),
  } as MergeableProjectLaborRow
}

export function sanitizeOverheadRowForMerge(
  row: any,
  projectId?: string,
  duplicateContext?: EstimateRowIdentityContext,
): MergeableProjectOverheadRow | null {
  if (!row || typeof row !== 'object') return null
  const overheadId = getOverheadStableId(row, projectId, duplicateContext)
  if (!overheadId) return null
  return {
    ...row,
    overheadId,
    createdAt: normalizeEstimateRowCreatedAt(row),
    updatedAt: normalizeEstimateRowUpdatedAt(row),
  } as MergeableProjectOverheadRow
}

export function isDeletedEstimateRow(row: any): boolean {
  return isValidDateString(row?.deletedAt)
}

export function getLiveLaborRows(rows: any[], projectId?: string): ProjectLaborRow[] {
  const context = createLaborIdentityContext(rows, projectId)
  const out: ProjectLaborRow[] = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const clean = sanitizeLaborRowForMerge(row, projectId, context)
    if (!clean || isDeletedEstimateRow(clean)) continue
    out.push(clean)
  }
  return out
}

export function getLiveOverheadRows(rows: any[], projectId?: string): ProjectOverheadRow[] {
  const context = createOverheadIdentityContext(rows, projectId)
  const out: ProjectOverheadRow[] = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const clean = sanitizeOverheadRowForMerge(row, projectId, context)
    if (!clean || isDeletedEstimateRow(clean)) continue
    out.push(clean)
  }
  return out
}

export function createLaborRowTombstone(
  existingRow: any,
  projectId?: string,
  deletedBy?: string,
  duplicateContext?: EstimateRowIdentityContext,
): ProjectLaborRow {
  const context = duplicateContext || createLaborIdentityContext([existingRow], projectId)
  const clean = sanitizeLaborRowForMerge(existingRow, projectId, context) || existingRow || {}
  const now = new Date().toISOString()
  const tombstone: ProjectLaborRow = {
    ...clean,
    laborId: getLaborStableId(clean, projectId, context),
    deletedAt: now,
    updatedAt: now,
  }
  if (deletedBy) tombstone.deletedBy = deletedBy
  else if (clean?.deletedBy) tombstone.deletedBy = clean.deletedBy
  return tombstone
}

export function createOverheadRowTombstone(
  existingRow: any,
  projectId?: string,
  deletedBy?: string,
  duplicateContext?: EstimateRowIdentityContext,
): ProjectOverheadRow {
  const context = duplicateContext || createOverheadIdentityContext([existingRow], projectId)
  const clean = sanitizeOverheadRowForMerge(existingRow, projectId, context) || existingRow || {}
  const now = new Date().toISOString()
  const tombstone: ProjectOverheadRow = {
    ...clean,
    overheadId: getOverheadStableId(clean, projectId, context),
    deletedAt: now,
    updatedAt: now,
  }
  if (deletedBy) tombstone.deletedBy = deletedBy
  else if (clean?.deletedBy) tombstone.deletedBy = clean.deletedBy
  return tombstone
}

function pickEstimateRowWinner<
  T extends { updatedAt: string; deletedAt?: string }
>(remote: T, incoming: T): T {
  const remoteDeleted = isDeletedEstimateRow(remote)
  const incomingDeleted = isDeletedEstimateRow(incoming)

  if (remoteDeleted && incomingDeleted) {
    return comparableMs(incoming.deletedAt) > comparableMs(remote.deletedAt) ? incoming : remote
  }

  if (remoteDeleted !== incomingDeleted) {
    const tombstone = remoteDeleted ? remote : incoming
    const live = remoteDeleted ? incoming : remote
    return comparableMs(live.updatedAt) > comparableMs(tombstone.deletedAt) ? live : tombstone
  }

  return comparableMs(incoming.updatedAt) > comparableMs(remote.updatedAt) ? incoming : remote
}

export function mergeLaborRowsByStableId(
  remoteRows: any[],
  incomingRows: any[],
  projectId?: string,
): ProjectLaborRow[] {
  const combinedContext = createLaborIdentityContext(
    [
      ...(Array.isArray(remoteRows) ? remoteRows : []),
      ...(Array.isArray(incomingRows) ? incomingRows : []),
    ],
    projectId,
  )
  const remoteSanitized = (Array.isArray(remoteRows) ? remoteRows : [])
    .map(row => sanitizeLaborRowForMerge(row, projectId, combinedContext))
    .filter((row): row is MergeableProjectLaborRow => row != null)
  const incomingSanitized = (Array.isArray(incomingRows) ? incomingRows : [])
    .map(row => sanitizeLaborRowForMerge(row, projectId, combinedContext))
    .filter((row): row is MergeableProjectLaborRow => row != null)

  const remoteById = new Map<string, MergeableProjectLaborRow>()
  for (const row of remoteSanitized) remoteById.set(String(row.laborId), row)

  const result: ProjectLaborRow[] = []
  const used = new Set<string>()

  for (const incoming of incomingSanitized) {
    const id = String(incoming.laborId)
    if (used.has(id)) continue
    used.add(id)
    const remote = remoteById.get(id)
    result.push(remote ? pickEstimateRowWinner(remote, incoming) : incoming)
  }

  for (const remote of remoteSanitized) {
    const id = String(remote.laborId)
    if (used.has(id)) continue
    used.add(id)
    result.push(remote)
  }

  return result
}

export function mergeOverheadRowsByStableId(
  remoteRows: any[],
  incomingRows: any[],
  projectId?: string,
): ProjectOverheadRow[] {
  const combinedContext = createOverheadIdentityContext(
    [
      ...(Array.isArray(remoteRows) ? remoteRows : []),
      ...(Array.isArray(incomingRows) ? incomingRows : []),
    ],
    projectId,
  )
  const remoteSanitized = (Array.isArray(remoteRows) ? remoteRows : [])
    .map(row => sanitizeOverheadRowForMerge(row, projectId, combinedContext))
    .filter((row): row is MergeableProjectOverheadRow => row != null)
  const incomingSanitized = (Array.isArray(incomingRows) ? incomingRows : [])
    .map(row => sanitizeOverheadRowForMerge(row, projectId, combinedContext))
    .filter((row): row is MergeableProjectOverheadRow => row != null)

  const remoteById = new Map<string, MergeableProjectOverheadRow>()
  for (const row of remoteSanitized) remoteById.set(String(row.overheadId), row)

  const result: ProjectOverheadRow[] = []
  const used = new Set<string>()

  for (const incoming of incomingSanitized) {
    const id = String(incoming.overheadId)
    if (used.has(id)) continue
    used.add(id)
    const remote = remoteById.get(id)
    result.push(remote ? pickEstimateRowWinner(remote, incoming) : incoming)
  }

  for (const remote of remoteSanitized) {
    const id = String(remote.overheadId)
    if (used.has(id)) continue
    used.add(id)
    result.push(remote)
  }

  return result
}

export function mergeProjectEstimateRowsIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
  projectId: string,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const targetId = String(projectId || '').trim()
  if (!targetId) return merged

  const remoteProjects = Array.isArray(merged.projects) ? merged.projects : []
  const remoteIndex = remoteProjects.findIndex((p: any) => String(p?.id || '') === targetId)
  if (remoteIndex === -1) return merged

  const incomingProjects = Array.isArray(incomingBackup?.projects) ? incomingBackup.projects : []
  const incomingProject: any = incomingProjects.find((p: any) => String(p?.id || '') === targetId)
  if (!incomingProject) return merged

  const remoteProject: any = remoteProjects[remoteIndex]
  const remoteLaborRows = Array.isArray(remoteProject.laborRows) ? remoteProject.laborRows : []
  const incomingLaborRows = Array.isArray(incomingProject.laborRows) ? incomingProject.laborRows : []
  remoteProject.laborRows = mergeLaborRowsByStableId(remoteLaborRows, incomingLaborRows, targetId)

  const remoteOverheadRows = Array.isArray(remoteProject.ohRows) ? remoteProject.ohRows : []
  const incomingOverheadRows = Array.isArray(incomingProject.ohRows) ? incomingProject.ohRows : []
  remoteProject.ohRows = mergeOverheadRowsByStableId(remoteOverheadRows, incomingOverheadRows, targetId)

  return merged
}

// ── Project estimate SCALAR fields (Phase 6L) ──────────────────────────────────
// Per-field last-writer-wins merge for the flat estimate scalars. Kept entirely
// separate from the row merges above so labor/OH/material/RFI/CO logic is
// untouched. Only the whitelisted fields plus the `estimateScalarUpdatedAt`
// per-field timestamp map are ever read or written on the target project.

export type EstimateScalarField = 'contract' | 'mileRT' | 'miDays'

/** The only project fields this scalar merge is allowed to patch. */
export const ESTIMATE_SCALAR_FIELDS: readonly EstimateScalarField[] = ['contract', 'mileRT', 'miDays']

export type EstimateScalarUpdatedAt = Partial<Record<EstimateScalarField, string>>

/**
 * Merge estimate scalar fields from `incomingBackup` into a fresh clone of
 * `remoteBackup` for a single project, per-field LWW by `estimateScalarUpdatedAt`.
 *
 * Rules (identical timestamp posture to the row merges):
 *  - A valid incoming timestamp beats a missing/invalid remote timestamp.
 *  - Incoming strictly newer than remote wins (value + timestamp copied).
 *  - Exact tie or incoming older keeps the remote value and remote timestamp.
 *  - Missing/invalid timestamps compare as -Infinity — never defaulted to "now".
 *
 * Only ESTIMATE_SCALAR_FIELDS values and the estimateScalarUpdatedAt map are
 * touched. laborRows/ohRows/mtoRows/matRows/rfis/changeOrders/logs/schedule/
 * notes/address and every other project branch (and every other project) are
 * preserved exactly as they are in the remote snapshot.
 */
export function mergeProjectEstimateScalarsIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
  projectId: string,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const targetId = String(projectId || '').trim()
  if (!targetId) return merged

  const remoteProjects = Array.isArray(merged.projects) ? merged.projects : []
  const remoteIndex = remoteProjects.findIndex((p: any) => String(p?.id || '') === targetId)
  if (remoteIndex === -1) return merged

  const incomingProjects = Array.isArray(incomingBackup?.projects) ? incomingBackup.projects : []
  const incomingProject: any = incomingProjects.find((p: any) => String(p?.id || '') === targetId)
  if (!incomingProject) return merged

  const remoteProject: any = remoteProjects[remoteIndex]
  const remoteStamps: Record<string, any> = (remoteProject.estimateScalarUpdatedAt && typeof remoteProject.estimateScalarUpdatedAt === 'object')
    ? remoteProject.estimateScalarUpdatedAt
    : {}
  const incomingStamps: Record<string, any> = (incomingProject.estimateScalarUpdatedAt && typeof incomingProject.estimateScalarUpdatedAt === 'object')
    ? incomingProject.estimateScalarUpdatedAt
    : {}

  // Start from remote metadata so unknown/legacy keys are preserved, never deleted.
  const nextStamps: Record<string, any> = { ...remoteStamps }

  for (const field of ESTIMATE_SCALAR_FIELDS) {
    const remoteTs = comparableMs(remoteStamps[field])
    const incomingTs = comparableMs(incomingStamps[field])
    if (incomingTs > remoteTs) {
      remoteProject[field] = incomingProject[field]
      if (isValidDateString(incomingStamps[field])) {
        nextStamps[field] = String(incomingStamps[field])
      }
    }
    // tie or incoming older: keep remote value + remote timestamp (already in nextStamps)
  }

  remoteProject.estimateScalarUpdatedAt = nextStamps
  return merged
}

// ── Project estimate labor phase colors (Phase 6L-B / 6S-E) ───────────────────
// UI metadata for Estimate labor phase headers. Per-phase LWW keyed by
// projects[].laborPhaseColorUpdatedAt[phaseKey]. Kept separate from estimate
// scalar/row merges; never touches progressPhaseColors (project.progress scope).

export function normalizeLaborPhaseColorKey(phaseKey: unknown): string {
  return String(phaseKey ?? '').trim().toLowerCase()
}

function isBlankLaborPhaseColor(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

function getLaborPhaseColorValue(project: any, phaseKey: string): string | undefined {
  const normalized = normalizeLaborPhaseColorKey(phaseKey)
  const map = project?.laborPhaseColors && typeof project.laborPhaseColors === 'object'
    ? project.laborPhaseColors
    : {}
  for (const [key, value] of Object.entries(map)) {
    if (normalizeLaborPhaseColorKey(key) === normalized && !isBlankLaborPhaseColor(value)) {
      return String(value)
    }
  }
  return undefined
}

function getLaborPhaseColorUpdatedAt(project: any, phaseKey: string): string | undefined {
  const normalized = normalizeLaborPhaseColorKey(phaseKey)
  const stamps = project?.laborPhaseColorUpdatedAt && typeof project.laborPhaseColorUpdatedAt === 'object'
    ? project.laborPhaseColorUpdatedAt
    : {}
  for (const [key, value] of Object.entries(stamps)) {
    if (normalizeLaborPhaseColorKey(key) === normalized && isValidDateString(value)) {
      return String(value)
    }
  }
  return undefined
}

/** Stamp only the edited labor phase color timestamp. Preserves every other field. */
export function stampLaborPhaseColor(project: any, phaseKey: string, timestamp?: string): any {
  const phase = String(phaseKey ?? '').trim()
  if (!project || typeof project !== 'object' || !phase) return project
  const ts = isValidDateString(timestamp) ? String(timestamp) : new Date().toISOString()
  project.laborPhaseColorUpdatedAt = {
    ...(project.laborPhaseColorUpdatedAt && typeof project.laborPhaseColorUpdatedAt === 'object'
      ? project.laborPhaseColorUpdatedAt
      : {}),
    [phase]: ts,
  }
  return project
}

function collectLaborPhaseColorKeys(remoteProject: any, incomingProject: any): string[] {
  const keys: string[] = []
  const add = (key: unknown) => {
    const label = String(key ?? '').trim()
    const norm = normalizeLaborPhaseColorKey(label)
    if (!norm || keys.some(existing => normalizeLaborPhaseColorKey(existing) === norm)) return
    keys.push(label)
  }
  const addFromProject = (project: any) => {
    const colors = project?.laborPhaseColors && typeof project.laborPhaseColors === 'object'
      ? project.laborPhaseColors
      : {}
    const stamps = project?.laborPhaseColorUpdatedAt && typeof project.laborPhaseColorUpdatedAt === 'object'
      ? project.laborPhaseColorUpdatedAt
      : {}
    Object.keys(colors).forEach(add)
    Object.keys(stamps).forEach(add)
  }
  addFromProject(remoteProject)
  addFromProject(incomingProject)
  return keys
}

function resolveLaborPhaseColorField(
  phaseKey: string,
  remoteProject: any,
  incomingProject: any,
  preferIncomingOnTie: boolean,
): { value?: string; label: string; updatedAt?: string } {
  const remoteValue = getLaborPhaseColorValue(remoteProject, phaseKey)
  const incomingValue = getLaborPhaseColorValue(incomingProject, phaseKey)
  const remoteHas = !isBlankLaborPhaseColor(remoteValue)
  const incomingHas = !isBlankLaborPhaseColor(incomingValue)
  const remoteTs = comparableMs(getLaborPhaseColorUpdatedAt(remoteProject, phaseKey))
  const incomingTs = comparableMs(getLaborPhaseColorUpdatedAt(incomingProject, phaseKey))

  let incomingWins: boolean
  if (incomingTs > remoteTs) incomingWins = true
  else if (remoteTs > incomingTs) incomingWins = false
  else incomingWins = preferIncomingOnTie ? (incomingHas || !remoteHas) : (remoteHas || !incomingHas)

  // Never wipe a remote defined color with an incoming blank.
  if (incomingWins && !incomingHas && remoteHas) incomingWins = false

  const winner = incomingWins ? incomingValue : remoteValue
  const loser = incomingWins ? remoteValue : incomingValue
  const value = !isBlankLaborPhaseColor(winner)
    ? winner
    : (!isBlankLaborPhaseColor(loser) ? loser : undefined)
  const stamp = incomingWins
    ? getLaborPhaseColorUpdatedAt(incomingProject, phaseKey)
    : getLaborPhaseColorUpdatedAt(remoteProject, phaseKey)
  return { value, label: String(phaseKey).trim(), updatedAt: stamp }
}

export function mergeLaborPhaseColorMaps(
  remoteProject: any,
  incomingProject: any,
  preferIncomingOnTie = true,
): { colors: Record<string, string>; updatedAt: Record<string, string> } {
  const keys = collectLaborPhaseColorKeys(remoteProject, incomingProject)
  const colors: Record<string, string> = {}
  const updatedAt: Record<string, string> = {}
  for (const key of keys) {
    const resolved = resolveLaborPhaseColorField(key, remoteProject, incomingProject, preferIncomingOnTie)
    if (isBlankLaborPhaseColor(resolved.value)) continue
    colors[resolved.label] = resolved.value!
    if (resolved.updatedAt) updatedAt[resolved.label] = resolved.updatedAt
  }
  return { colors, updatedAt }
}

function patchLaborPhaseColorFields(
  targetProject: any,
  remoteProject: any,
  incomingProject: any,
  preferIncomingOnTie = true,
): void {
  const merged = mergeLaborPhaseColorMaps(remoteProject, incomingProject, preferIncomingOnTie)
  targetProject.laborPhaseColors = merged.colors
  targetProject.laborPhaseColorUpdatedAt = {
    ...(targetProject.laborPhaseColorUpdatedAt && typeof targetProject.laborPhaseColorUpdatedAt === 'object'
      ? targetProject.laborPhaseColorUpdatedAt
      : {}),
    ...merged.updatedAt,
  }
}

export function mergeProjectLaborPhaseColorsIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
  projectId: string,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const targetId = String(projectId || '').trim()
  if (!targetId) return merged

  const remoteProjects = Array.isArray(merged.projects) ? merged.projects : []
  const remoteIndex = remoteProjects.findIndex((p: any) => String(p?.id || '') === targetId)
  if (remoteIndex === -1) return merged

  const incomingProjects = Array.isArray(incomingBackup?.projects) ? incomingBackup.projects : []
  const incomingProject: any = incomingProjects.find((p: any) => String(p?.id || '') === targetId)
  if (!incomingProject) return merged

  const remoteProject: any = remoteProjects[remoteIndex]
  patchLaborPhaseColorFields(remoteProject, remoteProject, incomingProject, true)
  return merged
}

export function mergeAllProjectLaborPhaseColorsIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(incomingBackup)) as BackupData
  const remoteById = new Map<string, any>()
  for (const rp of Array.isArray(remoteBackup?.projects) ? remoteBackup.projects : []) {
    const id = String(rp?.id || '').trim()
    if (id) remoteById.set(id, rp)
  }
  for (const mp of Array.isArray(merged.projects) ? merged.projects : []) {
    const id = String(mp?.id || '').trim()
    if (!id) continue
    const remoteProject = remoteById.get(id)
    if (!remoteProject) continue
    patchLaborPhaseColorFields(mp, remoteProject, mp, false)
  }
  return merged
}

export function mergeRemoteLaborPhaseColorsIntoOutgoing(
  outgoingBackup: BackupData,
  remoteBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(outgoingBackup)) as BackupData
  const remoteById = new Map<string, any>()
  for (const rp of Array.isArray(remoteBackup?.projects) ? remoteBackup.projects : []) {
    const id = String(rp?.id || '').trim()
    if (id) remoteById.set(id, rp)
  }
  for (const op of Array.isArray(merged.projects) ? merged.projects : []) {
    const id = String(op?.id || '').trim()
    if (!id) continue
    const remoteProject = remoteById.get(id)
    if (!remoteProject) continue
    patchLaborPhaseColorFields(op, remoteProject, op, false)
  }
  return merged
}

// ── Estimate version history (Phase 6S-F) ─────────────────────────────────────
// Top-level BackupData.estimateVersions[projectId][] — immutable laborRows/ohRows
// snapshots. Separate from project.estimate live row/scalar merge.

const MAX_ESTIMATE_VERSIONS = 5

function estimateVersionsMap(backup: BackupData | null | undefined): Record<string, BackupEstimateVersion[]> {
  const raw = (backup as any)?.estimateVersions
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

function comparableVersionMs(version: any): number {
  const updated = comparableMs(version?.updatedAt)
  if (updated > Number.NEGATIVE_INFINITY) return updated
  const created = comparableMs(version?.createdAt)
  if (created > Number.NEGATIVE_INFINITY) return created
  const ts = Number(version?.ts)
  return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY
}

function sortEstimateVersionsNewestFirst(a: BackupEstimateVersion, b: BackupEstimateVersion): number {
  return comparableVersionMs(b) - comparableVersionMs(a)
}

export function getEstimateVersionIdentity(version: any): string {
  const id = String(version?.versionId || '').trim()
  if (id) return id
  const ts = Number(version?.ts) || 0
  const laborCount = Number(version?.laborCount) || 0
  const ohCount = Number(version?.ohCount) || 0
  const total = Math.round(Number(version?.total) || 0)
  return `ev_legacy_${ts}_${laborCount}_${ohCount}_${total}`
}

export function ensureEstimateVersionIdentity(
  version: any,
  timestamp?: string,
): BackupEstimateVersion {
  const now = timestamp || new Date().toISOString()
  const ts = Number(version?.ts)
  const resolvedTs = Number.isFinite(ts) ? ts : (Date.parse(now) || Date.now())
  const laborCount = Number(version?.laborCount) || 0
  const ohCount = Number(version?.ohCount) || 0
  const total = Number(version?.total) || 0
  const roundedTotal = Math.round(total)
  const versionId = String(version?.versionId || '').trim()
    || `ev_${resolvedTs}_${laborCount}_${ohCount}_${roundedTotal}`

  return {
    ...version,
    versionId,
    ts: resolvedTs,
    total,
    laborCount,
    ohCount,
    laborRows: Array.isArray(version?.laborRows) ? version.laborRows : [],
    ohRows: Array.isArray(version?.ohRows) ? version.ohRows : [],
    createdAt: isValidDateString(version?.createdAt)
      ? String(version.createdAt)
      : new Date(resolvedTs).toISOString(),
    updatedAt: isValidDateString(version?.updatedAt) ? String(version.updatedAt) : now,
  }
}

export function isDeletedEstimateVersion(version: any): boolean {
  if (isValidDateString(version?.deletedAt)) return true
  return String(version?.status || '').toLowerCase().trim() === 'deleted'
}

export function createEstimateVersionTombstone(
  version: any,
  deletedBy?: string,
): BackupEstimateVersion {
  const now = new Date().toISOString()
  const base = ensureEstimateVersionIdentity(version, now)
  const tombstone: BackupEstimateVersion = {
    ...base,
    deletedAt: now,
    updatedAt: now,
    status: 'deleted',
  }
  if (deletedBy) tombstone.deletedBy = deletedBy
  else if (base.deletedBy) tombstone.deletedBy = base.deletedBy
  return tombstone
}

function pickEstimateVersionWinner(
  remote: BackupEstimateVersion,
  incoming: BackupEstimateVersion,
  preferIncomingOnTie: boolean,
): BackupEstimateVersion {
  const remoteDeleted = isDeletedEstimateVersion(remote)
  const incomingDeleted = isDeletedEstimateVersion(incoming)

  if (remoteDeleted && incomingDeleted) {
    return comparableMs(incoming.deletedAt) > comparableMs(remote.deletedAt) ? incoming : remote
  }

  if (remoteDeleted !== incomingDeleted) {
    const tombstone = remoteDeleted ? remote : incoming
    const live = remoteDeleted ? incoming : remote
    return comparableVersionMs(live) > comparableMs(tombstone.deletedAt) ? live : tombstone
  }

  const remoteMs = comparableVersionMs(remote)
  const incomingMs = comparableVersionMs(incoming)
  if (incomingMs > remoteMs) return incoming
  if (remoteMs > incomingMs) return remote
  return preferIncomingOnTie ? incoming : remote
}

/** Preserve immutable snapshot payload; merge name/notes from newer updatedAt side. */
function mergeEstimateVersionPair(
  remote: BackupEstimateVersion,
  incoming: BackupEstimateVersion,
  preferIncomingOnTie: boolean,
): BackupEstimateVersion {
  const winner = pickEstimateVersionWinner(remote, incoming, preferIncomingOnTie)
  const remoteMs = comparableVersionMs(remote)
  const incomingMs = comparableVersionMs(incoming)
  const metaNewer = incomingMs >= remoteMs ? incoming : remote
  const metaOlder = incomingMs >= remoteMs ? remote : incoming

  const payloadSource =
    (Array.isArray(winner.laborRows) && winner.laborRows.length > 0)
      ? winner
      : (Array.isArray(remote.laborRows) && remote.laborRows.length > 0)
        ? remote
        : incoming

  const resolvedName = Object.prototype.hasOwnProperty.call(metaNewer, 'name')
    ? metaNewer.name
    : (Object.prototype.hasOwnProperty.call(metaOlder, 'name')
      ? metaOlder.name
      : winner.name)
  const resolvedNotes = Object.prototype.hasOwnProperty.call(metaNewer, 'notes')
    ? metaNewer.notes
    : (Object.prototype.hasOwnProperty.call(metaOlder, 'notes')
      ? metaOlder.notes
      : winner.notes)

  return {
    ...winner,
    laborRows: Array.isArray(payloadSource.laborRows) ? payloadSource.laborRows : [],
    ohRows: Array.isArray(payloadSource.ohRows) ? payloadSource.ohRows : [],
    ts: payloadSource.ts ?? winner.ts,
    total: payloadSource.total ?? winner.total,
    laborCount: payloadSource.laborCount ?? winner.laborCount,
    ohCount: payloadSource.ohCount ?? winner.ohCount,
    name: resolvedName,
    notes: resolvedNotes,
  }
}

export function getEstimateVersionDisplayLabel(version: any): string {
  const name = String(version?.name || '').trim()
  if (name) return name
  const ts = Number(version?.ts)
  if (Number.isFinite(ts) && ts > 0) return new Date(ts).toLocaleString()
  return 'Saved snapshot'
}

function applyEstimateVersionCap(versions: BackupEstimateVersion[]): BackupEstimateVersion[] {
  const tombstones = versions.filter(isDeletedEstimateVersion)
  const live = versions.filter(v => !isDeletedEstimateVersion(v))
  live.sort(sortEstimateVersionsNewestFirst)
  const cappedLive = live.slice(0, MAX_ESTIMATE_VERSIONS)
  return [...cappedLive, ...tombstones].sort(sortEstimateVersionsNewestFirst)
}

export function mergeEstimateVersionArrays(
  remoteVersions: any[],
  incomingVersions: any[],
  preferIncomingOnTie = true,
): BackupEstimateVersion[] {
  const remoteSanitized = (Array.isArray(remoteVersions) ? remoteVersions : [])
    .map(v => ensureEstimateVersionIdentity(v))
  const incomingSanitized = (Array.isArray(incomingVersions) ? incomingVersions : [])
    .map(v => ensureEstimateVersionIdentity(v))

  const remoteById = new Map<string, BackupEstimateVersion>()
  for (const ver of remoteSanitized) remoteById.set(getEstimateVersionIdentity(ver), ver)

  const result: BackupEstimateVersion[] = []
  const used = new Set<string>()

  for (const incoming of incomingSanitized) {
    const id = getEstimateVersionIdentity(incoming)
    if (used.has(id)) continue
    used.add(id)
    const remote = remoteById.get(id)
    result.push(remote ? mergeEstimateVersionPair(remote, incoming, preferIncomingOnTie) : incoming)
  }

  for (const remote of remoteSanitized) {
    const id = getEstimateVersionIdentity(remote)
    if (used.has(id)) continue
    used.add(id)
    result.push(remote)
  }

  result.sort(sortEstimateVersionsNewestFirst)
  return applyEstimateVersionCap(result)
}

export function getVisibleEstimateVersions(versions: any[]): BackupEstimateVersion[] {
  return (Array.isArray(versions) ? versions : [])
    .map(v => ensureEstimateVersionIdentity(v))
    .filter(v => !isDeletedEstimateVersion(v))
    .sort(sortEstimateVersionsNewestFirst)
    .slice(0, MAX_ESTIMATE_VERSIONS)
}

export function mergeEstimateVersionsIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
  projectId: string,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const targetId = String(projectId || '').trim()
  if (!targetId) return merged

  const remoteMap = estimateVersionsMap(remoteBackup)
  const incomingMap = estimateVersionsMap(incomingBackup)
  const remoteVersions = Array.isArray(remoteMap[targetId]) ? remoteMap[targetId] : []
  const incomingVersions = Array.isArray(incomingMap[targetId]) ? incomingMap[targetId] : []

  if (!(merged as any).estimateVersions) (merged as any).estimateVersions = {}
  ;(merged as any).estimateVersions[targetId] = mergeEstimateVersionArrays(
    remoteVersions,
    incomingVersions,
    true,
  )
  return merged
}

export function mergeAllEstimateVersionsIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(incomingBackup)) as BackupData
  const remoteMap = estimateVersionsMap(remoteBackup)
  const incomingMap = estimateVersionsMap(incomingBackup)
  const allProjectIds = new Set([
    ...Object.keys(remoteMap),
    ...Object.keys(incomingMap),
  ])

  if (!(merged as any).estimateVersions) (merged as any).estimateVersions = {}

  for (const projectId of allProjectIds) {
    const remoteVersions = Array.isArray(remoteMap[projectId]) ? remoteMap[projectId] : []
    const incomingVersions = Array.isArray(incomingMap[projectId]) ? incomingMap[projectId] : []
    ;(merged as any).estimateVersions[projectId] = mergeEstimateVersionArrays(
      remoteVersions,
      incomingVersions,
      false,
    )
  }

  return merged
}

export function mergeRemoteEstimateVersionsIntoOutgoing(
  outgoingBackup: BackupData,
  remoteBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(outgoingBackup)) as BackupData
  const outgoingMap = estimateVersionsMap(merged)
  const remoteMap = estimateVersionsMap(remoteBackup)
  const allProjectIds = new Set([
    ...Object.keys(outgoingMap),
    ...Object.keys(remoteMap),
  ])

  const nextMap: Record<string, BackupEstimateVersion[]> = { ...outgoingMap }
  for (const projectId of allProjectIds) {
    const outgoingVersions = Array.isArray(outgoingMap[projectId]) ? outgoingMap[projectId] : []
    const remoteVersions = Array.isArray(remoteMap[projectId]) ? remoteMap[projectId] : []
    // Remote passed as incoming so remote wins non-explicit-save ties (protect remote).
    nextMap[projectId] = mergeEstimateVersionArrays(outgoingVersions, remoteVersions, true)
  }

  ;(merged as any).estimateVersions = nextMap
  return merged
}

// ── Project logs + embedded payments (Phase 6N) ────────────────────────────────
// Top-level BackupData.logs[] rows, scoped by projId. A project "payment" is the
// `collected` field ON a log row — there is no separate payment entity — so the
// whole row is the merge unit and `collected` always travels with it. Delete-safe
// (deletedAt/deletedBy tombstones); winner = newest updatedAt, tombstone beats an
// equal-or-older live edit. Merges ONLY the target project's slice; every other
// project's log rows are carried through from remote untouched.

export interface ProjectLog {
  logId?: string
  id?: string
  projId?: string
  projectId?: string
  projName?: string
  phase?: string
  date?: string
  emp?: string
  empId?: string
  hrs?: number
  miles?: number
  mat?: number
  collected?: number
  store?: string
  emergencyMatInfo?: unknown
  detailLink?: string
  notes?: string
  quoted?: number
  profit?: number
  projectQuote?: number
  createdAt?: string
  updatedAt?: string
  deletedAt?: string
  deletedBy?: string
  archivedAt?: string
  status?: string
  [key: string]: any
}

export type LogIdentityContext = {
  duplicateLegacyKeys: ReadonlySet<string>
}

export type MergeableProjectLog = ProjectLog & {
  logId: string
  updatedAt: string
}

/** projId is primary; projectId (camelCase) supported defensively for legacy readers. */
export function logProjectId(log: any): string {
  return normalizeEstimateText(log?.projId || log?.projectId)
}

function timestampFromLogId(log: any): string | null {
  const candidates = [log?.id, log?.logId]
  for (const candidate of candidates) {
    const text = normalizeEstimateText(candidate)
    const match = text.match(/(\d{13})/)
    if (!match) continue
    const ms = Number(match[1])
    if (!Number.isFinite(ms)) continue
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}

function legacyLogIdentityBase(log: any, projectId?: string): string {
  const legacyId = normalizeEstimateText(log?.id || 'missing') || 'missing'
  return `legacy:${normalizeProjectId(projectId)}:logs:${legacyId}`
}

function stableLogFingerprint(log: any): string {
  const parts = [
    log?.id,
    log?.projId,
    log?.projectId,
    log?.date,
    log?.empId,
    log?.emp,
    log?.hrs,
    log?.miles,
    log?.mat,
    log?.collected,
    log?.notes,
    log?.phase,
    log?.store,
  ].map(value => normalizeEstimateText(value))
  return shortStableHash(parts.join('|'))
}

export function createLogIdentityContext(logs: any[], projectId?: string): LogIdentityContext {
  const counts = new Map<string, number>()
  for (const log of Array.isArray(logs) ? logs : []) {
    if (normalizeEstimateText(log?.logId)) continue
    const base = legacyLogIdentityBase(log, projectId)
    counts.set(base, (counts.get(base) || 0) + 1)
  }
  const duplicateLegacyKeys = new Set<string>()
  for (const [base, count] of counts) {
    if (count > 1) duplicateLegacyKeys.add(base)
  }
  return { duplicateLegacyKeys }
}

export function getLogStableId(
  log: any,
  projectId?: string,
  duplicateContext?: LogIdentityContext,
): string {
  const existing = normalizeEstimateText(log?.logId)
  if (existing) return existing
  const base = legacyLogIdentityBase(log, projectId)
  if (duplicateContext?.duplicateLegacyKeys?.has(base)) {
    return `${base}:${stableLogFingerprint(log)}`
  }
  return base
}

export function normalizeLogCreatedAt(log: any): string {
  if (isValidDateString(log?.createdAt)) return String(log.createdAt)
  const fromId = timestampFromLogId(log)
  if (fromId) return fromId
  if (isValidDateString(log?.date)) return String(log.date)
  return EPOCH_FALLBACK_ISO
}

export function normalizeLogUpdatedAt(log: any): string {
  let base: string
  if (isValidDateString(log?.updatedAt)) base = String(log.updatedAt)
  else if (isValidDateString(log?.createdAt)) base = String(log.createdAt)
  else base = timestampFromLogId(log) || (isValidDateString(log?.date) ? String(log.date) : EPOCH_FALLBACK_ISO)

  if (isValidDateString(log?.deletedAt) && parseTimestampMs(log.deletedAt) > parseTimestampMs(base)) {
    return String(log.deletedAt)
  }
  return base
}

export function sanitizeLogForMerge(
  log: any,
  projectId?: string,
  duplicateContext?: LogIdentityContext,
): MergeableProjectLog | null {
  if (!log || typeof log !== 'object') return null
  const logId = getLogStableId(log, projectId, duplicateContext)
  if (!logId) return null
  return {
    ...log,
    logId,
    createdAt: normalizeLogCreatedAt(log),
    updatedAt: normalizeLogUpdatedAt(log),
  } as MergeableProjectLog
}

/** Tombstone marker for merge winner logic (needs a deletedAt timestamp). */
export function isDeletedLog(log: any): boolean {
  return isValidDateString(log?.deletedAt)
}

/** Broader "not live" test for UI/financial filtering (deleted OR archived OR void). */
export function isDeadProjectLog(log: any): boolean {
  if (!log) return true
  if (isValidDateString(log?.deletedAt)) return true
  if (isValidDateString(log?.archivedAt)) return true
  if (log?.archived === true || log?.isArchived === true || log?.deleted === true || log?.isDeleted === true) return true
  const status = String(log?.status || log?.logStatus || '').trim().toLowerCase()
  return status === 'archived' || status === 'deleted' || status === 'void'
}

/** Live (non-tombstoned, non-archived) logs for one project, from a raw logs[] array. */
export function getLiveProjectLogsFromArray(logs: any[], projectId?: string): ProjectLog[] {
  const target = normalizeEstimateText(projectId)
  const context = createLogIdentityContext(logs, projectId)
  const out: ProjectLog[] = []
  for (const log of Array.isArray(logs) ? logs : []) {
    if (target && logProjectId(log) !== target) continue
    const clean = sanitizeLogForMerge(log, projectId, context)
    if (!clean || isDeadProjectLog(clean)) continue
    out.push(clean)
  }
  return out
}

export function createLogTombstone(existingLog: any, projectId?: string, deletedBy?: string): ProjectLog {
  const context = createLogIdentityContext([existingLog], projectId)
  const clean = sanitizeLogForMerge(existingLog, projectId, context) || existingLog || {}
  const now = new Date().toISOString()
  const tombstone: ProjectLog = {
    ...clean,
    logId: getLogStableId(clean, projectId, context),
    deletedAt: now,
    updatedAt: now,
  }
  if (deletedBy) tombstone.deletedBy = deletedBy
  else if (clean?.deletedBy) tombstone.deletedBy = clean.deletedBy
  return tombstone
}

export function mergeLogsByStableId(
  remoteLogs: any[],
  incomingLogs: any[],
  projectId?: string,
): ProjectLog[] {
  const combinedContext = createLogIdentityContext(
    [
      ...(Array.isArray(remoteLogs) ? remoteLogs : []),
      ...(Array.isArray(incomingLogs) ? incomingLogs : []),
    ],
    projectId,
  )
  const remoteSanitized = (Array.isArray(remoteLogs) ? remoteLogs : [])
    .map(log => sanitizeLogForMerge(log, projectId, combinedContext))
    .filter((log): log is MergeableProjectLog => log != null)
  const incomingSanitized = (Array.isArray(incomingLogs) ? incomingLogs : [])
    .map(log => sanitizeLogForMerge(log, projectId, combinedContext))
    .filter((log): log is MergeableProjectLog => log != null)

  const remoteById = new Map<string, MergeableProjectLog>()
  for (const log of remoteSanitized) remoteById.set(String(log.logId), log)

  const result: ProjectLog[] = []
  const used = new Set<string>()

  // Incoming order first (preserves local ordering), then remote-only rows.
  for (const incoming of incomingSanitized) {
    const id = String(incoming.logId)
    if (used.has(id)) continue
    used.add(id)
    const remote = remoteById.get(id)
    result.push(remote ? pickEstimateRowWinner(remote, incoming) : incoming)
  }
  for (const remote of remoteSanitized) {
    const id = String(remote.logId)
    if (used.has(id)) continue
    used.add(id)
    result.push(remote)
  }

  return result
}

/**
 * Merge the target project's slice of the top-level logs[] from incomingBackup
 * into a fresh clone of remoteBackup. All logs belonging to OTHER projects are
 * carried through from remote unchanged; only the target project's rows are
 * reconciled row-by-row (delete-safe LWW). Nothing else in BackupData is touched.
 */
export function mergeProjectLogsIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
  projectId: string,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const targetId = String(projectId || '').trim()
  if (!targetId) return merged

  const remoteLogs = Array.isArray(merged.logs) ? merged.logs : []
  const incomingLogs = Array.isArray(incomingBackup?.logs) ? incomingBackup.logs : []

  const remoteTarget: any[] = []
  const remoteOther: any[] = []
  for (const log of remoteLogs) {
    if (logProjectId(log) === targetId) remoteTarget.push(log)
    else remoteOther.push(log)
  }
  const incomingTarget = incomingLogs.filter((log: any) => logProjectId(log) === targetId)

  const mergedTarget = mergeLogsByStableId(remoteTarget, incomingTarget, targetId)

  // Other projects' logs (from remote) preserved as-is; target slice replaced.
  merged.logs = [...remoteOther, ...mergedTarget]
  return merged
}

// ── Project lifecycle: soft-delete (Phase 6Q) ──────────────────────────────────
// Project deletion is delete-safe: instead of hard-removing the project from
// projects[] (and hard-filtering its logs), deleteProject stamps the project with
// deletedAt/deletedBy/status='deleted'. This module patches ONLY those lifecycle
// fields onto the matching remote project; every child array, the top-level logs[],
// all other projects, serviceLogs, and blueprint data are preserved untouched.
// Child-record cascade tombstoning and a hard purge are deferred to a later phase.

/** True when a project carries a soft-delete tombstone (deletedAt) or status 'deleted'. */
export function isDeletedProject(project: any): boolean {
  if (!project) return false
  if (isValidDateString(project?.deletedAt)) return true
  return String(project?.status || '').trim().toLowerCase() === 'deleted'
}

/**
 * Return a copy of `project` marked soft-deleted. Every existing field and child
 * array is preserved; only lifecycle metadata is added/updated. Idempotent: an
 * existing deletedAt is kept so re-deleting doesn't reset the tombstone.
 */
export function createProjectTombstone(project: any, deletedBy?: string): any {
  const now = new Date().toISOString()
  const existingDeletedAt = isValidDateString(project?.deletedAt) ? String(project.deletedAt) : null
  return {
    ...project,
    deletedAt: existingDeletedAt || now,
    deletedBy: deletedBy || project?.deletedBy || 'system',
    status: 'deleted',
    updatedAt: now,
  }
}

/**
 * Merge project soft-delete lifecycle fields from `incomingBackup` into a fresh
 * clone of `remoteBackup` for a single project. Patches ONLY deletedAt/deletedBy/
 * status/updatedAt onto the matching remote project. All remote child arrays, the
 * top-level logs[], every other project, serviceLogs, and blueprint data are left
 * exactly as they are in the remote snapshot.
 */
export function mergeProjectLifecycleIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
  projectId: string,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const targetId = String(projectId || '').trim()
  if (!targetId) return merged

  const incomingProjects = Array.isArray(incomingBackup?.projects) ? incomingBackup.projects : []
  const incomingProject: any = incomingProjects.find((p: any) => String(p?.id || '') === targetId)
  if (!incomingProject) return merged

  const remoteProjects = Array.isArray(merged.projects) ? merged.projects : []
  const remoteIndex = remoteProjects.findIndex((p: any) => String(p?.id || '') === targetId)

  if (remoteIndex === -1) {
    // Remote has no such project (already gone / never synced). Append the incoming
    // soft-deleted project so the tombstone still propagates, matching the additive
    // convention used by the log/item merges (incoming-only rows are carried through).
    if (Array.isArray(merged.projects)) merged.projects.push(incomingProject)
    else (merged as any).projects = [incomingProject]
    return merged
  }

  const remoteProject: any = remoteProjects[remoteIndex]
  remoteProject.deletedAt = incomingProject.deletedAt
  remoteProject.deletedBy = incomingProject.deletedBy
  remoteProject.status = incomingProject.status
  if (isValidDateString(incomingProject.updatedAt)) {
    remoteProject.updatedAt = incomingProject.updatedAt
  }
  return merged
}

// ── Project finance scalar fields (Phase 6S-A) ─────────────────────────────────
// Money-critical values live on the untyped projects[].finance bucket. A broad
// projects[] save from an unrelated tab can carry a STALE finance bucket and
// clobber a newer remote value (e.g. manualPaidAdjustment set on another device,
// which feeds getProjectFinancials paid → AR/exposure/risk → Dashboard/MoneyPanel/
// Home). This section adds a per-field last-writer-wins merge keyed by a
// projects[].financeUpdatedAt map. It NEVER touches logs[] (project.logs owns
// logs[].collected), service payments, estimate rows/scalars, or project lifecycle.
// Only FINANCE_SCALAR_FIELDS values and the financeUpdatedAt map are read/written.

export type FinanceScalarField =
  | 'manualPaidAdjustment'
  | 'lastCollectedAt'
  | 'billedOverride'
  | 'contractOverride'
  | 'matCostOverride'

/** The only projects[].finance fields this merge is allowed to read/patch. */
export const FINANCE_SCALAR_FIELDS: readonly FinanceScalarField[] = [
  'manualPaidAdjustment',
  'lastCollectedAt',
  'billedOverride',
  'contractOverride',
  'matCostOverride',
]

export type FinanceUpdatedAt = Partial<Record<string, string>>

function asFinanceObject(value: any): Record<string, any> {
  return value && typeof value === 'object' ? value : {}
}

/** A finance field counts as "present" only when it holds a real, non-blank value. */
function hasFinanceValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string' && value.trim() === '') return false
  return true
}

/**
 * Stamp a single finance field's LWW timestamp on a project (mutates and returns
 * the same project, matching the tombstone/estimate-scalar helper style). Ensures
 * the financeUpdatedAt map exists and only ever writes financeUpdatedAt[fieldName].
 * Provided for a future finance-editing UI; the current broad savers never mutate
 * finance themselves, so protection is purely defensive (remote-wins LWW).
 */
export function stampProjectFinanceField(project: any, fieldName: string, timestamp?: string): any {
  if (!project || typeof project !== 'object') return project
  const stamps = asFinanceObject(project.financeUpdatedAt)
  const ts = isValidDateString(timestamp) ? String(timestamp) : new Date().toISOString()
  project.financeUpdatedAt = { ...stamps, [fieldName]: ts }
  return project
}

/**
 * Resolve one project's finance scalar fields by per-field LWW, writing the winner
 * onto `targetProject` (already a clone). Winner rules:
 *  - Strictly-newer financeUpdatedAt wins that field (value + timestamp copied).
 *  - On a timestamp tie (commonly BOTH missing → legacy/imported data), the side
 *    that actually has a value wins; if both/neither, the incoming/target value is
 *    kept. This protects a remote legacy finance value from a local blank.
 *  - A value is NEVER wiped: if the winner has no value, the target keeps whatever
 *    it already had (no delete of a finance value with a stale undefined).
 * Only FINANCE_SCALAR_FIELDS + financeUpdatedAt are touched; every other finance
 * key (contract/paid/billed/exposure/etc.) on the target is preserved untouched.
 */
function resolveProjectFinanceLWW(targetProject: any, remoteProject: any, incomingProject: any): void {
  const remoteFin = asFinanceObject(remoteProject?.finance)
  const incomingFin = asFinanceObject(incomingProject?.finance)
  const remoteStamps = asFinanceObject(remoteProject?.financeUpdatedAt)
  const incomingStamps = asFinanceObject(incomingProject?.financeUpdatedAt)

  // Base off the target's own current values so unrelated finance keys survive.
  const nextFinance: Record<string, any> = { ...asFinanceObject(targetProject.finance) }
  const nextStamps: Record<string, any> = { ...asFinanceObject(targetProject.financeUpdatedAt) }

  for (const field of FINANCE_SCALAR_FIELDS) {
    const remoteTs = comparableMs(remoteStamps[field])
    const incomingTs = comparableMs(incomingStamps[field])
    const remoteHasVal = hasFinanceValue(remoteFin[field])
    const incomingHasVal = hasFinanceValue(incomingFin[field])

    let winnerIsRemote: boolean
    if (remoteTs > incomingTs) winnerIsRemote = true
    else if (incomingTs > remoteTs) winnerIsRemote = false
    else winnerIsRemote = !incomingHasVal && remoteHasVal // tie: never wipe a remote value with a local blank

    if (winnerIsRemote) {
      if (remoteHasVal) nextFinance[field] = remoteFin[field]
      if (isValidDateString(remoteStamps[field])) nextStamps[field] = String(remoteStamps[field])
    } else {
      if (incomingHasVal) nextFinance[field] = incomingFin[field]
      if (isValidDateString(incomingStamps[field])) nextStamps[field] = String(incomingStamps[field])
    }
  }

  targetProject.finance = nextFinance
  targetProject.financeUpdatedAt = nextStamps
}

/**
 * Single-project finance merge (remote-based, faithful to the estimate-scalar
 * pattern): returns a clone of `remoteBackup` with ONLY the target project's
 * finance scalar fields resolved by LWW against `incomingBackup`. Suitable for a
 * save site where ONLY finance changed. Every other field and every other project
 * is the remote snapshot, untouched.
 */
export function mergeProjectFinanceIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
  projectId: string,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const targetId = String(projectId || '').trim()
  if (!targetId) return merged

  const remoteProjects = Array.isArray(merged.projects) ? merged.projects : []
  const remoteIndex = remoteProjects.findIndex((p: any) => String(p?.id || '') === targetId)
  if (remoteIndex === -1) return merged

  const incomingProjects = Array.isArray(incomingBackup?.projects) ? incomingBackup.projects : []
  const incomingProject: any = incomingProjects.find((p: any) => String(p?.id || '') === targetId)
  if (!incomingProject) return merged

  const remoteProject: any = remoteProjects[remoteIndex]
  resolveProjectFinanceLWW(remoteProject, remoteProject, incomingProject)
  return merged
}

/**
 * Broad-saver finance guard (INCOMING-based): returns a clone of `incomingBackup`
 * so EVERY local project edit — status/archive/name/progress/logs/etc. — is
 * preserved exactly as today's broad save would push it, with each project's
 * finance scalar fields reconciled against `remoteBackup` by per-field LWW. This
 * is what V15rProjectsPanel/V15rProgressTab use so a stale local finance bucket can
 * never overwrite a newer remote finance value, and a remote legacy/imported value
 * (no financeUpdatedAt yet) is never wiped by a local blank. Only finance +
 * financeUpdatedAt are reconciled; all other data comes straight from incoming.
 */
export function mergeAllProjectFinanceIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(incomingBackup)) as BackupData

  const remoteById = new Map<string, any>()
  for (const rp of Array.isArray(remoteBackup?.projects) ? remoteBackup.projects : []) {
    const id = String(rp?.id || '').trim()
    if (id) remoteById.set(id, rp)
  }

  for (const mp of Array.isArray(merged.projects) ? merged.projects : []) {
    const id = String(mp?.id || '').trim()
    if (!id) continue
    const remoteProject = remoteById.get(id)
    if (!remoteProject) continue // remote has no counterpart; keep incoming finance as-is
    // target = incoming clone (mp); "incoming" side of the LWW is mp itself.
    resolveProjectFinanceLWW(mp, remoteProject, mp)
  }

  return merged
}

// ── Project timeline: phase_timeline rows + deposit scalars (Phase 6S-D1) ──────
// project.timeline protects projected cash flow / payment schedule / quote-vs-
// actual planning data: projects[].phase_timeline[] (merged by phase_name) plus
// the deposit_pct / phase_deposit_pct scalar fields (per-field LWW keyed by a
// projects[].timelineUpdatedAt map). SEPARATE from project.schedule (phases/
// plannedStart/plannedEnd/tasks) and project.progress/project.coordination,
// which remain unimplemented. Never touches logs[]/payments, finance, estimate
// rows/scalars, materials, RFIs, or change orders.

export type ProjectProgressMapName =
  | 'phases'
  | 'customPhases'
  | 'progressPhaseColors'
  | 'progressPhaseOverrideEnabled'

const PROJECT_PROGRESS_MAP_NAMES: readonly ProjectProgressMapName[] = [
  'phases',
  'customPhases',
  'progressPhaseColors',
  'progressPhaseOverrideEnabled',
]

function asProgressObject(value: any): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function isBlankProgressValue(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

export function normalizeProgressPhaseKey(key: unknown): string {
  return String(key ?? '').trim().toLowerCase()
}

function getProgressMapUpdatedAt(project: any, mapName: string, phaseKey: string): string | undefined {
  const normalized = normalizeProgressPhaseKey(phaseKey)
  const stamps = asProgressObject(asProgressObject(project?.progressUpdatedAt)[mapName])
  for (const [key, value] of Object.entries(stamps)) {
    if (normalizeProgressPhaseKey(key) === normalized && isValidDateString(value)) return String(value)
  }
  return undefined
}

function getProgressMapDeletedAt(project: any, mapName: string, phaseKey: string): string | undefined {
  const normalized = normalizeProgressPhaseKey(phaseKey)
  const deleted = asProgressObject(asProgressObject(project?.progressDeletedAt)[mapName])
  for (const [key, value] of Object.entries(deleted)) {
    if (normalizeProgressPhaseKey(key) === normalized && isValidDateString(value)) return String(value)
  }
  return undefined
}

function setNestedProgressStamp(project: any, rootName: 'progressUpdatedAt' | 'progressDeletedAt', mapName: string, phaseKey: string, timestamp: string): void {
  if (!project || typeof project !== 'object') return
  const root = asProgressObject(project[rootName])
  const bucket = asProgressObject(root[mapName])
  project[rootName] = { ...root, [mapName]: { ...bucket, [phaseKey]: timestamp } }
}

export function stampProgressMapField(project: any, mapName: ProjectProgressMapName | string, phaseKey: string, timestamp?: string): any {
  const phase = String(phaseKey ?? '').trim()
  if (!project || typeof project !== 'object' || !phase) return project
  const ts = isValidDateString(timestamp) ? String(timestamp) : new Date().toISOString()
  setNestedProgressStamp(project, 'progressUpdatedAt', mapName, phase, ts)
  return project
}

export function markProgressMapFieldDeleted(project: any, mapName: ProjectProgressMapName | string, phaseKey: string, deletedBy?: string): any {
  const phase = String(phaseKey ?? '').trim()
  if (!project || typeof project !== 'object' || !phase) return project
  const ts = new Date().toISOString()
  setNestedProgressStamp(project, 'progressDeletedAt', mapName, phase, ts)
  setNestedProgressStamp(project, 'progressUpdatedAt', mapName, phase, ts)
  if (deletedBy) {
    const deletedByRoot = asProgressObject(project.progressDeletedBy)
    const bucket = asProgressObject(deletedByRoot[mapName])
    project.progressDeletedBy = { ...deletedByRoot, [mapName]: { ...bucket, [phase]: deletedBy } }
  }
  return project
}

export interface ProjectProgressTask {
  id?: string
  desc?: string
  hrs?: number
  pct?: number
  phase?: string
  createdAt?: string
  updatedAt?: string
  deletedAt?: string
  deletedBy?: string
  status?: string
  [key: string]: any
}

export type MergeableProgressTask = ProjectProgressTask & {
  id: string
  createdAt: string
  updatedAt: string
}

function progressTaskFingerprint(task: any): string {
  const parts = [
    task?.id,
    task?.desc,
    task?.hrs,
    task?.pct,
    task?.phase,
    task?.createdAt,
    task?.updatedAt,
  ].map(value => String(value ?? '').trim())
  return shortStableHash(parts.join('|'))
}

function normalizeProgressTaskCreatedAt(task: any): string {
  if (isValidDateString(task?.createdAt)) return String(task.createdAt)
  if (isValidDateString(task?.updatedAt)) return String(task.updatedAt)
  return EPOCH_FALLBACK_ISO
}

function normalizeProgressTaskUpdatedAt(task: any): string {
  let base = EPOCH_FALLBACK_ISO
  if (isValidDateString(task?.updatedAt)) base = String(task.updatedAt)
  else if (isValidDateString(task?.createdAt)) base = String(task.createdAt)

  if (isValidDateString(task?.deletedAt) && parseTimestampMs(task.deletedAt) > parseTimestampMs(base)) {
    return String(task.deletedAt)
  }
  return base
}

export function isDeletedProgressTask(task: any): boolean {
  return isValidDateString(task?.deletedAt) || String(task?.status || '').trim().toLowerCase() === 'deleted'
}

export function ensureProgressTaskIdentity(task: any, timestamp?: string): MergeableProgressTask {
  const source = task && typeof task === 'object' ? task : {}
  const id = String(source.id || source.taskId || '').trim() || `legacy:${progressTaskFingerprint(source)}`
  const ts = isValidDateString(timestamp) ? String(timestamp) : undefined
  return {
    ...source,
    id,
    createdAt: isValidDateString(source.createdAt) ? String(source.createdAt) : (ts || normalizeProgressTaskCreatedAt(source)),
    updatedAt: ts || normalizeProgressTaskUpdatedAt(source),
  } as MergeableProgressTask
}

export function createProgressTaskTombstone(task: any, deletedBy?: string): ProjectProgressTask {
  const now = new Date().toISOString()
  const clean = ensureProgressTaskIdentity(task || {}, now)
  const tombstone: ProjectProgressTask = {
    ...clean,
    deletedAt: now,
    updatedAt: now,
    status: 'deleted',
  }
  if (deletedBy) tombstone.deletedBy = deletedBy
  else if (task?.deletedBy) tombstone.deletedBy = task.deletedBy
  else tombstone.deletedBy = 'system'
  return tombstone
}

function coalesceProgressRow(winner: any, loser: any): any {
  if (!loser || typeof loser !== 'object') return { ...winner }
  const result: Record<string, any> = { ...loser, ...winner }
  for (const key of Object.keys(loser)) {
    if (isBlankProgressValue(winner?.[key]) && !isBlankProgressValue(loser[key])) result[key] = loser[key]
  }
  return result
}

function pickProgressTaskWinner(remote: MergeableProgressTask, incoming: MergeableProgressTask): ProjectProgressTask {
  const remoteDeleted = isDeletedProgressTask(remote)
  const incomingDeleted = isDeletedProgressTask(incoming)

  if (remoteDeleted && incomingDeleted) {
    const incomingWins = comparableMs(incoming.deletedAt || incoming.updatedAt) >= comparableMs(remote.deletedAt || remote.updatedAt)
    return coalesceProgressRow(incomingWins ? incoming : remote, incomingWins ? remote : incoming)
  }

  if (remoteDeleted !== incomingDeleted) {
    const tombstone = remoteDeleted ? remote : incoming
    const live = remoteDeleted ? incoming : remote
    const liveWins = comparableMs(live.updatedAt) > comparableMs(tombstone.deletedAt || tombstone.updatedAt)
    return coalesceProgressRow(liveWins ? live : tombstone, liveWins ? tombstone : live)
  }

  const incomingWins = comparableMs(incoming.updatedAt) >= comparableMs(remote.updatedAt)
  return coalesceProgressRow(incomingWins ? incoming : remote, incomingWins ? remote : incoming)
}

function mergeProgressTaskRowsById(remoteRows: any[], incomingRows: any[]): ProjectProgressTask[] {
  const remoteArr = (Array.isArray(remoteRows) ? remoteRows : []).map(row => ensureProgressTaskIdentity(row))
  const incomingArr = (Array.isArray(incomingRows) ? incomingRows : []).map(row => ensureProgressTaskIdentity(row))
  const remoteById = new Map<string, MergeableProgressTask>()
  for (const row of remoteArr) remoteById.set(String(row.id), row)

  const result: ProjectProgressTask[] = []
  const used = new Set<string>()
  for (const incoming of incomingArr) {
    const id = String(incoming.id)
    if (used.has(id)) continue
    used.add(id)
    const remote = remoteById.get(id)
    result.push(remote ? pickProgressTaskWinner(remote, incoming) : incoming)
  }
  for (const remote of remoteArr) {
    const id = String(remote.id)
    if (used.has(id)) continue
    used.add(id)
    result.push(remote)
  }
  return result
}

export function getLiveProgressTasks(tasksForPhase: any[]): ProjectProgressTask[] {
  return (Array.isArray(tasksForPhase) ? tasksForPhase : [])
    .map(row => ensureProgressTaskIdentity(row))
    .filter(row => !isDeletedProgressTask(row))
}

function taskBucketEntries(tasks: any): Array<[string, any[]]> {
  const obj = asProgressObject(tasks)
  return Object.entries(obj).map(([key, rows]) => [key, Array.isArray(rows) ? rows : []])
}

export function mergeProgressTaskArrays(remoteTasks: any, incomingTasks: any): Record<string, ProjectProgressTask[]> {
  const remoteEntries = taskBucketEntries(remoteTasks)
  const incomingEntries = taskBucketEntries(incomingTasks)
  const remoteByNorm = new Map<string, [string, any[]]>()
  const incomingByNorm = new Map<string, [string, any[]]>()
  for (const entry of remoteEntries) remoteByNorm.set(normalizeProgressPhaseKey(entry[0]), entry)
  for (const entry of incomingEntries) incomingByNorm.set(normalizeProgressPhaseKey(entry[0]), entry)

  const result: Record<string, ProjectProgressTask[]> = {}
  const used = new Set<string>()
  for (const [norm, [incomingKey, incomingRows]] of incomingByNorm) {
    used.add(norm)
    const remoteEntry = remoteByNorm.get(norm)
    result[incomingKey] = mergeProgressTaskRowsById(remoteEntry?.[1] || [], incomingRows)
  }
  for (const [norm, [remoteKey, remoteRows]] of remoteByNorm) {
    if (used.has(norm)) continue
    result[remoteKey] = mergeProgressTaskRowsById(remoteRows, [])
  }
  return result
}

function getProgressObjectValue(project: any, mapName: string, phaseKey: string): any {
  const normalized = normalizeProgressPhaseKey(phaseKey)
  const map = asProgressObject(project?.[mapName])
  for (const [key, value] of Object.entries(map)) {
    if (normalizeProgressPhaseKey(key) === normalized) return value
  }
  return undefined
}

function getCustomPhaseLabel(project: any, phaseKey: string): string | undefined {
  const normalized = normalizeProgressPhaseKey(phaseKey)
  const phases = Array.isArray(project?.customPhases) ? project.customPhases : []
  const found = phases.find((ph: any) => normalizeProgressPhaseKey(ph) === normalized)
  return found == null ? undefined : String(found)
}

function collectProgressPhaseKeys(remoteProject: any, incomingProject: any, mapName: string): string[] {
  const keys: string[] = []
  const add = (key: unknown) => {
    const label = String(key ?? '').trim()
    const norm = normalizeProgressPhaseKey(label)
    if (!norm || keys.some(existing => normalizeProgressPhaseKey(existing) === norm)) return
    keys.push(label)
  }

  if (mapName === 'customPhases') {
    for (const ph of Array.isArray(remoteProject?.customPhases) ? remoteProject.customPhases : []) add(ph)
    for (const ph of Array.isArray(incomingProject?.customPhases) ? incomingProject.customPhases : []) add(ph)
  } else {
    for (const key of Object.keys(asProgressObject(remoteProject?.[mapName]))) add(key)
    for (const key of Object.keys(asProgressObject(incomingProject?.[mapName]))) add(key)
  }
  for (const key of Object.keys(asProgressObject(asProgressObject(remoteProject?.progressUpdatedAt)[mapName]))) add(key)
  for (const key of Object.keys(asProgressObject(asProgressObject(incomingProject?.progressUpdatedAt)[mapName]))) add(key)
  for (const key of Object.keys(asProgressObject(asProgressObject(remoteProject?.progressDeletedAt)[mapName]))) add(key)
  for (const key of Object.keys(asProgressObject(asProgressObject(incomingProject?.progressDeletedAt)[mapName]))) add(key)
  return keys
}

function resolveProgressMapField(mapName: string, phaseKey: string, remoteProject: any, incomingProject: any): any {
  const remoteValue = mapName === 'customPhases' ? getCustomPhaseLabel(remoteProject, phaseKey) : getProgressObjectValue(remoteProject, mapName, phaseKey)
  const incomingValue = mapName === 'customPhases' ? getCustomPhaseLabel(incomingProject, phaseKey) : getProgressObjectValue(incomingProject, mapName, phaseKey)
  const remoteHas = !isBlankProgressValue(remoteValue)
  const incomingHas = !isBlankProgressValue(incomingValue)
  const remoteLiveTs = comparableMs(getProgressMapUpdatedAt(remoteProject, mapName, phaseKey))
  const incomingLiveTs = comparableMs(getProgressMapUpdatedAt(incomingProject, mapName, phaseKey))
  const remoteDelAt = getProgressMapDeletedAt(remoteProject, mapName, phaseKey)
  const incomingDelAt = getProgressMapDeletedAt(incomingProject, mapName, phaseKey)
  const remoteDelTs = comparableMs(remoteDelAt)
  const incomingDelTs = comparableMs(incomingDelAt)
  const liveTs = Math.max(remoteHas ? remoteLiveTs : Number.NEGATIVE_INFINITY, incomingHas ? incomingLiveTs : Number.NEGATIVE_INFINITY)
  const deleteTs = Math.max(remoteDelTs, incomingDelTs)

  if (deleteTs !== Number.NEGATIVE_INFINITY && deleteTs >= liveTs) {
    return { deleted: true, label: String(incomingValue || remoteValue || phaseKey), deletedAt: incomingDelTs >= remoteDelTs ? incomingDelAt : remoteDelAt }
  }

  let incomingWins: boolean
  if (incomingLiveTs > remoteLiveTs) incomingWins = true
  else if (remoteLiveTs > incomingLiveTs) incomingWins = false
  else incomingWins = incomingHas || !remoteHas
  const winner = incomingWins ? incomingValue : remoteValue
  const loser = incomingWins ? remoteValue : incomingValue
  const value = !isBlankProgressValue(winner) ? winner : loser
  const stamp = incomingWins ? getProgressMapUpdatedAt(incomingProject, mapName, phaseKey) : getProgressMapUpdatedAt(remoteProject, mapName, phaseKey)
  return { deleted: false, value, label: String(value || incomingValue || remoteValue || phaseKey), updatedAt: stamp }
}

function mergeProgressMapObject(mapName: ProjectProgressMapName, remoteProject: any, incomingProject: any): any {
  const keys = collectProgressPhaseKeys(remoteProject, incomingProject, mapName)
  const stamps: Record<string, string> = {}
  const deleted: Record<string, string> = {}
  if (mapName === 'customPhases') {
    const phases: string[] = []
    for (const key of keys) {
      const resolved = resolveProgressMapField(mapName, key, remoteProject, incomingProject)
      if (resolved.deleted) {
        if (resolved.deletedAt) deleted[resolved.label || key] = resolved.deletedAt
        continue
      }
      if (isBlankProgressValue(resolved.value)) continue
      const label = String(resolved.label || resolved.value || key)
      if (!phases.some(existing => normalizeProgressPhaseKey(existing) === normalizeProgressPhaseKey(label))) phases.push(label)
      if (resolved.updatedAt) stamps[label] = resolved.updatedAt
    }
    return { value: phases, stamps, deleted }
  }

  const map: Record<string, any> = {}
  for (const key of keys) {
    const resolved = resolveProgressMapField(mapName, key, remoteProject, incomingProject)
    const label = String(key)
    if (resolved.deleted) {
      if (resolved.deletedAt) deleted[label] = resolved.deletedAt
      continue
    }
    if (isBlankProgressValue(resolved.value)) continue
    map[label] = resolved.value
    if (resolved.updatedAt) stamps[label] = resolved.updatedAt
  }
  return { value: map, stamps, deleted }
}

export function mergeProgressMaps(remoteProject: any, incomingProject: any): any {
  const progressUpdatedAt: Record<string, Record<string, string>> = {}
  const progressDeletedAt: Record<string, Record<string, string>> = {}
  const merged: any = {}
  for (const mapName of PROJECT_PROGRESS_MAP_NAMES) {
    const result = mergeProgressMapObject(mapName, remoteProject, incomingProject)
    merged[mapName] = result.value
    if (Object.keys(result.stamps).length) progressUpdatedAt[mapName] = result.stamps
    if (Object.keys(result.deleted).length) progressDeletedAt[mapName] = result.deleted
  }
  return {
    phases: merged.phases || {},
    customPhases: merged.customPhases || [],
    progressPhaseColors: merged.progressPhaseColors || {},
    progressPhaseOverrideEnabled: merged.progressPhaseOverrideEnabled || {},
    progressUpdatedAt,
    progressDeletedAt,
  }
}

function mergeProgressTimestampBucket(remoteProject: any, incomingProject: any, rootName: 'progressUpdatedAt' | 'progressDeletedAt', mapName: string): Record<string, string> {
  const remoteBucket = asProgressObject(asProgressObject(remoteProject?.[rootName])[mapName])
  const incomingBucket = asProgressObject(asProgressObject(incomingProject?.[rootName])[mapName])
  const keys: string[] = []
  const add = (key: string) => {
    const norm = normalizeProgressPhaseKey(key)
    if (!norm || keys.some(existing => normalizeProgressPhaseKey(existing) === norm)) return
    keys.push(key)
  }
  Object.keys(remoteBucket).forEach(add)
  Object.keys(incomingBucket).forEach(add)

  const result: Record<string, string> = {}
  for (const key of keys) {
    const remoteKey = Object.keys(remoteBucket).find(k => normalizeProgressPhaseKey(k) === normalizeProgressPhaseKey(key))
    const incomingKey = Object.keys(incomingBucket).find(k => normalizeProgressPhaseKey(k) === normalizeProgressPhaseKey(key))
    const remoteValue = remoteKey ? remoteBucket[remoteKey] : undefined
    const incomingValue = incomingKey ? incomingBucket[incomingKey] : undefined
    if (comparableMs(incomingValue) >= comparableMs(remoteValue)) {
      if (isValidDateString(incomingValue)) result[incomingKey || key] = String(incomingValue)
    } else if (isValidDateString(remoteValue)) {
      result[remoteKey || key] = String(remoteValue)
    }
  }
  return result
}

function patchProjectProgressFields(targetProject: any, remoteProject: any, incomingProject: any): void {
  const maps = mergeProgressMaps(remoteProject, incomingProject)
  const taskUpdatedAt = mergeProgressTimestampBucket(remoteProject, incomingProject, 'progressUpdatedAt', 'tasks')
  const taskDeletedAt = mergeProgressTimestampBucket(remoteProject, incomingProject, 'progressDeletedAt', 'tasks')
  targetProject.phases = maps.phases
  targetProject.tasks = mergeProgressTaskArrays(remoteProject?.tasks, incomingProject?.tasks)
  targetProject.customPhases = maps.customPhases
  targetProject.progressPhaseColors = maps.progressPhaseColors
  targetProject.progressPhaseOverrideEnabled = maps.progressPhaseOverrideEnabled
  targetProject.progressUpdatedAt = {
    ...asProgressObject(targetProject.progressUpdatedAt),
    ...maps.progressUpdatedAt,
    tasks: taskUpdatedAt,
  }
  targetProject.progressDeletedAt = {
    ...asProgressObject(targetProject.progressDeletedAt),
    ...maps.progressDeletedAt,
    tasks: taskDeletedAt,
  }
}

export function mergeProjectProgressIntoRemote(remoteBackup: BackupData, incomingBackup: BackupData, projectId: string): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const targetId = String(projectId || '').trim()
  if (!targetId) return merged
  const remoteProjects = Array.isArray(merged.projects) ? merged.projects : []
  const remoteIndex = remoteProjects.findIndex((p: any) => String(p?.id || '') === targetId)
  if (remoteIndex === -1) return merged
  const incomingProjects = Array.isArray(incomingBackup?.projects) ? incomingBackup.projects : []
  const incomingProject: any = incomingProjects.find((p: any) => String(p?.id || '') === targetId)
  if (!incomingProject) return merged
  const remoteProject: any = remoteProjects[remoteIndex]
  patchProjectProgressFields(remoteProject, remoteProject, incomingProject)
  return merged
}

export function mergeAllProjectProgressIntoRemote(remoteBackup: BackupData, incomingBackup: BackupData): BackupData {
  const merged = JSON.parse(JSON.stringify(incomingBackup)) as BackupData
  const remoteById = new Map<string, any>()
  for (const rp of Array.isArray(remoteBackup?.projects) ? remoteBackup.projects : []) {
    const id = String(rp?.id || '').trim()
    if (id) remoteById.set(id, rp)
  }
  for (const mp of Array.isArray(merged.projects) ? merged.projects : []) {
    const id = String(mp?.id || '').trim()
    const remoteProject = id ? remoteById.get(id) : null
    if (!remoteProject) continue
    patchProjectProgressFields(mp, remoteProject, mp)
  }
  return merged
}

export function mergeRemoteProjectProgressIntoOutgoing(outgoingBackup: BackupData, remoteBackup: BackupData): BackupData {
  const merged = JSON.parse(JSON.stringify(outgoingBackup)) as BackupData
  const remoteById = new Map<string, any>()
  for (const rp of Array.isArray(remoteBackup?.projects) ? remoteBackup.projects : []) {
    const id = String(rp?.id || '').trim()
    if (id) remoteById.set(id, rp)
  }
  for (const op of Array.isArray(merged.projects) ? merged.projects : []) {
    const id = String(op?.id || '').trim()
    const remoteProject = id ? remoteById.get(id) : null
    if (!remoteProject) continue
    patchProjectProgressFields(op, op, remoteProject)
  }
  return merged
}

export type ProjectTimelineFieldKey = 'deposit_pct' | 'phase_deposit_pct'

/** The only projects[] scalar fields this merge is allowed to read/patch (phase_timeline is handled separately). */
export const PROJECT_TIMELINE_FIELD_KEYS: readonly ProjectTimelineFieldKey[] = [
  'deposit_pct',
  'phase_deposit_pct',
]

function normalizeTimelinePhaseName(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function stableTimelineFingerprint(entry: any): string {
  const parts = [
    entry?.phase_name,
    entry?.payment_trigger_pct,
    entry?.confirmed_start_date,
    entry?.actual_start_date,
    entry?.actual_end_date,
  ].map(v => String(v ?? '').trim())
  return shortStableHash(parts.join('|'))
}

/**
 * Stable identity for a phase_timeline row: normalized phase_name (primary),
 * else a legacy `id` field, else a deterministic content fingerprint. Never
 * random, so the same logical phase resolves to the same identity on both
 * sides of a merge.
 */
export function getPhaseTimelineIdentity(entry: any): string {
  const normalizedName = normalizeTimelinePhaseName(entry?.phase_name)
  if (normalizedName) return normalizedName
  const legacyId = String(entry?.id ?? '').trim()
  if (legacyId) return `id:${legacyId}`
  return `fingerprint:${stableTimelineFingerprint(entry)}`
}

/**
 * Ensure a phase_timeline entry has updatedAt when a timestamp is supplied.
 * Preserves every existing field (including unknown ones) and never invents or
 * rewrites phase_name.
 */
export function ensurePhaseTimelineEntryIdentity(entry: any, timestamp?: string): any {
  if (!entry || typeof entry !== 'object') return entry
  const next = { ...entry }
  if (timestamp !== undefined) {
    next.updatedAt = isValidDateString(timestamp) ? String(timestamp) : new Date().toISOString()
  }
  return next
}

/** Stamp project.timelineUpdatedAt[fieldName] only; preserves every other field on the project untouched. */
export function stampProjectTimelineField(project: any, fieldName: string, timestamp?: string): any {
  if (!project || typeof project !== 'object') return project
  const stamps = project.timelineUpdatedAt && typeof project.timelineUpdatedAt === 'object' ? project.timelineUpdatedAt : {}
  const ts = isValidDateString(timestamp) ? String(timestamp) : new Date().toISOString()
  project.timelineUpdatedAt = { ...stamps, [fieldName]: ts }
  return project
}

function isBlankTimelineValue(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/** Overlay `winner` onto `loser` so a winner never wipes a loser's defined field with an undefined/blank one. Unknown fields preserved. */
function coalesceTimelineRow(winner: any, loser: any): any {
  if (!loser || typeof loser !== 'object') return { ...winner }
  const result: Record<string, any> = { ...loser, ...winner }
  for (const key of Object.keys(loser)) {
    if (isBlankTimelineValue(winner?.[key]) && !isBlankTimelineValue(loser[key])) {
      result[key] = loser[key]
    }
  }
  return result
}

/**
 * Merge two phase_timeline arrays by phase_name identity. Rows from both sides
 * are preserved; for a shared phase, newer `updatedAt` wins; on a tie or when
 * both are missing, incoming wins (so an explicit project.timeline save
 * applies) but never wipes a remote-defined field with an incoming
 * undefined/blank one. Output order is incoming-first, then any remote-only
 * rows appended.
 */
export function mergePhaseTimelineRowsByPhase(remoteRows: any[], incomingRows: any[]): any[] {
  const remoteArr = Array.isArray(remoteRows) ? remoteRows : []
  const incomingArr = Array.isArray(incomingRows) ? incomingRows : []

  const remoteByKey = new Map<string, any>()
  for (const row of remoteArr) remoteByKey.set(getPhaseTimelineIdentity(row), row)

  const result: any[] = []
  const used = new Set<string>()

  for (const incoming of incomingArr) {
    const key = getPhaseTimelineIdentity(incoming)
    if (used.has(key)) continue
    used.add(key)
    const remote = remoteByKey.get(key)
    if (!remote) {
      result.push(incoming)
      continue
    }

    const remoteTs = comparableMs(remote?.updatedAt)
    const incomingTs = comparableMs(incoming?.updatedAt)
    const incomingWins = incomingTs > remoteTs || incomingTs === remoteTs
    const winner = incomingWins ? incoming : remote
    const loser = incomingWins ? remote : incoming
    result.push(coalesceTimelineRow(winner, loser))
  }

  for (const remote of remoteArr) {
    const key = getPhaseTimelineIdentity(remote)
    if (used.has(key)) continue
    used.add(key)
    result.push(remote)
  }

  return result
}

function hasTimelineFieldValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string' && value.trim() === '') return false
  return true
}

function asTimelineStamps(value: any): Record<string, any> {
  return value && typeof value === 'object' ? value : {}
}

/**
 * Resolve deposit_pct / phase_deposit_pct on `targetProject` (already a clone)
 * by per-field LWW between `remoteProject` and `incomingProject`. Winner rules
 * mirror the project.finance scalar pattern: strictly-newer timelineUpdatedAt
 * wins that field; on a timestamp tie the side that actually has a value wins
 * (protects a remote legacy value from a local blank); a value is never wiped
 * by an undefined winner.
 */
function resolveProjectTimelineFieldsLWW(targetProject: any, remoteProject: any, incomingProject: any): void {
  const remoteStamps = asTimelineStamps(remoteProject?.timelineUpdatedAt)
  const incomingStamps = asTimelineStamps(incomingProject?.timelineUpdatedAt)
  const nextStamps: Record<string, any> = { ...asTimelineStamps(targetProject.timelineUpdatedAt) }

  for (const field of PROJECT_TIMELINE_FIELD_KEYS) {
    const remoteTs = comparableMs(remoteStamps[field])
    const incomingTs = comparableMs(incomingStamps[field])
    const remoteHasVal = hasTimelineFieldValue(remoteProject?.[field])
    const incomingHasVal = hasTimelineFieldValue(incomingProject?.[field])

    let winnerIsRemote: boolean
    if (remoteTs > incomingTs) winnerIsRemote = true
    else if (incomingTs > remoteTs) winnerIsRemote = false
    else winnerIsRemote = !incomingHasVal && remoteHasVal // tie: never wipe a remote value with a local blank

    if (winnerIsRemote) {
      if (remoteHasVal) targetProject[field] = remoteProject[field]
      if (isValidDateString(remoteStamps[field])) nextStamps[field] = String(remoteStamps[field])
    } else {
      if (incomingHasVal) targetProject[field] = incomingProject[field]
      if (isValidDateString(incomingStamps[field])) nextStamps[field] = String(incomingStamps[field])
    }
  }

  targetProject.timelineUpdatedAt = nextStamps
}

/**
 * Single-project timeline merge (remote-based): returns a clone of
 * `remoteBackup` with ONLY the target project's phase_timeline (merged by
 * phase_name) and deposit scalar fields resolved against `incomingBackup`.
 * Every other field and every other project is the remote snapshot, untouched.
 */
export function mergeProjectTimelineIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
  projectId: string,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const targetId = String(projectId || '').trim()
  if (!targetId) return merged

  const remoteProjects = Array.isArray(merged.projects) ? merged.projects : []
  const remoteIndex = remoteProjects.findIndex((p: any) => String(p?.id || '') === targetId)
  if (remoteIndex === -1) return merged

  const incomingProjects = Array.isArray(incomingBackup?.projects) ? incomingBackup.projects : []
  const incomingProject: any = incomingProjects.find((p: any) => String(p?.id || '') === targetId)
  if (!incomingProject) return merged

  const remoteProject: any = remoteProjects[remoteIndex]
  const remoteTimeline = Array.isArray(remoteProject.phase_timeline) ? remoteProject.phase_timeline : []
  const incomingTimeline = Array.isArray(incomingProject.phase_timeline) ? incomingProject.phase_timeline : []
  remoteProject.phase_timeline = mergePhaseTimelineRowsByPhase(remoteTimeline, incomingTimeline)

  resolveProjectTimelineFieldsLWW(remoteProject, remoteProject, incomingProject)
  return merged
}

/**
 * Broad-saver timeline guard (INCOMING-based): returns a clone of
 * `incomingBackup` so every local project edit is preserved exactly, with each
 * project's phase_timeline + deposit scalar fields reconciled against
 * `remoteBackup`. Intended for a future broad project saver that needs to
 * protect project.timeline the way mergeAllProjectFinanceIntoRemote protects
 * project.finance.
 */
export function mergeAllProjectTimelineIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(incomingBackup)) as BackupData

  const remoteById = new Map<string, any>()
  for (const rp of Array.isArray(remoteBackup?.projects) ? remoteBackup.projects : []) {
    const id = String(rp?.id || '').trim()
    if (id) remoteById.set(id, rp)
  }

  for (const mp of Array.isArray(merged.projects) ? merged.projects : []) {
    const id = String(mp?.id || '').trim()
    if (!id) continue
    const remoteProject = remoteById.get(id)
    if (!remoteProject) continue // remote has no counterpart; keep incoming timeline as-is

    const remoteTimeline = Array.isArray(remoteProject.phase_timeline) ? remoteProject.phase_timeline : []
    const incomingTimeline = Array.isArray(mp.phase_timeline) ? mp.phase_timeline : []
    mp.phase_timeline = mergePhaseTimelineRowsByPhase(remoteTimeline, incomingTimeline)

    // target = incoming clone (mp); "incoming" side of the LWW is mp itself.
    resolveProjectTimelineFieldsLWW(mp, remoteProject, mp)
  }

  return merged
}

/**
 * Narrow pre-sync preservation fold: returns a clone of `outgoingBackup` with
 * newer remote phase_timeline/deposit data folded in for every project that
 * exists on both sides. Remote is passed as the "incoming" side of the row
 * merge and the field LWW so it wins ties — this is only meant to run on a
 * save that is NOT itself a project.timeline save, protecting a stale local
 * timeline bucket from overwriting newer remote data. Only phase_timeline,
 * deposit_pct, phase_deposit_pct, and timelineUpdatedAt are touched.
 */
export function mergeRemoteProjectTimelineIntoOutgoing(
  outgoingBackup: BackupData,
  remoteBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(outgoingBackup)) as BackupData

  const remoteById = new Map<string, any>()
  for (const rp of Array.isArray(remoteBackup?.projects) ? remoteBackup.projects : []) {
    const id = String(rp?.id || '').trim()
    if (id) remoteById.set(id, rp)
  }

  for (const op of Array.isArray(merged.projects) ? merged.projects : []) {
    const id = String(op?.id || '').trim()
    if (!id) continue
    const remoteProject = remoteById.get(id)
    if (!remoteProject) continue

    const outgoingTimeline = Array.isArray(op.phase_timeline) ? op.phase_timeline : []
    const remoteTimeline = Array.isArray(remoteProject.phase_timeline) ? remoteProject.phase_timeline : []
    // Pass remote as "incoming" so remote wins tie/missing timestamps here.
    op.phase_timeline = mergePhaseTimelineRowsByPhase(outgoingTimeline, remoteTimeline)

    resolveProjectTimelineFieldsLWW(op, remoteProject, op)
  }

  return merged
}

export interface ProjectCoordItem {
  id?: string
  text?: string
  status?: string
  response?: string
  solvedBy?: string
  section?: string
  createdAt?: string
  updatedAt?: string
  deletedAt?: string
  deletedBy?: string
  [key: string]: any
}

export type MergeableProjectCoordItem = ProjectCoordItem & {
  id: string
  createdAt: string
  updatedAt: string
}

export function normalizeCoordSectionKey(sectionKey: unknown): string {
  return String(sectionKey ?? '').trim().toLowerCase()
}

function coordText(value: unknown): string {
  return String(value ?? '').trim()
}

function coordItemFingerprint(item: any): string {
  const parts = [
    item?.id,
    item?.text,
    item?.status,
    item?.response,
    item?.solvedBy,
    item?.section,
    item?.createdAt,
    item?.updatedAt,
  ].map(value => coordText(value))
  return shortStableHash(parts.join('|'))
}

export function getCoordItemIdentity(item: any): string {
  const id = coordText(item?.id)
  if (id) return id
  return `legacy:coord:${coordItemFingerprint(item)}`
}

function normalizeCoordCreatedAt(item: any): string {
  if (isValidDateString(item?.createdAt)) return String(item.createdAt)
  if (isValidDateString(item?.updatedAt)) return String(item.updatedAt)
  return EPOCH_FALLBACK_ISO
}

function normalizeCoordUpdatedAt(item: any): string {
  let base = EPOCH_FALLBACK_ISO
  if (isValidDateString(item?.updatedAt)) base = String(item.updatedAt)
  else if (isValidDateString(item?.createdAt)) base = String(item.createdAt)

  if (isValidDateString(item?.deletedAt) && parseTimestampMs(item.deletedAt) > parseTimestampMs(base)) {
    return String(item.deletedAt)
  }

  return base
}

export function ensureCoordItemIdentity(item: any, timestamp?: string): MergeableProjectCoordItem {
  const source = item && typeof item === 'object' ? item : {}
  const ts = isValidDateString(timestamp) ? String(timestamp) : undefined
  const id = coordText(source.id) || getCoordItemIdentity(source)
  return {
    ...source,
    id,
    createdAt: isValidDateString(source.createdAt) ? String(source.createdAt) : (ts || normalizeCoordCreatedAt(source)),
    updatedAt: ts || normalizeCoordUpdatedAt(source),
  } as MergeableProjectCoordItem
}

export function isDeletedCoordItem(item: any): boolean {
  return isValidDateString(item?.deletedAt) || coordText(item?.status).toLowerCase() === 'deleted'
}

export function createCoordItemTombstone(item: any, deletedBy?: string): ProjectCoordItem {
  const now = new Date().toISOString()
  const clean = ensureCoordItemIdentity(item || {}, now)
  const tombstone: ProjectCoordItem = {
    ...clean,
    deletedAt: now,
    updatedAt: now,
    status: 'deleted',
  }
  tombstone.deletedBy = deletedBy || clean?.deletedBy || 'system'
  return tombstone
}

export function getLiveCoordItems(items: any[]): ProjectCoordItem[] {
  return (Array.isArray(items) ? items : [])
    .map(item => ensureCoordItemIdentity(item))
    .filter(item => !isDeletedCoordItem(item))
}

function isBlankCoordValue(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function coalesceCoordItem(winner: any, loser: any): any {
  if (!loser || typeof loser !== 'object') return { ...winner }
  const result: Record<string, any> = { ...loser, ...winner }
  for (const key of Object.keys(loser)) {
    if (isBlankCoordValue(winner?.[key]) && !isBlankCoordValue(loser[key])) result[key] = loser[key]
  }
  return result
}

function pickCoordItemWinner(remote: MergeableProjectCoordItem, incoming: MergeableProjectCoordItem): ProjectCoordItem {
  const remoteDeleted = isDeletedCoordItem(remote)
  const incomingDeleted = isDeletedCoordItem(incoming)

  if (remoteDeleted && incomingDeleted) {
    const incomingWins = comparableMs(incoming.deletedAt || incoming.updatedAt) >= comparableMs(remote.deletedAt || remote.updatedAt)
    return coalesceCoordItem(incomingWins ? incoming : remote, incomingWins ? remote : incoming)
  }

  if (remoteDeleted !== incomingDeleted) {
    const tombstone = remoteDeleted ? remote : incoming
    const live = remoteDeleted ? incoming : remote
    const liveWins = comparableMs(live.updatedAt) > comparableMs(tombstone.deletedAt || tombstone.updatedAt)
    return coalesceCoordItem(liveWins ? live : tombstone, liveWins ? tombstone : live)
  }

  const incomingWins = comparableMs(incoming.updatedAt) >= comparableMs(remote.updatedAt)
  return coalesceCoordItem(incomingWins ? incoming : remote, incomingWins ? remote : incoming)
}

export function mergeCoordItemArrays(remoteItems: any[], incomingItems: any[]): ProjectCoordItem[] {
  const remoteArr = (Array.isArray(remoteItems) ? remoteItems : []).map(item => ensureCoordItemIdentity(item))
  const incomingArr = (Array.isArray(incomingItems) ? incomingItems : []).map(item => ensureCoordItemIdentity(item))
  const remoteById = new Map<string, MergeableProjectCoordItem>()
  for (const item of remoteArr) remoteById.set(String(item.id), item)

  const result: ProjectCoordItem[] = []
  const used = new Set<string>()
  for (const incoming of incomingArr) {
    const id = String(incoming.id)
    if (used.has(id)) continue
    used.add(id)
    const remote = remoteById.get(id)
    result.push(remote ? pickCoordItemWinner(remote, incoming) : incoming)
  }
  for (const remote of remoteArr) {
    const id = String(remote.id)
    if (used.has(id)) continue
    used.add(id)
    result.push(remote)
  }
  return result
}

function asCoordMap(value: any): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function mergeProjectCoordMaps(remoteCoord: any, incomingCoord: any): Record<string, ProjectCoordItem[]> {
  const remoteObj = asCoordMap(remoteCoord)
  const incomingObj = asCoordMap(incomingCoord)
  const remoteByNorm = new Map<string, [string, any[]]>()
  const incomingByNorm = new Map<string, [string, any[]]>()

  for (const [section, rows] of Object.entries(remoteObj)) {
    const norm = normalizeCoordSectionKey(section)
    if (!norm) continue
    remoteByNorm.set(norm, [section, Array.isArray(rows) ? rows : []])
  }
  for (const [section, rows] of Object.entries(incomingObj)) {
    const norm = normalizeCoordSectionKey(section)
    if (!norm) continue
    incomingByNorm.set(norm, [section, Array.isArray(rows) ? rows : []])
  }

  const result: Record<string, ProjectCoordItem[]> = {}
  const used = new Set<string>()
  for (const [norm, [incomingSection, incomingRows]] of incomingByNorm) {
    used.add(norm)
    const remoteEntry = remoteByNorm.get(norm)
    result[incomingSection] = mergeCoordItemArrays(remoteEntry?.[1] || [], incomingRows)
  }
  for (const [norm, [remoteSection, remoteRows]] of remoteByNorm) {
    if (used.has(norm)) continue
    result[remoteSection] = mergeCoordItemArrays(remoteRows, [])
  }
  return result
}

function patchProjectCoordinationFields(targetProject: any, remoteProject: any, incomingProject: any): void {
  targetProject.coord = mergeProjectCoordMaps(remoteProject?.coord, incomingProject?.coord)
  if (remoteProject?.coordUpdatedAt || incomingProject?.coordUpdatedAt || targetProject?.coordUpdatedAt) {
    targetProject.coordUpdatedAt = {
      ...asCoordMap(remoteProject?.coordUpdatedAt),
      ...asCoordMap(incomingProject?.coordUpdatedAt),
      ...asCoordMap(targetProject?.coordUpdatedAt),
    }
  }
  if (remoteProject?.coordDeletedAt || incomingProject?.coordDeletedAt || targetProject?.coordDeletedAt) {
    targetProject.coordDeletedAt = {
      ...asCoordMap(remoteProject?.coordDeletedAt),
      ...asCoordMap(incomingProject?.coordDeletedAt),
      ...asCoordMap(targetProject?.coordDeletedAt),
    }
  }
}

export function mergeProjectCoordinationIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
  projectId: string,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const targetId = String(projectId || '').trim()
  if (!targetId) return merged

  const remoteProjects = Array.isArray(merged.projects) ? merged.projects : []
  const remoteIndex = remoteProjects.findIndex((p: any) => String(p?.id || '') === targetId)
  if (remoteIndex === -1) return merged

  const incomingProjects = Array.isArray(incomingBackup?.projects) ? incomingBackup.projects : []
  const incomingProject: any = incomingProjects.find((p: any) => String(p?.id || '') === targetId)
  if (!incomingProject) return merged

  const remoteProject: any = remoteProjects[remoteIndex]
  patchProjectCoordinationFields(remoteProject, remoteProject, incomingProject)
  return merged
}

export function mergeAllProjectCoordinationIntoRemote(remoteBackup: BackupData, incomingBackup: BackupData): BackupData {
  const merged = JSON.parse(JSON.stringify(incomingBackup)) as BackupData
  const remoteById = new Map<string, any>()
  for (const rp of Array.isArray(remoteBackup?.projects) ? remoteBackup.projects : []) {
    const id = String(rp?.id || '').trim()
    if (id) remoteById.set(id, rp)
  }
  for (const mp of Array.isArray(merged.projects) ? merged.projects : []) {
    const id = String(mp?.id || '').trim()
    const remoteProject = id ? remoteById.get(id) : null
    if (!remoteProject) continue
    patchProjectCoordinationFields(mp, remoteProject, mp)
  }
  return merged
}

export function mergeRemoteProjectCoordinationIntoOutgoing(outgoingBackup: BackupData, remoteBackup: BackupData): BackupData {
  const merged = JSON.parse(JSON.stringify(outgoingBackup)) as BackupData
  const remoteById = new Map<string, any>()
  for (const rp of Array.isArray(remoteBackup?.projects) ? remoteBackup.projects : []) {
    const id = String(rp?.id || '').trim()
    if (id) remoteById.set(id, rp)
  }
  for (const op of Array.isArray(merged.projects) ? merged.projects : []) {
    const id = String(op?.id || '').trim()
    const remoteProject = id ? remoteById.get(id) : null
    if (!remoteProject) continue
    patchProjectCoordinationFields(op, op, remoteProject)
  }
  return merged
}

export type ProjectScheduleFieldKey = 'plannedStart' | 'plannedEnd' | 'lastMove'

/** The only projects[] scalar fields owned by project.schedule. */
export const PROJECT_SCHEDULE_FIELD_KEYS: readonly ProjectScheduleFieldKey[] = [
  'plannedStart',
  'plannedEnd',
  'lastMove',
]

export function isProjectScheduleField(fieldName: string): fieldName is ProjectScheduleFieldKey {
  return (PROJECT_SCHEDULE_FIELD_KEYS as readonly string[]).includes(String(fieldName || ''))
}

function asScheduleStamps(value: any): Record<string, any> {
  return value && typeof value === 'object' ? value : {}
}

function isExplicitScheduleBlank(value: unknown): boolean {
  return value === null || value === ''
}

function hasScheduleFieldValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

function hasScheduleFieldPresence(value: unknown): boolean {
  return value !== undefined
}

export function stampProjectScheduleField(project: any, fieldName: string, timestamp?: string): any {
  if (!project || typeof project !== 'object') return project
  if (!isProjectScheduleField(fieldName)) return project
  const stamps = asScheduleStamps(project.scheduleUpdatedAt)
  const ts = isValidDateString(timestamp) ? String(timestamp) : new Date().toISOString()
  project.scheduleUpdatedAt = { ...stamps, [fieldName]: ts }
  return project
}

export function stampProjectScheduleFields(project: any, fieldNames: string[], timestamp?: string): any {
  if (!project || typeof project !== 'object') return project
  for (const fieldName of Array.isArray(fieldNames) ? fieldNames : []) {
    stampProjectScheduleField(project, fieldName, timestamp)
  }
  return project
}

function resolveProjectScheduleFieldsLWW(targetProject: any, remoteProject: any, incomingProject: any): void {
  const remoteStamps = asScheduleStamps(remoteProject?.scheduleUpdatedAt)
  const incomingStamps = asScheduleStamps(incomingProject?.scheduleUpdatedAt)
  const nextStamps: Record<string, any> = {
    ...asScheduleStamps(remoteProject?.scheduleUpdatedAt),
    ...asScheduleStamps(incomingProject?.scheduleUpdatedAt),
    ...asScheduleStamps(targetProject?.scheduleUpdatedAt),
  }

  for (const field of PROJECT_SCHEDULE_FIELD_KEYS) {
    const remoteTs = comparableMs(remoteStamps[field])
    const incomingTs = comparableMs(incomingStamps[field])
    const remoteValue = remoteProject?.[field]
    const incomingValue = incomingProject?.[field]
    const remoteHasValue = hasScheduleFieldValue(remoteValue)
    const incomingHasValue = hasScheduleFieldValue(incomingValue)
    const remotePresent = hasScheduleFieldPresence(remoteValue)
    const incomingPresent = hasScheduleFieldPresence(incomingValue)

    let winner: 'remote' | 'incoming'
    if (remoteTs > incomingTs) {
      winner = 'remote'
    } else if (incomingTs > remoteTs) {
      winner = 'incoming'
    } else if (incomingHasValue) {
      winner = 'incoming'
    } else if (remoteHasValue) {
      winner = 'remote'
    } else if (incomingPresent && !isExplicitScheduleBlank(incomingValue)) {
      winner = 'incoming'
    } else {
      winner = 'remote'
    }

    if (winner === 'incoming') {
      if (incomingHasValue || (incomingTs > remoteTs && isExplicitScheduleBlank(incomingValue))) {
        targetProject[field] = incomingValue
      } else if (remotePresent) {
        targetProject[field] = remoteValue
      }
      if (isValidDateString(incomingStamps[field])) nextStamps[field] = String(incomingStamps[field])
    } else {
      if (remotePresent) targetProject[field] = remoteValue
      else if (incomingPresent && incomingHasValue) targetProject[field] = incomingValue
      if (isValidDateString(remoteStamps[field])) nextStamps[field] = String(remoteStamps[field])
    }
  }

  targetProject.scheduleUpdatedAt = nextStamps
}

export function mergeProjectScheduleFields(remoteProject: any, incomingProject: any): any {
  const merged = JSON.parse(JSON.stringify(remoteProject || {}))
  resolveProjectScheduleFieldsLWW(merged, remoteProject || {}, incomingProject || {})
  return {
    plannedStart: merged.plannedStart,
    plannedEnd: merged.plannedEnd,
    lastMove: merged.lastMove,
    scheduleUpdatedAt: merged.scheduleUpdatedAt,
  }
}

export function mergeProjectScheduleIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
  projectId: string,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const targetId = String(projectId || '').trim()
  if (!targetId) return merged

  const remoteProjects = Array.isArray(merged.projects) ? merged.projects : []
  const remoteIndex = remoteProjects.findIndex((p: any) => String(p?.id || '') === targetId)
  if (remoteIndex === -1) return merged

  const incomingProjects = Array.isArray(incomingBackup?.projects) ? incomingBackup.projects : []
  const incomingProject: any = incomingProjects.find((p: any) => String(p?.id || '') === targetId)
  if (!incomingProject) return merged

  const remoteProject: any = remoteProjects[remoteIndex]
  resolveProjectScheduleFieldsLWW(remoteProject, remoteProject, incomingProject)
  return merged
}

export function mergeAllProjectScheduleIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(incomingBackup)) as BackupData

  const remoteById = new Map<string, any>()
  for (const rp of Array.isArray(remoteBackup?.projects) ? remoteBackup.projects : []) {
    const id = String(rp?.id || '').trim()
    if (id) remoteById.set(id, rp)
  }

  for (const mp of Array.isArray(merged.projects) ? merged.projects : []) {
    const id = String(mp?.id || '').trim()
    if (!id) continue
    const remoteProject = remoteById.get(id)
    if (!remoteProject) continue
    resolveProjectScheduleFieldsLWW(mp, remoteProject, mp)
  }

  return merged
}

export function mergeRemoteProjectScheduleIntoOutgoing(
  outgoingBackup: BackupData,
  remoteBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(outgoingBackup)) as BackupData

  const remoteById = new Map<string, any>()
  for (const rp of Array.isArray(remoteBackup?.projects) ? remoteBackup.projects : []) {
    const id = String(rp?.id || '').trim()
    if (id) remoteById.set(id, rp)
  }

  for (const op of Array.isArray(merged.projects) ? merged.projects : []) {
    const id = String(op?.id || '').trim()
    if (!id) continue
    const remoteProject = remoteById.get(id)
    if (!remoteProject) continue
    // Pass remote as incoming so remote wins timestamp ties on non-schedule saves.
    resolveProjectScheduleFieldsLWW(op, op, remoteProject)
  }

  return merged
}
