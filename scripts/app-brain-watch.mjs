#!/usr/bin/env node

/**
 * App Brain Watch / Refresh Utility
 *
 * Opt-in CLI for refreshing App Brain generated snapshots.
 * Node built-ins only — no dependencies, no git hooks, no auto-commit.
 *
 * Usage:
 *   node scripts/app-brain-watch.mjs            # one-shot refresh (default)
 *   node scripts/app-brain-watch.mjs --once     # one-shot refresh
 *   node scripts/app-brain-watch.mjs --watch    # opt-in poll loop (Ctrl+C to stop)
 *   node scripts/app-brain-watch.mjs --help
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const SCHEMA_VERSION = 'app-brain-runtime-snapshot-v1'
const GENERATED_BY = 'scripts/app-brain-watch.mjs'
const OUTPUT_FILE = 'src/components/v15r/generatedAppBrainRuntimeSnapshot.ts'
const DEFAULT_INTERVAL_MS = 30_000

const GENERATORS = [
  {
    source: 'app-brain-manifest',
    command: 'node scripts/generate-app-brain-manifest.mjs',
    output: 'src/components/v15r/generatedAppBrainManifest.ts',
  },
  {
    source: 'directory-manifest',
    command: 'node scripts/generate-app-brain-directory.mjs',
    output: 'src/components/v15r/generatedAppBrainDirectory.ts',
  },
  {
    source: 'work-manifest',
    command: 'node scripts/generate-app-brain-work-manifest.mjs',
    output: 'src/components/v15r/generatedAppBrainWorkManifest.ts',
  },
]

const SAFETY_NOTES = [
  'Opt-in CLI utility — not a git hook or background daemon',
  'No auto-commit, auto-push, or auto-staging',
  'Only regenerates App Brain snapshot TypeScript files',
  'Git status captures file paths only — never diff contents',
  'Secrets, credentials, and .env paths excluded from change lists',
  'No operational financial values in runtime snapshot',
  'Watch mode polls source mtimes — skips refresh when inputs unchanged (HMR-safe)',
  'Timestamp-only generator output is not rewritten when content is unchanged',
]

const SKIP_PATH_PATTERNS = [
  /(^|[/\\])\.env/i,
  /secret/i,
  /credential/i,
  /\.local\.json$/i,
  /node_modules/,
  /\.git([/\\]|$)/,
  /(^|[/\\])dist([/\\]|$)/,
  /generatedAppBrain/i,
]

const VOLATILE_TS_PATTERNS = [
  [/"generatedAt"\s*:\s*"[^"]*"/g, '"generatedAt":"__VOLATILE__"'],
  [/"modifiedAt"\s*:\s*"[^"]*"/g, '"modifiedAt":"__VOLATILE__"'],
  [/"completedAt"\s*:\s*"[^"]*"/g, '"completedAt":"__VOLATILE__"'],
  [/"lastRunAt"\s*:\s*"[^"]*"/g, '"lastRunAt":"__VOLATILE__"'],
  [/"durationMs"\s*:\s*\d+/g, '"durationMs":0'],
  [/\* generatedAt changes each time the refresh runs\./g, '* generatedAt volatile'],
]

function printHelp() {
  console.log(`App Brain Watch / Refresh Utility

Commands:
  node scripts/app-brain-watch.mjs            One-shot refresh (default)
  node scripts/app-brain-watch.mjs --once     One-shot refresh
  node scripts/app-brain-watch.mjs --watch    Opt-in poll loop (Ctrl+C to stop)
  node scripts/app-brain-watch.mjs --help     Show this help

npm scripts:
  npm run app-brain:refresh                   One-shot refresh
  npm run app-brain:watch                     Opt-in watch loop

Watch options:
  --interval=60                               Poll interval in seconds (default: 30)

Watch behavior:
  - Polls stable source inputs (src/**/*.ts(x), APP_BRAIN*.json, SOLARUPGRADE_*.md)
  - Skips generator refresh when no meaningful source changes (HMR-safe)
  - Skips writing generated TS files when only timestamp fields changed

Safety:
  - No git hooks, no auto-commit, no auto-push
  - Only updates App Brain generated snapshot files
  - Git paths only — no file contents, secrets, or financial values
  - Press Ctrl+C to stop watch mode
