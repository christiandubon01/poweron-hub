import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const SCHEMA_VERSION = 'app-brain-manifest-v1'
const GENERATED_BY = 'scripts/generate-app-brain-manifest.mjs'
const REFRESH_COMMAND = 'npm run app-brain:generate'
const SCAN_DIRS = [
  'src/components/v15r',
  'src/views',
  'src/features',
  'src/components/shared',
  'src/components/neural-world',
  'src/components/blueprint',
  'src/components/nexus',
  'src/agents',
  'src/utils',
]

const OUTPUT_FILE = 'src/components/v15r/generatedAppBrainManifest.ts'
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.next', 'coverage'])
const SKIPPED_PATTERNS = [
  'node_modules/',
  'dist/',
  'build/',
  '.git/',
  '.next/',
  'coverage/',
  '.env*',
  '*secret*',
  '*credential*',
  'generatedAppBrainManifest.ts',
]
const SKIP_FILE_PATTERNS = [
  /(^|[/\\])\.env/i,
  /secret/i,
  /credential/i,
  /generatedAppBrainManifest\.ts$/,
]

function toPosix(filePath) {
  return filePath.split(path.sep).join('/')
}

function repoRelative(absPath) {
  return toPosix(path.relative(repoRoot, absPath))
}

function isSafeFile(absPath) {
  const rel = repoRelative(absPath)
  const ext = path.extname(absPath)
  return SOURCE_EXTENSIONS.has(ext) && !SKIP_FILE_PATTERNS.some((pattern) => pattern.test(rel))
}

function walkDir(absDir, files = []) {
  if (!fs.existsSync(absDir)) return files

  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walkDir(path.join(absDir, entry.name), files)
      continue
    }

    const absFile = path.join(absDir, entry.name)
    if (entry.isFile() && isSafeFile(absFile)) files.push(absFile)
  }

  return files
}

function getArea(relPath) {
  if (relPath.startsWith('src/components/v15r/')) return 'V15r'
  if (relPath.startsWith('src/views/')) return 'Views'
  if (relPath.startsWith('src/features/')) return 'Features'
  if (relPath.startsWith('src/components/shared/')) return 'Shared Components'
  if (relPath.startsWith('src/components/neural-world/')) return 'Neural World'
  if (relPath.startsWith('src/components/blueprint/')) return 'Blueprint'
  if (relPath.startsWith('src/components/nexus/')) return 'NEXUS Components'
  if (relPath.startsWith('src/agents/')) return 'Agents'
  if (relPath.startsWith('src/utils/')) return 'Utils'
  return 'Other'
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

function extractImports(source) {
  const imports = []
  const patterns = [
    /import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    /export\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)['"]([^'"]+)['"]/g,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(source)) !== null) imports.push(match[1])
  }

  return imports
}

function makeResolver(scannedRelFiles) {
  const scanned = new Set(scannedRelFiles)
  const candidatesFor = (base) => [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
  ]

  return function resolveImport(fromRel, specifier) {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null

    const fromDir = path.posix.dirname(fromRel)
    const base = specifier.startsWith('@/')
      ? `src/${specifier.slice(2)}`
      : path.posix.normalize(path.posix.join(fromDir, specifier))

    return candidatesFor(base).find((candidate) => scanned.has(candidate)) ?? null
  }
}

function detectRouteCandidates(relPath, source) {
  const candidates = []
  if (relPath.startsWith('src/views/')) {
    candidates.push({
      file: relPath,
      kind: 'view-file',
      label: path.basename(relPath).replace(/\.(tsx?|jsx?)$/, ''),
    })
  }

  const lazyMatches = source.matchAll(/lazy\(\s*\(\)\s*=>\s*[^'"]*['"]([^'"]+)['"]/g)
  for (const match of lazyMatches) {
    candidates.push({ file: relPath, kind: 'lazy-import', label: match[1] })
  }

  const routeMatches = source.matchAll(/case\s+['"]([^'"]+)['"]\s*:/g)
  for (const match of routeMatches) {
    candidates.push({ file: relPath, kind: 'switch-case', label: match[1] })
  }

  return candidates
}

function buildManifest() {
  const absFiles = uniqueSorted(SCAN_DIRS.flatMap((dir) => walkDir(path.join(repoRoot, dir)).map(repoRelative)))
  const resolveImport = makeResolver(absFiles)
  const fileRecords = []
  const detectedEdges = []
  const routeCandidates = []
  const importsByTarget = new Map()

  for (const relPath of absFiles) {
    const absPath = path.join(repoRoot, relPath)
    const source = fs.readFileSync(absPath, 'utf8')
    const imports = uniqueSorted(extractImports(source))
    const localImports = []

    for (const specifier of imports) {
      const target = resolveImport(relPath, specifier)
      if (!target) continue
      localImports.push(target)
      detectedEdges.push({ from: relPath, to: target })
      importsByTarget.set(target, (importsByTarget.get(target) ?? 0) + 1)
    }

    routeCandidates.push(...detectRouteCandidates(relPath, source))
    fileRecords.push({
      path: relPath,
      area: getArea(relPath),
      importCount: imports.length,
      localImportCount: localImports.length,
    })
  }

  const areaMap = new Map()
  for (const file of fileRecords) {
    const area = areaMap.get(file.area) ?? { name: file.area, fileCount: 0, importCount: 0 }
    area.fileCount += 1
    area.importCount += file.importCount
    areaMap.set(file.area, area)
  }

  const highTouchFiles = fileRecords
    .map((file) => ({
      path: file.path,
      area: file.area,
      importCount: file.importCount,
      importedByCount: importsByTarget.get(file.path) ?? 0,
      touchScore: file.importCount + (importsByTarget.get(file.path) ?? 0),
    }))
    .filter((file) => file.touchScore > 0)
    .sort((a, b) => b.touchScore - a.touchScore || a.path.localeCompare(b.path))
    .slice(0, 20)

  const sharedSystemCandidates = highTouchFiles
    .filter((file) => file.importedByCount >= 2 || file.path.includes('/shared/') || file.path.includes('/utils/'))
    .slice(0, 16)

  const adminCandidates = fileRecords
    .filter((file) => /admin|nexus|guardian|security|diagnostic|visual/i.test(file.path))
    .map((file) => ({ path: file.path, area: file.area, importCount: file.importCount }))
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, 24)

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    generatedBy: GENERATED_BY,
    refreshCommand: REFRESH_COMMAND,
    scannedRoots: [...SCAN_DIRS],
    skippedPatterns: [...SKIPPED_PATTERNS],
    repoRelative: true,
    totalFiles: fileRecords.length,
    totalImports: fileRecords.reduce((sum, file) => sum + file.importCount, 0),
    areas: Array.from(areaMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    files: fileRecords.sort((a, b) => a.path.localeCompare(b.path)),
    detectedEdges: detectedEdges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    highTouchFiles,
    sharedSystemCandidates,
    adminCandidates,
    routeViewCandidates: routeCandidates
      .sort((a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label))
      .slice(0, 40),
  }
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

  const body = `export const GENERATED_APP_BRAIN_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const\n`
  fs.writeFileSync(outputPath, `${banner}${body}`, 'utf8')
}

const manifest = buildManifest()
writeManifest(manifest)

console.log(`[app-brain] manifest generated: ${OUTPUT_FILE}`)
console.log(`[app-brain] files=${manifest.totalFiles} imports=${manifest.totalImports} edges=${manifest.detectedEdges.length}`)
