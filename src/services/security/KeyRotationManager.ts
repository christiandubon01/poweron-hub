/**
 * KeyRotationManager.ts
 * 
 * Manages API key rotation with breach detection and 90-day lifecycle enforcement.
 * Provides:
 * - Key inventory tracking (all service API keys)
 * - Rotation scheduling (90-day max, warnings at 60/83 days)
 * - Breach detection (unusual patterns, IP anomalies)
 * - 5-minute breach response protocol
 * - Per-service rotation guides and checklists
 */

export type KeyStatus = 'active' | 'expired' | 'compromised' | 'pending';

export interface ApiKeyEntry {
  name: string;
  service: string;
  lastRotated: string; // ISO timestamp
  ageDays: number;
  status: KeyStatus;
  rotationUrl?: string;
  environment?: 'netlify' | '.env.local' | 'supabase' | 'github';
  notes?: string;
}

export interface RotationChecklistStep {
  step: number;
  title: string;
  description: string;
  actions: string[];
  minDuration?: number; // seconds
}

export interface BreachDetectionMetrics {
  apiCallVolume: number;
  apiCallVolumeNormal: number;
  unknownIPs: string[];
  unknownOrigins: string[];
  failedAuthAttempts: number;
  suspiciousPatterns: string[];
}

export interface BreachAlert {
  detected: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedKeys: string[];
  metrics: BreachDetectionMetrics;
  timestamp: string;
  githubAlert?: boolean;
}

/**
 * Key inventory: All known API keys used by PowerOn Hub
 */
export const KEY_INVENTORY: ApiKeyEntry[] = [
  {
    name: 'Anthropic API',
    service: 'Claude AI',
    lastRotated: new Date().toISOString(),
    ageDays: 0,
    status: 'active',
    environment: 'netlify',
    rotationUrl: 'https://console.anthropic.com/account/billing/overview',
    notes: 'ANTHROPIC_API_KEY / VITE_ANTHROPIC_API_KEY'
  },
  {
    name: 'ElevenLabs',
    service: 'Voice Synthesis',
    lastRotated: new Date().toISOString(),
    ageDays: 0,
    status: 'active',
    environment: 'netlify',
    rotationUrl: 'https://elevenlabs.io/account/security',
    notes: 'VITE_ELEVEN_LABS_API_KEY / VITE_ELEVENLABS_API_KEY'
  },
  {
    name: 'OpenAI Whisper',
    service: 'Speech Transcription',
    lastRotated: new Date().toISOString(),
    ageDays: 0,
    status: 'active',
    environment: 'netlify',
    rotationUrl: 'https://platform.openai.com/account/api-keys',
    notes: 'OPENAI_API_KEY'
  },
  {
    name: 'Supabase Anon',
    service: 'Database (Public)',
    lastRotated: new Date().toISOString(),
    ageDays: 0,
    status: 'active',
    environment: 'netlify',
    rotationUrl: 'https://app.supabase.com/project/_/settings/api',
    notes: 'SUPABASE_ANON_KEY'
  },
  {
    name: 'Supabase Service Role',
    service: 'Database (Admin)',
    lastRotated: new Date().toISOString(),
    ageDays: 0,
    status: 'active',
    environment: 'netlify',
    rotationUrl: 'https://app.supabase.com/project/_/settings/api',
    notes: 'SUPABASE_SERVICE_ROLE_KEY'
  },
  {
    name: 'Stripe Secret',
    service: 'Payments',
    lastRotated: new Date().toISOString(),
    ageDays: 0,
    status: 'active',
    environment: 'netlify',
    rotationUrl: 'https://dashboard.stripe.com/account/apikeys',
    notes: 'STRIPE_SECRET_KEY'
  },
  {
    name: 'Stripe Webhook',
    service: 'Payments Webhooks',
    lastRotated: new Date().toISOString(),
    ageDays: 0,
    status: 'active',
    environment: 'netlify',
    rotationUrl: 'https://dashboard.stripe.com/webhooks',
    notes: 'STRIPE_WEBHOOK_SECRET'
  },
  {
    name: 'GitHub Token',
    service: 'Repository & Secrets Scanning',
    lastRotated: new Date().toISOString(),
    ageDays: 0,
    status: 'active',
    environment: '.env.local',
    rotationUrl: 'https://github.com/settings/personal-access-tokens',
    notes: 'GITHUB_TOKEN'
  },
  {
    name: 'Upstash Redis',
    service: 'Cache & Sessions',
    lastRotated: new Date().toISOString(),
    ageDays: 0,
    status: 'active',
    environment: 'netlify',
    rotationUrl: 'https://console.upstash.com',
    notes: 'UPSTASH_REDIS_TOKEN'
  },
  {
    name: 'Resend Email',
    service: 'Email Service',
    lastRotated: new Date().toISOString(),
    ageDays: 0,
    status: 'active',
    environment: 'netlify',
    rotationUrl: 'https://resend.com/api-keys',
    notes: 'RESEND_API_KEY'
  }
];

