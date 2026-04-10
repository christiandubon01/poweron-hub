/**
 * PortalRedesign.tsx
 * PowerOn Solutions LLC — Customer-facing portal.
 * Web3 / glassmorphism aesthetic · dark + light themes · mobile-first.
 * Branch: ht-web1
 */

import React, { useEffect, useRef, useState } from 'react';
import { PortalThemeProvider, usePortalTheme } from './PortalThemeProvider';

// ─── Brand constants ────────────────────────────────────────────────────────────

const BRAND = {
  name:          'Power On Solutions, LLC',
  tagline:       'Licensed. Insured. AI-Powered.',
  license:       'CSLB License #1119879',
  licenseShort:  '#1119879',
  cslbVerifyUrl: 'https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/CheckLicense.aspx',
  phone:         '(888) 456-7890',
  email:         'service@poweronsolutionsllc.com',
  responseTime:  'We respond within 60 minutes',
  c10Badge:      'Licensed C-10 Electrical Contractor',
  aiPowered:     'AI-Powered Operations',
  state:         'California',
  city:          'Los Angeles County',
} as const;

// ─── Service data ───────────────────────────────────────────────────────────────

interface ServiceItem {
  id:          string;
  icon:        string;
  title:       string;
  short:       string;
  detail:      string;
  highlight:   string;
}

const SERVICES: ServiceItem[] = [
  {
    id:        'residential',
    icon:      '🏠',
    title:     'Residential Electrical',
    short:     'Panel upgrades, rewiring, outlets, EV chargers & more.',
    detail:
      'Complete home electrical services — panel upgrades to 200 A / 400 A, whole-home rewiring, outlet & switch installs, GFCI protection, EV charging station installation, lighting retrofits, and safety inspections.',
    highlight: 'Most installs completed same or next day.',
  },
  {
    id:        'commercial',
    icon:      '🏢',
    title:     'Commercial Electrical',
    short:     'Tenant improvements, service upgrades, lighting & compliance.',
    detail:
      'Tenant improvements, service entrance upgrades, lighting controls (occupancy / daylight sensors), exit & emergency lighting, electrical code compliance surveys, and coordination with general contractors.',
    highlight: 'NEC 2023 compliant work on every project.',
  },
  {
    id:        'solar',
    icon:      '☀️',
    title:     'Solar & Battery Storage',
    short:     'Grid-tied solar, battery back-up & interconnect permits.',
    detail:
      'Design-assist and installation of grid-tied solar PV systems, battery energy storage (Tesla Powerwall, Enphase), utility interconnect applications, NEM enrollment, and permit expediting with local AHJs.',
    highlight: 'Certified RMO partner for solar permitting.',
  },
  {
    id:        'service-call',
    icon:      '⚡',
    title:     'Emergency Service Calls',
    short:     '24 / 7 response — breakers, tripped GFCI, power outages.',
    detail:
      'Rapid-response troubleshooting for tripped breakers, partial outages, burning smells, GFCI failures, dead outlets, and flickering lights. We carry common parts on every truck to get you back up fast.',
    highlight: '60-minute response commitment.',
  },
  {
    id:        'maintenance',
    icon:      '🔧',
    title:     'Preventive Maintenance',
    short:     'Annual inspections, thermographic scanning & panel checks.',
    detail:
      'Scheduled electrical preventive maintenance: panel thermal scanning, torque checks, arc-flash hazard assessment, breaker exercising, grounding verification, and AFCI/GFCI device testing.',
    highlight: 'Catch problems before they become emergencies.',
  },
];

// ─── Testimonials ───────────────────────────────────────────────────────────────

interface Testimonial {
  id:     number;
  name:   string;
  city:   string;
  text:   string;
  stars:  number;
  type:   string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    id:    1,
    name:  'Maria G.',
    city:  'Pasadena, CA',
    text:  "Responded in under an hour on a Sunday. Had our power back before dinner. Absolutely outstanding service — I won't call anyone else.",
    stars: 5,
    type:  'Emergency Service',
  },
  {
    id:    2,
    name:  'David R.',
    city:  'Burbank, CA',
    text:  "Panel upgrade was flawless — permitted, inspected, and passed first try. The AI estimate was accurate to the dollar. Incredibly professional.",
    stars: 5,
    type:  'Panel Upgrade',
  },
  {
    id:    3,
    name:  'Sandra L.',
    city:  'Glendale, CA',
    text:  "Solar install went smoothly from permit to PTO. They handled everything with the utility and kept me updated every step. Highly recommended.",
    stars: 5,
    type:  'Solar Installation',
  },
  {
    id:    4,
    name:  'James T.',
    city:  'Los Angeles, CA',
    text:  "Needed three EV chargers installed at my shop. Done in one day, all circuits properly labeled, and the work is clean. Great crew.",
    stars: 5,
    type:  'Commercial / EV',
  },
];

