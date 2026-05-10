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
        radial-gradient(rgba(30,128,223,0.04) 1.2px, transparent 1.2px),
        linear-gradient(rgba(30,128,223,0.014) 1px, transparent 1px),
        linear-gradient(90deg, rgba(30,128,223,0.014) 1px, transparent 1px)
      `,
      backgroundSize: '28px 28px, 56px 56px, 56px 56px',
      backgroundPosition: '0 0, 14px 14px, 14px 14px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px', position: 'relative', overflow: 'hidden',
      fontFamily: "'Barlow', system-ui, sans-serif",
    }}>
      <style>{`
        @keyframes pcbRailSignal {
          0% { transform: translateY(-18vh); opacity: 0; }
          18%, 70% { opacity: 0.46; }
          100% { transform: translateY(118vh); opacity: 0; }
        }
        @keyframes pcbRailSignalReverse {
          0% { transform: translateY(118vh); opacity: 0; }
          18%, 70% { opacity: 0.4; }
          100% { transform: translateY(-18vh); opacity: 0; }
        }
        @keyframes pcbGridSweep {
          0% { transform: translateX(-120%) skewX(-18deg); opacity: 0; }
          24%, 66% { opacity: 0.18; }
          100% { transform: translateX(120%) skewX(-18deg); opacity: 0; }
        }
        @keyframes pcbGlowPulse {
          0%, 100% { opacity: 0.24; transform: scale(0.98); }
          50% { opacity: 0.44; transform: scale(1.02); }
        }
        @keyframes pcbSignalTraceX {
          0% { transform: translateX(-24vw); opacity: 0; }
          18%, 72% { opacity: 0.48; }
          100% { transform: translateX(124vw); opacity: 0; }
        }
        @keyframes pcbSignalTraceY {
          0% { transform: translateY(-24vh); opacity: 0; }
          18%, 70% { opacity: 0.42; }
          100% { transform: translateY(124vh); opacity: 0; }
        }
        @keyframes pcbScanBeamWide {
          0% { transform: translateX(-130%) skewX(-16deg); opacity: 0; }
          26%, 58% { opacity: 0.26; }
          100% { transform: translateX(130%) skewX(-16deg); opacity: 0; }
        }
        @keyframes pcbNodeBlink {
          0%, 100% { opacity: 0.14; box-shadow: 0 0 0 rgba(61,158,245,0); transform: scale(0.86); }
          50% { opacity: 0.48; box-shadow: 0 0 10px rgba(61,158,245,0.36); transform: scale(1.02); }
        }
        .pcb-trace-x,
        .pcb-trace-y,
        .pcb-node,
        .pcb-scan-beam {
          position: fixed;
          pointer-events: none;
          z-index: 0;
        }
        .pcb-trace-x {
          height: 1px;
          width: 34vw;
          background: linear-gradient(90deg, transparent, rgba(61,158,245,0.1), rgba(61,158,245,0.48), rgba(120,190,255,0.5), transparent);
          box-shadow: 0 0 12px rgba(61,158,245,0.28);
          animation: pcbSignalTraceX 11.5s ease-in-out infinite;
        }
        .pcb-trace-y {
          width: 1px;
          height: 30vh;
          background: linear-gradient(to bottom, transparent, rgba(61,158,245,0.09), rgba(61,158,245,0.44), rgba(120,190,255,0.48), transparent);
          box-shadow: 0 0 11px rgba(61,158,245,0.26);
          animation: pcbSignalTraceY 12.8s ease-in-out infinite;
        }
        .pcb-scan-beam {
          top: -8vh;
          bottom: -8vh;
          left: -28vw;
          width: 34vw;
          background: linear-gradient(90deg, transparent, rgba(61,158,245,0.055), rgba(61,158,245,0.11), transparent);
          filter: blur(0.5px);
          animation: pcbScanBeamWide 13.5s ease-in-out infinite;
        }
        .pcb-node {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          border: 1px solid rgba(120,190,255,0.28);
          background: rgba(61,158,245,0.1);
          animation: pcbNodeBlink 5.8s ease-in-out infinite;
        }
        @media (max-width: 767px) {
          .pcb-trace-x, .pcb-trace-y, .pcb-scan-beam { opacity: 0.2; }
          .pcb-node { opacity: 0.24; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pcb-trace-x, .pcb-trace-y, .pcb-scan-beam, .pcb-node {
            animation-duration: 18s !important;
            opacity: 0.1 !important;
          }
        }
      `}</style>
      {/* Circuit rails */}
      <div style={{ position: 'fixed', top: 0, left: '12px', bottom: 0, width: '1px', background: 'linear-gradient(to bottom, transparent, rgba(30,128,223,0.04) 20%, rgba(30,128,223,0.05) 50%, rgba(30,128,223,0.03) 80%, transparent)', pointerEvents: 'none', zIndex: 1 }} />
      <div style={{ position: 'fixed', top: 0, right: '12px', bottom: 0, width: '1px', background: 'linear-gradient(to bottom, transparent, rgba(30,128,223,0.04) 20%, rgba(30,128,223,0.05) 50%, rgba(30,128,223,0.03) 80%, transparent)', pointerEvents: 'none', zIndex: 1 }} />
      <div style={{ position: 'fixed', top: 0, left: '12px', width: '1px', height: '120px', background: 'linear-gradient(to bottom, transparent, rgba(61,158,245,0.46), transparent)', boxShadow: '0 0 10px rgba(61,158,245,0.28)', animation: 'pcbRailSignal 8.8s ease-in-out infinite', pointerEvents: 'none', zIndex: 1 }} />
      <div style={{ position: 'fixed', top: 0, right: '12px', width: '1px', height: '150px', background: 'linear-gradient(to bottom, transparent, rgba(61,158,245,0.42), transparent)', boxShadow: '0 0 10px rgba(61,158,245,0.24)', animation: 'pcbRailSignalReverse 10.4s ease-in-out infinite', pointerEvents: 'none', zIndex: 1 }} />
      <div style={{ position: 'fixed', top: '22%', left: '12px', width: '82px', height: '1px', background: 'linear-gradient(90deg, rgba(61,158,245,0.18), transparent)', pointerEvents: 'none', zIndex: 1 }} />
      <div style={{ position: 'fixed', top: '22%', left: '88px', width: '7px', height: '7px', borderRadius: '50%', border: '1px solid rgba(61,158,245,0.18)', background: 'rgba(30,128,223,0.04)', pointerEvents: 'none', zIndex: 1 }} />
      <div style={{ position: 'fixed', bottom: '26%', right: '12px', width: '96px', height: '1px', background: 'linear-gradient(270deg, rgba(61,158,245,0.16), transparent)', pointerEvents: 'none', zIndex: 1 }} />
      <div style={{ position: 'fixed', bottom: 'calc(26% - 3px)', right: '102px', width: '7px', height: '7px', borderRadius: '50%', border: '1px solid rgba(61,158,245,0.16)', background: 'rgba(30,128,223,0.04)', pointerEvents: 'none', zIndex: 1 }} />
      <div style={{ position: 'fixed', top: 0, bottom: 0, left: '-18%', width: '42%', background: 'linear-gradient(90deg, transparent, rgba(61,158,245,0.024), transparent)', animation: 'pcbGridSweep 14s ease-in-out infinite', pointerEvents: 'none', zIndex: 0 }} />
      <div className="pcb-scan-beam" />
      <div className="pcb-trace-x" style={{ top: '18%', left: 0, animationDelay: '-1.2s' }} />
      <div className="pcb-trace-x" style={{ top: '72%', left: 0, width: '28vw', animationDuration: '14.5s', animationDelay: '-5.5s' }} />
      <div className="pcb-trace-y" style={{ top: 0, left: '18%', animationDelay: '-3.1s' }} />
      <div className="pcb-trace-y" style={{ top: 0, right: '24%', height: '34vh', animationDuration: '15.6s', animationDelay: '-6.4s' }} />
      <div className="pcb-node" style={{ top: '16%', left: '22%', animationDelay: '-0.4s' }} />
      <div className="pcb-node" style={{ top: '28%', right: '18%', animationDelay: '-1.7s' }} />
      <div className="pcb-node" style={{ bottom: '18%', left: '15%', animationDelay: '-2.5s' }} />
      <div className="pcb-node" style={{ bottom: '24%', right: '30%', animationDelay: '-3.2s' }} />
      <div className="pcb-node" style={{ top: '54%', left: '7%', animationDelay: '-4.1s' }} />
      <div className="pcb-node" style={{ top: '62%', right: '8%', animationDelay: '-5.3s' }} />
      {/* Glow orb */}
      <div style={{ position: 'fixed', top: '-100px', left: '-100px', width: '650px', height: '650px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(30,128,223,0.065) 0%, transparent 65%)', animation: 'pcbGlowPulse 11s ease-in-out infinite', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'fixed', right: '-170px', bottom: '-160px', width: '560px', height: '560px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(61,158,245,0.055) 0%, transparent 68%)', animation: 'pcbGlowPulse 13s ease-in-out infinite reverse', pointerEvents: 'none', zIndex: 0 }} />
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
      <style>{`
        @keyframes landingLogoFloat {
          0%, 100% { transform: translateY(0) rotateX(10deg) rotateY(-8deg); }
          50% { transform: translateY(-9px) rotateX(14deg) rotateY(5deg); }
        }
        @keyframes landingLogoOrbit {
          0% { transform: rotateZ(0deg) rotateX(66deg); opacity: 0.22; }
          50% { opacity: 0.42; }
          100% { transform: rotateZ(360deg) rotateX(66deg); opacity: 0.22; }
        }
        @keyframes landingLogoPulse {
          0%, 100% { opacity: 0.34; transform: scale(0.98); }
          50% { opacity: 0.52; transform: scale(1.02); }
        }
        @keyframes landingSweep {
          0%, 22% { transform: translateX(-130%) skewX(-18deg); opacity: 0; }
          42%, 56% { opacity: 0.28; }
          82%, 100% { transform: translateX(130%) skewX(-18deg); opacity: 0; }
        }
        .poweron-landing {
          width: 100%;
          max-width: 980px;
          margin: 0 auto;
          text-align: center;
          position: relative;
        }
        .poweron-landing-panel {
          position: relative;
          overflow: hidden;
          border-radius: 28px;
          border: 1px solid rgba(61,158,245,0.2);
          background: linear-gradient(145deg, rgba(5,18,34,0.62), rgba(2,6,13,0.84));
          box-shadow: 0 36px 110px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.06);
          padding: 48px 48px 44px;
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
        }
        .poweron-landing-panel::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(61,158,245,0.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(61,158,245,0.045) 1px, transparent 1px);
          background-size: 36px 36px;
          mask-image: radial-gradient(circle at center, black, transparent 76%);
          pointer-events: none;
        }
        .poweron-landing-glow {
          position: absolute;
          inset: 20px 8% auto;
          height: 340px;
          border-radius: 50%;
          background: radial-gradient(ellipse at center, rgba(61,158,245,0.16), transparent 68%);
          filter: blur(8px);
          pointer-events: none;
        }
        .poweron-landing-badge {
          position: relative;
          z-index: 2;
          display: inline-flex;
          align-items: center;
          gap: 9px;
          color: ${BLUE_B};
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          background: rgba(30,128,223,0.075);
          border: 1px solid rgba(61,158,245,0.22);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 34px rgba(0,0,0,0.18);
          padding: 8px 16px;
          border-radius: 999px;
          margin-bottom: 28px;
        }
        .poweron-landing-logo-stage {
          position: relative;
          z-index: 2;
          width: min(100%, 520px);
          min-height: 292px;
          display: flex;
          align-items: center;
          justify-content: center;
          perspective: 1200px;
          margin: 0 auto 30px;
          isolation: isolate;
        }
        .poweron-landing-logo-halo,
        .poweron-landing-logo-orbit,
        .poweron-landing-logo-orbit-alt,
        .poweron-landing-logo-reflection {
          position: absolute;
          pointer-events: none;
        }
        .poweron-landing-logo-halo {
          inset: 0 18px 28px;
          border-radius: 44px;
          background:
            radial-gradient(circle at 50% 42%, rgba(61,158,245,0.2), transparent 64%),
            radial-gradient(circle at 86% 20%, rgba(120,190,255,0.12), transparent 42%);
          box-shadow: 0 0 60px rgba(61,158,245,0.16);
          animation: landingLogoPulse 8.5s ease-in-out infinite;
          z-index: 0;
        }
        .poweron-landing-logo-orbit {
          inset: 12px 32px 46px;
          border-radius: 50%;
          border: 1px solid rgba(61,158,245,0.18);
          border-top-color: rgba(120,190,255,0.42);
          border-right-color: rgba(61,158,245,0.32);
          filter: drop-shadow(0 0 8px rgba(61,158,245,0.2));
          animation: landingLogoOrbit 18s ease-in-out infinite;
          z-index: 3;
        }
        .poweron-landing-logo-orbit-alt {
          inset: 28px 64px 64px;
          border-radius: 50%;
          border: 1px solid rgba(61,158,245,0.12);
          border-left-color: rgba(120,190,255,0.3);
          border-bottom-color: rgba(61,158,245,0.24);
          animation: landingLogoOrbit 25s ease-in-out infinite reverse;
          z-index: 3;
        }
        .poweron-landing-logo-plate {
          position: relative;
          z-index: 2;
          width: min(90%, 420px);
          min-height: 190px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 38px 46px;
          border-radius: 34px;
          border: 1px solid rgba(120,190,255,0.28);
          background:
            linear-gradient(145deg, rgba(61,158,245,0.16), rgba(2,6,13,0.46) 42%, rgba(3,12,26,0.82)),
            radial-gradient(circle at 28% 8%, rgba(255,255,255,0.14), transparent 30%);
          box-shadow:
            0 36px 80px rgba(0,0,0,0.42),
            18px -14px 46px rgba(61,158,245,0.18),
            inset 0 1px 0 rgba(255,255,255,0.15),
            inset -1px 0 0 rgba(120,190,255,0.12);
          transform-style: preserve-3d;
          animation: landingLogoFloat 10.5s ease-in-out infinite;
          overflow: hidden;
        }
        .poweron-landing-logo-plate::before {
          content: '';
          position: absolute;
          inset: 12px;
          border-radius: 27px;
          border: 1px solid rgba(61,158,245,0.1);
          background: linear-gradient(135deg, rgba(255,255,255,0.08), transparent 40%);
          transform: translateZ(18px);
          pointer-events: none;
        }
        .poweron-landing-logo-plate::after {
          content: '';
          position: absolute;
          top: -28%;
          bottom: -28%;
          left: -40%;
          width: 32%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), rgba(120,190,255,0.12), transparent);
          animation: landingSweep 9s ease-in-out infinite;
          pointer-events: none;
        }
        .poweron-landing-logo-depth {
          position: absolute;
          inset: 14px -10px -14px 16px;
          border-radius: 34px;
          background: linear-gradient(145deg, rgba(1,4,10,0.78), rgba(30,128,223,0.1));
          transform: translateZ(-34px);
          pointer-events: none;
        }
        .poweron-landing-logo-rim {
          position: absolute;
          inset: 0;
          border-radius: 34px;
          background:
            linear-gradient(90deg, transparent 72%, rgba(120,190,255,0.15)),
            linear-gradient(180deg, rgba(120,190,255,0.13), transparent 34%);
          transform: translateZ(28px);
          pointer-events: none;
        }
        .poweron-landing-logo-img {
          position: relative;
          z-index: 2;
          width: 100%;
          max-width: 332px;
          height: auto;
          object-fit: contain;
          filter: drop-shadow(0 18px 30px rgba(0,0,0,0.36)) drop-shadow(0 0 18px rgba(61,158,245,0.22));
          transform: translateZ(46px);
        }
        .poweron-landing-logo-reflection {
          left: 14%;
          right: 14%;
          bottom: 8px;
          height: 28px;
          border-radius: 50%;
          background: radial-gradient(ellipse at center, rgba(61,158,245,0.26), rgba(30,128,223,0.08) 38%, transparent 72%);
          filter: blur(10px);
          animation: landingLogoPulse 8.5s ease-in-out infinite;
          z-index: 0;
        }
        .poweron-landing-title {
          position: relative;
          z-index: 2;
          font-family: 'Barlow Condensed', sans-serif;
          font-size: clamp(62px, 9vw, 106px);
          font-weight: 700;
          line-height: 0.84;
          text-transform: uppercase;
          color: ${TEXT};
          margin: 0 0 24px;
        }
        .poweron-landing-actions {
          position: relative;
          z-index: 2;
          display: grid;
          grid-template-columns: repeat(2, minmax(180px, 240px));
          gap: 14px;
          justify-content: center;
          margin: 34px auto 24px;
        }
        .poweron-landing-status {
          position: relative;
          z-index: 2;
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 10px;
        }
        @media (max-width: 767px) {
          .poweron-landing-panel { padding: 30px 20px 28px; border-radius: 22px; }
          .poweron-landing-badge { font-size: 9px; letter-spacing: 1.7px; margin-bottom: 18px; }
          .poweron-landing-logo-stage { min-height: 190px; margin-bottom: 18px; perspective: 900px; }
          .poweron-landing-logo-plate { width: min(88%, 318px); min-height: 130px; padding: 24px 28px; border-radius: 24px; animation-duration: 14s; }
          .poweron-landing-logo-depth,
          .poweron-landing-logo-rim { border-radius: 24px; }
          .poweron-landing-logo-img { max-width: 248px; }
          .poweron-landing-logo-orbit { inset: 12px 28px 34px; animation-duration: 24s; }
          .poweron-landing-logo-orbit-alt { inset: 26px 48px 50px; animation-duration: 30s; }
          .poweron-landing-title { font-size: 54px; margin-bottom: 18px; }
          .poweron-landing-actions { grid-template-columns: 1fr; max-width: 320px; margin-top: 26px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .poweron-landing-logo-halo,
          .poweron-landing-logo-orbit,
          .poweron-landing-logo-orbit-alt,
          .poweron-landing-logo-reflection,
          .poweron-landing-logo-plate,
          .poweron-landing-logo-plate::after {
            animation: none !important;
          }
        }
      `}</style>
      <div className="poweron-landing">
        <div className="poweron-landing-panel">
          <div className="poweron-landing-glow" />

          <div className="poweron-landing-badge">
            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#1fc97a', boxShadow: '0 0 10px #1fc97a' }} />
            Operations Ready &middot; PowerOn
          </div>

          <div className="poweron-landing-logo-stage" aria-label="Power On Solutions">
            <span className="poweron-landing-logo-halo" />
            <span className="poweron-landing-logo-orbit" />
            <span className="poweron-landing-logo-orbit-alt" />
            <div className="poweron-landing-logo-plate">
              <span className="poweron-landing-logo-depth" />
              <span className="poweron-landing-logo-rim" />
              <img className="poweron-landing-logo-img" src="/assets/poweron-logo.png" alt="Power On Solutions" />
            </div>
            <span className="poweron-landing-logo-reflection" />
          </div>

          <h1 className="poweron-landing-title">
            YOUR<br />ELECTRICAL<br />
            <span style={{ color: BLUE_B, textShadow: '0 0 58px rgba(61,158,245,0.38)' }}>BUSINESS OS</span>
          </h1>

          <p style={{ position: 'relative', zIndex: 2, fontSize: '16px', color: T2, lineHeight: 1.8, maxWidth: '560px', margin: '0 auto' }}>
            Sales intelligence, field ops, project and business management &mdash; built for electrical contractors.
          </p>

          <div className="poweron-landing-actions">
            <button onClick={onRegister} style={{ ...btnPrimary, minHeight: '56px', borderRadius: '12px', boxShadow: `0 0 0 1px rgba(61,158,245,0.42), 0 16px 42px rgba(30,128,223,0.32)` }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
              Create Account
            </button>
            <button onClick={onLogin} style={{ ...btnSecondary, minHeight: '56px', borderRadius: '12px', background: 'rgba(2,6,13,0.48)', border: '1px solid rgba(61,158,245,0.22)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
              Log In
            </button>
          </div>

          <div className="poweron-landing-status">
            {['Dispatch Active', 'Field Ops Online', 'AI Engine Running', 'Sync Live'].map(item => (
              <span key={item} style={{ color: T2, fontSize: '10px', fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', border: '1px solid rgba(61,158,245,0.16)', background: 'linear-gradient(180deg, rgba(8,24,43,0.5), rgba(2,6,13,0.44))', borderRadius: '999px', padding: '8px 11px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' }}>
                {item}
              </span>
            ))}
          </div>
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
      const msg = err.message ?? ''
      if (msg.includes('Password should contain')) {
        setError('Password must include uppercase, lowercase, and a number. Minimum 8 characters.')
      } else {
        setError(msg || 'Registration failed.')
      }
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

  const loginInputStyle = {
    ...inputStyle,
    minHeight: '56px',
    borderRadius: '12px',
    fontSize: '15px',
    padding: '15px 18px 15px 48px',
    background: 'rgba(2,6,13,0.46)',
    border: '1px solid rgba(61,158,245,0.22)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
  }

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
      <style>{`
        @keyframes authFloat {
          0%, 100% { transform: translateY(0) rotateX(18deg) rotateY(-20deg); }
          50% { transform: translateY(-7px) rotateX(21deg) rotateY(-14deg); }
        }
        @keyframes authPulse {
          0%, 100% { opacity: 0.28; transform: scale(0.98); }
          50% { opacity: 0.5; transform: scale(1.02); }
        }
        @keyframes authScan {
          0% { transform: translateX(-115%); opacity: 0; }
          26%, 74% { opacity: 0.34; }
          100% { transform: translateX(115%); opacity: 0; }
        }
        @keyframes authRailDrop {
          0% { transform: translateY(-120%); opacity: 0; }
          24%, 76% { opacity: 0.42; }
          100% { transform: translateY(120%); opacity: 0; }
        }
        @keyframes authOrbit {
          0% { transform: rotate(0deg) scale(1); opacity: 0.24; }
          50% { opacity: 0.44; }
          100% { transform: rotate(360deg) scale(1); opacity: 0.24; }
        }
        @keyframes authArcFlicker {
          0%, 100% { opacity: 0.12; transform: rotate(-18deg) scale(0.98); }
          45% { opacity: 0.42; transform: rotate(14deg) scale(1.02); }
          70% { opacity: 0.26; transform: rotate(36deg) scale(1); }
        }
        @keyframes authBackGlow {
          0%, 100% { opacity: 0.3; transform: scale(0.99); }
          50% { opacity: 0.48; transform: scale(1.02); }
        }
        @keyframes logoPlateFloat {
          0%, 100% { transform: translateY(0) rotateX(12deg) rotateY(-10deg) rotateZ(-0.8deg); }
          50% { transform: translateY(-10px) rotateX(16deg) rotateY(5deg) rotateZ(0.8deg); }
        }
        @keyframes logoOrbit {
          0% { transform: rotateZ(0deg) rotateX(68deg) scale(1); opacity: 0.24; }
          50% { opacity: 0.42; }
          100% { transform: rotateZ(360deg) rotateX(68deg) scale(1); opacity: 0.24; }
        }
        @keyframes logoOrbitReverse {
          0% { transform: rotateZ(360deg) rotateY(62deg) scale(0.96); opacity: 0.18; }
          50% { opacity: 0.34; }
          100% { transform: rotateZ(0deg) rotateY(62deg) scale(0.96); opacity: 0.18; }
        }
        @keyframes logoHaloPulse {
          0%, 100% { opacity: 0.34; transform: scale(0.98); }
          50% { opacity: 0.54; transform: scale(1.02); }
        }
        @keyframes logoReflectionPulse {
          0%, 100% { opacity: 0.24; transform: scaleX(0.9); }
          50% { opacity: 0.38; transform: scaleX(1); }
        }
        @keyframes logoGlassSweep {
          0%, 18% { transform: translateX(-130%) skewX(-18deg); opacity: 0; }
          38%, 54% { opacity: 0.32; }
          82%, 100% { transform: translateX(130%) skewX(-18deg); opacity: 0; }
        }
        .poweron-auth-backglow {
          position: absolute;
          inset: -44px;
          z-index: 0;
          pointer-events: none;
          background:
            radial-gradient(circle at 27% 45%, rgba(30,128,223,0.14), transparent 30%),
            radial-gradient(circle at 75% 52%, rgba(61,158,245,0.11), transparent 26%);
          filter: blur(8px);
          animation: authBackGlow 11s ease-in-out infinite;
        }
        .poweron-logo-showcase {
          position: relative;
          width: min(100%, 500px);
          min-height: 292px;
          display: flex;
          align-items: center;
          justify-content: center;
          perspective: 1200px;
          margin: 0 0 50px;
          isolation: isolate;
        }
        .poweron-logo-halo,
        .poweron-logo-orbit,
        .poweron-logo-orbit-secondary,
        .poweron-logo-arc,
        .poweron-logo-reflection {
          position: absolute;
          pointer-events: none;
        }
        .poweron-logo-halo {
          inset: 2px 18px 26px;
          border-radius: 42px;
          background:
            radial-gradient(circle at 50% 42%, rgba(61,158,245,0.22), transparent 64%),
            radial-gradient(circle at 82% 18%, rgba(120,190,255,0.14), transparent 42%),
            radial-gradient(circle at 18% 72%, rgba(30,128,223,0.1), transparent 46%);
          box-shadow: 0 0 58px rgba(61,158,245,0.18);
          animation: logoHaloPulse 8.4s ease-in-out infinite;
          z-index: 0;
        }
        .poweron-logo-orbit {
          inset: 10px 34px 44px;
          border-radius: 50%;
          border: 1px solid rgba(61,158,245,0.18);
          border-top-color: rgba(120,190,255,0.45);
          border-right-color: rgba(61,158,245,0.34);
          filter: drop-shadow(0 0 9px rgba(61,158,245,0.22));
          animation: logoOrbit 18s ease-in-out infinite;
          z-index: 3;
        }
        .poweron-logo-orbit-secondary {
          inset: 24px 60px 58px;
          border-radius: 50%;
          border: 1px solid rgba(61,158,245,0.12);
          border-left-color: rgba(120,190,255,0.34);
          border-bottom-color: rgba(61,158,245,0.25);
          filter: drop-shadow(0 0 7px rgba(61,158,245,0.16));
          animation: logoOrbitReverse 24s ease-in-out infinite;
          z-index: 3;
        }
        .poweron-logo-arc {
          inset: 28px 84px 74px;
          border-radius: 50%;
          border: 2px solid transparent;
          border-left-color: rgba(120,190,255,0.26);
          border-bottom-color: rgba(61,158,245,0.18);
          filter: drop-shadow(0 0 8px rgba(61,158,245,0.18));
          animation: logoOrbit 26s ease-in-out infinite reverse;
          z-index: 1;
        }
        .poweron-logo-plate {
          position: relative;
          z-index: 2;
          width: min(90%, 408px);
          min-height: 188px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 38px 44px;
          border-radius: 34px;
          border: 1px solid rgba(120,190,255,0.3);
          background:
            linear-gradient(145deg, rgba(61,158,245,0.17), rgba(2,6,13,0.46) 42%, rgba(3,12,26,0.82)),
            radial-gradient(circle at 28% 8%, rgba(255,255,255,0.16), transparent 30%),
            radial-gradient(circle at 92% 18%, rgba(61,158,245,0.12), transparent 34%);
          box-shadow:
            0 36px 80px rgba(0,0,0,0.42),
            0 0 0 1px rgba(30,128,223,0.08),
            18px -14px 46px rgba(61,158,245,0.2),
            -18px 18px 42px rgba(0,0,0,0.22),
            inset 0 1px 0 rgba(255,255,255,0.16),
            inset -1px 0 0 rgba(120,190,255,0.14),
            inset 0 -1px 0 rgba(61,158,245,0.12);
          transform-style: preserve-3d;
          animation: logoPlateFloat 10.5s ease-in-out infinite;
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          overflow: hidden;
        }
        .poweron-logo-plate::before {
          content: '';
          position: absolute;
          inset: 10px;
          border-radius: 27px;
          border: 1px solid rgba(61,158,245,0.1);
          background:
            linear-gradient(135deg, rgba(255,255,255,0.08), transparent 40%),
            linear-gradient(90deg, transparent, rgba(120,190,255,0.05), transparent);
          pointer-events: none;
          transform: translateZ(18px);
        }
        .poweron-logo-plate::after {
          content: '';
          position: absolute;
          top: -28%;
          bottom: -28%;
          left: -40%;
          width: 32%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.16), rgba(120,190,255,0.14), transparent);
          filter: blur(1px);
          transform: translateX(-130%) skewX(-18deg) translateZ(24px);
          animation: logoGlassSweep 8.8s ease-in-out infinite;
          pointer-events: none;
        }
        .poweron-logo-depth {
          position: absolute;
          inset: 14px -10px -14px 16px;
          border-radius: 34px;
          background: linear-gradient(145deg, rgba(1,4,10,0.78), rgba(30,128,223,0.1));
          border: 1px solid rgba(61,158,245,0.08);
          box-shadow: 0 22px 48px rgba(0,0,0,0.34);
          transform: translateZ(-34px);
          pointer-events: none;
        }
        .poweron-logo-rim {
          position: absolute;
          inset: 0;
          border-radius: 34px;
          background:
            linear-gradient(90deg, transparent 72%, rgba(120,190,255,0.16)),
            linear-gradient(180deg, rgba(120,190,255,0.14), transparent 34%);
          opacity: 0.78;
          transform: translateZ(28px);
          pointer-events: none;
        }
        .poweron-logo-img {
          position: relative;
          z-index: 2;
          display: block;
          width: 100%;
          max-width: 324px;
          height: auto;
          object-fit: contain;
          image-rendering: auto;
          filter: drop-shadow(0 18px 30px rgba(0,0,0,0.36)) drop-shadow(0 0 18px rgba(61,158,245,0.24));
          transform: translateZ(46px);
        }
        .poweron-logo-reflection {
          left: 12%;
          right: 12%;
          bottom: 2px;
          height: 28px;
          border-radius: 50%;
          background: radial-gradient(ellipse at center, rgba(61,158,245,0.28), rgba(30,128,223,0.08) 38%, transparent 72%);
          filter: blur(10px);
          animation: logoReflectionPulse 8.4s ease-in-out infinite;
          z-index: 0;
        }
        @media (max-width: 767px) {
          .poweron-auth-shell { grid-template-columns: 1fr !important; gap: 22px !important; padding: 0 !important; max-width: 420px !important; }
          .poweron-auth-side { min-height: 220px !important; padding: 24px !important; }
          .poweron-auth-title { font-size: 36px !important; }
          .poweron-auth-card { padding: 24px !important; }
          .poweron-auth-metrics { grid-template-columns: 1fr !important; }
          .poweron-auth-backglow { opacity: 0.24; filter: blur(10px); }
          .poweron-logo-showcase { width: 100%; min-height: 190px; margin-bottom: 30px; perspective: 900px; }
          .poweron-logo-plate { width: min(88%, 318px); min-height: 130px; padding: 24px 28px; border-radius: 24px; animation-duration: 14s; }
          .poweron-logo-plate::before { border-radius: 19px; }
          .poweron-logo-depth,
          .poweron-logo-rim { border-radius: 24px; }
          .poweron-logo-img { max-width: 248px; }
          .poweron-logo-orbit { inset: 12px 28px 34px; animation-duration: 24s; }
          .poweron-logo-orbit-secondary { inset: 26px 48px 50px; animation-duration: 30s; }
          .poweron-logo-arc { inset: 32px 58px 62px; animation-duration: 32s; }
          .poweron-logo-reflection { left: 18%; right: 18%; bottom: 8px; height: 20px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .poweron-logo-halo,
          .poweron-logo-orbit,
          .poweron-logo-orbit-secondary,
          .poweron-logo-arc,
          .poweron-logo-reflection,
          .poweron-auth-backglow {
            animation: none !important;
            opacity: 0.16 !important;
          }
          .poweron-logo-plate,
          .poweron-logo-plate::after {
            animation: none !important;
          }
        }
      `}</style>
      <div className="poweron-auth-shell" style={{ width: '100%', maxWidth: '1040px', margin: '0 auto', position: 'relative', display: 'grid', gridTemplateColumns: '1.08fr 0.92fr', gap: '32px', alignItems: 'stretch', padding: '10px' }}>
        <div className="poweron-auth-backglow" />
        <section className="poweron-auth-side" style={{ minHeight: '610px', position: 'relative', zIndex: 1, overflow: 'hidden', borderRadius: '20px', border: '1px solid rgba(61,158,245,0.2)', background: 'linear-gradient(145deg, rgba(5,18,34,0.74), rgba(2,6,13,0.88))', boxShadow: '0 32px 100px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)', padding: '44px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(61,158,245,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(61,158,245,0.055) 1px, transparent 1px)', backgroundSize: '34px 34px', maskImage: 'linear-gradient(140deg, black, transparent 76%)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: '-20%', top: '15%', width: '70%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(61,158,245,0.34), transparent)', animation: 'authScan 9.5s ease-in-out infinite', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: '18px', top: '0', width: '1px', height: '100%', background: 'linear-gradient(to bottom, transparent, rgba(61,158,245,0.08), transparent)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: '18px', top: '0', width: '1px', height: '96px', background: 'linear-gradient(to bottom, transparent, rgba(61,158,245,0.42), transparent)', boxShadow: '0 0 8px rgba(61,158,245,0.24)', animation: 'authRailDrop 8.8s ease-in-out infinite', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: '18px', top: '34%', width: '64px', height: '1px', background: 'linear-gradient(90deg, rgba(61,158,245,0.16), transparent)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: '80px', top: 'calc(34% - 3px)', width: '7px', height: '7px', borderRadius: '50%', border: '1px solid rgba(61,158,245,0.18)', background: 'rgba(61,158,245,0.04)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', right: '-120px', top: '-110px', width: '320px', height: '320px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(30,128,223,0.12), transparent 66%)', pointerEvents: 'none' }} />

          <div style={{ position: 'relative', zIndex: 1 }}>
            <button onClick={onBack} style={{ background: 'rgba(30,128,223,0.06)', border: '1px solid rgba(30,128,223,0.16)', cursor: 'pointer', color: T2, fontSize: '12px', marginBottom: '42px', display: 'inline-flex', alignItems: 'center', gap: '8px', fontFamily: "'Barlow', sans-serif", borderRadius: '999px', padding: '10px 15px', minHeight: '40px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
              Back
            </button>

            <div className="poweron-logo-showcase" aria-label="Power On Solutions">
              <span className="poweron-logo-halo" />
              <span className="poweron-logo-orbit" />
              <span className="poweron-logo-orbit-secondary" />
              <span className="poweron-logo-arc" />
              <div className="poweron-logo-plate">
                <span className="poweron-logo-depth" />
                <span className="poweron-logo-rim" />
                <img className="poweron-logo-img" src="/assets/poweron-logo.png" alt="Power On Solutions" />
              </div>
              <span className="poweron-logo-reflection" />
            </div>

            <h1 className="poweron-auth-title" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '66px', fontWeight: 700, lineHeight: 0.9, letterSpacing: '-1px', textTransform: 'uppercase', color: TEXT, margin: '0 0 22px' }}>
              Sign into<br />
              <span style={{ color: BLUE_B, textShadow: '0 0 42px rgba(61,158,245,0.44)' }}>operations</span>
            </h1>
            <p style={{ color: T2, fontSize: '15px', lineHeight: 1.8, maxWidth: '460px', margin: 0 }}>
              Secure access. Intelligence. Field work. Billing Signals. & the live PowerOn operating layer.
            </p>
          </div>

          <div className="poweron-auth-metrics" style={{ position: 'relative', zIndex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '42px' }}>
            {[
              ['AUTH', 'Password first'],
              ['SESSION', 'Lock-ready'],
              ['STATUS', 'Systems online'],
            ].map(([label, value]) => (
              <div key={label} style={{ borderRadius: '14px', border: '1px solid rgba(61,158,245,0.18)', background: 'linear-gradient(180deg, rgba(8,24,43,0.52), rgba(2,6,13,0.48))', padding: '16px 14px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 30px rgba(0,0,0,0.18)' }}>
                <div style={{ color: T3, fontSize: '9px', letterSpacing: '1.8px', textTransform: 'uppercase', marginBottom: '6px' }}>{label}</div>
                <div style={{ color: TEXT, fontSize: '12px', fontWeight: 700 }}>{value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="poweron-auth-card" style={{ position: 'relative', zIndex: 1, overflow: 'hidden', borderRadius: '20px', padding: '44px', border: '1px solid rgba(61,158,245,0.22)', background: 'linear-gradient(180deg, rgba(8,24,43,0.78), rgba(3,8,17,0.88))', boxShadow: '0 32px 94px rgba(0,0,0,0.46), 0 0 0 1px rgba(30,128,223,0.08), inset 0 1px 0 rgba(255,255,255,0.06)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', alignSelf: 'center' }}>
          <div style={{ position: 'absolute', inset: '0 0 auto 0', height: '2px', background: 'linear-gradient(90deg, transparent, rgba(61,158,245,0.85), transparent)' }} />
          <div style={{ position: 'absolute', right: '-70px', bottom: '-80px', width: '220px', height: '220px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(61,158,245,0.14), transparent 68%)', pointerEvents: 'none' }} />

          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ marginBottom: '34px' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', border: '1px solid rgba(31,201,122,0.22)', background: 'rgba(31,201,122,0.07)', borderRadius: '999px', padding: '6px 10px', marginBottom: '14px' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#1fc97a', boxShadow: '0 0 10px #1fc97a', animation: 'authPulse 2.2s ease-in-out infinite' }} />
                <span style={{ fontSize: '10px', color: '#6ee7b7', letterSpacing: '1.8px', textTransform: 'uppercase', fontWeight: 700 }}>Secure channel live</span>
              </div>
              <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '38px', fontWeight: 700, textTransform: 'uppercase', color: TEXT, margin: '0 0 8px', letterSpacing: '-0.6px' }}>Welcome Back</h2>
              <p style={{ color: T2, margin: 0, fontSize: '14px', lineHeight: 1.65 }}>Use your email and password to enter the hub. PIN unlock remains available only after session lock.</p>
            </div>

            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div style={{ position: 'relative' }}>
                <User size={16} color={T3} style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                <input type="text" value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="Email address" required autoComplete="username" style={loginInputStyle} />
              </div>
              <div style={{ position: 'relative' }}>
                <Lock size={16} color={T3} style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required autoComplete="current-password" style={{ ...loginInputStyle, paddingRight: '46px' }} />
                <button type="button" onClick={() => setShowPassword(v => !v)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(30,128,223,0.06)', border: '1px solid rgba(30,128,223,0.12)', borderRadius: '8px', cursor: 'pointer', color: T2, width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {(localError || error) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '11px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)', borderRadius: '10px' }}>
                  <AlertCircle size={15} color="#f87171" />
                  <span style={{ fontSize: '12px', color: '#f87171' }}>{localError || error}</span>
                </div>
              )}
              <button type="submit" disabled={loading || !identifier.trim() || !password} style={{ ...btnPrimary, minHeight: '56px', borderRadius: '12px', marginTop: '4px', opacity: (loading || !identifier.trim() || !password) ? 0.5 : 1, boxShadow: `0 0 0 1px rgba(61,158,245,0.42), 0 16px 42px rgba(30,128,223,0.32)` }}>
                {loading ? <div style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> : <><ArrowRight size={15} /> Sign In</>}
              </button>
            </form>

            <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <button onClick={() => { setShowForgot(true); setLocalError('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T2, fontSize: '12px', fontFamily: "'Barlow', sans-serif", padding: 0 }}>
                Forgot password?
              </button>
              <span style={{ color: T3, fontSize: '11px', letterSpacing: '1.2px', textTransform: 'uppercase' }}>Session PIN unlock is lock-screen only</span>
            </div>
          </div>
        </section>
      </div>
    </PCBPage>
  )
}
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
  const status = useAuthStore(s => s.status)
  const { submitPasscode, signOut } = useAuth()
  const [screen, setScreen] = useState<AuthScreen>('landing')
  const [pinFallback, setPinFallback] = useState(false)

  switch (status) {
    case 'loading':
      return <AuthSpinner />

    case 'unauthenticated': {
      // In a Locked state, status is 'needs_passcode', not 'unauthenticated'.
      // This block handles users who haven't logged in at all.
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

    case 'hydrating_user_data':
      return (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100vh', background: '#02060d', flexDirection: 'column', gap: '16px'
        }}>
          <div style={{ width: '32px', height: '32px', border: '3px solid #1e80df',
            borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <div style={{ color: '#6b7280', fontSize: '14px' }}>Loading your workspace...</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )

    case 'authenticated':
      return <>{children}</>

    default:
      return <AuthSpinner />
  }
}
