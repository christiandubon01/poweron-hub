// @ts-nocheck
/**
 * LoginFlow — top-level auth orchestrator.
 * Landing page + Login/Register styled after power_on_v5_final.html
 * Navy #02060d, blue #1e80df, PCB dot-grid background, Barlow Condensed headers
 */

import { useState, useEffect } from 'react'
import { Zap, ArrowRight, Eye, EyeOff, Lock, Mail, User, AlertCircle, CheckCircle } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/authStore'
import { PasscodeScreen } from '@/components/auth/PasscodeScreen'
import { BiometricPrompt } from '@/components/auth/BiometricPrompt'
import { PinAuth } from '@/components/auth/PinAuth'
import { InitialSetupFlow } from '@/components/auth/InitialSetupFlow'
import { supabase } from '@/lib/supabase'

const PIN_STORAGE_KEY = 'poweron_pin_hash'
function hasPinStored(): boolean {
  try { return Boolean(localStorage.getItem(PIN_STORAGE_KEY)) } catch { return false }
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const BG = '#02060d'
const BLUE = '#1e80df'
const BLUE_B = '#3d9ef5'
const TEXT = '#d8eaf8'
const T2 = '#8ab4d4'
const T3 = '#4d7a9e'

const inputStyle = {
  width: '100%', padding: '13px 16px 13px 44px',
  background: 'rgba(30,128,223,0.05)',
  border: '1px solid rgba(30,128,223,0.18)',
  borderRadius: '4px', color: TEXT, fontSize: '14px',
  outline: 'none', fontFamily: "'Barlow', sans-serif",
  transition: 'border-color 0.2s',
}

const btnPrimary = {
  width: '100%', padding: '15px 24px',
  background: BLUE, color: '#fff',
  border: 'none', borderRadius: '4px', cursor: 'pointer',
  fontSize: '12px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase' as const,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
  boxShadow: `0 0 0 1px rgba(30,128,223,0.4), 0 4px 28px rgba(30,128,223,0.28)`,
  fontFamily: "'Barlow', sans-serif",
  position: 'relative' as const, overflow: 'hidden' as const,
}

const btnSecondary = {
  width: '100%', padding: '15px 24px',
  background: 'rgba(30,128,223,0.06)',
  border: '1px solid rgba(30,128,223,0.22)',
  borderRadius: '4px', cursor: 'pointer',
  color: T2, fontSize: '12px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase' as const,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
  fontFamily: "'Barlow', sans-serif",
}

// ── PCB Background wrapper ────────────────────────────────────────────────────
function PCBPage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh', background: BG,
      backgroundImage: `
        radial-gradient(rgba(30,128,223,0.07) 1.2px, transparent 1.2px),
        linear-gradient(rgba(30,128,223,0.022) 1px, transparent 1px),
        linear-gradient(90deg, rgba(30,128,223,0.022) 1px, transparent 1px)
      `,
      backgroundSize: '28px 28px, 56px 56px, 56px 56px',
      backgroundPosition: '0 0, 14px 14px, 14px 14px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px', position: 'relative', overflow: 'hidden',
      fontFamily: "'Barlow', system-ui, sans-serif",
    }}>
      {/* Circuit rails */}
      <div style={{ position: 'fixed', top: 0, left: '12px', bottom: 0, width: '1px', background: 'linear-gradient(to bottom, transparent, rgba(30,128,223,0.08) 20%, rgba(30,128,223,0.10) 50%, rgba(30,128,223,0.06) 80%, transparent)', pointerEvents: 'none', zIndex: 1 }} />
      <div style={{ position: 'fixed', top: 0, right: '12px', bottom: 0, width: '1px', background: 'linear-gradient(to bottom, transparent, rgba(30,128,223,0.08) 20%, rgba(30,128,223,0.10) 50%, rgba(30,128,223,0.06) 80%, transparent)', pointerEvents: 'none', zIndex: 1 }} />
      {/* Glow orb */}
      <div style={{ position: 'fixed', top: '-100px', left: '-100px', width: '600px', height: '600px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(30,128,223,0.06) 0%, transparent 65%)', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'relative', zIndex: 2, width: '100%' }}>
        {children}
      </div>
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function AuthSpinner() {
  return (
    <PCBPage>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '10px', background: `linear-gradient(135deg, rgba(30,128,223,0.3), rgba(30,128,223,0.1))`, border: '1px solid rgba(30,128,223,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Zap size={22} color={BLUE_B} fill={BLUE_B} />
        </div>
        <div style={{ width: '20px', height: '20px', border: `2px solid ${BLUE}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    </PCBPage>
  )
}

// ── Landing Page ──────────────────────────────────────────────────────────────
function LandingPage({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  return (
    <PCBPage>
      <div style={{ maxWidth: '460px', margin: '0 auto' }}>
        {/* Status badge */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '28px', fontSize: '10px', color: BLUE_B, letterSpacing: '2.5px', textTransform: 'uppercase', background: 'rgba(30,128,223,0.07)', border: '1px solid rgba(30,128,223,0.2)', padding: '6px 14px', borderRadius: '20px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#1fc97a', boxShadow: '0 0 8px #1fc97a' }} />
          Coachella Valley · C-10 Licensed
        </div>

        {/* Logo row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '36px' }}>
          <div style={{ width: '52px', height: '52px', borderRadius: '10px', background: `linear-gradient(135deg, rgba(30,128,223,0.2), rgba(30,128,223,0.08))`, border: '1px solid rgba(30,128,223,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 20px rgba(30,128,223,0.2)` }}>
            <Zap size={26} color={BLUE_B} fill={BLUE_B} />
          </div>
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '24px', fontWeight: 700, letterSpacing: '-0.5px', textTransform: 'uppercase', color: TEXT, lineHeight: 1 }}>Power On</div>
            <div style={{ fontSize: '10px', color: T3, letterSpacing: '2px', textTransform: 'uppercase', marginTop: '2px' }}>Solutions Hub · v3.0</div>
          </div>
        </div>

        {/* Headline */}
        <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 'clamp(52px, 11vw, 72px)', fontWeight: 700, lineHeight: 0.88, textTransform: 'uppercase', letterSpacing: '-2px', color: TEXT, marginBottom: '20px' }}>
          YOUR<br />ELECTRICAL<br />
          <span style={{ color: BLUE, textShadow: `0 0 80px rgba(30,128,223,0.5), 0 0 40px rgba(30,128,223,0.25)` }}>BUSINESS OS</span>
        </h1>

        <p style={{ fontSize: '14px', color: T2, lineHeight: 1.8, maxWidth: '360px', marginBottom: '36px' }}>
          AI-powered sales intelligence, field ops, leads, and business management — built for C-10 contractors.
        </p>

        {/* Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '40px' }}>
          <button onClick={onRegister} style={btnPrimary}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            Create Account
          </button>
          <button onClick={onLogin} style={btnSecondary}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
            Log In
          </button>
        </div>

        {/* Footer rule */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, transparent, rgba(30,128,223,0.15))' }} />
          <span style={{ fontSize: '9px', color: T3, letterSpacing: '2px', textTransform: 'uppercase' }}>Power On Solutions LLC</span>
          <div style={{ flex: 1, height: '1px', background: 'linear-gradient(270deg, transparent, rgba(30,128,223,0.15))' }} />
        </div>
      </div>
    </PCBPage>
  )
}

