/**
 * ProjectionScenarioInput.tsx — NW34: Structured scenario input panel.
 *
 * Slide-in panel from right (380px, dark glass, scrollable).
 * Collapsible sections for Field Operations, Software/PowerOn Hub, Investment, and Custom.
 * On "CALCULATE PROJECTION" → emits nw:projection-calculate with all inputs.
 * On "RECALCULATE" (after results exist) → re-emits with updated inputs.
 */

import React, { useState, useCallback } from 'react'
import { ResizablePanel } from './ResizablePanel'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ProjectionInputs {
  // Field Operations
  field_add_crew: number
  field_hire_office_manager: boolean
  field_new_service_area: string
  field_rmo_activates: boolean
  field_raise_service_minimum: number

  // Software / PowerOn Hub
  sw_outsource_dev_count: number
  sw_outsource_hourly_rate: number
  sw_outsource_buckets: string[]
  sw_inhouse_dev_count: number
  sw_inhouse_salary_min: number
  sw_inhouse_salary_max: number
  sw_open_api_early_access: boolean
  sw_api_dev_count: number
  sw_new_pricing_tier_name: string
  sw_new_pricing_tier_price: number

  // Investment
  inv_angel_amount: number
  inv_angel_equity: number
  inv_rbf_monthly: number
  inv_rbf_runway: number
  inv_mode: 'bootstrap' | 'angel' | 'rbf'

  // Custom
  custom_text: string
}

export const DEFAULT_INPUTS: ProjectionInputs = {
  field_add_crew: 0,
  field_hire_office_manager: false,
  field_new_service_area: '',
  field_rmo_activates: false,
  field_raise_service_minimum: 200,

  sw_outsource_dev_count: 0,
  sw_outsource_hourly_rate: 60,
  sw_outsource_buckets: [],
  sw_inhouse_dev_count: 0,
  sw_inhouse_salary_min: 80000,
  sw_inhouse_salary_max: 120000,
  sw_open_api_early_access: false,
  sw_api_dev_count: 0,
  sw_new_pricing_tier_name: '',
  sw_new_pricing_tier_price: 0,

  inv_angel_amount: 0,
  inv_angel_equity: 0,
  inv_rbf_monthly: 0,
  inv_rbf_runway: 0,
  inv_mode: 'bootstrap',

  custom_text: '',
}

const DEV_BUCKETS = ['Features', 'Infrastructure', 'Security', 'Neural World']

interface Props {
  open: boolean
  onClose: () => void
  hasResults: boolean
  isCalculating: boolean
}

