import path from 'node:path';

import { isSensitiveRepoPath } from './repoPolicy.ts';
import type { HostCommandClassification, PolicyDecision } from './types.ts';

function normalizeToken(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function commandBaseName(token: string | undefined): string {
  const normalized = normalizeToken(token).replace(/\\/gu, '/');
  const base = path.posix.basename(normalized);
  return base.endsWith('.exe') || base.endsWith('.cmd') || base.endsWith('.bat')
    ? base.replace(/\.(exe|cmd|bat)$/u, '')
    : base;
}

function argsContainSensitivePath(argv: readonly string[]): boolean {
  return argv.some((entry) => {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      return false;
    }
    try {
      return isSensitiveRepoPath(trimmed);
    } catch {
      return false;
    }
  });
}

function allow(reasonCode: PolicyDecision['reasonCode'], reason: string, matchedRule: string): PolicyDecision {
  return { decision: 'allow', reasonCode, reason, matchedRule };
}

function deny(reasonCode: PolicyDecision['reasonCode'], reason: string, matchedRule: string): PolicyDecision {
  return { decision: 'deny', reasonCode, reason, matchedRule };
}

function requireHuman(reasonCode: PolicyDecision['reasonCode'], reason: string, matchedRule: string): PolicyDecision {
  return { decision: 'require-human', reasonCode, reason, matchedRule };
}

export function classifyHostCommand(argv: readonly string[]): {
  classification: HostCommandClassification;
  decision: PolicyDecision;
} {
  const executable = commandBaseName(argv[0]);
  const subcommand = normalizeToken(argv[1]);

  if (argv.length === 0) {
    return {
      classification: 'UNKNOWN',
      decision: requireHuman('unknown-command', 'Empty host command cannot be classified safely.', 'empty-command'),
    };
  }

  if (
    executable === 'type' ||
    executable === 'cat' ||
    executable === 'more' ||
    (executable === 'get-content' && argsContainSensitivePath(argv))
  ) {
    return {
      classification: 'SECRET_ACCESS',
      decision: deny('secret-access', 'Host-initiated secret reads are denied.', 'sensitive-read'),
    };
  }

  if (argsContainSensitivePath(argv) && executable === 'get-content') {
    return {
      classification: 'SECRET_ACCESS',
      decision: deny('secret-access', 'Host-initiated secret reads are denied.', 'sensitive-read'),
    };
  }

  if (executable === 'git') {
    if (['status', 'diff', 'show', 'log', 'rev-parse', 'branch'].includes(subcommand)) {
      return {
        classification: 'READ_ONLY',
        decision: allow('in-scope', 'Read-only git inspection is allowed.', `git ${subcommand}`),
      };
    }

    if (['add', 'commit', 'stash', 'tag', 'merge'].includes(subcommand)) {
      return {
        classification: 'GIT_WRITE_LOCAL',
        decision: requireHuman('git-write-local', 'Local git writes require human approval.', `git ${subcommand}`),
      };
    }

    if (['reset', 'clean', 'checkout', 'restore', 'rebase'].includes(subcommand)) {
      return {
        classification: 'GIT_DESTRUCTIVE',
        decision: deny('git-destructive', 'Destructive git commands are denied.', `git ${subcommand}`),
      };
    }
  }

  if (
    (executable === 'npm' || executable === 'pnpm' || executable === 'yarn' || executable === 'bun') &&
    ['install', 'add', 'update', 'remove', 'uninstall'].includes(subcommand)
  ) {
    return {
      classification: 'DEP_MUTATION',
      decision: requireHuman('dependency-mutation', 'Dependency mutations require human approval.', `${executable} ${subcommand}`),
    };
  }

  if (
    (executable === 'npm' || executable === 'pnpm' || executable === 'yarn' || executable === 'bun') &&
    subcommand === 'run' &&
    ['test', 'build', 'typecheck', 'lint'].includes(normalizeToken(argv[2]))
  ) {
    return {
      classification: 'VALIDATION',
      decision: allow('in-scope', 'Validation commands are allowed.', `${executable} run ${normalizeToken(argv[2])}`),
    };
  }

  if (executable === 'node' && argv.includes('--test')) {
    return {
      classification: 'VALIDATION',
      decision: allow('in-scope', 'Node test execution is allowed.', 'node --test'),
    };
  }

  if (
    (executable === 'supabase' && ['db', 'migration'].includes(subcommand)) ||
    executable === 'psql' ||
    executable === 'prisma'
  ) {
    return {
      classification: 'DB_MUTATION',
      decision: requireHuman('db-mutation', 'Database mutations require human approval.', executable),
    };
  }

  if (['netlify', 'vercel', 'firebase', 'wrangler'].includes(executable)) {
    return {
      classification: 'DEPLOY',
      decision: requireHuman('deploy', 'Deploy commands require human approval.', executable),
    };
  }

  if (['rm', 'del', 'rmdir', 'remove-item'].includes(executable)) {
    return {
      classification: 'DESTRUCTIVE_FS',
      decision: deny('destructive-fs', 'Destructive filesystem commands are denied.', executable),
    };
  }

  if (
    ['rg', 'dir', 'ls', 'get-childitem', 'find', 'findstr'].includes(executable) ||
    (executable === 'get-content' && !argsContainSensitivePath(argv))
  ) {
    return {
      classification: 'READ_ONLY',
      decision: allow('in-scope', 'Read-only inspection is allowed.', executable),
    };
  }

  return {
    classification: 'UNKNOWN',
    decision: requireHuman('unknown-command', 'Unknown host-initiated commands require human approval.', executable),
  };
}