// ── Register Flow ─────────────────────────────────────────────────────────────
function RegisterFlow({ onBack }: { onBack: () => void }) {
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!fullName.trim()) { setError('Full name is required.'); return }
    if (!username.trim() || username.length < 3) { setError('Username must be at least 3 characters.'); return }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) { setError('Username: letters, numbers, underscores only.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    setLoading(true)
    try {
      const { data: existing } = await supabase.from('profiles').select('id').eq('username', username.toLowerCase().trim()).maybeSingle()
      if (existing) { setError('Username already taken.'); setLoading(false); return }
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(), password,
        options: { emailRedirectTo: 'https://app.poweronsolutionsllc.com', data: { full_name: fullName.trim(), username: username.toLowerCase().trim() } },
      })
      if (signUpError) throw signUpError
      if (data.user) {
        await supabase.from('profiles').update({ full_name: fullName.trim(), username: username.toLowerCase().trim() } as any).eq('id', data.user.id)
      }
      setSent(true)
    } catch (err: any) {
      setError(err.message ?? 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <PCBPage>
        <div style={{ maxWidth: '420px', margin: '0 auto', textAlign: 'center' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '14px', background: 'rgba(30,128,223,0.1)', border: '1px solid rgba(30,128,223,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <CheckCircle size={30} color={BLUE_B} />
          </div>
          <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '32px', fontWeight: 700, textTransform: 'uppercase', color: TEXT, marginBottom: '12px', letterSpacing: '-1px' }}>Check your email</h2>
          <p style={{ fontSize: '14px', color: T2, marginBottom: '8px' }}>We sent a verification link to:</p>
          <div style={{ background: 'rgba(30,128,223,0.06)', border: '1px solid rgba(30,128,223,0.2)', borderRadius: '4px', padding: '10px 20px', fontSize: '13px', color: TEXT, fontFamily: 'monospace', marginBottom: '20px', display: 'inline-block' }}>{email}</div>
          <p style={{ fontSize: '12px', color: T3, marginBottom: '28px' }}>Click the link to verify. Then log in with your email and password.</p>
          <button onClick={onBack} style={{ ...btnSecondary, width: 'auto', padding: '10px 24px' }}>Back to home</button>
        </div>
      </PCBPage>
    )
  }

  return (
    <PCBPage>
      <div style={{ maxWidth: '420px', margin: '0 auto' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T3, fontSize: '13px', marginBottom: '28px', display: 'flex', alignItems: 'center', gap: '6px', fontFamily: "'Barlow', sans-serif" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          Back
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '28px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(30,128,223,0.12)', border: '1px solid rgba(30,128,223,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Zap size={18} color={BLUE_B} fill={BLUE_B} />
          </div>
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '18px', fontWeight: 700, textTransform: 'uppercase', color: TEXT, letterSpacing: '-0.5px' }}>Create Account</div>
            <div style={{ fontSize: '10px', color: T3, letterSpacing: '1.5px', textTransform: 'uppercase' }}>Join PowerOn Hub</div>
          </div>
        </div>

        <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Full Name */}
          <div style={{ position: 'relative' }}>
            <User size={16} color={T3} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Full Name" required style={inputStyle} />
          </div>

          {/* Username */}
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: T3, fontSize: '14px', pointerEvents: 'none' }}>@</span>
            <input type="text" value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-zA-Z0-9_]/g, ''))} placeholder="username" required style={{ ...inputStyle, paddingLeft: '30px' }} />
          </div>

          {/* Email */}
          <div style={{ position: 'relative' }}>
            <Mail size={16} color={T3} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" required style={inputStyle} />
          </div>

          {/* Password */}
          <div style={{ position: 'relative' }}>
            <Lock size={16} color={T3} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password (min 8 chars)" required style={{ ...inputStyle, paddingRight: '44px' }} />
            <button type="button" onClick={() => setShowPassword(v => !v)} style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: T3 }}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/* Confirm Password */}
          <div style={{ position: 'relative' }}>
            <Lock size={16} color={T3} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm password" required style={inputStyle} />
          </div>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '4px' }}>
              <AlertCircle size={14} color="#f87171" />
              <span style={{ fontSize: '12px', color: '#f87171' }}>{error}</span>
            </div>
          )}

          <button type="submit" disabled={loading} style={{ ...btnPrimary, marginTop: '4px', opacity: loading ? 0.6 : 1 }}>
            {loading ? <div style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> : <><ArrowRight size={15} /> Create Account</>}
          </button>
        </form>
      </div>
    </PCBPage>
  )
}

