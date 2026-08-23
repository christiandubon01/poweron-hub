import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  DISCOVERY_RESOLUTION_TIMEOUT_MS,
  DISCOVERY_TIMEOUT_MS,
  type DiscoveryError,
  type HarnessKind,
  type ProviderDiscoveryRecord,
} from '../types.ts';

const execFileAsync = promisify(execFile);

interface ToolProbe {
  toolId: string;
  displayName: string;
  kind: 'provider' | 'diagnostic';
  command: string;
  workerCapable: boolean;
  preferredExtensions: string[];
}

interface ProcessOutput {
  stdout: string;
  stderr: string;
}

export interface DiscoveryDependencies {
  resolveCommandCandidates?: ((command: string, timeoutMs: number) => Promise<string[]>) | undefined;
  runNativeVersion?: ((resolvedPath: string, args: string[], timeoutMs: number) => Promise<ProcessOutput>) | undefined;
  runWrapperVersion?: ((resolvedPath: string, args: string[], timeoutMs: number) => Promise<ProcessOutput>) | undefined;
  now?: (() => Date) | undefined;
  timeoutMs?: number | undefined;
  resolutionTimeoutMs?: number | undefined;
}

const TOOL_PROBES: ToolProbe[] = [
  {
    toolId: 'claude-code',
    displayName: 'Claude Code',
    kind: 'provider',
    command: 'claude',
    workerCapable: true,
    preferredExtensions: ['.exe', '.cmd', ''],
  },
  {
    toolId: 'codex-cli',
    displayName: 'Codex CLI',
    kind: 'provider',
    command: 'codex',
    workerCapable: true,
    preferredExtensions: ['.cmd', '.exe', ''],
  },
  {
    toolId: 'ollama-cli',
    displayName: 'Ollama CLI',
    kind: 'provider',
    command: 'ollama',
    workerCapable: true,
    preferredExtensions: ['.exe', '.cmd', ''],
  },
  {
    toolId: 'cursor-agent',
    displayName: 'Cursor Agent',
    kind: 'provider',
    command: 'cursor-agent',
    workerCapable: true,
    preferredExtensions: ['.exe', '.cmd', ''],
  },
  {
    toolId: 'cursor-editor',
    displayName: 'Cursor Editor CLI',
    kind: 'diagnostic',
    command: 'cursor',
    workerCapable: false,
    preferredExtensions: ['.cmd', '.exe', ''],
  },
];

function createMissingResult(probe: ToolProbe, discoveredAt: string, error?: DiscoveryError): ProviderDiscoveryRecord {
  return {
    toolId: probe.toolId,
    displayName: probe.displayName,
    kind: probe.kind,
    command: probe.command,
    harnessKind: 'missing',
    installed: false,
    workerCapable: probe.workerCapable,
    discoveredAt,
    error,
  };
}

function sanitizeVersionOutput(output: string): string | undefined {
  const firstLine = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return undefined;
  }

  return firstLine.slice(0, 200);
}

function pickResolvedPath(candidates: string[], preferredExtensions: string[]): string | undefined {
  const normalizedCandidates = candidates.filter((candidate) => candidate.trim().length > 0);

  for (const extension of preferredExtensions) {
    const match = normalizedCandidates.find((candidate) => candidate.toLowerCase().endsWith(extension.toLowerCase()));
    if (match) {
      return match;
    }
  }

  return normalizedCandidates[0];
}

function determineHarnessKind(resolvedPath: string): HarnessKind {
  const extension = path.extname(resolvedPath).toLowerCase();
  if (extension === '.cmd' || extension === '.bat') {
    return 'cmd-wrapper';
  }
  return 'native-executable';
}

async function resolveCommandCandidates(command: string, timeoutMs: number): Promise<string[]> {
  try {
    const result = await execFileAsync('where.exe', [command], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: timeoutMs,
    });
    return result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    const resolveError = error as NodeJS.ErrnoException;
    if (resolveError.code === 'ENOENT') {
      return [];
    }
    const message = String((resolveError as { stderr?: string }).stderr ?? resolveError.message ?? '');
    if (message.includes('Could not find files')) {
      return [];
    }
    throw error;
  }
}

