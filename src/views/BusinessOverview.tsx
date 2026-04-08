// @ts-nocheck
/**
 * BusinessOverview.tsx — B64 | Admin Sidebar Reorganization
 * Placeholder view for Business Overview (B68 will build this out).
 */
import React from 'react'

export default function BusinessOverview() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 400,
        gap: 16,
        color: '#9ca3af',
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          backgroundColor: 'rgba(22, 163, 74, 0.08)',
          border: '1px solid rgba(22, 163, 74, 0.25)',
          borderRadius: 10,
          padding: '10px 20px',
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: '#16a34a',
            boxShadow: '0 0 8px #16a34a',
          }}
        />
        <span
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#16a34a',
          }}
        >
          Business Overview
        </span>
      </div>

      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>
        🏗 Placeholder — Full build coming in B68
      </p>

      <p style={{ fontSize: 11, color: '#374151', maxWidth: 360, textAlign: 'center', lineHeight: 1.6 }}>
        This view will provide a high-level business health dashboard including revenue,
        project pipeline, crew utilization, and financial forecasting.
      </p>
    </div>
  )
}