// ── Login Form ────────────────────────────────────────────────────────────────
function LoginForm({ onBack }: { onBack: () => void }) {
  const { signInWithEmail, error, clearError } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState('')
  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(''); clearError()
    if (!identifier.trim() || !password) return
    setLoading(true)
    try {
      let emailToUse = identifier.trim()
      if (!identifier.includes('@')) {
        const { data: profile } = await supabase.from('profiles').select('id').eq('username', identifier.toLowerCase().trim()).maybeSingle()
        if (!profile) { setLocalError('Username not found. Try your email address.'); setLoading(false); return }
        setLocalError('Please use your email address to log in.')
        setLoading(false); return
      }
      await signInWithEmail(emailToUse, password)
    } catch (err: any) {
      setLocalError(err.message ?? 'Login failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!forgotEmail.trim()) return
    setForgotLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), { redirectTo: 'https://app.poweronsolutionsllc.com' })
      if (error) throw error
      setForgotSent(true)
    } catch (err: any) {
      setLocalError(err.message ?? 'Failed to send reset email.')
    } finally {
      setForgotLoading(false)
    }
  }

  if (showForgot) {
    return (
      <PCBPage>
        <div style={{ maxWidth: '420px', margin: '0 auto' }}>
          <button onClick={() => { setShowForgot(false); setForgotSent(false); setLocalError('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T3, fontSize: '13px', marginBottom: '28px', display: 'flex', alignItems: 'center', gap: '6px', fontFamily: "'Barlow', sans-serif" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            Back to login
          </button>
          {forgotSent ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '12px', background: 'rgba(30,128,223,0.1)', border: '1px solid rgba(30,128,223,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                <CheckCircle size={26} color={BLUE_B} />
              </div>
              <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '28px', fontWeight: 700, textTransform: 'uppercase', color: TEXT, marginBottom: '10px', letterSpacing: '-1px' }}>Check your email</h2>
              <p style={{ fontSize: '13px', color: T2 }}>Reset link sent to <strong style={{ color: TEXT }}>{forgotEmail}</strong></p>
            </div>
          ) : (
            <>
              <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '28px', fontWeight: 700, textTransform: 'uppercase', color: TEXT, marginBottom: '8px', letterSpacing: '-1px' }}>Reset Password</h2>
              <p style={{ fontSize: '13px', color: T2, marginBottom: '24px' }}>Enter your email and we'll send a reset link.</p>
              <form onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ position: 'relative' }}>
                  <Mail size={16} color={T3} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                  <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} placeholder="your@email.com" required style={inputStyle} />
                </div>
                {localError && <span style={{ fontSize: '12px', color: '#f87171' }}>{localError}</span>}
                <button type="submit" disabled={forgotLoading} style={{ ...btnPrimary, opacity: forgotLoading ? 0.6 : 1 }}>
                  {forgotLoading ? <div style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> : 'Send Reset Link'}
                </button>
              </form>
            </>
          )}
        </div>
      </PCBPage>
    )
  }

  return (
    <PCBPage>
      <div style={{ maxWidth: '420px', margin: '0 auto' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T3, fontSize: '13px', marginBottom: '28px', display: 'flex', alignItems: 'center', gap: '6px', fontFamily: "'Barlow', sans-serif" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          Back
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '28px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(30,128,223,0.12)', border: '1px solid rgba(30,128,223,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Zap size={18} color={BLUE_B} fill={BLUE_B} />
          </div>
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '18px', fontWeight: 700, textTransform: 'uppercase', color: TEXT, letterSpacing: '-0.5px' }}>Welcome Back</div>
            <div style={{ fontSize: '10px', color: T3, letterSpacing: '1.5px', textTransform: 'uppercase' }}>Sign in to PowerOn Hub</div>
          </div>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ position: 'relative' }}>
            <User size={16} color={T3} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input type="text" value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="Email or @username" required autoComplete="username" style={inputStyle} />
          </div>

          <div style={{ position: 'relative' }}>
            <Lock size={16} color={T3} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required autoComplete="current-password" style={{ ...inputStyle, paddingRight: '44px' }} />
            <button type="button" onClick={() => setShowPassword(v => !v)} style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: T3 }}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {(localError || error) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '4px' }}>
              <AlertCircle size={14} color="#f87171" />
              <span style={{ fontSize: '12px', color: '#f87171' }}>{localError || error}</span>
            </div>
          )}

          <button type="submit" disabled={loading || !identifier.trim() || !password} style={{ ...btnPrimary, opacity: (loading || !identifier.trim() || !password) ? 0.5 : 1 }}>
            {loading ? <div style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> : <><ArrowRight size={15} /> Sign In</>}
          </button>
        </form>

        <div style={{ marginTop: '16px', textAlign: 'center' }}>
          <button onClick={() => { setShowForgot(true); setLocalError('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T3, fontSize: '12px', fontFamily: "'Barlow', sans-serif" }}>
            Forgot password?
          </button>
        </div>
      </div>
    </PCBPage>
  )
}

// ── Set New Password Form ─────────────────────────────────────────────────────
function SetNewPasswordForm() {
  const { signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setDone(true)
    } catch (err: any) {
      setError(err.message ?? 'Failed to update password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PCBPage>
      <div style={{ maxWidth: '420px', margin: '0 auto' }}>
        {done ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '12px', background: 'rgba(30,128,223,0.1)', border: '1px solid rgba(30,128,223,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <CheckCircle size={26} color={BLUE_B} />
            </div>
            <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '28px', fontWeight: 700, textTransform: 'uppercase', color: TEXT, marginBottom: '10px', letterSpacing: '-1px' }}>Password Updated</h2>
            <p style={{ fontSize: '13px', color: T2, marginBottom: '24px' }}>Your password has been changed successfully.</p>
            <button onClick={() => signOut()} style={{ ...btnPrimary, width: 'auto', padding: '12px 28px' }}>Sign In with New Password</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '28px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(30,128,223,0.12)', border: '1px solid rgba(30,128,223,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Zap size={18} color={BLUE_B} fill={BLUE_B} />
              </div>
              <div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '18px', fontWeight: 700, textTransform: 'uppercase', color: TEXT, letterSpacing: '-0.5px' }}>Set New Password</div>
                <div style={{ fontSize: '10px', color: T3, letterSpacing: '1.5px', textTransform: 'uppercase' }}>Choose a strong password</div>
              </div>
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ position: 'relative' }}>
                <Lock size={16} color={T3} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="New password (min 8 chars)" required style={{ ...inputStyle, paddingRight: '44px' }} />
                <button type="button" onClick={() => setShowPassword(v => !v)} style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: T3 }}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div style={{ position: 'relative' }}>
                <Lock size={16} color={T3} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                <input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm password" required style={inputStyle} />
              </div>
              {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '4px' }}>
                  <AlertCircle size={14} color="#f87171" />
                  <span style={{ fontSize: '12px', color: '#f87171' }}>{error}</span>
                </div>
              )}
              <button type="submit" disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.6 : 1 }}>
                {loading ? <div style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> : <><ArrowRight size={15} /> Update Password</>}
              </button>
            </form>
          </>
        )}
      </div>
    </PCBPage>
  )
}

