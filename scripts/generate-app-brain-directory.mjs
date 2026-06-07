#!/usr/bin/env node

/**
 * Directory Brain Generator for PowerOn Hub App Brain.
 *
 * Scans safe app source roots and writes a compact, deterministic directory
 * manifest used by the read-only App Brain Directory and File Profile panels.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const GENERATED_AT = '2026-06-06T00:00:00.000Z'

const SAFE_ROOTS = [
  'src/components/v15r',
  'src/components/blueprint',
  'src/components/neural-world',
  'src/components/shared',
  'src/views',
  'src/features',
  'src/agents',
  'src/utils',
  'src/services',
]

const TRACKED_EXTENSIONS = new Set(['.tsx', '.ts', '.js', '.jsx', '.json', '.css', '.scss'])
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.next', 'coverage'])

function toPosix(filePath) {
  return filePath.replace(/\\/g, '/')
}

function quote(value) {
  return JSON.stringify(value)
}

function makeFileId(filePath) {
  return filePath
    .toLowerCase()
    .replace(/^src\//, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function scanDirectory(dirPath, baseDir = '') {
  const files = []

  let entries = []
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch (error) {
    console.warn(`Warning: could not read ${dirPath}: ${error.message}`)
    return files
  }

  entries.sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      files.push(...scanDirectory(path.join(dirPath, entry.name), path.join(baseDir, entry.name)))
      continue
    }

    if (!entry.isFile()) continue

    const extension = path.extname(entry.name)
    if (!TRACKED_EXTENSIONS.has(extension)) continue

    const relativePath = toPosix(path.join(baseDir, entry.name))
    const fullPath = path.join(dirPath, entry.name)
    const stat = fs.statSync(fullPath)

    files.push({
      name: entry.name,
      path: relativePath,
      extension,
      size: stat.size,
    })
  }

  return files
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

function extractMetadata(filePath) {
  const content = readTextFile(filePath)
  if (!content) {
    return { components: [], exports: [], importCount: 0, imports: [] }
  }

  const components = []
  const exports = []
  const imports = []

  const componentPatterns = [
    /(?:export\s+default\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g,
    /(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*[:=]/g,
    /class\s+([A-Z][A-Za-z0-9_]*)\s+/g,
  ]

  for (const pattern of componentPatterns) {
    for (const match of content.matchAll(pattern)) {
      components.push(match[1])
    }
  }

  const exportPatterns = [
    /export\s+default\s+function\s+([A-Za-z0-9_]+)/g,
    /export\s+default\s+([A-Za-z0-9_]+)/g,
    /export\s+(?:const|function|interface|type|class|enum)\s+([A-Za-z0-9_]+)/g,
  ]

  for (const pattern of exportPatterns) {
    for (const match of content.matchAll(pattern)) {
      exports.push(match[1])
    }
  }

  const namedExportBlocks = content.matchAll(/export\s*\{([^}]+)\}/g)
  for (const match of namedExportBlocks) {
    match[1].split(',').forEach((part) => {
      const name = part.trim().split(/\s+as\s+/i)[0]?.trim()
      if (name) exports.push(name)
    })
  }

  const importPatterns = [
    /import\s+(?:type\s+)?(?:[^'"]+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]

  for (const pattern of importPatterns) {
    for (const match of content.matchAll(pattern)) {
      imports.push(match[1])
    }
  }

  return {
    components: uniqueSorted(components),
    exports: uniqueSorted(exports),
    importCount: imports.length,
    imports: uniqueSorted(imports),
  }
}

function resolveLocalImport(importerPath, specifier) {
  if (!specifier.startsWith('.')) return null

  const importerDir = path.posix.dirname(importerPath)
  const base = path.posix.normalize(path.posix.join(importerDir, specifier))
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.json`,
    path.posix.join(base, 'index.ts'),
    path.posix.join(base, 'index.tsx'),
    path.posix.join(base, 'index.js'),
    path.posix.join(base, 'index.jsx'),
  ]

  return candidates
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item)
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
}

function serializeFile(file) {
  return `    {
      fileId: ${quote(file.fileId)},
      path: ${quote(file.path)},
      name: ${quote(file.name)},
      parentDirectory: ${quote(file.parentDirectory)},
      extension: ${quote(file.extension)},
      size: ${file.size},
      area: ${quote(file.area)},
      components: [${file.components.map(quote).join(', ')}],
      exports: [${file.exports.map(quote).join(', ')}],
      importCount: ${file.importCount},
      importedByCount: ${file.importedByCount},
      importedBy: [${file.importedBy.map(quote).join(', ')}],
    }`
}

function generateOutput(files, extensionCounts, areaCounts) {
  return `/**
 * ============================================================================
 * GENERATED FILE - DO NOT EDIT MANUALLY
 *
 * File: generatedAppBrainDirectory.ts
 * Generator: scripts/generate-app-brain-directory.mjs
 * Generated: ${GENERATED_AT}
 * Purpose: App Brain directory index for neural navigation
 * ============================================================================
 */