// ─── Sub-components ─────────────────────────────────────────────────────────────

/** Simple star row */
function StarRow({ count }: { count: number }): React.ReactElement {
  return (
    <span style={{ color: '#f5c518', fontSize: '0.875rem', letterSpacing: '0.05em' }}>
      {'★'.repeat(count)}
    </span>
  );
}

/** Theme toggle button */
function ThemeToggle(): React.ReactElement {
  const { theme, toggleTheme } = usePortalTheme();
  return (
    <button
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      style={{
        background:   'var(--glass-bg)',
        border:       '1px solid var(--glass-border)',
        borderRadius: '999px',
        color:        'var(--text-secondary)',
        cursor:       'pointer',
        fontSize:     '1.1rem',
        lineHeight:   1,
        minWidth:     '40px',
        minHeight:    '40px',
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        transition:   'background 0.2s, border-color 0.2s',
        flexShrink:   0,
      }}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}

/** Credential / trust bar — always visible */
function CredentialBar(): React.ReactElement {
  return (
    <div
      style={{
        display:        'flex',
        flexWrap:       'wrap',
        gap:            '8px',
        justifyContent: 'center',
        alignItems:     'center',
        padding:        '10px 16px',
        background:     'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        borderBottom:   '1px solid var(--border-subtle)',
      }}
    >
      {/* C-10 License */}
      <a
        href={BRAND.cslbVerifyUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="glass-badge"
        style={{ textDecoration: 'none' }}
        title="Verify license on CSLB.ca.gov"
      >
        🏛️ CSLB {BRAND.licenseShort} ↗
      </a>

      {/* C-10 badge */}
      <span className="glass-badge">⚡ C-10 Licensed</span>

      {/* Insurance */}
      <span
        className="glass-badge"
        style={{
          background: 'var(--accent-blue-dim)',
          borderColor: 'var(--accent-blue)',
          color:       'var(--accent-blue)',
        }}
      >
        🛡️ Insured &amp; Bonded
      </span>

      {/* AI-Powered */}
      <span
        className="glass-badge"
        style={{
          background:  'rgba(58,142,255,0.12)',
          borderColor: 'rgba(58,142,255,0.35)',
          color:       'var(--accent-blue)',
        }}
      >
        🤖 AI-Powered Ops
      </span>

      {/* Response time */}
      <span className="glass-badge">⏱️ 60-Min Response</span>
    </div>
  );
}

/** Hero section */
function HeroSection({
  onRequestEstimate,
}: {
  onRequestEstimate: () => void;
}): React.ReactElement {
  return (
    <section
      className="portal-fade-up portal-fade-up-1"
      style={{
        textAlign:  'center',
        padding:    'clamp(48px, 8vw, 96px) clamp(16px, 6vw, 64px) clamp(32px, 6vw, 64px)',
        position:   'relative',
        overflow:   'hidden',
      }}
    >
      {/* Ambient glow blobs */}
      <div
        aria-hidden="true"
        style={{
          position:     'absolute',
          top:          '-80px',
          left:         '50%',
          transform:    'translateX(-50%)',
          width:        '600px',
          height:       '400px',
          background:   'radial-gradient(ellipse at center, var(--accent-green-dim) 0%, transparent 70%)',
          pointerEvents:'none',
          zIndex:       0,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position:     'absolute',
          bottom:       '-40px',
          right:        '-80px',
          width:        '400px',
          height:       '300px',
          background:   'radial-gradient(ellipse at center, var(--accent-blue-dim) 0%, transparent 70%)',
          pointerEvents:'none',
          zIndex:       0,
        }}
      />

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Brand wordmark */}
        <div
          style={{
            fontSize:      'clamp(0.7rem, 1.8vw, 0.875rem)',
            fontWeight:    700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color:         'var(--text-accent)',
            marginBottom:  '12px',
          }}
        >
          {BRAND.city} · {BRAND.state}
        </div>

        <h1
          style={{
            fontSize:     'clamp(2rem, 5.5vw, 3.6rem)',
            fontWeight:   800,
            lineHeight:   1.1,
            color:        'var(--text-primary)',
            margin:       '0 0 12px',
            letterSpacing:'-0.02em',
          }}
        >
          Power On{' '}
          <span
            style={{
              background:           'linear-gradient(135deg, var(--accent-green) 0%, var(--accent-blue) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor:  'transparent',
              backgroundClip:       'text',
            }}
          >
            Solutions
          </span>
          , LLC
        </h1>

        {/* Tagline */}
        <p
          style={{
            fontSize:      'clamp(1rem, 2.5vw, 1.35rem)',
            fontWeight:    600,
            color:         'var(--text-secondary)',
            margin:        '0 0 8px',
            letterSpacing: '0.04em',
          }}
        >
          {BRAND.tagline}
        </p>

        {/* C-10 pill */}
        <div
          style={{
            display:        'flex',
            justifyContent: 'center',
            marginBottom:   '32px',
          }}
        >
          <span
            className="glass-badge portal-pulse-green"
            style={{ fontSize: '0.8rem' }}
          >
            ⚡ {BRAND.c10Badge}
          </span>
        </div>

        {/* CTA row */}
        <div
          style={{
            display:        'flex',
            gap:            '16px',
            justifyContent: 'center',
            flexWrap:       'wrap',
          }}
        >
          <button
            className="portal-cta-btn"
            onClick={onRequestEstimate}
            style={{ fontSize: 'clamp(0.9rem, 2vw, 1rem)' }}
          >
            Request Free Estimate →
          </button>

          <a
            href={`tel:${BRAND.phone}`}
            style={{
              display:       'inline-flex',
              alignItems:    'center',
              gap:           '8px',
              background:    'var(--glass-bg)',
              border:        '1px solid var(--glass-border)',
              borderRadius:  '12px',
              color:         'var(--text-primary)',
              padding:       '14px 24px',
              fontWeight:    600,
              fontSize:      'clamp(0.9rem, 2vw, 1rem)',
              textDecoration:'none',
              minHeight:     '48px',
              backdropFilter:'var(--glass-blur)',
              WebkitBackdropFilter: 'var(--glass-blur)',
              transition:    'background 0.2s, border-color 0.2s',
              whiteSpace:    'nowrap',
            }}
          >
            📞 {BRAND.phone}
          </a>
        </div>

        {/* Response commitment */}
        <p
          style={{
            marginTop:  '20px',
            fontSize:   '0.85rem',
            color:      'var(--text-muted)',
            letterSpacing: '0.02em',
          }}
        >
          {BRAND.responseTime} · Available 24 / 7 for emergencies
        </p>
      </div>
    </section>
  );
}

/** A single service card with expand-on-hover */
function ServiceCard({ svc }: { svc: ServiceItem }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`glass-card${expanded ? ' glass-card-active' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={() => setExpanded((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded((v) => !v);
        }
      }}
      style={{
        padding:    '24px',
        cursor:     'pointer',
        userSelect: 'none',
        outline:    'none',
      }}
    >
      {/* Icon + title row */}
      <div
        style={{
          display:     'flex',
          alignItems:  'flex-start',
          gap:         '14px',
          marginBottom:'10px',
        }}
      >
        <span
          style={{
            fontSize:     '2rem',
            lineHeight:   1,
            flexShrink:   0,
            filter:       'drop-shadow(0 2px 6px rgba(0,0,0,0.3))',
          }}
          aria-hidden="true"
        >
          {svc.icon}
        </span>
        <div>
          <h3
            style={{
              fontSize:   'clamp(0.95rem, 2vw, 1.1rem)',
              fontWeight: 700,
              color:      'var(--text-primary)',
              margin:     '0 0 4px',
            }}
          >
            {svc.title}
          </h3>
          <p
            style={{
              fontSize: '0.875rem',
              color:    'var(--text-secondary)',
              margin:   0,
            }}
          >
            {svc.short}
          </p>
        </div>
      </div>

      {/* Expanded detail */}
      <div
        style={{
          overflow:   'hidden',
          maxHeight:  expanded ? '200px' : '0',
          opacity:    expanded ? 1 : 0,
          transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease',
        }}
      >
        <p
          style={{
            fontSize:     '0.85rem',
            color:        'var(--text-secondary)',
            margin:       '0 0 10px',
            paddingTop:   '8px',
            borderTop:    '1px solid var(--border-subtle)',
          }}
        >
          {svc.detail}
        </p>
        <span className="glass-badge" style={{ fontSize: '0.75rem' }}>
          ✓ {svc.highlight}
        </span>
      </div>

      {/* Expand hint */}
      <div
        style={{
          marginTop:   '10px',
          fontSize:    '0.75rem',
          color:       'var(--text-muted)',
          display:     'flex',
          alignItems:  'center',
          gap:         '4px',
        }}
      >
        <span
          style={{
            display:    'inline-block',
            transition: 'transform 0.25s ease',
            transform:  expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          ▾
        </span>
        {expanded ? 'Collapse' : 'Learn more'}
      </div>
    </div>
  );
}

/** Service cards grid */
function ServicesSection(): React.ReactElement {
  return (
    <section
      className="portal-fade-up portal-fade-up-2"
      style={{ padding: 'clamp(24px, 5vw, 56px) clamp(16px, 6vw, 64px)' }}
    >
      <h2
        style={{
          textAlign:     'center',
          fontSize:      'clamp(1.4rem, 3.5vw, 2rem)',
          fontWeight:    700,
          color:         'var(--text-primary)',
          margin:        '0 0 8px',
          letterSpacing: '-0.01em',
        }}
      >
        What We Do
      </h2>
      <p
        style={{
          textAlign:   'center',
          color:       'var(--text-muted)',
          marginBottom:'32px',
          fontSize:    '0.875rem',
        }}
      >
        Tap any card to expand details
      </p>

      <div
        style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
          gap:                 '16px',
          maxWidth:            '1000px',
          margin:              '0 auto',
        }}
      >
        {SERVICES.map((svc) => (
          <ServiceCard key={svc.id} svc={svc} />
        ))}
      </div>
    </section>
  );
}

/** Rotating testimonial section */
function TestimonialSection(): React.ReactElement {
  const [activeIdx, setActiveIdx] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const resetInterval = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setActiveIdx((i) => (i + 1) % TESTIMONIALS.length);
    }, 5000);
  };

  useEffect(() => {
    resetInterval();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goTo = (idx: number) => {
    setActiveIdx(idx);
    resetInterval();
  };

  const t = TESTIMONIALS[activeIdx];

  return (
    <section
      className="portal-fade-up portal-fade-up-3"
      style={{
        padding:    'clamp(24px, 5vw, 56px) clamp(16px, 6vw, 64px)',
        background: 'var(--portal-bg-secondary)',
      }}
    >
      <h2
        style={{
          textAlign:     'center',
          fontSize:      'clamp(1.4rem, 3.5vw, 2rem)',
          fontWeight:    700,
          color:         'var(--text-primary)',
          margin:        '0 0 32px',
          letterSpacing: '-0.01em',
        }}
      >
        What Our Clients Say
      </h2>

      <div
        style={{
          maxWidth: '680px',
          margin:   '0 auto',
        }}
      >
        <div
          key={t.id}
          className="glass-card"
          style={{
            padding:       '32px',
            textAlign:     'center',
            position:      'relative',
            animation:     'portalFadeUp 0.4s cubic-bezier(0.22,1,0.36,1) both',
          }}
        >
          {/* Type badge */}
          <span
            className="glass-badge"
            style={{
              position:      'absolute',
              top:           '16px',
              right:         '16px',
              fontSize:      '0.7rem',
            }}
          >
            {t.type}
          </span>

          {/* Stars */}
          <div style={{ marginBottom: '12px' }}>
            <StarRow count={t.stars} />
          </div>

          {/* Quote */}
          <blockquote
            style={{
              fontSize:   'clamp(0.95rem, 2vw, 1.1rem)',
              color:      'var(--text-primary)',
              fontStyle:  'italic',
              lineHeight: 1.7,
              margin:     '0 0 16px',
            }}
          >
            &ldquo;{t.text}&rdquo;
          </blockquote>

          {/* Attribution */}
          <p
            style={{
              fontSize:   '0.85rem',
              color:      'var(--text-muted)',
              margin:     0,
              fontWeight: 600,
            }}
          >
            — {t.name}, {t.city}
          </p>
        </div>

        {/* Dot nav */}
        <div
          role="tablist"
          aria-label="Testimonial navigation"
          style={{
            display:        'flex',
            justifyContent: 'center',
            gap:            '8px',
            marginTop:      '20px',
          }}
        >
          {TESTIMONIALS.map((_, idx) => (
            <button
              key={idx}
              role="tab"
              aria-selected={idx === activeIdx}
              aria-label={`Testimonial ${idx + 1}`}
              onClick={() => goTo(idx)}
              style={{
                width:        idx === activeIdx ? '24px' : '8px',
                height:       '8px',
                borderRadius: '4px',
                border:       'none',
                background:   idx === activeIdx ? 'var(--accent-green)' : 'var(--border-visible)',
                cursor:       'pointer',
                padding:      0,
                transition:   'width 0.3s ease, background 0.3s ease',
                minHeight:    '8px',
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Trust / differentiator section */
function TrustSection(): React.ReactElement {
  const badges = [
    {
      icon:  '🏛️',
      label: 'CSLB Verified',
      sub:   BRAND.license,
      link:  BRAND.cslbVerifyUrl,
    },
    {
      icon:  '⚡',
      label: 'C-10 Electrical Contractor',
      sub:   'State of California',
    },
    {
      icon:  '🛡️',
      label: 'Fully Insured',
      sub:   'General liability + workers comp',
    },
    {
      icon:  '🔗',
      label: 'Licensed & Bonded',
      sub:   'Consumer protection guarantee',
    },
    {
      icon:  '🤖',
      label: 'AI-Powered Operations',
      sub:   'Faster estimates · smarter scheduling',
    },
    {
      icon:  '⏱️',
      label: '60-Minute Response',
      sub:   'We pick up. We show up.',
    },
  ];

  return (
    <section
      className="portal-fade-up portal-fade-up-4"
      style={{ padding: 'clamp(24px, 5vw, 56px) clamp(16px, 6vw, 64px)' }}
    >
      <h2
        style={{
          textAlign:     'center',
          fontSize:      'clamp(1.4rem, 3.5vw, 2rem)',
          fontWeight:    700,
          color:         'var(--text-primary)',
          margin:        '0 0 32px',
          letterSpacing: '-0.01em',
        }}
      >
        Why Clients Trust Us
      </h2>

      <div
        style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 230px), 1fr))',
          gap:                 '16px',
          maxWidth:            '900px',
          margin:              '0 auto',
        }}
      >
        {badges.map((b) => {
          const inner = (
            <div
              className="glass-card"
              style={{
                padding:    '20px',
                textAlign:  'center',
                height:     '100%',
                boxSizing:  'border-box',
              }}
            >
              <div style={{ fontSize: '2rem', marginBottom: '8px' }}>{b.icon}</div>
              <div
                style={{
                  fontSize:   '0.9rem',
                  fontWeight: 700,
                  color:      'var(--text-primary)',
                  marginBottom: '4px',
                }}
              >
                {b.label}
              </div>
              <div
                style={{
                  fontSize: '0.78rem',
                  color:    'var(--text-muted)',
                }}
              >
                {b.sub}
              </div>
              {b.link && (
                <div
                  style={{
                    fontSize:   '0.72rem',
                    color:      'var(--text-accent)',
                    marginTop:  '6px',
                    fontWeight: 600,
                  }}
                >
                  Verify ↗
                </div>
              )}
            </div>
          );

          return b.link ? (
            <a
              key={b.label}
              href={b.link}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', display: 'block' }}
            >
              {inner}
            </a>
          ) : (
            <div key={b.label}>{inner}</div>
          );
        })}
      </div>
    </section>
  );
}

/** Contact / CTA section */
function ContactSection({
  onRequestEstimate,
}: {
  onRequestEstimate: () => void;
}): React.ReactElement {
  return (
    <section
      className="portal-fade-up portal-fade-up-5"
      style={{
        padding:    'clamp(32px, 6vw, 72px) clamp(16px, 6vw, 64px)',
        textAlign:  'center',
        background: 'var(--portal-bg-secondary)',
      }}
    >
      <h2
        style={{
          fontSize:      'clamp(1.5rem, 4vw, 2.2rem)',
          fontWeight:    800,
          color:         'var(--text-primary)',
          margin:        '0 0 12px',
          letterSpacing: '-0.02em',
        }}
      >
        Ready to Get Started?
      </h2>
      <p
        style={{
          fontSize:    'clamp(0.9rem, 2vw, 1.1rem)',
          color:       'var(--text-secondary)',
          marginBottom:'32px',
        }}
      >
        Free estimates · No obligation · {BRAND.responseTime}
      </p>

      <div
        style={{
          display:        'flex',
          flexWrap:       'wrap',
          gap:            '16px',
          justifyContent: 'center',
          marginBottom:   '32px',
        }}
      >
        <button
          className="portal-cta-btn"
          onClick={onRequestEstimate}
          style={{ fontSize: 'clamp(1rem, 2.2vw, 1.1rem)', padding: '16px 40px' }}
        >
          Request a Free Estimate →
        </button>

        <a
          href={`tel:${BRAND.phone}`}
          style={{
            display:        'inline-flex',
            alignItems:     'center',
            gap:            '8px',
            background:     'var(--glass-bg)',
            border:         '1px solid var(--glass-border)',
            borderRadius:   '12px',
            color:          'var(--text-primary)',
            padding:        '16px 28px',
            fontWeight:     700,
            fontSize:       'clamp(0.9rem, 2vw, 1.05rem)',
            textDecoration: 'none',
            minHeight:      '48px',
            backdropFilter: 'var(--glass-blur)',
            WebkitBackdropFilter: 'var(--glass-blur)',
            transition:     'background 0.2s',
            whiteSpace:     'nowrap',
          }}
        >
          📞 {BRAND.phone}
        </a>
      </div>

      {/* Email */}
      <a
        href={`mailto:${BRAND.email}`}
        style={{
          fontSize:       '0.9rem',
          color:          'var(--text-accent)',
          textDecoration: 'none',
          fontWeight:     600,
          letterSpacing:  '0.01em',
        }}
      >
        ✉️ {BRAND.email}
      </a>
    </section>
  );
}

/** Footer */
function PortalFooter(): React.ReactElement {
  const year = new Date().getFullYear();
  return (
    <footer
      style={{
        padding:    'clamp(20px, 4vw, 40px) clamp(16px, 6vw, 64px)',
        background: 'var(--portal-bg)',
        borderTop:  '1px solid var(--border-subtle)',
      }}
    >
      {/* License bar */}
      <div
        style={{
          textAlign:    'center',
          marginBottom: '16px',
        }}
      >
        <a
          href={BRAND.cslbVerifyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="glass-badge"
          style={{ textDecoration: 'none', fontSize: '0.75rem' }}
        >
          🏛️ {BRAND.c10Badge} · {BRAND.license} · Verify on CSLB.ca.gov ↗
        </a>
      </div>

      {/* Links row */}
      <div
        style={{
          display:        'flex',
          flexWrap:       'wrap',
          gap:            '16px',
          justifyContent: 'center',
          marginBottom:   '16px',
        }}
      >
        {[
          { label: 'Privacy Policy',     href: '/privacy' },
          { label: 'Terms of Service',   href: '/terms' },
          { label: 'Verify Our License', href: BRAND.cslbVerifyUrl, external: true },
        ].map((l) => (
          <a
            key={l.label}
            href={l.href}
            target={l.external ? '_blank' : undefined}
            rel={l.external ? 'noopener noreferrer' : undefined}
            style={{
              fontSize:       '0.8rem',
              color:          'var(--text-muted)',
              textDecoration: 'none',
              transition:     'color 0.2s',
            }}
          >
            {l.label}
          </a>
        ))}
      </div>

      {/* Copyright */}
      <p
        style={{
          textAlign:   'center',
          fontSize:    '0.75rem',
          color:       'var(--text-muted)',
          margin:      0,
        }}
      >
        &copy; {year} {BRAND.name}. All rights reserved.
        <span style={{ margin: '0 8px', opacity: 0.4 }}>·</span>
        {BRAND.city}, {BRAND.state}
      </p>
    </footer>
  );
}

// ─── Estimate Modal (lightweight inline) ──────────────────────────────────────

interface EstimateModalProps {
  open:    boolean;
  onClose: () => void;
}

function EstimateModal({ open, onClose }: EstimateModalProps): React.ReactElement | null {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name:    '',
    phone:   '',
    email:   '',
    service: '',
    message: '',
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // In production: POST to your endpoint / Supabase / n8n webhook
    setSubmitted(true);
  };

  const handleClose = () => {
    onClose();
    // reset after animation
    setTimeout(() => setSubmitted(false), 300);
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Request a Free Estimate"
      style={{
        position:       'fixed',
        inset:          0,
        zIndex:         1000,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        padding:        '16px',
        background:     'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        animation:      'portalFadeUp 0.25s ease both',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="glass-card"
        style={{
          width:      '100%',
          maxWidth:   '520px',
          maxHeight:  '90vh',
          overflowY:  'auto',
          padding:    'clamp(24px, 5vw, 40px)',
          position:   'relative',
        }}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          aria-label="Close"
          style={{
            position:   'absolute',
            top:        '16px',
            right:      '16px',
            background: 'var(--glass-bg)',
            border:     '1px solid var(--glass-border)',
            borderRadius: '8px',
            color:      'var(--text-secondary)',
            cursor:     'pointer',
            fontSize:   '1rem',
            width:      '32px',
            height:     '32px',
            display:    'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✕
        </button>

        {submitted ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>✅</div>
            <h3
              style={{
                fontSize:   '1.4rem',
                fontWeight: 700,
                color:      'var(--text-primary)',
                margin:     '0 0 8px',
              }}
            >
              Request Received!
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
              We&apos;ll be in touch within 60 minutes.
            </p>
            <button className="portal-cta-btn" onClick={handleClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <h3
              style={{
                fontSize:   'clamp(1.1rem, 3vw, 1.4rem)',
                fontWeight: 700,
                color:      'var(--text-primary)',
                margin:     '0 0 6px',
              }}
            >
              Request a Free Estimate
            </h3>
            <p
              style={{
                fontSize:    '0.85rem',
                color:       'var(--text-muted)',
                marginBottom:'24px',
              }}
            >
              {BRAND.responseTime} · No obligation
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {(
                [
                  { name: 'name',  label: 'Full Name',     type: 'text',  required: true },
                  { name: 'phone', label: 'Phone Number',  type: 'tel',   required: true },
                  { name: 'email', label: 'Email Address', type: 'email', required: false },
                ] as const
              ).map((f) => (
                <div key={f.name}>
                  <label
                    htmlFor={`estimate-${f.name}`}
                    style={{
                      display:      'block',
                      fontSize:     '0.8rem',
                      fontWeight:   600,
                      color:        'var(--text-secondary)',
                      marginBottom: '6px',
                    }}
                  >
                    {f.label} {f.required && <span style={{ color: 'var(--accent-green)' }}>*</span>}
                  </label>
                  <input
                    id={`estimate-${f.name}`}
                    name={f.name}
                    type={f.type}
                    required={f.required}
                    value={form[f.name as keyof typeof form]}
                    onChange={handleChange}
                    style={{
                      width:        '100%',
                      background:   'var(--glass-bg)',
                      border:       '1px solid var(--glass-border)',
                      borderRadius: '8px',
                      color:        'var(--text-primary)',
                      fontSize:     '0.9rem',
                      padding:      '10px 14px',
                      outline:      'none',
                      boxSizing:    'border-box',
                      minHeight:    '44px',
                      transition:   'border-color 0.2s',
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent-green)')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--glass-border)')}
                  />
                </div>
              ))}

              {/* Service type select */}
              <div>
                <label
                  htmlFor="estimate-service"
                  style={{
                    display:      'block',
                    fontSize:     '0.8rem',
                    fontWeight:   600,
                    color:        'var(--text-secondary)',
                    marginBottom: '6px',
                  }}
                >
                  Service Type <span style={{ color: 'var(--accent-green)' }}>*</span>
                </label>
                <select
                  id="estimate-service"
                  name="service"
                  required
                  value={form.service}
                  onChange={handleChange}
                  style={{
                    width:        '100%',
                    background:   'var(--glass-bg)',
                    border:       '1px solid var(--glass-border)',
                    borderRadius: '8px',
                    color:        'var(--text-primary)',
                    fontSize:     '0.9rem',
                    padding:      '10px 14px',
                    outline:      'none',
                    boxSizing:    'border-box',
                    minHeight:    '44px',
                    cursor:       'pointer',
                  }}
                >
                  <option value="">— Select a service —</option>
                  {SERVICES.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
              </div>

              {/* Message */}
              <div>
                <label
                  htmlFor="estimate-message"
                  style={{
                    display:      'block',
                    fontSize:     '0.8rem',
                    fontWeight:   600,
                    color:        'var(--text-secondary)',
                    marginBottom: '6px',
                  }}
                >
                  Describe your project
                </label>
                <textarea
                  id="estimate-message"
                  name="message"
                  rows={3}
                  value={form.message}
                  onChange={handleChange}
                  style={{
                    width:       '100%',
                    background:  'var(--glass-bg)',
                    border:      '1px solid var(--glass-border)',
                    borderRadius:'8px',
                    color:       'var(--text-primary)',
                    fontSize:    '0.9rem',
                    padding:     '10px 14px',
                    outline:     'none',
                    resize:      'vertical',
                    boxSizing:   'border-box',
                    minHeight:   '80px',
                    fontFamily:  'inherit',
                    transition:  'border-color 0.2s',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent-green)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--glass-border)')}
                />
              </div>

              <button
                type="submit"
                className="portal-cta-btn"
                style={{ width: '100%', marginTop: '4px' }}
              >
                Submit Request →
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Top navigation bar ────────────────────────────────────────────────────────

function TopNav({
  onRequestEstimate,
}: {
  onRequestEstimate: () => void;
}): React.ReactElement {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      style={{
        position:       'sticky',
        top:            0,
        zIndex:         100,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '12px clamp(16px, 5vw, 48px)',
        background:     scrolled ? 'var(--glass-bg)' : 'transparent',
        backdropFilter: scrolled ? 'var(--glass-blur)' : 'none',
        WebkitBackdropFilter: scrolled ? 'var(--glass-blur)' : 'none',
        borderBottom:   scrolled ? '1px solid var(--border-subtle)' : '1px solid transparent',
        transition:     'background 0.3s, border-color 0.3s, backdrop-filter 0.3s',
        gap:            '12px',
      }}
    >
      {/* Wordmark */}
      <div
        style={{
          fontWeight:    800,
          fontSize:      'clamp(0.85rem, 2vw, 1rem)',
          color:         'var(--text-primary)',
          letterSpacing: '-0.01em',
          flexShrink:    0,
        }}
      >
        <span
          style={{
            background:           'linear-gradient(135deg, var(--accent-green) 0%, var(--accent-blue) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor:  'transparent',
            backgroundClip:       'text',
          }}
        >
          Power On
        </span>{' '}
        Solutions
      </div>

      {/* Right side */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <a
          href={`tel:${BRAND.phone}`}
          style={{
            fontSize:       '0.8rem',
            fontWeight:     700,
            color:          'var(--text-secondary)',
            textDecoration: 'none',
            whiteSpace:     'nowrap',
          }}
        >
          {BRAND.phone}
        </a>

        <button
          className="portal-cta-btn"
          onClick={onRequestEstimate}
          style={{
            padding:   '8px 18px',
            fontSize:  '0.8rem',
            minHeight: '36px',
          }}
        >
          Get Estimate
        </button>

        <ThemeToggle />
      </div>
    </nav>
  );
}

// ─── Main portal (inner — must be wrapped in PortalThemeProvider) ───────────────

function PortalInner(): React.ReactElement {
  const [modalOpen, setModalOpen] = useState(false);
  const { theme } = usePortalTheme();

  return (
    <div
      className="portal-root"
      style={{
        background: 'var(--portal-bg)',
        color:      'var(--text-primary)',
        minHeight:  '100vh',
        fontFamily: '"Inter", "Syne", system-ui, -apple-system, sans-serif',
        lineHeight: 1.5,
        overflowX:  'hidden',
        // Smooth color transitions when toggling theme
        transition: 'background 0.3s ease, color 0.3s ease',
      }}
      data-theme={theme}
    >
      {/* Always-visible credential bar */}
      <CredentialBar />

      {/* Sticky nav */}
      <TopNav onRequestEstimate={() => setModalOpen(true)} />

      {/* Main content */}
      <main>
        <HeroSection onRequestEstimate={() => setModalOpen(true)} />
        <ServicesSection />
        <TrustSection />
        <TestimonialSection />
        <ContactSection onRequestEstimate={() => setModalOpen(true)} />
      </main>

      {/* Footer */}
      <PortalFooter />

      {/* Estimate modal */}
      <EstimateModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}

// ─── Public export — self-contained with theme provider ───────────────────────

/**
 * PortalRedesign
 *
 * Drop-in replacement for the customer-facing portal.
 * Wraps itself in PortalThemeProvider so it is fully standalone.
 *
 * Usage:
 *   import { PortalRedesign } from '@/components/portal/PortalRedesign';
 *   <PortalRedesign />
 */
export function PortalRedesign(): React.ReactElement {
  return (
    <PortalThemeProvider>
      <PortalInner />
    </PortalThemeProvider>
  );
}

export default PortalRedesign;
