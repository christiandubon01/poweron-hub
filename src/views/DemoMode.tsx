/**
 * src/views/DemoMode.tsx — Demo Mode settings view.
 *
 * E3 | Demo Mode:
 *   Settings-style card layout with:
 *     1. Toggle card  — on/off switch controlled by demoStore
 *     2. Shareable link section — visible when demo mode is active
 *     3. Warning card — yellow, visible when demo mode is active
 */

import React, { useState } from 'react'
import { useDemoStore } from '@/store/demoStore'

// ── Toggle switch ─────────────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        width: 48,
        height: 26,
        borderRadius: 9999,
        border: 'none',
        cursor: 'pointer',
        backgroundColor: checked ? '#16a34a' : '#6b7280',
        transition: 'background-color 0.2s',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: checked ? 24 : 2,
          width: 22,
          height: 22,
          borderRadius: '50%',
          backgroundColor: '#fff',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      />
    </button>
  )
}

// ── Card container ─────────────────────────────────────────────────────────────

function Card({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-primary, #1f2937)',
        border: '1px solid var(--border-primary, #374151)',
        borderRadius: 12,
        padding: '20px 24px',
        marginBottom: 16,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function DemoMode() {
  const { isDemoMode, toggleDemoMode } = useDemoStore()
  const [copied, setCopied] = useState(false)

  // Build the shareable URL with ?demo=true
  const shareableUrl = (() => {
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('demo', 'true')
      // Clear any auth-specific params that shouldn't be shared
      url.searchParams.delete('audit')
      return url.toString()
    } catch {
      return `${window.location.origin}?demo=true`
    }
  })()

  function handleCopyLink() {
    navigator.clipboard.writeText(shareableUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      // Fallback: select and copy
      const el = document.getElementById('demo-share-input') as HTMLInputElement | null
      if (el) {
        el.select()
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    })
  }

  return (
    <div
      style={{
        maxWidth: 600,
        margin: '0 auto',
        padding: '24px 16px',
        color: 'var(--text-primary, #f9fafb)',
      }}
    >
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--text-primary, #f9fafb)',
            margin: 0,
            marginBottom: 4,
          }}
        >
          Demo Mode
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary, #9ca3af)', margin: 0 }}>
          Share a live preview of your app with generic placeholder data.
        </p>
      </div>

      {/* ── Toggle card ── */}
      <Card>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ flex: 1 }}>
            <p
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--text-primary, #f9fafb)',
                margin: 0,
                marginBottom: 4,
              }}
            >
              Demo Mode
            </p>
            <p
              style={{
                fontSize: 13,
                color: 'var(--text-secondary, #9ca3af)',
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              Replaces all data with generic placeholders for sharing. Your real data is never
              modified.
            </p>

            {/* Status badge */}
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: isDemoMode ? '#22c55e' : '#6b7280',
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: isDemoMode ? '#22c55e' : '#6b7280',
                  letterSpacing: '0.03em',
                }}
              >
                {isDemoMode ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>

          <ToggleSwitch checked={isDemoMode} onChange={toggleDemoMode} />
        </div>
      </Card>

      {/* ── Shareable link section (visible when active) ── */}
      {isDemoMode && (
        <Card>
          <p
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-secondary, #9ca3af)',
              margin: 0,
              marginBottom: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Shareable Link
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="demo-share-input"
              type="text"
              readOnly
              value={shareableUrl}
              style={{
                flex: 1,
                backgroundColor: 'var(--bg-secondary, #111827)',
                border: '1px solid var(--border-primary, #374151)',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 12,
                color: 'var(--text-secondary, #9ca3af)',
                fontFamily: 'monospace',
                outline: 'none',
                minWidth: 0,
              }}
              onFocus={e => e.target.select()}
            />
            <button
              onClick={handleCopyLink}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: copied ? '#16a34a' : '#2563eb',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'background-color 0.15s',
                flexShrink: 0,
              }}
            >
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
          <p
            style={{
              fontSize: 12,
              color: 'var(--text-secondary, #6b7280)',
              margin: 0,
              marginTop: 8,
            }}
          >
            Anyone with this link can view the app in demo mode — no sign-in required.
          </p>
        </Card>
      )}

      {/* ── Warning card (visible when active) ── */}
      {isDemoMode && (
        <Card
          style={{
            backgroundColor: '#fef9c3',
            border: '1px solid #fde047',
          }}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>⚠</span>
            <p
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#713f12',
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              Demo mode is active. All data shown is placeholder data only.
            </p>
          </div>
        </Card>
      )}
    </div>
  )
}

export default DemoMode
