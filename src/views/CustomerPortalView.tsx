/**
 * CustomerPortalView.tsx
 * Public-facing Power On Solutions Customer Portal
 * Route: /portal  /request
 * No auth required — Phase 1
 *
 * Tabs:
 *   Homeowner  → service request form → inserts portal_requests
 *   GC / Sub   → RFQ form            → inserts portal_requests (request_type='gc')
 *
 * On submit: row inserted into portal_requests with source='customer_portal'
 */

import React, { useState } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'homeowner' | 'gc'

type FormState = {
  name: string
  phone: string
  email: string
  address: string
  city: string
  service_category: string
  description: string
  preferred_date: string
  preferred_time: string
  // GC-only
  company: string
}

const BLANK: FormState = {
  name: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  service_category: '',
  description: '',
  preferred_date: '',
  preferred_time: '',
  company: '',
}

const SERVICE_CATEGORIES = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'solar', label: 'Solar / PV' },
  { value: 'maintenance', label: 'Maintenance / Service' },
  { value: 'panel_upgrade', label: 'Panel Upgrade' },
  { value: 'ev_charger', label: 'EV Charger' },
  { value: 'other', label: 'Other' },
]

const TIME_SLOTS = [
  'Morning (8am – 12pm)',
  'Afternoon (12pm – 4pm)',
  'Evening (4pm – 7pm)',
  'Flexible',
]

// ── Styles (inline — no Tailwind dependency for portal public page) ────────────
// Brand: #02060d navy · #1e80df electric blue · Barlow Condensed + Barlow

