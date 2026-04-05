/**
 * components/Watermark.tsx
 * V3-22 — Watermark System
 *
 * Fixed-position watermark rendered at the bottom-right of every dashboard view.
 * - Visible but unobtrusive: 6px text, 30% opacity, muted gray
 * - Tamper-resistant: MutationObserver re-attaches if removed from DOM
 *   and restores styles if overridden via inspector
 * - Always visible on the dashboard regardless of export/settings tier
 */

import { useEffect, useRef } from 'react';
import {
  generateWatermarkText,
  generateDemoWatermarkText,
  formatWatermarkDate,
} from '../utils/watermark';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WatermarkProps {
  /** Company name shown in the watermark. Defaults to 'PowerOn Hub'. */
  companyName?: string;
  /** When true, prefixes the text with "⚠ DEMO MODE ·". */
  isDemoMode?: boolean;
  /** Controls text color: dark theme uses #3a3a3a, light theme uses #d0d0d0. */
  theme?: 'dark' | 'light';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Watermark({
  companyName = 'PowerOn Hub',
  isDemoMode = false,
  theme = 'dark',
}: WatermarkProps) {
  const ref = useRef<HTMLDivElement>(null);

  const date = formatWatermarkDate();
  const text = isDemoMode
    ? generateDemoWatermarkText(companyName, date)
    : generateWatermarkText(companyName, date);

  // Dark theme: visible against dark bg (#0a0b0f); Light theme: visible against white
  const color = theme === 'dark' ? '#3a3a3a' : '#d0d0d0';

  // ── Tamper-resistance via MutationObserver ────────────────────────────────
  // Prevents hiding via: right-click > delete element, or style overrides
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.parentElement;
    if (!parent) return;

    // Enforces the correct inline styles even if inspector changes them
    const enforceStyles = () => {
      el.style.display = 'block';
      el.style.visibility = 'visible';
      el.style.opacity = '0.3';
      el.style.pointerEvents = 'none';
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Re-attach if element was removed from its parent
        if (mutation.type === 'childList') {
          const removed = Array.from(mutation.removedNodes);
          if (removed.includes(el)) {
            parent.appendChild(el);
          }
        }
        // Restore styles if tampered via inspector
        if (mutation.type === 'attributes' && mutation.target === el) {
          enforceStyles();
        }
      }
    });

    observer.observe(parent, { childList: true, subtree: false });
    observer.observe(el, {
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden'],
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-poweron-watermark="true"
      aria-hidden="true"
      style={{
        position: 'fixed',
        bottom: '12px',
        right: '16px',
        fontSize: '6px',
        color,
        opacity: 0.3,
        userSelect: 'none',
        pointerEvents: 'none',
        zIndex: 9999,
        letterSpacing: '0.04em',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        whiteSpace: 'nowrap',
        lineHeight: 1,
      }}
    >
      {text}
    </div>
  );
}