// ── Collapsible Section ────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  color,
  defaultOpen = false,
  children,
}: {
  title: string
  icon: string
  color: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [expanded, setExpanded] = useState(defaultOpen)
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => setExpanded(p => !p)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          background: expanded ? `rgba(${color},0.12)` : 'rgba(255,255,255,0.04)',
          border: `1px solid rgba(${color},${expanded ? '0.4' : '0.15'})`,
          borderRadius: 6,
          color: expanded ? `rgb(${color})` : 'rgba(255,255,255,0.6)',
          cursor: 'pointer',
          fontSize: 14,
          fontFamily: 'monospace',
          letterSpacing: 1.5,
          fontWeight: 700,
          textAlign: 'left',
          transition: 'all 0.18s',
        }}
      >
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ flex: 1 }}>{title}</span>
        <span style={{ opacity: 0.6, fontSize: 14 }}>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div style={{
          background: 'rgba(0,0,0,0.25)',
          border: `1px solid rgba(${color},0.1)`,
          borderTop: 'none',
          borderRadius: '0 0 6px 6px',
          padding: '12px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Field Row ──────────────────────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{
        color: 'rgba(255,255,255,0.55)',
        fontSize: 14,
        fontFamily: 'monospace',
        letterSpacing: 1,
      }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 4,
  color: '#fff',
  fontFamily: 'monospace',
  fontSize: 14,
  padding: '5px 8px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

const toggleStyle = (on: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  background: on ? 'rgba(0,255,136,0.12)' : 'rgba(255,255,255,0.04)',
  border: `1px solid rgba(${on ? '0,255,136' : '255,255,255'},${on ? '0.5' : '0.12'})`,
  borderRadius: 4,
  color: on ? '#00ff88' : 'rgba(255,255,255,0.45)',
  cursor: 'pointer',
  fontSize: 14,
  fontFamily: 'monospace',
  letterSpacing: 0.8,
  transition: 'all 0.15s',
})

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ProjectionScenarioInput({ open, onClose, hasResults, isCalculating }: Props) {
  const [visible, setVisible]   = useState(false)
  const [animIn, setAnimIn]     = useState(false)
  const [inputs, setInputs]     = useState<ProjectionInputs>({ ...DEFAULT_INPUTS })

  React.useEffect(() => {
    if (open) {
      setVisible(true)
      requestAnimationFrame(() => setAnimIn(true))
    } else {
      setAnimIn(false)
      const t = setTimeout(() => setVisible(false), 300)
      return () => clearTimeout(t)
    }
  }, [open])

  const set = useCallback(<K extends keyof ProjectionInputs>(key: K, value: ProjectionInputs[K]) => {
    setInputs(prev => ({ ...prev, [key]: value }))
  }, [])

  const toggleBucket = useCallback((bucket: string) => {
    setInputs(prev => {
      const has = prev.sw_outsource_buckets.includes(bucket)
      return {
        ...prev,
        sw_outsource_buckets: has
          ? prev.sw_outsource_buckets.filter(b => b !== bucket)
          : [...prev.sw_outsource_buckets, bucket],
      }
    })
  }, [])

  const handleCalculate = useCallback(() => {
    window.dispatchEvent(new CustomEvent('nw:projection-calculate', { detail: { inputs } }))
  }, [inputs])

  if (!visible) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 380,
        height: '100%',
        zIndex: 40,
        pointerEvents: 'auto',
        transform: animIn ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s cubic-bezier(0.22,0.61,0.36,1)',
        overflow: 'visible',
      }}
    >
      <ResizablePanel
        panelKey="projection-guide"
        defaultWidth={380}
        defaultHeight={700}
        titleBarHeight={54}
        zIndex={41}
        initialPos={{ x: 0, y: 0 }}
      >
      {/* Glass panel */}
      <div style={{
        width: '100%',
        boxSizing: 'border-box',
        background: 'rgba(4,8,16,0.88)',
        backdropFilter: 'blur(18px)',
        borderLeft: '1px solid rgba(255,180,50,0.25)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 700,
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 16px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ fontSize: 20 }}>🧭</span>
          <div style={{ flex: 1 }}>
            <div style={{
              color: '#ffb432',
              fontFamily: 'monospace',
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: 2,
            }}>
              BUILD YOUR PROJECTION
            </div>
            <div style={{
              color: 'rgba(255,255,255,0.35)',
              fontFamily: 'monospace',
              fontSize: 14,
              letterSpacing: 1,
              marginTop: 2,
            }}>
              CONFIGURE SCENARIO INPUTS
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 4,
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              fontSize: 14,
              padding: '3px 8px',
              fontFamily: 'monospace',
              position: 'relative',
              zIndex: 46,
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 12px 0',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.15) transparent',
        }}>

          {/* ── FIELD OPERATIONS ── */}
          <Section title="FIELD OPERATIONS" icon="🔧" color="255,180,50" defaultOpen>
            <FieldRow label="ADD CREW (0–10)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min={0} max={10} step={1}
                  value={inputs.field_add_crew}
                  onChange={e => set('field_add_crew', Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#ffb432' }}
                />
                <span style={{ color: '#ffb432', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, minWidth: 20 }}>
                  {inputs.field_add_crew}
                </span>
              </div>
            </FieldRow>

            <FieldRow label="">
              <button
                onClick={() => set('field_hire_office_manager', !inputs.field_hire_office_manager)}
                style={toggleStyle(inputs.field_hire_office_manager)}
              >
                {inputs.field_hire_office_manager ? '✓' : '○'} HIRE OFFICE MANAGER
              </button>
            </FieldRow>

            <FieldRow label="NEW SERVICE AREA (city / region)">
              <input
                type="text"
                placeholder="e.g. Riverside, CA"
                value={inputs.field_new_service_area}
                onChange={e => set('field_new_service_area', e.target.value)}
                style={inputStyle}
              />
            </FieldRow>

            <FieldRow label="">
              <button
                onClick={() => set('field_rmo_activates', !inputs.field_rmo_activates)}
                style={toggleStyle(inputs.field_rmo_activates)}
              >
                {inputs.field_rmo_activates ? '✓' : '○'} RMO ACTIVATES
              </button>
            </FieldRow>

            <FieldRow label={`RAISE SERVICE MINIMUM ($${inputs.field_raise_service_minimum})`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min={200} max={1000} step={50}
                  value={inputs.field_raise_service_minimum}
                  onChange={e => set('field_raise_service_minimum', Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#ffb432' }}
                />
                <span style={{ color: '#ffb432', fontFamily: 'monospace', fontSize: 12, minWidth: 52 }}>
                  ${inputs.field_raise_service_minimum}
                </span>
              </div>
            </FieldRow>
          </Section>

          {/* ── SOFTWARE / POWERON HUB ── */}
          <Section title="SOFTWARE / POWERON HUB" icon="💻" color="80,180,255">
            <FieldRow label="OUTSOURCE DEVELOPERS (1–10)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range" min={0} max={10} step={1}
                  value={inputs.sw_outsource_dev_count}
                  onChange={e => set('sw_outsource_dev_count', Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#50b4ff' }}
                />
                <span style={{ color: '#50b4ff', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, minWidth: 20 }}>
                  {inputs.sw_outsource_dev_count}
                </span>
              </div>
            </FieldRow>

            {inputs.sw_outsource_dev_count > 0 && (
              <>
                <FieldRow label={`HOURLY RATE ($${inputs.sw_outsource_hourly_rate}/hr)`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="range" min={40} max={150} step={5}
                      value={inputs.sw_outsource_hourly_rate}
                      onChange={e => set('sw_outsource_hourly_rate', Number(e.target.value))}
                      style={{ flex: 1, accentColor: '#50b4ff' }}
                    />
                    <span style={{ color: '#50b4ff', fontFamily: 'monospace', fontSize: 12, minWidth: 48 }}>
                      ${inputs.sw_outsource_hourly_rate}/hr
                    </span>
                  </div>
                </FieldRow>

                <FieldRow label="WHICH BUCKETS">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {DEV_BUCKETS.map(b => {
                      const on = inputs.sw_outsource_buckets.includes(b)
                      return (
                        <button
                          key={b}
                          onClick={() => toggleBucket(b)}
                          style={{
                            padding: '4px 9px',
                            background: on ? 'rgba(80,180,255,0.18)' : 'rgba(255,255,255,0.04)',
                            border: `1px solid rgba(80,180,255,${on ? '0.6' : '0.18'})`,
                            borderRadius: 4,
                            color: on ? '#50b4ff' : 'rgba(255,255,255,0.4)',
                            cursor: 'pointer',
                            fontSize: 14,
                            fontFamily: 'monospace',
                            letterSpacing: 0.5,
                            transition: 'all 0.15s',
                          }}
                        >
                          {on ? '✓ ' : ''}{b}
                        </button>
                      )
                    })}
                  </div>
                </FieldRow>
              </>
            )}

            <FieldRow label="IN-HOUSE DEV TEAM (1–5)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range" min={0} max={5} step={1}
                  value={inputs.sw_inhouse_dev_count}
                  onChange={e => set('sw_inhouse_dev_count', Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#50b4ff' }}
                />
                <span style={{ color: '#50b4ff', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, minWidth: 20 }}>
                  {inputs.sw_inhouse_dev_count}
                </span>
              </div>
            </FieldRow>

            {inputs.sw_inhouse_dev_count > 0 && (
              <FieldRow label="SALARY RANGE ($K/yr)">
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number" placeholder="Min $K"
                    value={inputs.sw_inhouse_salary_min / 1000}
                    onChange={e => set('sw_inhouse_salary_min', Number(e.target.value) * 1000)}
                    style={{ ...inputStyle, width: '50%' }}
                  />
                  <input
                    type="number" placeholder="Max $K"
                    value={inputs.sw_inhouse_salary_max / 1000}
                    onChange={e => set('sw_inhouse_salary_max', Number(e.target.value) * 1000)}
                    style={{ ...inputStyle, width: '50%' }}
                  />
                </div>
              </FieldRow>
            )}

            <FieldRow label="">
              <button
                onClick={() => set('sw_open_api_early_access', !inputs.sw_open_api_early_access)}
                style={toggleStyle(inputs.sw_open_api_early_access)}
              >
                {inputs.sw_open_api_early_access ? '✓' : '○'} OPEN API EARLY ACCESS
              </button>
            </FieldRow>

            {inputs.sw_open_api_early_access && (
              <FieldRow label="DEVELOPER COUNT ESTIMATE">
                <input
                  type="number" min={0} placeholder="e.g. 20"
                  value={inputs.sw_api_dev_count || ''}
                  onChange={e => set('sw_api_dev_count', Number(e.target.value))}
                  style={inputStyle}
                />
              </FieldRow>
            )}

            <FieldRow label="NEW PRICING TIER">
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text" placeholder="Tier name"
                  value={inputs.sw_new_pricing_tier_name}
                  onChange={e => set('sw_new_pricing_tier_name', e.target.value)}
                  style={{ ...inputStyle, width: '55%' }}
                />
                <div style={{ position: 'relative', width: '45%' }}>
                  <span style={{
                    position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
                    color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', fontSize: 12, pointerEvents: 'none',
                  }}>$</span>
                  <input
                    type="number" min={0} placeholder="0"
                    value={inputs.sw_new_pricing_tier_price || ''}
                    onChange={e => set('sw_new_pricing_tier_price', Number(e.target.value))}
                    style={{ ...inputStyle, paddingLeft: 18 }}
                  />
                </div>
              </div>
            </FieldRow>
          </Section>

          {/* ── INVESTMENT ── */}
          <Section title="INVESTMENT" icon="💰" color="0,255,136">
            <FieldRow label="CAPITAL MODE">
              <div style={{ display: 'flex', gap: 5 }}>
                {(['bootstrap', 'angel', 'rbf'] as const).map(mode => {
                  const on = inputs.inv_mode === mode
                  const labels: Record<string, string> = { bootstrap: 'BOOTSTRAP', angel: 'ANGEL', rbf: 'REV-BASED' }
                  return (
                    <button
                      key={mode}
                      onClick={() => set('inv_mode', mode)}
                      style={{
                        flex: 1,
                        padding: '5px 4px',
                        background: on ? 'rgba(0,255,136,0.14)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid rgba(0,255,136,${on ? '0.6' : '0.12'})`,
                        borderRadius: 4,
                        color: on ? '#00ff88' : 'rgba(255,255,255,0.4)',
                        cursor: 'pointer',
                        fontSize: 14,
                        fontFamily: 'monospace',
                        letterSpacing: 0.8,
                        transition: 'all 0.15s',
                      }}
                    >
                      {labels[mode]}
                    </button>
                  )
                })}
              </div>
            </FieldRow>

            {inputs.inv_mode === 'angel' && (
              <>
                <FieldRow label="INVESTMENT AMOUNT ($)">
                  <input
                    type="number" min={0} placeholder="e.g. 250000"
                    value={inputs.inv_angel_amount || ''}
                    onChange={e => set('inv_angel_amount', Number(e.target.value))}
                    style={inputStyle}
                  />
                </FieldRow>
                <FieldRow label="EQUITY (%)">
                  <input
                    type="number" min={0} max={100} placeholder="e.g. 10"
                    value={inputs.inv_angel_equity || ''}
                    onChange={e => set('inv_angel_equity', Number(e.target.value))}
                    style={inputStyle}
                  />
                </FieldRow>
              </>
            )}

            {inputs.inv_mode === 'rbf' && (
              <>
                <FieldRow label="MONTHLY PAYMENT ($)">
                  <input
                    type="number" min={0} placeholder="e.g. 5000"
                    value={inputs.inv_rbf_monthly || ''}
                    onChange={e => set('inv_rbf_monthly', Number(e.target.value))}
                    style={inputStyle}
                  />
                </FieldRow>
                <FieldRow label="RUNWAY (months)">
                  <input
                    type="number" min={1} max={60} placeholder="e.g. 18"
                    value={inputs.inv_rbf_runway || ''}
                    onChange={e => set('inv_rbf_runway', Number(e.target.value))}
                    style={inputStyle}
                  />
                </FieldRow>
              </>
            )}
          </Section>

          {/* ── CUSTOM ── */}
          <Section title="CUSTOM SCENARIO" icon="✍️" color="200,120,255">
            <FieldRow label="WHAT ELSE ARE YOU CONSIDERING?">
              <textarea
                rows={3}
                placeholder="e.g. Partner with a solar distributor for wholesale pricing…"
                value={inputs.custom_text}
                onChange={e => set('custom_text', e.target.value)}
                style={{
                  ...inputStyle,
                  resize: 'vertical',
                  minHeight: 64,
                  lineHeight: 1.5,
                }}
              />
            </FieldRow>
          </Section>

          {/* spacer */}
          <div style={{ height: 12 }} />
        </div>

        {/* Footer CTA */}
        <div style={{
          padding: '12px 12px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
        }}>
          <button
            onClick={handleCalculate}
            disabled={isCalculating}
            style={{
              width: '100%',
              padding: '12px',
              background: isCalculating
                ? 'rgba(255,180,50,0.08)'
                : 'rgba(255,180,50,0.18)',
              border: `1px solid rgba(255,180,50,${isCalculating ? '0.25' : '0.7'})`,
              borderRadius: 6,
              color: isCalculating ? 'rgba(255,180,50,0.45)' : '#ffb432',
              cursor: isCalculating ? 'not-allowed' : 'pointer',
              fontFamily: 'monospace',
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: 2,
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {isCalculating ? (
              <>
                <span style={{ animation: 'spin 0.8s linear infinite', display: 'inline-block' }}>◌</span>
                CALCULATING…
              </>
            ) : hasResults ? (
              <>⟳ RECALCULATE</>
            ) : (
              <>🧭 CALCULATE PROJECTION</>
            )}
          </button>
        </div>
      </div>
      </ResizablePanel>
    </div>
  )
}
