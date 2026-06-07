#!/usr/bin/env node

/**
 * Work Manifest Generator for PowerOn Hub App Brain
 *
 * Reads safe registry/context sources and emits a generated TypeScript snapshot.
 * Output: src/components/v15r/generatedAppBrainWorkManifest.ts
 *
 * Dependencies: Node.js fs, path, child_process only (no npm packages)
 *
 * Usage: node scripts/generate-app-brain-work-manifest.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const SCHEMA_VERSION = 'app-brain-work-manifest-v1'
const GENERATED_BY = 'scripts/generate-app-brain-work-manifest.mjs'
const REFRESH_COMMAND = 'node scripts/generate-app-brain-work-manifest.mjs'
const OUTPUT_FILE = 'src/components/v15r/generatedAppBrainWorkManifest.ts'

const SNAPSHOT_WARNING =
  'Generated snapshot · not watch mode. Re-run the generator to refresh; no automatic live tracking or git hooks.'

const REGISTRY_SOURCES = [
  'solarupgrade_agent_context/APP_BRAIN_ACTIVE_SESSIONS.json',
  'solarupgrade_agent_context/APP_BRAIN_GLOBAL_RULES.json',
  'solarupgrade_agent_context/APP_BRAIN_AGENT_RULES.json',
  'solarupgrade_agent_context/APP_BRAIN_SKILLS.json',
  'solarupgrade_agent_context/APP_BRAIN_TASK_REGISTRY.json',
]

const CONTEXT_FILES = [
  { key: 'shared', label: 'Shared context', path: 'solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md' },
  { key: 'claude', label: 'Claude context', path: 'solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md' },
  { key: 'codex', label: 'Codex context', path: 'solarupgrade_agent_context/SOLARUPGRADE_CODEX.md' },
  { key: 'cursor', label: 'Cursor context', path: 'solarupgrade_agent_context/SOLARUPGRADE_CURSOR.md' },
  { key: 'haiku', label: 'Haiku context', path: 'solarupgrade_agent_context/SOLARUPGRADE_HAIKU.md' },
]

const AGENT_ORDER = ['Claude', 'Codex', 'Cursor', 'Haiku', 'Manual/Owner']

const AGENT_CONTEXT_KEY = {
  Claude: 'claude',
  Codex: 'codex',
  Cursor: 'cursor',
  Haiku: 'haiku',
  'Manual/Owner': 'shared',
}

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{8,}/g,
  /api[_-]?key\s*[:=]\s*\S+/gi,
  /password\s*[:=]\s*\S+/gi,
  /secret\s*[:=]\s*\S+/gi,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
]

const FINANCIAL_PATTERNS = [
  /\$\s?\d[\d,]*(?:\.\d{2})?/g,
  /revenue\s*[:=]\s*\d+/gi,
  /pipeline\s*[:=]\s*\d+/gi,
]

function readJsonIfExists(relPath) {
  const absPath = path.join(repoRoot, relPath)
  if (!fs.existsSync(absPath)) return { data: null, missing: true }
  try {
    return { data: JSON.parse(fs.readFileSync(absPath, 'utf8')), missing: false }
  } catch {
    return { data: null, missing: true }
  }
}

function sanitizeExcerpt(text) {
  let cleaned = text.replace(/\r\n/g, '\n').trim()
  for (const pattern of SECRET_PATTERNS) cleaned = cleaned.replace(pattern, '[redacted]')
  for (const pattern of FINANCIAL_PATTERNS) cleaned = cleaned.replace(pattern, '[amount]')
  cleaned = cleaned.replace(/\s+/g, ' ')
  if (cleaned.length > 220) cleaned = `${cleaned.slice(0, 217)}...`
  return cleaned
}

function extractLastReportExcerpt(content) {
  if (!content) return null

  const markers = [
    /## Cursor Report[^\n]*/gi,
    /## Codex Report[^\n]*/gi,
    /## Claude Report[^\n]*/gi,
    /COMPACT HANDOFF FOR NEXT CHAT:/gi,
    /Compact handoff for next agent\/chat:/gi,
    /\* Compact handoff:/gi,
  ]

  let lastIndex = -1
  for (const marker of markers) {
    let match
    while ((match = marker.exec(content)) !== null) {
      if (match.index > lastIndex) lastIndex = match.index
    }
  }

  const slice = lastIndex >= 0 ? content.slice(lastIndex) : content.slice(-1200)
  const lines = slice
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').replace(/^[*-]\s*/, '').trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('AGENT:') && !line.startsWith('COMMIT'))

  const excerpt = lines.slice(0, 4).join(' ')
  return excerpt ? sanitizeExcerpt(excerpt) : null
}

