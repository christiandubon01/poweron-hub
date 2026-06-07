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
]

const SKIP_PATH_PATTERNS = [
  /(^|[/\\])\.env/i,
  /secret/i,
  /credential/i,
  /\.local\.json$/i,
  /node_modules/,
  /\.git([/\\]|$)/,
]

function printHelp() {
  console.log(`App Brain Watch / Refresh Utility

Commands:
  node scripts/app-brain-watch.mjs            One-shot refresh (default)
  node scripts/app-brain-watch.mjs --once     One-shot refresh
  node scripts/app-brain-watch.mjs --watch    Opt-in watch loop (Ctrl+C to stop)
  node scripts/app-brain-watch.mjs --help     Show this help

npm scripts:
  npm run app-brain:refresh                   One-shot refresh
  npm run app-brain:watch                     Opt-in watch loop

Watch options:
  --interval=60                               Poll interval in seconds (default: 30)

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

function writeRuntimeSnapshot(snapshot) {
  const outputPath = path.join(repoRoot, OUTPUT_FILE)
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
  fs.writeFileSync(outputPath, `${banner}${body}`, 'utf8')
}

function runRefresh(mode, isWatchModeRunning) {
  const warnings = []
  const generatorResults = []
  const sourcesRefreshed = []

  for (const generator of GENERATORS) {
    const result = runGenerator(generator)
    generatorResults.push(result)
    if (result.success) {
      sourcesRefreshed.push(result.source)
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
    refreshCommand: mode === 'watch' ? 'npm run app-brain:watch' : 'npm run app-brain:refresh',
    branch: git.branch,
    gitClean: git.gitClean,
    changedFileCount: git.changedFileCount,
    changedFiles: git.changedFiles,
    generatorResults,
    sourcesRefreshed,
    warnings,
    safetyNotes: SAFETY_NOTES,
    noSecrets: true,
    noFinancialValues: true,
  }

  writeRuntimeSnapshot(snapshot)
  return snapshot
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const { mode, intervalMs, help } = parseArgs(process.argv.slice(2))

  if (help) {
    printHelp()
    return
  }

  if (mode === 'once') {
    const snapshot = runRefresh('once', false)
    console.log(`[app-brain-watch] refresh complete: ${OUTPUT_FILE}`)
    console.log(
      `[app-brain-watch] branch=${snapshot.branch ?? 'unknown'} clean=${snapshot.gitClean} generators=${snapshot.sourcesRefreshed.length}/${GENERATORS.length}`,
    )

    const failed = snapshot.generatorResults.filter((result) => !result.success)
    if (failed.length > 0) {
      process.exitCode = 1
    }
    return
  }

  let running = true

  const handleStop = () => {
    if (!running) return
    running = false
    console.log('\n[app-brain-watch] stopping watch loop (Ctrl+C)')
  }

  process.on('SIGINT', handleStop)
  process.on('SIGTERM', handleStop)

  console.log(
    `[app-brain-watch] starting watch loop (interval=${intervalMs}ms). Press Ctrl+C to stop.`,
  )

  while (running) {
    const snapshot = runRefresh('watch', true)
    console.log(
      `[app-brain-watch] snapshot refreshed at ${snapshot.generatedAt} (branch=${snapshot.branch ?? 'unknown'})`,
    )

    if (!running) break

    await sleep(intervalMs)
  }

  runRefresh('watch', false)
  console.log('[app-brain-watch] watch stopped')
}

main().catch((error) => {
  console.error('[app-brain-watch] unrecoverable error:', error)
  process.exit(1)
})
