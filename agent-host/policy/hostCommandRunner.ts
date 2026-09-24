/**
 * ATB-4B: the ONLY Host-owned command execution seam.
 *
 * This is NOT ProcessRunner and is NOT the provider CLI launch path. Claude /
 * Codex / Ollama internal tool/shell commands are OPAQUE to Agent Host and
 * must never be faked through this module.
 *
 * Host-controlled argv that an orchestrator might launch (validation, inspect,
 * or a later explicit Host action) go through {@link executeHostCommand} once:
 * classify → allow/deny/gate → optional injected runner. No real child_process
 * is created unless the caller injects a runner, so tests stay fixture-only.
 */

import { classifyHostCommand } from './commandPolicy.ts';
import type { HostCommandClassification, PolicyDecision } from './types.ts';

export type HostCommandSignalCategory =
  | 'dependency-mutation'
  | 'db-mutation'
  | 'unknown-command'
  | 'policy-gate'
  | 'human-gate';

export interface HostCommandExecution {
  /** Injected spawn. Required for allow; never defaults to a real process. */
  run?: ((argv: readonly string[]) => Promise<unknown> | unknown) | undefined;
}

export interface HostCommandResult {
  status: 'executed' | 'denied' | 'gated' | 'failed-closed';
  classification: HostCommandClassification | null;
  decision: PolicyDecision | null;
  launches: number;
  signalCategory: HostCommandSignalCategory | null;
  ownerActionRequired: boolean;
}

export async function executeHostCommand(
  argv: readonly string[],
  execution: HostCommandExecution = {},
): Promise<HostCommandResult> {
  let classified: ReturnType<typeof classifyHostCommand>;
  try {
    classified = classifyHostCommand(argv);
  } catch {
    return {
      status: 'failed-closed',
      classification: null,
      decision: null,
      launches: 0,
      signalCategory: 'policy-gate',
      ownerActionRequired: false,
    };
  }

  const signalCategory = hostCommandSignalCategory(classified.decision);
  const ownerActionRequired = classified.decision.decision === 'require-human';

  if (classified.decision.decision === 'deny') {
    return {
      status: 'denied',
      classification: classified.classification,
      decision: classified.decision,
      launches: 0,
      signalCategory,
      ownerActionRequired: false,
    };
  }

  if (classified.decision.decision === 'require-human') {
    return {
      status: 'gated',
      classification: classified.classification,
      decision: classified.decision,
      launches: 0,
      signalCategory,
      ownerActionRequired: true,
    };
  }

  if (typeof execution.run !== 'function') {
    return {
      status: 'failed-closed',
      classification: classified.classification,
      decision: classified.decision,
      launches: 0,
      signalCategory: 'policy-gate',
      ownerActionRequired: false,
    };
  }

  await execution.run(argv);
  return {
    status: 'executed',
    classification: classified.classification,
    decision: classified.decision,
    launches: 1,
    signalCategory: null,
    ownerActionRequired: false,
  };
}

export function hostCommandSignalCategory(decision: PolicyDecision): HostCommandSignalCategory {
  if (decision.reasonCode === 'dependency-mutation') {
    return 'dependency-mutation';
  }
  if (decision.reasonCode === 'db-mutation') {
    return 'db-mutation';
  }
  if (decision.reasonCode === 'unknown-command') {
    return 'unknown-command';
  }
  if (decision.decision === 'require-human') {
    return 'human-gate';
  }
  return 'policy-gate';
}