function freshnessFromModified(modifiedAt) {
  if (!modifiedAt) return 'unknown'
  const ageMs = Date.now() - Date.parse(modifiedAt)
  if (!Number.isFinite(ageMs)) return 'unknown'
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  if (ageDays <= 7) return 'recent'
  if (ageDays <= 30) return 'aging'
  return 'stale'
}

function buildContextFileSummary(entry) {
  const absPath = path.join(repoRoot, entry.path)
  if (!fs.existsSync(absPath)) {
    return {
      key: entry.key,
      label: entry.label,
      path: entry.path,
      exists: false,
      sizeBytes: 0,
      modifiedAt: null,
      freshness: 'missing',
      lastReportExcerpt: null,
    }
  }

  const stat = fs.statSync(absPath)
  const content = fs.readFileSync(absPath, 'utf8')
  return {
    key: entry.key,
    label: entry.label,
    path: entry.path,
    exists: true,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    freshness: freshnessFromModified(stat.mtime.toISOString()),
    lastReportExcerpt: extractLastReportExcerpt(content),
  }
}

function countBacklogTasks(taskRegistry) {
  if (!taskRegistry?.domains) return { domains: 0, tasks: 0 }
  const domains = Object.values(taskRegistry.domains)
  const tasks = domains.reduce((sum, domain) => sum + (domain.tasks?.length ?? 0), 0)
  return { domains: domains.length, tasks }
}

function buildAgentsSummary(activeSessions, contextFiles) {
  const sessions = activeSessions?.sessions ? Object.values(activeSessions.sessions) : []
  const contextByKey = new Map(contextFiles.map((file) => [file.key, file]))

  return AGENT_ORDER.map((agent) => {
    const agentSessions = sessions.filter((session) => session.agent === agent)
    const activeSession =
      agentSessions.find((session) => session.status === 'active') ??
      agentSessions.find((session) => session.status === 'pending') ??
      agentSessions[0]

    const contextKey = AGENT_CONTEXT_KEY[agent]
    const contextFile = contextByKey.get(contextKey)
    const contextHealth = []
    if (!contextFile?.exists) contextHealth.push('context-missing')
    else if (contextFile.freshness === 'stale') contextHealth.push('context-stale')
    else if (contextFile.freshness === 'aging') contextHealth.push('context-aging')
    else if (contextFile.freshness === 'recent') contextHealth.push('context-recent')
    else contextHealth.push('context-unknown')

    if (activeSession?.contextHealth && activeSession.contextHealth !== 'unknown') {
      contextHealth.push(`seed-${activeSession.contextHealth}`)
    }

    return {
      agent,
      sessionCount: agentSessions.length,
      activeCount: agentSessions.filter((session) => session.status === 'active').length,
      pendingCount: agentSessions.filter((session) => session.status === 'pending').length,
      primaryTask: activeSession?.currentTask ?? null,
      status: activeSession?.status ?? 'none',
      domain: activeSession?.domain ?? null,
      contextHealth,
      domains: [...new Set(agentSessions.map((session) => session.domain).filter(Boolean))],
    }
  })
}

