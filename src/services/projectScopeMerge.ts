/**
 * Project inner-scope merge helpers.
 *
 * Phase 6B implements delete-safe, item-level scoped merge for
 * project.changeOrders. Phase 6F adds the same scoped tombstone merge pattern
 * for project.rfis. Phase 6H adds project.materials / MTO row support. This
 * module is intentionally pure: no React, localStorage, Supabase client, or
 * side effects.
 */
import type { BackupData, ChangeOrder } from './backupDataService'

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