// ── Passcode Setup Flow ───────────────────────────────────────────────────────
function PasscodeSetupFlow() {
  const { setupPasscode } = useAuth()
  const [step, setStep] = useState<'create' | 'confirm'>('create')
  const [first, setFirst] = useState('')
  const handleCreate = (passcode: string) => { setFirst(passcode); setStep('confirm') }
  const handleConfirm = (passcode: string) => { if (passcode === first) setupPasscode(passcode) }
  if (step === 'confirm') {
    return <PasscodeScreen key="confirm" mode="confirm" toConfirm={first} onComplete={handleConfirm} title="Confirm Passcode" subtitle="Enter the same passcode again to confirm" onCancel={() => setStep('create')} />
  }
  return <PasscodeScreen key="create" mode="setup" onComplete={handleCreate} title="Create Passcode" subtitle="Choose a 6-digit passcode to secure your account" />
}

// ── LoginFlow (router) ────────────────────────────────────────────────────────
type AuthScreen = 'landing' | 'login' | 'register'

interface LoginFlowProps {
  children: React.ReactNode
}

export function LoginFlow({ children }: LoginFlowProps) {
  const { status, submitPasscode, signOut } = useAuth()
  const [screen, setScreen] = useState<AuthScreen>('landing')
  const [pinFallback, setPinFallback] = useState(false)

  switch (status) {
    case 'loading':
      return <AuthSpinner />

    case 'unauthenticated': {
      const showPin = hasPinStored() && !pinFallback
      if (showPin) return <PinAuth onFallbackToMagicLink={() => setPinFallback(true)} />
      if (screen === 'register') return <RegisterFlow onBack={() => setScreen('landing')} />
      if (screen === 'login') return <LoginForm onBack={() => setScreen('landing')} />
      return <LandingPage onLogin={() => setScreen('login')} onRegister={() => setScreen('register')} />
    }

    case 'needs_passcode_setup':
      return <InitialSetupFlow />

    case 'needs_passcode':
      return <PinAuth onVerify={submitPasscode} onFallbackToMagicLink={signOut} />

    case 'biometric_prompt':
      return <BiometricPrompt />

    case 'locked':
      return <PasscodeScreen mode="verify" onComplete={submitPasscode} onCancel={signOut} />

    case 'password_recovery':
      return <SetNewPasswordForm />

    case 'authenticated':
      return <>{children}</>

    default:
      return <AuthSpinner />
  }
}