function buildGitStatusSummary() {
  try {
    const branch = execSync('git branch --show-current', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

    const statusOutput = execSync('git status --porcelain', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    const changedLines = statusOutput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    return {
      available: true,
      branch: branch || null,
      clean: changedLines.length === 0,
      changedFileCount: changedLines.length,
      warning: null,
    }
  } catch {
    return {
      available: false,
      branch: null,
      clean: null,
      changedFileCount: null,
      warning: 'Git status unavailable in this environment.',
    }
  }
}

function buildManifest() {
  const sourcesRead = []
  const sourcesMissing = []

  for (const relPath of REGISTRY_SOURCES) {
    if (fs.existsSync(path.join(repoRoot, relPath))) sourcesRead.push(relPath)
    else sourcesMissing.push(relPath)
  }

  const activeSessions = readJsonIfExists('solarupgrade_agent_context/APP_BRAIN_ACTIVE_SESSIONS.json')
  const globalRules = readJsonIfExists('solarupgrade_agent_context/APP_BRAIN_GLOBAL_RULES.json')
  const agentRules = readJsonIfExists('solarupgrade_agent_context/APP_BRAIN_AGENT_RULES.json')
  const skills = readJsonIfExists('solarupgrade_agent_context/APP_BRAIN_SKILLS.json')
  const taskRegistry = readJsonIfExists('solarupgrade_agent_context/APP_BRAIN_TASK_REGISTRY.json')

  for (const entry of CONTEXT_FILES) {
    if (fs.existsSync(path.join(repoRoot, entry.path))) sourcesRead.push(entry.path)
    else sourcesMissing.push(entry.path)
  }

  const contextFiles = CONTEXT_FILES.map(buildContextFileSummary)
  const backlogCounts = countBacklogTasks(taskRegistry.data)
  const agentRuleAgents = agentRules.data?.agents ? Object.keys(agentRules.data.agents).length : 0

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    generatedBy: GENERATED_BY,
    refreshCommand: REFRESH_COMMAND,
    snapshotWarning: SNAPSHOT_WARNING,
    sourcesRead: [...sourcesRead].sort((a, b) => a.localeCompare(b)),
    sourcesMissing: [...sourcesMissing].sort((a, b) => a.localeCompare(b)),
    activeSessionCount: activeSessions.data?.totalActiveSessions ?? 0,
    overallHealthy: activeSessions.data?.overallHealthy ?? true,
    typeCheckPassRate: activeSessions.data?.typeCheckPassRate ?? 100,
    agentsSummary: buildAgentsSummary(activeSessions.data, contextFiles),
    registrySummary: {
      sessionsCount: activeSessions.data?.sessions
        ? Object.keys(activeSessions.data.sessions).length
        : 0,
      globalRulesCount: globalRules.data?.globalRules?.length ?? 0,
      agentRulesCount: agentRuleAgents,
      skillsCount: skills.data?.totalSkills ?? skills.data?.skills?.length ?? 0,
      backlogDomainsCount: backlogCounts.domains,
      backlogTasksCount: backlogCounts.tasks,
    },
    contextFiles,
    gitStatus: buildGitStatusSummary(),
  }

  return manifest
}

function writeManifest(manifest) {
  const outputPath = path.join(repoRoot, OUTPUT_FILE)
  const banner = [
    '/*',
    ' * GENERATED FILE - DO NOT HAND EDIT.',
    ` * Run ${REFRESH_COMMAND} to refresh.`,
    ` * Generated by ${GENERATED_BY}.`,
    ' * generatedAt changes each time the generator is run.',
    ' */',
    '',
  ].join('\n')

  const body = `export const GENERATED_APP_BRAIN_WORK_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const\n`
  fs.writeFileSync(outputPath, `${banner}${body}`, 'utf8')
}

const manifest = buildManifest()
writeManifest(manifest)

console.log(`[app-brain] work manifest generated: ${OUTPUT_FILE}`)
console.log(
  `[app-brain] sessions=${manifest.registrySummary.sessionsCount} contextFiles=${manifest.contextFiles.filter((f) => f.exists).length}/${manifest.contextFiles.length} git=${manifest.gitStatus.available ? manifest.gitStatus.branch : 'unavailable'}`,
)
