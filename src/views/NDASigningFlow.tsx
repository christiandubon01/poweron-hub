/**
 * NDASigningFlow.tsx
 * Full-screen mandatory NDA signing view.
 *
 * - Blocks ALL app navigation until NDA is signed
 * - Scrollable NDA text with scroll-progress indicator
 * - Checkbox, SignaturePad, typed name, auto-date, Submit
 * - On submit: generates PDF + saves via ndaService
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Shield,
  CheckCircle,
  AlertTriangle,
  Loader2,
  FileText,
  ChevronDown,
} from 'lucide-react';
import SignaturePad from '../components/SignaturePad';
import {
  saveSignedNDA,
  NDA_FULL_TEXT,
  NDA_AGREEMENT_VERSION,
} from '../services/ndaService';

// ─── Props ────────────────────────────────────────────────────────────────────

interface NDASigningFlowProps {
  /** User ID to store the signed NDA against */
  userId: string;
  /** Called after successful NDA submission */
  onSigned: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Best-effort IP address fetch (external prototype stub returns a placeholder) */
async function fetchClientIP(): Promise<string> {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = (await res.json()) as { ip: string };
    return data.ip ?? '0.0.0.0';
  } catch {
    return '0.0.0.0';
  }
}

// ─── NDA Scroll Progress Bar ──────────────────────────────────────────────────

