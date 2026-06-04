#!/usr/bin/env node

/**
 * Directory Brain Generator for PowerOn Hub App Brain
 * 
 * Scans safe app source roots and generates a comprehensive directory index.
 * Output: src/components/v15r/generatedAppBrainDirectory.ts
 * 
 * Dependencies: Node.js fs, path only (no npm packages)
 * 
 * Usage: node scripts/generate-app-brain-directory.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Safe app source roots to scan
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
];

// File extensions to track
const TRACKED_EXTENSIONS = ['.tsx', '.ts', '.js', '.jsx', '.json', '.css', '.scss'];

/**
 * Recursively scan directory and collect file information
 */
function scanDirectory(dirPath, baseDir = '') {
  const files = [];
  const dirs = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip node_modules, dist, build, .git, etc.
      if (['node_modules', 'dist', 'build', '.git', '.next', 'coverage'].includes(entry.name)) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.join(baseDir, entry.name);

      if (entry.isDirectory()) {
        dirs.push({
          name: entry.name,
          path: relativePath,
          items: scanDirectory(fullPath, relativePath),
        });
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        files.push({
          name: entry.name,
          path: relativePath,
          extension: ext,
          size: fs.statSync(fullPath).size,
        });
      }
    }
  } catch (err) {
    console.warn(`Warning: Could not read directory ${dirPath}: ${err.message}`);
  }

  return { files, dirs };
}

/**
 * Extract component and export names using basic regex
 */