`)
}

function parseArgs(argv) {
  let mode = 'once'
  let intervalMs = DEFAULT_INTERVAL_MS
  let help = false

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--once') {
      mode = 'once'
    } else if (arg === '--watch') {
      mode = 'watch'
    } else if (arg.startsWith('--interval=')) {
      const seconds = Number(arg.slice('--interval='.length))
      if (Number.isFinite(seconds) && seconds > 0) {
        intervalMs = Math.round(seconds * 1000)
      }
    }
  }

  return { mode, intervalMs, help }
}

function shouldSkipPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/')
  return SKIP_PATH_PATTERNS.some((pattern) => pattern.test(normalized))
}

function stripVolatileTsContent(content) {
  let normalized = content.replace(/\r\n/g, '\n')
  for (const [pattern, replacement] of VOLATILE_TS_PATTERNS) {
    normalized = normalized.replace(pattern, replacement)
  }
  return normalized
}

function contentsMeaningfullyEqual(before, after) {
  if (before === after) return true
  if (!before || !after) return false
  return stripVolatileTsContent(before) === stripVolatileTsContent(after)
}

function parsePorcelainPath(line) {
  const raw = line.slice(3).trim()
  if (!raw) return null
  if (raw.includes(' -> ')) {
    return raw.split(' -> ').pop()?.trim() ?? null
  }
  return raw.replace(/^"(.*)"$/, '$1')
}

function captureGitStatus() {
  const warnings = []

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

    const lines = statusOutput
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)

    const changedFiles = []
    for (const line of lines) {
      const parsed = parsePorcelainPath(line)
      if (!parsed || shouldSkipPath(parsed)) continue
      changedFiles.push(parsed.replace(/\\/g, '/'))
    }

    const uniqueChangedFiles = [...new Set(changedFiles)].sort((a, b) => a.localeCompare(b))

    return {
      branch: branch || null,
      gitClean: lines.length === 0,
      changedFileCount: lines.length,
      changedFiles: uniqueChangedFiles,
      warnings,
    }
  } catch (error) {
    warnings.push(`Git status unavailable: ${error instanceof Error ? error.message : String(error)}`)
    return {
      branch: null,
      gitClean: null,
      changedFileCount: 0,
      changedFiles: [],
      warnings,
    }
  }
}

function isWatchedSourceFile(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/')
  if (shouldSkipPath(normalized)) return false

  if (normalized.startsWith('src/') && (normalized.endsWith('.ts') || normalized.endsWith('.tsx'))) {
    return true
  }

  if (normalized.startsWith('solarupgrade_agent_context/')) {
    const baseName = path.posix.basename(normalized)
    if (baseName.startsWith('APP_BRAIN') && baseName.endsWith('.json')) return true
    if (baseName.startsWith('SOLARUPGRADE_') && baseName.endsWith('.md')) return true
  }

  return false
}

function walkDirectory(absoluteDir, relativeDir = '') {
  const files = []
  if (!fs.existsSync(absoluteDir)) return files

  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
    const normalized = relativePath.replace(/\\/g, '/')

    if (entry.isDirectory()) {
      if (shouldSkipPath(`${normalized}/`)) continue
      files.push(...walkDirectory(path.join(absoluteDir, entry.name), normalized))
      continue
    }

    if (entry.isFile() && isWatchedSourceFile(normalized)) {
      files.push(normalized)
    }
  }

  return files
}

function collectWatchedSourceFiles() {
  const srcRoot = path.join(repoRoot, 'src')
  const contextRoot = path.join(repoRoot, 'solarupgrade_agent_context')
  const files = [
    ...walkDirectory(srcRoot, 'src'),
    ...walkDirectory(contextRoot, 'solarupgrade_agent_context'),
  ]
  return [...new Set(files)].sort((a, b) => a.localeCompare(b))
}

function computeSourceSignature() {
  const parts = []
  for (const relativePath of collectWatchedSourceFiles()) {
    const absolutePath = path.join(repoRoot, relativePath)
    try {
      const stat = fs.statSync(absolutePath)
      parts.push(`${relativePath}:${stat.mtimeMs}:${stat.size}`)
    } catch {
      parts.push(`${relativePath}:missing`)
    }
  }
  return parts.join('\n')
}

function runGenerator(generator) {
  const startedAt = Date.now()

  try {
    execSync(generator.command, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    return {
      source: generator.source,
      command: generator.command,
      success: true,
      durationMs: Date.now() - startedAt,
      outputFile: generator.output,
    }
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : ''
    const message = error instanceof Error ? error.message : String(error)

    return {
      source: generator.source,
      command: generator.command,
      success: false,
      durationMs: Date.now() - startedAt,
      outputFile: generator.output,
      error: (stderr || message).trim().slice(0, 500) || 'Generator failed',
    }
  }
}

function runGeneratorWithStability(generator) {
  const outputPath = path.join(repoRoot, generator.output)
  const before = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null
  const result = runGenerator(generator)

  if (!result.success) {
    return {
      ...result,
      written: false,
      skippedNoMeaningfulChange: false,
    }
  }

  const after = fs.readFileSync(outputPath, 'utf8')
  if (before && contentsMeaningfullyEqual(before, after)) {
    fs.writeFileSync(outputPath, before, 'utf8')
    return {
      ...result,
      written: false,
      skippedNoMeaningfulChange: true,
    }
  }

  return {
    ...result,
    written: true,
    skippedNoMeaningfulChange: false,
  }
}

function formatRuntimeSnapshotFile(snapshot) {
  const banner = [
    '/*',
    ' * GENERATED FILE - DO NOT HAND EDIT.',
    ' * Run npm run app-brain:refresh or npm run app-brain:watch to refresh.',
    ` * Generated by ${GENERATED_BY}.`,
    ' * generatedAt changes each time the refresh runs.',
    ' */',
    '',
  ].join('\n')

  const body = `export const GENERATED_APP_BRAIN_RUNTIME_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)} as const\n`
  return `${banner}${body}`
}

function normalizeSnapshotForCompare(snapshot) {
  const clone = JSON.parse(JSON.stringify(snapshot))
  delete clone.generatedAt
  delete clone.changedFileCount
  delete clone.changedFiles
  delete clone.gitClean
  delete clone.branch
  delete clone.filesWritten
  delete clone.filesSkipped
  delete clone.skippedNoMeaningfulChanges
  delete clone.sourceChanged

  if (Array.isArray(clone.generatorResults)) {
    clone.generatorResults = clone.generatorResults.map((result) => {
      const next = { ...result }
      delete next.durationMs
      delete next.written
      delete next.skippedNoMeaningfulChange
      return next
    })
  }

  return JSON.stringify(clone)
}

function writeRuntimeSnapshot(snapshot, options = {}) {
  const { force = false } = options
  const outputPath = path.join(repoRoot, OUTPUT_FILE)
  const newContent = formatRuntimeSnapshotFile(snapshot)
  const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null

  if (!force && existing) {
    const existingObject = extractSnapshotObject(existing)
    if (existingObject && normalizeSnapshotForCompare(existingObject) === normalizeSnapshotForCompare(snapshot)) {
      return { written: false, path: OUTPUT_FILE, skippedNoMeaningfulChange: true }
    }
  }

  fs.writeFileSync(outputPath, newContent, 'utf8')
  return { written: true, path: OUTPUT_FILE, skippedNoMeaningfulChange: false }
}

function markWatchStopped() {
  const outputPath = path.join(repoRoot, OUTPUT_FILE)
  const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null
  const existingObject = existing ? extractSnapshotObject(existing) : null
  if (!existingObject) return null

  const git = captureGitStatus()
  const stopped = {
    ...existingObject,
    generatedAt: new Date().toISOString(),
    isWatchModeRunning: false,
    mode: 'watch',
    branch: git.branch,
    gitClean: git.gitClean,
    changedFileCount: git.changedFileCount,
    changedFiles: git.changedFiles,
  }

  const write = writeRuntimeSnapshot(stopped, { force: true })
  return { snapshot: stopped, write }
}

function extractSnapshotObject(fileContent) {
  const marker = 'export const GENERATED_APP_BRAIN_RUNTIME_SNAPSHOT = '
  const start = fileContent.indexOf(marker)
  if (start < 0) return null

  const jsonStart = start + marker.length
  const jsonEnd = fileContent.lastIndexOf('} as const')
  if (jsonEnd < jsonStart) return null

  try {
    return JSON.parse(fileContent.slice(jsonStart, jsonEnd + 1))
  } catch {
    return null
  }
}

function runRefresh(mode, isWatchModeRunning, options = {}) {
  const { sourceChanged = true, hmrSafeWatch = mode === 'watch' } = options
  const warnings = []
  const generatorResults = []
  const sourcesRefreshed = []
  const filesWritten = []
  const filesSkipped = []
  let skippedNoMeaningfulChanges = 0

  for (const generator of GENERATORS) {
    const result = runGeneratorWithStability(generator)
    generatorResults.push(result)

    if (result.success) {
      if (result.written) {
        sourcesRefreshed.push(result.source)
        filesWritten.push(result.outputFile)
      } else if (result.skippedNoMeaningfulChange) {
        filesSkipped.push(result.outputFile)
        skippedNoMeaningfulChanges += 1
      }
    } else {
      warnings.push(`Generator failed (${result.source}): ${result.error}`)
    }
  }

  const git = captureGitStatus()
  warnings.push(...git.warnings)

  const snapshot = {
    generatedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    mode,
    isWatchModeAvailable: true,
    isWatchModeRunning,
    hmrSafeWatch,
    sourceChanged,
    refreshCommand: mode === 'watch' ? 'npm run app-brain:watch' : 'npm run app-brain:refresh',
    branch: git.branch,
    gitClean: git.gitClean,
    changedFileCount: git.changedFileCount,
    changedFiles: git.changedFiles,
    generatorResults,
    sourcesRefreshed,
    filesWritten,
    filesSkipped,
    skippedNoMeaningfulChanges,
    warnings,
    safetyNotes: SAFETY_NOTES,
    noSecrets: true,
    noFinancialValues: true,
  }

  const runtimeWrite = writeRuntimeSnapshot(snapshot, { force: mode === 'once' })
  if (runtimeWrite.written) {
    filesWritten.push(runtimeWrite.path)
  } else if (runtimeWrite.skippedNoMeaningfulChange) {
    filesSkipped.push(runtimeWrite.path)
    skippedNoMeaningfulChanges += 1
  }

  snapshot.filesWritten = filesWritten
  snapshot.filesSkipped = filesSkipped
  snapshot.skippedNoMeaningfulChanges = skippedNoMeaningfulChanges

  return snapshot
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function logRefreshSummary(snapshot, label) {
  console.log(`[app-brain-watch] ${label}`)
  console.log(
    `[app-brain-watch] branch=${snapshot.branch ?? 'unknown'} clean=${snapshot.gitClean} generators=${snapshot.sourcesRefreshed.length}/${GENERATORS.length} written=${snapshot.filesWritten.length} skipped=${snapshot.skippedNoMeaningfulChanges}`,
  )

  if (snapshot.filesWritten.length > 0) {
    console.log(`[app-brain-watch] wrote: ${snapshot.filesWritten.join(', ')}`)
  }
  if (snapshot.filesSkipped.length > 0) {
    console.log(`[app-brain-watch] skipped (no meaningful change): ${snapshot.filesSkipped.join(', ')}`)
  }
}

async function main() {
  const { mode, intervalMs, help } = parseArgs(process.argv.slice(2))

  if (help) {
    printHelp()
    return
  }

  if (mode === 'once') {
    const snapshot = runRefresh('once', false, { sourceChanged: true, hmrSafeWatch: false })
    logRefreshSummary(snapshot, `refresh complete: ${OUTPUT_FILE}`)

    const failed = snapshot.generatorResults.filter((result) => !result.success)
    if (failed.length > 0) {
      process.exitCode = 1
    }
    return
  }

  let running = true
  let lastSourceSignature = computeSourceSignature()

  const handleStop = () => {
    if (!running) return
    running = false
    console.log('\n[app-brain-watch] stopping watch loop (Ctrl+C)')
  }

  process.on('SIGINT', handleStop)
  process.on('SIGTERM', handleStop)

  console.log(
    `[app-brain-watch] starting HMR-safe watch loop (interval=${intervalMs}ms). Press Ctrl+C to stop.`,
  )
  console.log('[app-brain-watch] initial source signature captured — no refresh until inputs change')

  while (running) {
    await sleep(intervalMs)
    if (!running) break

    const currentSignature = computeSourceSignature()
    const sourceChanged = currentSignature !== lastSourceSignature

    if (!sourceChanged) {
      console.log(
        `[app-brain-watch] skipped poll — no meaningful source changes since last refresh (HMR-safe)`,
      )
      continue
    }

    lastSourceSignature = currentSignature
    const snapshot = runRefresh('watch', true, { sourceChanged: true, hmrSafeWatch: true })
    logRefreshSummary(snapshot, `snapshot refreshed at ${snapshot.generatedAt}`)
  }

  const stopped = markWatchStopped()
  if (stopped?.write.written) {
    console.log(`[app-brain-watch] watch stopped — marked isWatchModeRunning=false in ${OUTPUT_FILE}`)
  } else {
    console.log('[app-brain-watch] watch stopped — runtime snapshot unchanged')
  }
}

main().catch((error) => {
  console.error('[app-brain-watch] unrecoverable error:', error)
  process.exit(1)
})