function ScrollProgress({ progress }: { progress: number }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b" style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#1e2128' }}>
        <div
          className="h-full rounded-full transition-all duration-150"
          style={{
            width: `${pct}%`,
            backgroundColor: pct >= 100 ? '#16a34a' : '#4f46e5',
          }}
        />
      </div>
      <span className="text-xs font-medium flex-shrink-0" style={{ color: pct >= 100 ? '#4ade80' : '#818cf8' }}>
        {pct >= 100 ? '✓ Fully read' : `${pct}% read`}
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NDASigningFlow({ userId, onSigned }: NDASigningFlowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [hasReadAll, setHasReadAll] = useState(false);

  const [agreed, setAgreed] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [typedName, setTypedName] = useState('');
  const [signedDate] = useState<Date>(new Date());

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // ── Scroll tracking ────────────────────────────────────────────────────────

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const maxScroll = scrollHeight - clientHeight;
    if (maxScroll <= 0) {
      setScrollProgress(1);
      setHasReadAll(true);
      return;
    }
    const progress = scrollTop / maxScroll;
    setScrollProgress(progress);
    if (progress >= 0.97) setHasReadAll(true);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    // Trigger initial measure
    handleScroll();
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // ── Scroll-to-bottom helper ────────────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  // ── Validation ─────────────────────────────────────────────────────────────

  const isValid =
    hasReadAll &&
    agreed &&
    signatureDataUrl !== null &&
    typedName.trim().length >= 2;

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!isValid || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const ip = await fetchClientIP();
      await saveSignedNDA(userId, signatureDataUrl!, typedName.trim(), ip);
      setSubmitSuccess(true);
      // Short delay so the user sees the success state before the app unlocks
      setTimeout(() => onSigned(), 1800);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Submission failed. Please try again.'
      );
      setIsSubmitting(false);
    }
  }, [isValid, isSubmitting, userId, signatureDataUrl, typedName, onSigned]);

  // ── Success screen ─────────────────────────────────────────────────────────

  if (submitSuccess) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6"
        style={{ backgroundColor: '#0a0b0f' }}
      >
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ backgroundColor: '#052e16', border: '2px solid #16a34a' }}
        >
          <CheckCircle size={32} className="text-green-400" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-100 mb-1">Agreement Signed</h2>
          <p className="text-sm text-gray-500">Welcome to PowerOn Hub Beta. Loading your workspace…</p>
        </div>
        <Loader2 size={20} className="text-green-500 animate-spin" />
      </div>
    );
  }

  // ── Main flow ──────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: '#0a0b0f', color: '#e5e7eb' }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header
        className="flex items-center gap-3 px-6 py-4 border-b flex-shrink-0"
        style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: '#1e1b4b' }}
        >
          <Shield size={16} className="text-indigo-400" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-gray-100 leading-tight">
            Non-Disclosure &amp; Beta Testing Agreement
          </h1>
          <p className="text-xs mt-0.5" style={{ color: '#6b7280' }}>
            You must read and sign this agreement before accessing PowerOn Hub. ·{' '}
            <span className="font-mono" style={{ color: '#818cf8' }}>{NDA_AGREEMENT_VERSION}</span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs" style={{ color: '#f59e0b' }}>
          <AlertTriangle size={13} />
          <span>Required before access</span>
        </div>
      </header>

      {/* ── Scroll progress ──────────────────────────────────────────────── */}
      <ScrollProgress progress={scrollProgress} />

      {/* ── Scrollable NDA body ──────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-6 py-6"
          style={{ backgroundColor: '#0a0b0f' }}
        >
          {/* NDA text */}
          <div
            className="max-w-3xl mx-auto rounded-xl p-6 mb-6"
            style={{ backgroundColor: '#0d0e14', border: '1px solid #1e2128' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <FileText size={16} className="text-indigo-400 flex-shrink-0" />
              <span className="text-sm font-semibold text-gray-200">Agreement Text</span>
            </div>
            <pre
              className="text-xs leading-relaxed whitespace-pre-wrap font-mono"
              style={{ color: '#9ca3af' }}
            >
              {NDA_FULL_TEXT}
            </pre>
          </div>

          {/* Scroll prompt when not fully read */}
          {!hasReadAll && (
            <div className="max-w-3xl mx-auto mb-4 flex justify-center">
              <button
                type="button"
                onClick={scrollToBottom}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs transition-colors"
                style={{
                  backgroundColor: '#1e1b4b',
                  color: '#818cf8',
                  border: '1px solid #312e81',
                }}
              >
                <ChevronDown size={13} />
                Scroll to bottom to continue
              </button>
            </div>
          )}

          {/* ── Signature / Execution Section ─────────────────────────── */}
          <div
            className="max-w-3xl mx-auto rounded-xl p-6"
            style={{
              backgroundColor: '#0d0e14',
              border: `1px solid ${hasReadAll ? '#1e3a2f' : '#1e2128'}`,
            }}
          >
            <div className="flex items-center gap-2 mb-6">
              <CheckCircle size={16} style={{ color: hasReadAll ? '#4ade80' : '#374151' }} />
              <span className="text-sm font-semibold" style={{ color: hasReadAll ? '#e5e7eb' : '#4b5563' }}>
                Execution — Sign Below
              </span>
              {!hasReadAll && (
                <span className="text-xs ml-2" style={{ color: '#6b7280' }}>
                  (scroll through the full agreement first)
                </span>
              )}
            </div>

            <div className={`flex flex-col gap-5 ${!hasReadAll ? 'opacity-40 pointer-events-none select-none' : ''}`}>

              {/* 1. Checkbox */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="flex-shrink-0 mt-0.5">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="sr-only"
                    disabled={!hasReadAll}
                  />
                  <div
                    className="w-5 h-5 rounded flex items-center justify-center transition-colors"
                    style={{
                      backgroundColor: agreed ? '#16a34a' : '#1a1c23',
                      border: `2px solid ${agreed ? '#16a34a' : '#374151'}`,
                    }}
                  >
                    {agreed && (
                      <svg viewBox="0 0 10 8" className="w-3 h-3" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                </div>
                <span className="text-sm leading-snug" style={{ color: agreed ? '#d1fae5' : '#9ca3af' }}>
                  I have read the full agreement and agree to be bound by its terms.
                </span>
              </label>

              {/* 2. Signature pad */}
              <div>
                <label className="block text-xs font-medium mb-2" style={{ color: '#9ca3af' }}>
                  Signature <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <SignaturePad
                  height={160}
                  onChange={setSignatureDataUrl}
                />
              </div>

              {/* 3. Typed name */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#9ca3af' }}>
                  Full Legal Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder="Type your full legal name"
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors"
                  style={{
                    backgroundColor: '#1a1c23',
                    border: `1px solid ${typedName.length >= 2 ? '#374151' : '#2e3040'}`,
                    color: '#e5e7eb',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#4f46e5'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = typedName.length >= 2 ? '#374151' : '#2e3040'; }}
                  disabled={!hasReadAll}
                />
              </div>

              {/* 4. Auto date */}
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#9ca3af' }}>Date</label>
                  <div
                    className="px-3 py-2.5 rounded-lg text-sm"
                    style={{
                      backgroundColor: '#11121a',
                      border: '1px solid #1e2128',
                      color: '#6b7280',
                    }}
                  >
                    {formatDate(signedDate)}
                  </div>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#9ca3af' }}>Agreement Version</label>
                  <div
                    className="px-3 py-2.5 rounded-lg text-sm font-mono"
                    style={{
                      backgroundColor: '#11121a',
                      border: '1px solid #1e2128',
                      color: '#818cf8',
                    }}
                  >
                    {NDA_AGREEMENT_VERSION}
                  </div>
                </div>
              </div>

              {/* Error */}
              {submitError && (
                <div
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm"
                  style={{ backgroundColor: '#450a0a', border: '1px solid #7f1d1d', color: '#fca5a5' }}
                >
                  <AlertTriangle size={14} className="flex-shrink-0" />
                  {submitError}
                </div>
              )}

              {/* 5. Submit */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!isValid || isSubmitting}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-lg text-sm font-semibold transition-all"
                style={{
                  backgroundColor: isValid && !isSubmitting ? '#16a34a' : '#1a1c23',
                  color: isValid && !isSubmitting ? '#ffffff' : '#4b5563',
                  border: `1px solid ${isValid && !isSubmitting ? '#16a34a' : '#2e3040'}`,
                  cursor: isValid && !isSubmitting ? 'pointer' : 'not-allowed',
                }}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Submitting…
                  </>
                ) : (
                  <>
                    <Shield size={15} />
                    Sign &amp; Enter PowerOn Hub
                  </>
                )}
              </button>

              {/* Validation hints */}
              {!isValid && !isSubmitting && (
                <ul className="text-xs space-y-1" style={{ color: '#6b7280' }}>
                  {!hasReadAll && <li>• Scroll through the full agreement</li>}
                  {!agreed && <li>• Check the agreement checkbox</li>}
                  {!signatureDataUrl && <li>• Draw your signature</li>}
                  {typedName.trim().length < 2 && <li>• Enter your full legal name</li>}
                </ul>
              )}

            </div>
          </div>

          {/* Spacer so content isn't flush against bottom */}
          <div className="h-8" />
        </div>
      </div>
    </div>
  );
}