function extractComponentNames(filePath) {
  const components = [];
  const exports = [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Match export default function/const declarations
    const defaultExports = content.match(/export\s+default\s+(?:function|const)\s+(\w+)/g) || [];
    defaultExports.forEach(match => {
      const name = match.match(/\s+(\w+)$/)?.[1];
      if (name) exports.push({ type: 'default', name });
    });

    // Match named exports
    const namedExports = content.match(/export\s+(?:const|function|interface|type|class)\s+(\w+)/g) || [];
    namedExports.forEach(match => {
      const name = match.match(/\s+(\w+)$/)?.[1];
      if (name && !exports.some(e => e.name === name)) {
        exports.push({ type: 'named', name });
      }
    });

    // Match React component patterns (PascalCase functions)
    const componentMatches = content.match(/(?:function|const)\s+([A-Z]\w+)\s*(?:[:=\(])/g) || [];
    componentMatches.forEach(match => {
      const name = match.match(/\s+([A-Z]\w+)/)?.[1];
      if (name && !components.includes(name)) {
        components.push(name);
      }
    });
  } catch (err) {
    // Silent fail for binary/inaccessible files
  }

  return { components, exports };
}

/**
 * Build directory tree structure
 */
function buildTree(scanResult, indent = '') {
  let tree = '';

  if (scanResult.dirs && scanResult.dirs.length > 0) {
    scanResult.dirs.sort((a, b) => a.name.localeCompare(b.name));
    scanResult.dirs.forEach((dir, idx) => {
      const isLast = idx === scanResult.dirs.length - 1 && (!scanResult.files || scanResult.files.length === 0);
      tree += `${indent}${isLast ? '└── ' : '├── '}📁 ${dir.name}/\n`;
      const childIndent = indent + (isLast ? '    ' : '│   ');
      tree += buildTree(dir.items, childIndent);
    });
  }

  if (scanResult.files && scanResult.files.length > 0) {
    scanResult.files.sort((a, b) => a.name.localeCompare(b.name));
    scanResult.files.forEach((file, idx) => {
      const isLast = idx === scanResult.files.length - 1;
      const icon = file.extension === '.tsx' ? '⚛️' : file.extension === '.ts' ? '📄' : '📋';
      tree += `${indent}${isLast ? '└── ' : '├── '}${icon} ${file.name}\n`;
    });
  }

  return tree;
}

/**
 * Flatten directory structure to list all files
 */
function flattenFiles(scanResult, basePath = '') {
  let files = [];

  if (scanResult.files && scanResult.files.length > 0) {
    files = files.concat(
      scanResult.files.map(f => ({
        path: path.join(basePath, f.name).replace(/\\/g, '/'),
        name: f.name,
        ext: f.extension,
        size: f.size,
      }))
    );
  }

  if (scanResult.dirs && scanResult.dirs.length > 0) {
    scanResult.dirs.forEach(dir => {
      files = files.concat(
        flattenFiles(dir.items, path.join(basePath, dir.name).replace(/\\/g, '/'))
      );
    });
  }

  return files;
}

/**
 * Count occurrences of extensions
 */
function countExtensions(files) {
  const counts = {};
  files.forEach(file => {
    const ext = file.ext || 'unknown';
    counts[ext] = (counts[ext] || 0) + 1;
  });
  return counts;
}

/**
 * Generate the output TypeScript file
 */
function generateOutputFile(data) {
  const timestamp = new Date().toISOString();
  
  // Build file metadata array as string
  let fileMetadataStr = '';
  data.fileMetadata.forEach((fm, idx) => {
    fileMetadataStr += `    {\n`;
    fileMetadataStr += `      path: '${fm.path}',\n`;
    fileMetadataStr += `      name: '${fm.name}',\n`;
    fileMetadataStr += `      extension: '${fm.extension}',\n`;
    fileMetadataStr += `      size: ${fm.size},\n`;
    fileMetadataStr += `      area: '${fm.area}',\n`;
    
    // Always include components array (empty if no components found)
    fileMetadataStr += `      components: [${(fm.components || []).map(c => `'${c}'`).join(', ')}],\n`;
    
    // Always include exports array (empty if no exports found)
    const exportsStr = (fm.exports || []).map(e => `{ type: '${e.type}', name: '${e.name}' }`).join(', ');
    fileMetadataStr += `      exports: [${exportsStr}],\n`;
    
    fileMetadataStr += `    }`;
    if (idx < data.fileMetadata.length - 1) {
      fileMetadataStr += ',\n';
    }
  });

  const output = `/**
 * ============================================================================
 * GENERATED FILE - DO NOT EDIT MANUALLY
 * 
 * File: generatedAppBrainDirectory.ts
 * Generator: scripts/generate-app-brain-directory.mjs
 * Generated: ${timestamp}
 * Purpose: App Brain directory index for neural navigation
 * ============================================================================
 */

/**
 * Directory structure of safe app source roots
 * Includes: components, views, features, agents, utils, services
 */
export const APP_BRAIN_DIRECTORY = {
  generatedAt: '${timestamp}',
  version: '1.0',
  scanRoots: [
${SAFE_ROOTS.map(r => `    '${r}'`).join(',\n')}
  ],
  
  /**
   * Summary statistics
   */
  statistics: {
    totalFiles: ${data.sortedFiles.length},
    filesByExtension: {
${Object.entries(data.extensionCounts).map(([ext, count]) => `      '${ext}': ${count}`).join(',\n')}
    },
    filesPerArea: {
${Object.entries(data.areaStats).map(([area, count]) => `      '${area}': ${count}`).join(',\n')}
    },
  },

  /**
   * All files in stable sorted order [area/path/filename]
   */
  allFiles: [
${data.sortedFiles.map(f => `    '${f}'`).join(',\n')}
  ],

  /**
   * File metadata: name, path, extension, component exports
   */
  fileMetadata: [
${fileMetadataStr}
  ],

  /**
   * Utility function: find files by area
   */
  getFilesByArea: (area: string) => {
    return APP_BRAIN_DIRECTORY.fileMetadata.filter(f => f.area === area);
  },

  /**
   * Utility function: find files by extension
   */
  getFilesByExtension: (extension: string) => {
    return APP_BRAIN_DIRECTORY.fileMetadata.filter(f => f.extension === extension);
  },

  /**
   * Utility function: find files containing component names
   */
  searchComponents: (query: string) => {
    const lowerQuery = query.toLowerCase();
    return APP_BRAIN_DIRECTORY.fileMetadata.filter(f => 
      (f.components?.length ?? 0) > 0 && f.components!.some((c: string) => c.toLowerCase().includes(lowerQuery))
    );
  },
} as const;

export type AppBrainDirectoryType = typeof APP_BRAIN_DIRECTORY;

/**
 * Quick reference: all available areas
 */
export const APP_AREAS = [
${SAFE_ROOTS.map(r => `  '${r}'`).join(',\n')}
] as const;

/**
 * Export a simple lookup by path
 */
export function findFileByPath(filePath: string) {
  return APP_BRAIN_DIRECTORY.fileMetadata.find(f => f.path === filePath);
}
`;

  return output;
}

/**
 * Main execution
 */
async function main() {
  console.log('🧠 PowerOn App Brain Directory Generator');
  console.log('========================================\n');

  const results = {};
  let totalFiles = 0;
  let totalDirs = 0;
  let allFiles = [];
  let allFileMetadata = [];
  let areaStats = {};
  let directoryTrees = [];

  // Scan each safe root
  for (const root of SAFE_ROOTS) {
    const fullPath = path.join(rootDir, root);

    if (!fs.existsSync(fullPath)) {
      console.warn(`⚠️  Skipping missing root: ${root}`);
      continue;
    }

    console.log(`📂 Scanning ${root}...`);

    const scanResult = scanDirectory(fullPath);
    const flatFiles = flattenFiles(scanResult);
    const tree = buildTree(scanResult, '  ');

    results[root] = { scanResult, flatFiles, tree };
    totalFiles += flatFiles.length;
    areaStats[root] = flatFiles.length;

    // Add to global lists
    allFiles = allFiles.concat(flatFiles.map(f => `${root}/${f.path}`));
    directoryTrees.push(`\n### ${root}\n\`\`\`\n${tree}\`\`\``);

    // Extract metadata for TypeScript/TSX files
    flatFiles.forEach(file => {
      if (['.ts', '.tsx', '.js', '.jsx'].includes(file.ext)) {
        const fullFilePath = path.join(fullPath, file.path);
        const metadata = extractComponentNames(fullFilePath);

        allFileMetadata.push({
          path: `${root}/${file.path}`,
          name: file.name,
          extension: file.ext,
          size: file.size,
          area: root,
          components: metadata.components,
          exports: metadata.exports,
        });
      }
    });

    console.log(`✓ Found ${flatFiles.length} files`);
  }

  // Count extensions
  const extensionCounts = {};
  allFiles.forEach(f => {
    const ext = path.extname(f);
    extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
  });

  // Sort all files stably
  const sortedFiles = Array.from(new Set(allFiles)).sort((a, b) => a.localeCompare(b));

  // Generate output
  const data = {
    totalFiles: sortedFiles.length,
    extensionCounts,
    areaStats,
    sortedFiles,
    fileMetadata: allFileMetadata,
    directoryTrees,
  };

  const outputContent = generateOutputFile(data);
  const outputPath = path.join(rootDir, 'src/components/v15r/generatedAppBrainDirectory.ts');

  // Ensure directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, outputContent, 'utf-8');

  console.log('\n========================================');
  console.log(`📊 Summary`);
  console.log(`  Total files: ${sortedFiles.length}`);
  console.log(`  Areas scanned: ${SAFE_ROOTS.length}`);
  console.log(`  Extensions tracked: ${Object.keys(extensionCounts).join(', ')}`);
  console.log(`\n✅ Output written to: ${path.relative(rootDir, outputPath)}`);
  console.log('');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