export interface AppBrainDirectoryFile {
  fileId: string
  path: string
  name: string
  parentDirectory: string
  extension: string
  size: number
  area: string
  components: string[]
  exports: string[]
  importCount: number
  importedByCount: number
  importedBy: string[]
}

export const APP_BRAIN_DIRECTORY = {
  generatedAt: ${quote(GENERATED_AT)},
  version: '2.0',
  scanRoots: [
${SAFE_ROOTS.map((root) => `    ${quote(root)}`).join(',\n')}
  ],
  statistics: {
    totalFiles: ${files.length},
    filesByExtension: {
${Object.entries(extensionCounts).map(([extension, count]) => `      ${quote(extension)}: ${count}`).join(',\n')}
    },
    filesPerArea: {
${Object.entries(areaCounts).map(([area, count]) => `      ${quote(area)}: ${count}`).join(',\n')}
    },
  },
  allFiles: [
${files.map((file) => `    ${quote(file.path)}`).join(',\n')}
  ],
  fileMetadata: [
${files.map(serializeFile).join(',\n')}
  ] satisfies AppBrainDirectoryFile[],
} as const

export type AppBrainDirectoryType = typeof APP_BRAIN_DIRECTORY
export type AppBrainDirectoryFilePath = (typeof APP_BRAIN_DIRECTORY.allFiles)[number]

export const APP_AREAS = [
${SAFE_ROOTS.map((root) => `  ${quote(root)}`).join(',\n')}
] as const

export function findFileByPath(filePath: string): AppBrainDirectoryFile | undefined {
  return APP_BRAIN_DIRECTORY.fileMetadata.find((file) => file.path === filePath)
}
`
}

function main() {
  console.log('PowerOn App Brain Directory Generator')
  console.log('====================================')

  const files = []

  for (const root of SAFE_ROOTS) {
    const fullRoot = path.join(rootDir, root)
    if (!fs.existsSync(fullRoot)) {
      console.warn(`Skipping missing root: ${root}`)
      continue
    }

    const rootFiles = scanDirectory(fullRoot)
    console.log(`Scanned ${root}: ${rootFiles.length} files`)

    for (const file of rootFiles) {
      const appPath = `${root}/${file.path}`
      const metadata = extractMetadata(path.join(fullRoot, file.path))
      files.push({
        fileId: makeFileId(appPath),
        path: appPath,
        name: file.name,
        parentDirectory: path.posix.dirname(appPath),
        extension: file.extension,
        size: file.size,
        area: root,
        components: metadata.components,
        exports: metadata.exports,
        importCount: metadata.importCount,
        imports: metadata.imports,
        importedBy: [],
        importedByCount: 0,
      })
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path))
  const pathSet = new Set(files.map((file) => file.path))
  const fileByPath = new Map(files.map((file) => [file.path, file]))

  for (const file of files) {
    for (const specifier of file.imports) {
      const candidates = resolveLocalImport(file.path, specifier)
      const resolvedPath = candidates?.find((candidate) => pathSet.has(candidate))
      if (!resolvedPath) continue

      const importedFile = fileByPath.get(resolvedPath)
      if (importedFile) importedFile.importedBy.push(file.path)
    }
  }

  for (const file of files) {
    file.importedBy = uniqueSorted(file.importedBy)
    file.importedByCount = file.importedBy.length
    delete file.imports
  }

  const extensionCounts = countBy(files, (file) => file.extension)
  const areaCounts = countBy(files, (file) => file.area)
  const output = generateOutput(files, extensionCounts, areaCounts)
  const outputPath = path.join(rootDir, 'src/components/v15r/generatedAppBrainDirectory.ts')

  fs.writeFileSync(outputPath, output, 'utf-8')

  console.log('====================================')
  console.log(`Total files: ${files.length}`)
  console.log(`Output: ${path.relative(rootDir, outputPath)}`)
}

main()
