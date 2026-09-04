/**
 * Builds the deliberately small environment inherited by provider processes.
 * Values are never logged, persisted, or returned from this module.
 */

export type ProviderEnvironmentProfile = 'claude' | 'codex' | 'generic';

const WINDOWS_CORE_NAMES = new Set([
  'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'TEMP', 'TMP',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'NUMBER_OF_PROCESSORS', 'LANG',
]);

const CLAUDE_NAMES = new Set(['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY']);
const CODEX_NAMES = new Set(['OPENAI_API_KEY']);

function normaliseName(name: string): string {
  return name.toUpperCase();
}

function isWindowsCore(name: string): boolean {
  return WINDOWS_CORE_NAMES.has(name) || name.startsWith('PROCESSOR_') || name.startsWith('LC_');
}

function isProviderAllowed(name: string, profile: ProviderEnvironmentProfile): boolean {
  if (profile === 'claude') {
    return CLAUDE_NAMES.has(name) || name.startsWith('CLAUDE_CODE_');
  }
  if (profile === 'codex') {
    return CODEX_NAMES.has(name) || name.startsWith('CODEX_');
  }
  return false;
}

function isHardDenied(name: string): boolean {
  return (
    name.startsWith('SUPABASE') ||
    name.startsWith('NETLIFY') ||
    name.startsWith('POWERON') ||
    name.startsWith('DATABASE') ||
    name.startsWith('VITE_') ||
    name.endsWith('_TOKEN') ||
    name.endsWith('_API_KEY') ||
    name.includes('SERVICE_ROLE') ||
    name.includes('PRIVATE_KEY') ||
    name.includes('PASSWORD') ||
    name.includes('SECRET')
  );
}

function setCaseInsensitive(target: NodeJS.ProcessEnv, rawName: string, value: string): void {
  const matchingName = Object.keys(target).find((existing) => normaliseName(existing) === normaliseName(rawName));
  if (matchingName) {
    delete target[matchingName];
  }
  target[rawName] = value;
}

/**
 * Environment source and overlay are both treated as untrusted provider input.
 * The allowlist is evaluated before values are merged, preventing an overlay
 * from reintroducing production credentials omitted from the host environment.
 */
export function buildProviderEnvironment(
  profile: ProviderEnvironmentProfile,
  source: NodeJS.ProcessEnv,
  overlay: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [rawName, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }
    const name = normaliseName(rawName);
    if (isWindowsCore(name) || isProviderAllowed(name, profile)) {
      setCaseInsensitive(result, rawName, value);
    } else if (isHardDenied(name)) {
      // Defense in depth: explicitly classify sensitive names as denied even
      // though the surrounding policy is already default-deny.
      continue;
    }
  }
  for (const [rawName, value] of Object.entries(overlay ?? {})) {
    if (value === undefined) {
      continue;
    }
    const name = normaliseName(rawName);
    // Overlays are not trusted to alter PATH/runtime variables. They can
    // only supply the same narrowly approved provider credentials as source.
    if (isProviderAllowed(name, profile)) {
      setCaseInsensitive(result, rawName, value);
    } else if (isHardDenied(name)) {
      continue;
    }
  }

  return result;
}