async function runNativeVersion(resolvedPath: string, args: string[], timeoutMs: number): Promise<ProcessOutput> {
  const result = await execFileAsync(resolvedPath, args, {
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 256 * 1024,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr ?? '',
  };
}

async function runWrapperVersion(resolvedPath: string, args: string[], timeoutMs: number): Promise<ProcessOutput> {
  const commandLine = `""${resolvedPath}" ${args.join(' ')}"`;
  const commandProcessor = process.env.COMSPEC ?? 'cmd.exe';
  const result = await new Promise<ProcessOutput>((resolve, reject) => {
    const child = execFile(
      commandProcessor,
      ['/d', '/s', '/c', commandLine],
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 256 * 1024,
        windowsVerbatimArguments: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr: stderr ?? '' });
      },
    );

    child.unref();
  });

  return result;
}

export async function discoverTools(dependencies: DiscoveryDependencies = {}): Promise<ProviderDiscoveryRecord[]> {
  const now = dependencies.now ?? (() => new Date());
  const timeoutMs = dependencies.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
  const resolutionTimeoutMs = dependencies.resolutionTimeoutMs ?? DISCOVERY_RESOLUTION_TIMEOUT_MS;
  const resolveCandidates = dependencies.resolveCommandCandidates ?? resolveCommandCandidates;
  const runNative = dependencies.runNativeVersion ?? runNativeVersion;
  const runWrapper = dependencies.runWrapperVersion ?? runWrapperVersion;

  const results: ProviderDiscoveryRecord[] = [];

  for (const probe of TOOL_PROBES) {
    const discoveredAt = now().toISOString();
    try {
      const candidates = await resolveCandidates(probe.command, resolutionTimeoutMs);
      const resolvedPath = pickResolvedPath(candidates, probe.preferredExtensions);

      if (!resolvedPath) {
        results.push(
          createMissingResult(probe, discoveredAt, {
            code: 'missing',
            message: `${probe.command} was not found on PATH.`,
          }),
        );
        continue;
      }

      const harnessKind = determineHarnessKind(resolvedPath);
      const runner = harnessKind === 'cmd-wrapper' ? runWrapper : runNative;

      try {
        const output = await runner(resolvedPath, ['--version'], timeoutMs);
        const versionText = sanitizeVersionOutput(output.stdout || output.stderr);
        results.push({
          toolId: probe.toolId,
          displayName: probe.displayName,
          kind: probe.kind,
          command: probe.command,
          harnessKind,
          resolvedPath,
          installed: true,
          workerCapable: probe.workerCapable,
          cliVersion: versionText,
          discoveredAt,
        });
      } catch (error) {
        const processError = error as NodeJS.ErrnoException;
        const code = processError.code === 'ETIMEDOUT' ? 'timeout' : 'execution-failed';
        results.push({
          toolId: probe.toolId,
          displayName: probe.displayName,
          kind: probe.kind,
          command: probe.command,
          harnessKind,
          resolvedPath,
          installed: true,
          workerCapable: probe.workerCapable,
          discoveredAt,
          error: {
            code,
            message: code === 'timeout' ? `Timed out after ${timeoutMs}ms` : 'Version probe failed.',
          },
        });
      }
    } catch (error) {
      const resolveError = error as NodeJS.ErrnoException;
      results.push(
        createMissingResult(probe, discoveredAt, {
          code: resolveError.code === 'ETIMEDOUT' ? 'timeout' : 'resolve-failed',
          message:
            resolveError.code === 'ETIMEDOUT'
              ? `Command resolution timed out after ${resolutionTimeoutMs}ms.`
              : `Failed to resolve ${probe.command} on PATH.`,
        }),
      );
    }
  }

  return results;
}
