/**
 * PortalThemeProvider.tsx
 * CSS custom-property theme system for the PowerOn customer portal.
 * Provides dark (default) and light themes with Web3/glassmorphism design tokens.
 * Branch: ht-web1
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

// ─── Theme tokens ──────────────────────────────────────────────────────────────

const DARK_TOKENS = `
  :root[data-portal-theme="dark"] {
    /* Backgrounds */
    --portal-bg:            #060608;
    --portal-bg-secondary:  #0d0d14;
    --portal-bg-tertiary:   #12121c;

    /* Glass surfaces */
    --glass-bg:             rgba(255, 255, 255, 0.04);
    --glass-bg-hover:       rgba(255, 255, 255, 0.08);
    --glass-bg-active:      rgba(46, 232, 154, 0.08);
    --glass-border:         rgba(255, 255, 255, 0.10);
    --glass-border-hover:   rgba(46, 232, 154, 0.40);
    --glass-blur:           blur(12px);
    --glass-shadow:         0 8px 32px rgba(0, 0, 0, 0.48);
    --glass-shadow-hover:   0 12px 48px rgba(46, 232, 154, 0.12);

    /* Accent palette */
    --accent-green:         #2EE89A;
    --accent-green-dim:     rgba(46, 232, 154, 0.20);
    --accent-blue:          #3A8EFF;
    --accent-blue-dim:      rgba(58, 142, 255, 0.20);
    --accent-glow-green:    0 0 24px rgba(46, 232, 154, 0.30);
    --accent-glow-blue:     0 0 24px rgba(58, 142, 255, 0.30);

    /* Typography */
    --text-primary:         #F0F2FF;
    --text-secondary:       rgba(240, 242, 255, 0.65);
    --text-muted:           rgba(240, 242, 255, 0.38);
    --text-accent:          #2EE89A;
    --text-on-accent:       #060608;

    /* Borders & dividers */
    --border-subtle:        rgba(255, 255, 255, 0.07);
    --border-visible:       rgba(255, 255, 255, 0.14);

    /* Credentials / badges */
    --badge-bg:             rgba(46, 232, 154, 0.12);
    --badge-border:         rgba(46, 232, 154, 0.35);
    --badge-text:           #2EE89A;

    /* CTA button */
    --cta-bg:               linear-gradient(135deg, #2EE89A 0%, #25c87f 100%);
    --cta-text:             #060608;
    --cta-shadow:           0 4px 24px rgba(46, 232, 154, 0.40);
    --cta-shadow-hover:     0 8px 40px rgba(46, 232, 154, 0.60);

    /* Scrollbar */
    --scrollbar-track:      #0d0d14;
    --scrollbar-thumb:      rgba(255,255,255,0.12);
    --scrollbar-thumb-hover:rgba(46, 232, 154, 0.45);
  }