/**
 * Calculate days since last rotation
 */
export function calculateKeyAge(lastRotated: string): number {
  const rotatedDate = new Date(lastRotated);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - rotatedDate.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Get warning level for key age
 */
export function getKeyWarningLevel(ageDays: number): 'ok' | 'warning' | 'critical' | 'expired' {
  if (ageDays >= 90) return 'expired';
  if (ageDays >= 83) return 'critical'; // 7 days left
  if (ageDays >= 60) return 'warning'; // 30 days left
  return 'ok';
}

/**
 * Get key status badge color and message
 */
export function getKeyStatusDisplay(ageDays: number) {
  const level = getKeyWarningLevel(ageDays);
  const daysLeft = Math.max(0, 90 - ageDays);
  
  return {
    color: level === 'ok' ? 'green' : level === 'warning' ? 'amber' : level === 'critical' ? 'red' : 'red',
    message: level === 'ok' 
      ? `Active — ${daysLeft} days until rotation`
      : level === 'warning'
      ? `⚠ Warning — ${daysLeft} days until rotation`
      : level === 'critical'
      ? `🔴 CRITICAL — ${daysLeft} days until rotation`
      : '❌ EXPIRED — Rotate immediately',
    percentage: Math.min(100, (ageDays / 90) * 100)
  };
}

/**
 * Detect potential key breach based on usage patterns
 */
export function detectBreach(metrics: BreachDetectionMetrics): BreachAlert {
  const baselineVolume = metrics.apiCallVolumeNormal;
  const currentVolume = metrics.apiCallVolume;
  const volumeSpike = currentVolume / baselineVolume;
  
  const suspiciousPatterns: string[] = [];
  const severity: BreachAlert['severity'] = 'low';
  let finalSeverity: BreachAlert['severity'] = severity;
  
  // Check for unusual API call patterns
  if (volumeSpike >= 10) {
    suspiciousPatterns.push(`API volume spike: ${Math.round(volumeSpike)}x normal baseline`);
    finalSeverity = 'high';
  } else if (volumeSpike >= 3) {
    suspiciousPatterns.push(`API volume elevated: ${Math.round(volumeSpike)}x normal baseline`);
    finalSeverity = 'medium';
  }
  
  // Check for calls from unknown IPs
  if (metrics.unknownIPs.length > 0) {
    suspiciousPatterns.push(`${metrics.unknownIPs.length} calls from unknown IP addresses`);
    finalSeverity = finalSeverity === 'low' ? 'medium' : finalSeverity;
  }
  
  // Check for calls from unknown origins
  if (metrics.unknownOrigins.length > 0) {
    suspiciousPatterns.push(`${metrics.unknownOrigins.length} calls from unknown origins`);
    finalSeverity = 'high';
  }
  
  // Check for failed auth spike
  if (metrics.failedAuthAttempts > 5) {
    suspiciousPatterns.push(`${metrics.failedAuthAttempts} failed authentication attempts`);
    finalSeverity = finalSeverity === 'low' || finalSeverity === 'medium' ? 'high' : 'critical';
  }
  
  return {
    detected: suspiciousPatterns.length > 0,
    severity: finalSeverity,
    affectedKeys: [],
    metrics,
    timestamp: new Date().toISOString(),
    githubAlert: metrics.suspiciousPatterns.some(p => p.includes('github'))
  };
}

/**
 * Generate 5-minute breach response protocol
 * Returns timeline of actions with target completion times
 */
export function generateBreachResponseProtocol(): Array<{
  phase: number;
  name: string;
  targetMinutes: number;
  actions: string[];
  verification: string;
}> {
  return [
    {
      phase: 1,
      name: 'Immediate Alert',
      targetMinutes: 1,
      actions: [
        'Send push notification to Christian @ poweronsolutionsllc.com',
        'Log breach event in audit trail',
        'Mark affected keys as compromised'
      ],
      verification: 'Notification delivered and logged'
    },
    {
      phase: 2,
      name: 'Key Generation',
      targetMinutes: 2,
      actions: [
        'Generate new API keys for affected services',
        'Create rotation instructions per service',
        'Document new key locations and endpoints'
      ],
      verification: 'New keys generated and documented'
    },
    {
      phase: 3,
      name: 'Netlify Environment Update',
      targetMinutes: 3,
      actions: [
        'Update Netlify environment variables via API',
        'Set new API keys for all affected vars',
        'Trigger deployment with new secrets',
        'Verify Netlify build succeeds'
      ],
      verification: 'Netlify deployment successful with new keys'
    },
    {
      phase: 4,
      name: 'Validation',
      targetMinutes: 4,
      actions: [
        'Test each service with new keys',
        'Verify Claude API connectivity',
        'Verify ElevenLabs voice synthesis',
        'Verify Supabase database access',
        'Verify payment webhook reception'
      ],
      verification: 'All services operational with new keys'
    },
    {
      phase: 5,
      name: 'Revocation',
      targetMinutes: 5,
      actions: [
        'Revoke old API keys from each service',
        'Revoke old GitHub token',
        'Update audit trail with revocation',
        'Mark old keys as deactivated',
        'Notify all downstream services'
      ],
      verification: 'Old keys revoked, new keys active, all services confirmed operational'
    }
  ];
}

/**
 * Generate rotation checklist for a specific key
 */
export function generateRotationChecklist(keyName: string): RotationChecklistStep[] {
  // Map key names to rotation steps
  const checklists: { [key: string]: RotationChecklistStep[] } = {
    'Anthropic API': [
      {
        step: 1,
        title: 'Navigate to Anthropic Console',
        description: 'Go to API keys management in Anthropic console',
        actions: [
          'Visit https://console.anthropic.com/account/billing/overview',
          'Log in with credentials',
          'Click "API Keys" or "Settings"'
        ],
        minDuration: 30
      },
      {
        step: 2,
        title: 'Generate New Key',
        description: 'Create new API key',
        actions: [
          'Click "Create new key" button',
          'Give key a name like "PowerOn Hub - 2026-Q2"',
          'Copy the generated key (only shown once)',
          'Store in secure location'
        ],
        minDuration: 60
      },
      {
        step: 3,
        title: 'Update Netlify Variables',
        description: 'Update environment variables',
        actions: [
          'Go to Netlify > Settings > Build & deploy > Environment',
          'Update ANTHROPIC_API_KEY with new value',
          'Update VITE_ANTHROPIC_API_KEY with new value',
          'Trigger manual deploy to activate'
        ],
        minDuration: 120
      },
      {
        step: 4,
        title: 'Test API Connectivity',
        description: 'Verify new key works',
        actions: [
          'Open deployed app',
          'Navigate to any agent panel',
          'Submit a test query',
          'Verify response comes back successfully'
        ],
        minDuration: 60
      },
      {
        step: 5,
        title: 'Revoke Old Key',
        description: 'Disable the old key',
        actions: [
          'Return to Anthropic Console',
          'Find old key in API Keys list',
          'Click revoke / delete',
          'Confirm revocation'
        ],
        minDuration: 30
      }
    ],
    'ElevenLabs': [
      {
        step: 1,
        title: 'Navigate to ElevenLabs',
        description: 'Go to security settings',
        actions: [
          'Visit https://elevenlabs.io/account/security',
          'Log in with credentials',
          'Click "API Keys" section'
        ],
        minDuration: 30
      },
      {
        step: 2,
        title: 'Generate New Key',
        description: 'Create new API key',
        actions: [
          'Click "Create New Key"',
          'Name it "PowerOn Hub - 2026-Q2"',
          'Copy the generated key',
          'Save in secure location'
        ],
        minDuration: 60
      },
      {
        step: 3,
        title: 'Update Netlify Variables',
        description: 'Update environment variables',
        actions: [
          'Go to Netlify > Settings > Build & deploy > Environment',
          'Update VITE_ELEVEN_LABS_API_KEY with new value',
          'Update VITE_ELEVENLABS_API_KEY with new value',
          'Trigger deploy'
        ],
        minDuration: 120
      },
      {
        step: 4,
        title: 'Test Voice Synthesis',
        description: 'Verify new key works',
        actions: [
          'Open deployed app',
          'Go to Voice Journaling or SPARK Live Call',
          'Ask for a voice response (trigger TTS)',
          'Verify audio plays successfully'
        ],
        minDuration: 60
      },
      {
        step: 5,
        title: 'Revoke Old Key',
        description: 'Disable the old key',
        actions: [
          'Return to ElevenLabs Security page',
          'Find old key',
          'Click revoke',
          'Confirm'
        ],
        minDuration: 30
      }
    ],
    'Supabase Anon': [
      {
        step: 1,
        title: 'Navigate to Supabase',
        description: 'Go to API settings',
        actions: [
          'Visit https://app.supabase.com',
          'Select project edxxbtyugohtowvslbfo',
          'Go to Settings > API > Project API keys'
        ],
        minDuration: 30
      },
      {
        step: 2,
        title: 'Copy New Anon Key',
        description: 'Get new public key',
        actions: [
          'In Project API keys section, find "anon" key',
          'Click to reveal and copy',
          'Note: Supabase rotates keys automatically on release'
        ],
        minDuration: 30
      },
      {
        step: 3,
        title: 'Update Netlify',
        description: 'Update environment variables',
        actions: [
          'Go to Netlify > Environment variables',
          'Update VITE_SUPABASE_ANON_KEY with new value',
          'Trigger deploy'
        ],
        minDuration: 120
      },
      {
        step: 4,
        title: 'Test Database Connectivity',
        description: 'Verify new key works',
        actions: [
          'Open deployed app',
          'Perform a cloud sync operation (Settings > Cloud > Sync)',
          'Verify data loads successfully'
        ],
        minDuration: 60
      },
      {
        step: 5,
        title: 'Verify Service Role',
        description: 'Confirm admin key still valid',
        actions: [
          'Check VITE_SUPABASE_URL is still set',
          'Verify no 401/403 errors in console',
          'Old key can remain as Supabase handles versioning'
        ],
        minDuration: 30
      }
    ],
    'Stripe Secret': [
      {
        step: 1,
        title: 'Navigate to Stripe',
        description: 'Go to API keys',
        actions: [
          'Visit https://dashboard.stripe.com/account/apikeys',
          'Log in with credentials',
          'Scroll to Restricted API keys section'
        ],
        minDuration: 30
      },
      {
        step: 2,
        title: 'Generate New Restricted Key',
        description: 'Create new secret key with same permissions',
        actions: [
          'Click "Create restricted key"',
          'Set permissions: read/write for charges, customers, invoices',
          'Limit to same API version as current',
          'Give it a meaningful name with date',
          'Copy the secret key'
        ],
        minDuration: 90
      },
      {
        step: 3,
        title: 'Update Netlify',
        description: 'Update environment variable',
        actions: [
          'Go to Netlify > Environment variables',
          'Update STRIPE_SECRET_KEY with new value',
          'Trigger deploy'
        ],
        minDuration: 120
      },
      {
        step: 4,
        title: 'Test Payment Processing',
        description: 'Verify new key works',
        actions: [
          'Open app and navigate to payment section if available',
          'Perform test transaction (use Stripe test card)',
          'Verify transaction succeeds'
        ],
        minDuration: 60
      },
      {
        step: 5,
        title: 'Revoke Old Key',
        description: 'Disable the old key',
        actions: [
          'Return to Stripe API keys',
          'Find old restricted key',
          'Click the key and select "Revoke"',
          'Confirm revocation'
        ],
        minDuration: 30
      }
    ],
    'GitHub Token': [
      {
        step: 1,
        title: 'Navigate to GitHub',
        description: 'Go to personal access tokens',
        actions: [
          'Visit https://github.com/settings/personal-access-tokens',
          'Log in if needed',
          'Find "PowerOn Hub" token'
        ],
        minDuration: 30
      },
      {
        step: 2,
        title: 'Generate New Token',
        description: 'Create new personal access token',
        actions: [
          'Click "Generate new token" > "Generate new token (beta)"',
          'Name: "PowerOn Hub - 2026-Q2"',
          'Expiration: 90 days',
          'Scopes: repo (full control), workflow, admin:repo_hook',
          'Generate and copy token'
        ],
        minDuration: 60
      },
      {
        step: 3,
        title: 'Update Local .env.local',
        description: 'Update local environment',
        actions: [
          'Edit .env.local in project root',
          'Update GITHUB_TOKEN=<new_token>',
          'Save file (do NOT commit)'
        ],
        minDuration: 30
      },
      {
        step: 4,
        title: 'Test Git Operations',
        description: 'Verify new token works',
        actions: [
          'Run: git remote -v (verify origin is set)',
          'Run: git fetch (test read access)',
          'Run: git push origin sec9 (test write access with new branch)',
          'Verify both succeed'
        ],
        minDuration: 60
      },
      {
        step: 5,
        title: 'Revoke Old Token',
        description: 'Disable the old token',
        actions: [
          'Return to GitHub tokens page',
          'Find old token',
          'Click and select "Delete"',
          'Confirm deletion'
        ],
        minDuration: 30
      }
    ]
  };
  
  // Return checklist or generic fallback
  return checklists[keyName] || [
    {
      step: 1,
      title: 'Generate New Key',
      description: 'Create a new API key in the service console',
      actions: [
        `Visit the rotation URL for ${keyName}`,
        'Log in to your account',
        'Click to create a new API key',
        'Copy the new key to a secure location'
      ],
      minDuration: 60
    },
    {
      step: 2,
      title: 'Update Netlify or .env.local',
      description: 'Update the environment variable',
      actions: [
        'Go to Netlify > Settings > Build & deploy > Environment',
        'Or edit .env.local if local-only',
        'Update the key variable with the new value',
        'Trigger a new deployment'
      ],
      minDuration: 120
    },
    {
      step: 3,
      title: 'Test Connectivity',
      description: 'Verify the new key works',
      actions: [
        'Open the deployed app',
        'Perform an operation that uses this service',
        'Check browser console for errors',
        'Verify success'
      ],
      minDuration: 60
    },
    {
      step: 4,
      title: 'Revoke Old Key',
      description: 'Disable the old key',
      actions: [
        `Return to ${keyName} service console`,
        'Find the old API key',
        'Click to revoke or delete',
        'Confirm the action'
      ],
      minDuration: 30
    }
  ];
}

/**
 * Get overall key health score (0-100)
 */
export function getKeyHealthScore(keys: ApiKeyEntry[]): number {
  let score = 100;
  
  keys.forEach(key => {
    const level = getKeyWarningLevel(key.ageDays);
    
    if (level === 'expired') {
      score -= 25;
    } else if (level === 'critical') {
      score -= 15;
    } else if (level === 'warning') {
      score -= 5;
    }
    
    if (key.status === 'compromised') {
      score -= 30;
    }
  });
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Format duration for display
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (secs === 0) return `${minutes}m`;
  return `${minutes}m ${secs}s`;
}

export default {
  calculateKeyAge,
  getKeyWarningLevel,
  getKeyStatusDisplay,
  detectBreach,
  generateBreachResponseProtocol,
  generateRotationChecklist,
  getKeyHealthScore,
  formatDuration,
  KEY_INVENTORY
};