const S = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(160deg, #02060d 0%, #06111f 60%, #0a1a2e 100%)',
    fontFamily: "'Barlow', system-ui, sans-serif",
    color: '#e8edf4',
  } as React.CSSProperties,

  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 32px',
    borderBottom: '1px solid rgba(30,128,223,0.15)',
    background: 'rgba(2,6,13,0.8)',
    backdropFilter: 'blur(12px)',
    position: 'sticky' as const,
    top: 0,
    zIndex: 50,
  } as React.CSSProperties,

  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    textDecoration: 'none',
  } as React.CSSProperties,

  logoMark: {
    width: 36,
    height: 36,
    background: 'linear-gradient(135deg, #1e80df, #0d4f8c)',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
  } as React.CSSProperties,

  logoText: {
    fontFamily: "'Barlow Condensed', system-ui, sans-serif",
    fontWeight: 700,
    fontSize: 18,
    letterSpacing: '0.04em',
    color: '#e8edf4',
    textTransform: 'uppercase' as const,
    lineHeight: 1.1,
  } as React.CSSProperties,

  licenseTag: {
    fontSize: 11,
    color: '#4a7fa8',
    letterSpacing: '0.06em',
    fontWeight: 600,
  } as React.CSSProperties,

  hero: {
    textAlign: 'center' as const,
    padding: '56px 24px 40px',
    maxWidth: 640,
    margin: '0 auto',
  } as React.CSSProperties,

  heroEyebrow: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.18em',
    color: '#1e80df',
    textTransform: 'uppercase' as const,
    marginBottom: 14,
  } as React.CSSProperties,

  heroTitle: {
    fontFamily: "'Barlow Condensed', system-ui, sans-serif",
    fontWeight: 700,
    fontSize: 'clamp(32px, 6vw, 52px)',
    lineHeight: 1.1,
    letterSpacing: '-0.01em',
    color: '#fff',
    marginBottom: 16,
  } as React.CSSProperties,

  heroSub: {
    fontSize: 16,
    color: '#7a9bbe',
    lineHeight: 1.6,
    maxWidth: 480,
    margin: '0 auto 32px',
  } as React.CSSProperties,

  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 12px',
    borderRadius: 20,
    background: 'rgba(30,128,223,0.12)',
    border: '1px solid rgba(30,128,223,0.3)',
    fontSize: 12,
    color: '#5da8e8',
    fontWeight: 600,
  } as React.CSSProperties,

  tabRow: {
    display: 'flex',
    gap: 0,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.08)',
    padding: 4,
    margin: '0 auto 32px',
    maxWidth: 360,
    width: '100%',
  } as React.CSSProperties,

  tab: (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '10px 16px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontFamily: "'Barlow Condensed', system-ui, sans-serif",
    fontWeight: 700,
    fontSize: 14,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    transition: 'all 0.2s',
    background: active ? 'linear-gradient(135deg, #1e80df, #1565b8)' : 'transparent',
    color: active ? '#fff' : '#4a7fa8',
    boxShadow: active ? '0 2px 12px rgba(30,128,223,0.3)' : 'none',
  }),

  formWrap: {
    maxWidth: 600,
    margin: '0 auto',
    padding: '0 20px 60px',
  } as React.CSSProperties,

  card: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: '32px',
    backdropFilter: 'blur(8px)',
  } as React.CSSProperties,

  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.14em',
    color: '#1e80df',
    textTransform: 'uppercase' as const,
    marginBottom: 16,
    marginTop: 24,
  } as React.CSSProperties,

  fieldRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
  } as React.CSSProperties,

  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    marginBottom: 12,
  } as React.CSSProperties,

  label: {
    fontSize: 12,
    fontWeight: 600,
    color: '#7a9bbe',
    letterSpacing: '0.04em',
  } as React.CSSProperties,

  input: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 14,
    color: '#e8edf4',
    outline: 'none',
    transition: 'border-color 0.2s',
    width: '100%',
    boxSizing: 'border-box' as const,
    fontFamily: "'Barlow', system-ui, sans-serif",
  } as React.CSSProperties,

  textarea: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 14,
    color: '#e8edf4',
    outline: 'none',
    transition: 'border-color 0.2s',
    width: '100%',
    boxSizing: 'border-box' as const,
    minHeight: 100,
    resize: 'vertical' as const,
    fontFamily: "'Barlow', system-ui, sans-serif",
  } as React.CSSProperties,

  select: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 14,
    color: '#e8edf4',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
    fontFamily: "'Barlow', system-ui, sans-serif",
    appearance: 'none' as const,
    cursor: 'pointer',
  } as React.CSSProperties,

  submitBtn: (loading: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '14px',
    marginTop: 24,
    borderRadius: 10,
    border: 'none',
    background: loading
      ? 'rgba(30,128,223,0.4)'
      : 'linear-gradient(135deg, #1e80df, #1565b8)',
    color: '#fff',
    fontFamily: "'Barlow Condensed', system-ui, sans-serif",
    fontWeight: 700,
    fontSize: 16,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    cursor: loading ? 'not-allowed' : 'pointer',
    boxShadow: loading ? 'none' : '0 4px 20px rgba(30,128,223,0.35)',
    transition: 'all 0.2s',
  }),

  errorBox: {
    background: 'rgba(220,38,38,0.12)',
    border: '1px solid rgba(220,38,38,0.3)',
    borderRadius: 8,
    padding: '12px 16px',
    fontSize: 13,
    color: '#fca5a5',
    marginTop: 16,
  } as React.CSSProperties,

  successWrap: {
    textAlign: 'center' as const,
    padding: '60px 24px',
    maxWidth: 480,
    margin: '0 auto',
  } as React.CSSProperties,

  successIcon: {
    width: 72,
    height: 72,
    background: 'linear-gradient(135deg, #16a34a, #15803d)',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 32,
    margin: '0 auto 24px',
    boxShadow: '0 8px 32px rgba(22,163,74,0.3)',
  } as React.CSSProperties,

  successTitle: {
    fontFamily: "'Barlow Condensed', system-ui, sans-serif",
    fontWeight: 700,
    fontSize: 32,
    color: '#fff',
    marginBottom: 12,
  } as React.CSSProperties,

  successSub: {
    fontSize: 15,
    color: '#7a9bbe',
    lineHeight: 1.6,
    marginBottom: 32,
  } as React.CSSProperties,

  anotherBtn: {
    padding: '10px 28px',
    borderRadius: 8,
    border: '1px solid rgba(30,128,223,0.4)',
    background: 'transparent',
    color: '#5da8e8',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
  } as React.CSSProperties,

  footer: {
    textAlign: 'center' as const,
    padding: '20px 24px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    fontSize: 12,
    color: '#2d4a63',
  } as React.CSSProperties,

  gcInfo: {
    background: 'rgba(30,128,223,0.06)',
    border: '1px solid rgba(30,128,223,0.15)',
    borderRadius: 12,
    padding: '20px 24px',
    marginBottom: 24,
  } as React.CSSProperties,

  gcInfoTitle: {
    fontFamily: "'Barlow Condensed', system-ui, sans-serif",
    fontWeight: 700,
    fontSize: 16,
    color: '#5da8e8',
    marginBottom: 8,
  } as React.CSSProperties,

  gcInfoList: {
    fontSize: 13,
    color: '#7a9bbe',
    lineHeight: 1.8,
    paddingLeft: 16,
  } as React.CSSProperties,
}