`;

const LIGHT_TOKENS = `
  :root[data-portal-theme="light"] {
    /* Backgrounds */
    --portal-bg:            #F5F7FF;
    --portal-bg-secondary:  #ECEEF8;
    --portal-bg-tertiary:   #E2E5F4;

    /* Glass surfaces */
    --glass-bg:             rgba(255, 255, 255, 0.65);
    --glass-bg-hover:       rgba(255, 255, 255, 0.85);
    --glass-bg-active:      rgba(46, 232, 154, 0.10);
    --glass-border:         rgba(0, 0, 0, 0.08);
    --glass-border-hover:   rgba(46, 232, 154, 0.50);
    --glass-blur:           blur(12px);
    --glass-shadow:         0 8px 32px rgba(0, 0, 0, 0.10);
    --glass-shadow-hover:   0 12px 48px rgba(46, 232, 154, 0.18);

    /* Accent palette */
    --accent-green:         #18A867;
    --accent-green-dim:     rgba(24, 168, 103, 0.14);
    --accent-blue:          #1E6FE0;
    --accent-blue-dim:      rgba(30, 111, 224, 0.14);
    --accent-glow-green:    0 0 20px rgba(24, 168, 103, 0.20);
    --accent-glow-blue:     0 0 20px rgba(30, 111, 224, 0.20);

    /* Typography */
    --text-primary:         #0F1120;
    --text-secondary:       rgba(15, 17, 32, 0.65);
    --text-muted:           rgba(15, 17, 32, 0.40);
    --text-accent:          #18A867;
    --text-on-accent:       #FFFFFF;

    /* Borders & dividers */
    --border-subtle:        rgba(0, 0, 0, 0.05);
    --border-visible:       rgba(0, 0, 0, 0.12);

    /* Credentials / badges */
    --badge-bg:             rgba(24, 168, 103, 0.10);
    --badge-border:         rgba(24, 168, 103, 0.35);
    --badge-text:           #18A867;

    /* CTA button */
    --cta-bg:               linear-gradient(135deg, #18A867 0%, #12905a 100%);
    --cta-text:             #FFFFFF;
    --cta-shadow:           0 4px 24px rgba(24, 168, 103, 0.35);
    --cta-shadow-hover:     0 8px 40px rgba(24, 168, 103, 0.50);

    /* Scrollbar */
    --scrollbar-track:      #ECEEF8;
    --scrollbar-thumb:      rgba(0,0,0,0.14);
    --scrollbar-thumb-hover:rgba(24, 168, 103, 0.45);
  }
`;

const GLASS_UTILITY_STYLES = `
  /* ── Glassmorphism utility classes ───────────────────────────────────────── */

  .glass-card {
    background:    var(--glass-bg);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border:        1px solid var(--glass-border);
    box-shadow:    var(--glass-shadow);
    border-radius: 16px;
    transition:    background 0.25s ease,
                   border-color 0.25s ease,
                   box-shadow 0.25s ease,
                   transform 0.25s ease;
  }

  .glass-card:hover {
    background:    var(--glass-bg-hover);
    border-color:  var(--glass-border-hover);
    box-shadow:    var(--glass-shadow-hover);
  }

  .glass-card-active {
    background:    var(--glass-bg-active);
    border-color:  var(--glass-border-hover);
    box-shadow:    var(--glass-shadow-hover);
  }

  .glass-badge {
    background:    var(--badge-bg);
    border:        1px solid var(--badge-border);
    color:         var(--badge-text);
    border-radius: 999px;
    font-size:     0.75rem;
    font-weight:   600;
    letter-spacing: 0.04em;
    padding:       4px 12px;
    display:       inline-flex;
    align-items:   center;
    gap:           6px;
    white-space:   nowrap;
  }

  .portal-cta-btn {
    background:    var(--cta-bg);
    color:         var(--cta-text);
    box-shadow:    var(--cta-shadow);
    border:        none;
    border-radius: 12px;
    padding:       14px 32px;
    font-size:     1rem;
    font-weight:   700;
    letter-spacing: 0.02em;
    cursor:        pointer;
    transition:    box-shadow 0.25s ease, transform 0.2s ease, filter 0.2s ease;
    min-height:    48px;
    touch-action:  manipulation;
  }

  .portal-cta-btn:hover {
    box-shadow:    var(--cta-shadow-hover);
    transform:     translateY(-2px);
    filter:        brightness(1.06);
  }

  .portal-cta-btn:active {
    transform:     translateY(0);
  }

  /* Scrollbar */
  .portal-root * {
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
  }
  .portal-root *::-webkit-scrollbar       { width: 6px; }
  .portal-root *::-webkit-scrollbar-track { background: var(--scrollbar-track); }
  .portal-root *::-webkit-scrollbar-thumb {
    background:    var(--scrollbar-thumb);
    border-radius: 3px;
  }
  .portal-root *::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }

  /* Entrance animation */
  @keyframes portalFadeUp {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .portal-fade-up {
    animation: portalFadeUp 0.55s cubic-bezier(0.22,1,0.36,1) both;
  }
  .portal-fade-up-1 { animation-delay: 0.05s; }
  .portal-fade-up-2 { animation-delay: 0.12s; }
  .portal-fade-up-3 { animation-delay: 0.20s; }
  .portal-fade-up-4 { animation-delay: 0.28s; }
  .portal-fade-up-5 { animation-delay: 0.36s; }

  /* Neon pulse keyframe */
  @keyframes portalPulseGreen {
    0%, 100% { box-shadow: var(--accent-glow-green); }
    50%       { box-shadow: 0 0 40px rgba(46, 232, 154, 0.55); }
  }
  .portal-pulse-green {
    animation: portalPulseGreen 3s ease-in-out infinite;
  }
`;

// ─── Inject styles once ────────────────────────────────────────────────────────

const STYLE_ID = 'poweron-portal-theme-styles';

function injectPortalStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = DARK_TOKENS + LIGHT_TOKENS + GLASS_UTILITY_STYLES;
  document.head.appendChild(el);
}

// ─── Context ───────────────────────────────────────────────────────────────────

export type PortalTheme = 'dark' | 'light';

interface PortalThemeContextValue {
  theme: PortalTheme;
  toggleTheme: () => void;
  setTheme: (t: PortalTheme) => void;
}

const PortalThemeContext = createContext<PortalThemeContextValue>({
  theme: 'dark',
  toggleTheme: () => {},
  setTheme: () => {},
});

export function usePortalTheme(): PortalThemeContextValue {
  return useContext(PortalThemeContext);
}

// ─── Provider ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'poweron_portal_theme';

interface PortalThemeProviderProps {
  children: React.ReactNode;
  /** Override with an explicit initial theme (skips localStorage / system pref) */
  initialTheme?: PortalTheme;
}

export function PortalThemeProvider({
  children,
  initialTheme,
}: PortalThemeProviderProps): React.ReactElement {
  injectPortalStyles();

  const resolveInitial = useCallback((): PortalTheme => {
    if (initialTheme) return initialTheme;
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as PortalTheme | null;
      if (stored === 'dark' || stored === 'light') return stored;
    } catch {
      // localStorage unavailable (SSR / private mode)
    }
    // Fall back to system preference
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: light)').matches
    ) {
      return 'light';
    }
    return 'dark';
  }, [initialTheme]);

  const [theme, setThemeState] = useState<PortalTheme>(resolveInitial);

  // Apply theme attribute to <html> so CSS vars take effect
  useEffect(() => {
    document.documentElement.setAttribute('data-portal-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // noop
    }
  }, [theme]);

  // Respect OS-level theme changes when no manual override is stored
  useEffect(() => {
    if (initialTheme) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (e: MediaQueryListEvent) => {
      try {
        if (!localStorage.getItem(STORAGE_KEY)) {
          setThemeState(e.matches ? 'light' : 'dark');
        }
      } catch {
        setThemeState(e.matches ? 'light' : 'dark');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [initialTheme]);

  const setTheme = useCallback((t: PortalTheme) => setThemeState(t), []);

  const toggleTheme = useCallback(
    () => setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark')),
    []
  );

  return (
    <PortalThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </PortalThemeContext.Provider>
  );
}