// ── Fonts loader (inject once) ────────────────────────────────────────────────
function loadFonts() {
  if (document.getElementById('portal-fonts')) return
  const link = document.createElement('link')
  link.id = 'portal-fonts'
  link.rel = 'stylesheet'
  link.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600&display=swap'
  document.head.appendChild(link)
}

// ── Field component ───────────────────────────────────────────────────────────
function Field({
  label,
  required,
  children,
  fullWidth,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
  fullWidth?: boolean
}) {
  return (
    <div style={{ ...S.field, ...(fullWidth ? { gridColumn: '1 / -1' } : {}) }}>
      <label style={S.label}>
        {label}
        {required && <span style={{ color: '#1e80df', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CustomerPortalView() {
  loadFonts()

  const [tab, setTab] = useState<Tab>('homeowner')
  const [form, setForm] = useState<FormState>(BLANK)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const set = (key: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm(prev => ({ ...prev, [key]: e.target.value }))

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError('Please enter your name.')
      return
    }
    if (!form.phone.trim() && !form.email.trim()) {
      setError('Please enter a phone number or email so we can reach you.')
      return
    }
    if (!form.service_category) {
      setError('Please select a service category.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const payload: Record<string, any> = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        service_category: form.service_category,
        description: form.description.trim() || null,
        preferred_date: form.preferred_date || null,
        preferred_time: form.preferred_time || null,
        request_type: tab === 'gc' ? 'gc' : 'homeowner',
        source: 'customer_portal',
        status: 'new',
      }

      if (tab === 'gc' && form.company.trim()) {
        payload.notes = `Company: ${form.company.trim()}`
      }

      const { error: dbError } = await (supabase as any)
        .from('portal_requests')
        .insert(payload)

      if (dbError) {
        setError('Something went wrong submitting your request. Please try again or call us.')
        console.error('portal_requests insert error:', dbError)
        return
      }

      setSubmitted(true)
    } catch (err: any) {
      setError('Unexpected error. Please try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setForm(BLANK)
    setSubmitted(false)
    setError(null)
  }

  return (
    <div style={S.page}>
      {/* Header */}
      <header style={S.header}>
        <div style={S.logo}>
          <div style={S.logoMark}>⚡</div>
          <div>
            <div style={S.logoText}>Power On Solutions</div>
            <div style={S.licenseTag}>C-10 ELECTRICAL · LIC #1151468</div>
          </div>
        </div>
        <a
          href="tel:17603399888"
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: '#5da8e8',
            textDecoration: 'none',
            letterSpacing: '0.04em',
          }}
        >
          (760) 339-9888
        </a>
      </header>

      {submitted ? (
        /* ── Success Screen ── */
        <div style={S.successWrap}>
          <div style={S.successIcon}>✓</div>
          <div style={S.successTitle}>Request Received</div>
          <p style={S.successSub}>
            We'll review your request and reach out within 1 business day to schedule your estimate.
            Coachella Valley's trusted electrical contractor — we've got you covered.
          </p>
          <button style={S.anotherBtn} onClick={reset}>
            Submit another request
          </button>
        </div>
      ) : (
        <>
          {/* Hero */}
          <div style={S.hero}>
            <div style={S.heroEyebrow}>Coachella Valley · Electrical Contractor</div>
            <h1 style={S.heroTitle}>Request Electrical Service</h1>
            <p style={S.heroSub}>
              Residential, commercial, solar, and maintenance. Licensed, insured, and serving the Coachella Valley.
            </p>
            <div style={S.badge}>
              <span>⚡</span>
              <span>Fast response · No-obligation estimates</span>
            </div>
          </div>

          {/* Tab switcher */}
          <div style={{ padding: '0 20px' }}>
            <div style={S.tabRow}>
              <button style={S.tab(tab === 'homeowner')} onClick={() => setTab('homeowner')}>
                Homeowner
              </button>
              <button style={S.tab(tab === 'gc')} onClick={() => setTab('gc')}>
                GC / Sub
              </button>
            </div>
          </div>

          {/* Form */}
          <div style={S.formWrap}>
            <div style={S.card}>

              {tab === 'gc' && (
                <div style={S.gcInfo}>
                  <div style={S.gcInfoTitle}>General Contractor & Sub-Contractor RFQ</div>
                  <ul style={S.gcInfoList}>
                    <li>C-10 Electrical License #1151468</li>
                    <li>Available for bid on commercial & residential projects</li>
                    <li>Crew capacity and certifications available on request</li>
                  </ul>
                </div>
              )}

              {/* Contact */}
              <div style={S.sectionLabel}>Contact Information</div>
              <div style={S.fieldRow}>
                <Field label="Full Name" required>
                  <input style={S.input} value={form.name} onChange={set('name')} placeholder="Your name" />
                </Field>
                {tab === 'gc' && (
                  <Field label="Company">
                    <input style={S.input} value={form.company} onChange={set('company')} placeholder="Company name" />
                  </Field>
                )}
                <Field label="Phone">
                  <input style={S.input} type="tel" value={form.phone} onChange={set('phone')} placeholder="(760) 000-0000" />
                </Field>
                <Field label="Email">
                  <input style={S.input} type="email" value={form.email} onChange={set('email')} placeholder="you@email.com" />
                </Field>
              </div>

              {/* Location */}
              <div style={S.sectionLabel}>Service Location</div>
              <div style={S.fieldRow}>
                <Field label="Address" fullWidth>
                  <input style={S.input} value={form.address} onChange={set('address')} placeholder="Street address" />
                </Field>
                <Field label="City">
                  <input style={S.input} value={form.city} onChange={set('city')} placeholder="e.g. Palm Springs" />
                </Field>
              </div>

              {/* Service */}
              <div style={S.sectionLabel}>Service Request</div>
              <div style={S.fieldRow}>
                <Field label="Service Category" required>
                  <select style={S.select} value={form.service_category} onChange={set('service_category')}>
                    <option value="">Select a category</option>
                    {SERVICE_CATEGORIES.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </Field>
                {tab === 'homeowner' && (
                  <Field label="Preferred Date">
                    <input style={S.input} type="date" value={form.preferred_date} onChange={set('preferred_date')} />
                  </Field>
                )}
              </div>
              {tab === 'homeowner' && (
                <div style={S.fieldRow}>
                  <Field label="Preferred Time">
                    <select style={S.select} value={form.preferred_time} onChange={set('preferred_time')}>
                      <option value="">Any time</option>
                      {TIME_SLOTS.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
              <div style={S.fieldRow}>
                <Field label={tab === 'gc' ? 'Project Description / Scope' : 'Describe the Issue'} fullWidth>
                  <textarea
                    style={S.textarea}
                    value={form.description}
                    onChange={set('description')}
                    placeholder={
                      tab === 'gc'
                        ? 'Describe the project scope, timeline, and any specific requirements...'
                        : 'What electrical issue are you experiencing? Any relevant details help...'
                    }
                  />
                </Field>
              </div>

              {error && <div style={S.errorBox}>{error}</div>}

              <button style={S.submitBtn(loading)} onClick={handleSubmit} disabled={loading}>
                {loading ? 'Submitting…' : tab === 'gc' ? 'Submit RFQ' : 'Request Estimate'}
              </button>

              <p style={{ fontSize: 12, color: '#2d4a63', textAlign: 'center', marginTop: 14 }}>
                By submitting you agree to be contacted by Power On Solutions LLC regarding your request.
              </p>
            </div>
          </div>
        </>
      )}

      <footer style={S.footer}>
        © {new Date().getFullYear()} Power On Solutions LLC · C-10 Electrical License #1151468 · Desert Hot Springs, CA
      </footer>
    </div>
  )
}
