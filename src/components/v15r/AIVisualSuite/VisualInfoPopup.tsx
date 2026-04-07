// @ts-nocheck
/**
 * VisualInfoPopup — "? WHAT IS THIS" floating popup for AI Visual Suite
 * B46 — AI Visual Suite
 *
 * Shows 3 sections per visual: science explanation, plain English, and
 * the conceptual prompt that inspired the visualization.
 */

import React, { useState } from 'react'

export interface VisualInfo {
  name: string
  science: string
  plain: string
  prompt: string
}

export const VISUAL_INFO: VisualInfo[] = [
  {
    name: 'Quantum Foam',
    science: 'At the Planck scale (10⁻³⁵ m) spacetime is predicted to be a probabilistic foam of virtual particle pairs, micro-black-holes, and quantum fluctuations — described by the wave function collapse in quantum field theory.',
    plain: 'Space itself isn\'t smooth — zoom in far enough and it\'s a churning ocean of bubbles popping in and out of existence. This visualization shows what that might look like if you could see it.',
    prompt: 'Render the quantum vacuum as overlapping probability bubbles on a rotating particle sphere, driven by voice frequency bands.',
  },
  {
    name: 'Strange Attractor',
    science: 'The Lorenz attractor is a chaotic dynamical system with sensitive dependence on initial conditions. Its butterfly-shaped phase portrait never repeats, yet is bounded — a strange attractor.',
    plain: 'A mathematical object that looks random but follows hidden rules. Like a weather system that\'s deterministic but unpredictable. The trace draws the "shape" of chaos itself.',
    prompt: 'Trace a Lorenz attractor in phase space with audio-reactive parameters sigma, rho, beta driving trajectory divergence.',
  },
  {
    name: 'Hyperbolic Space',
    science: 'Hyperbolic geometry (constant negative curvature) is visualized via the Poincaré disk model. Geodesics appear as arcs of circles perpendicular to the boundary disk — infinitely many parallel lines through a given point.',
    plain: 'A universe where space curves the other way — more room as you go outward, but you never reach the edge. The fish in Escher\'s Circle Limit live here.',
    prompt: 'Animate the Poincaré disk with rotating geodesic tessellations, Möbius pulse overlays triggered by MTZ.',
  },
  {
    name: 'Cellular Automata',
    science: 'Conway\'s Game of Life runs discrete birth/death rules on a 2D grid. Complex structures (gliders, oscillators, still lifes) emerge from 3 simple rules despite zero explicit programming of these structures.',
    plain: 'Tiny cells live and die based on their neighbors. From 3 simple rules emerges ant highways, gliding patterns, and permanent structures — life from nothing.',
    prompt: 'Run Game of Life with audio-reactive birth rules, age-colored cells, MTZ-injected glider seeds.',
  },
  {
    name: 'Field Lines',
    science: 'Electric field lines trace the direction of force on a positive test charge. They originate at positive charges, terminate at negative, never cross, and their density encodes field strength — visualizing the gradient of the electric potential.',
    plain: 'Invisible force pathways between charges — like river currents in space. The lines show where a ball would roll if the charges were hills and valleys.',
    prompt: 'Draw electric field lines from audio-reactive charge sources orbiting the center, with polarity flips on MTZ.',
  },
  {
    name: 'Reaction-Diffusion',
    science: 'The Gray-Scott system models two chemicals: U (activator) and V (inhibitor) reacting and diffusing at different rates. Turing showed this mechanism can spontaneously generate the spots on leopards, stripes on zebrafish, and spiral waves.',
    plain: 'The same math that makes leopard spots. Two chemicals compete and cooperate, generating living-looking patterns — without any life, just diffusion.',
    prompt: 'Simulate Gray-Scott with feed/kill rates driven by bass/mid, MTZ injecting fresh reactant seeds.',
  },
  {
    name: 'Flow Field',
    science: 'A vector field assigns a direction to every point in space. Particle advection follows the Lagrangian (particle-tracking) perspective of fluid dynamics, revealing streamlines, vorticity, and Kolmogorov turbulence cascades.',
    plain: 'Each point in space has an arrow. Particles follow the arrows — like leaves in a stream. Zoom in on wind or water and this is what it looks like.',
    prompt: 'Advect thousands of particles through a Perlin-noise vector field, frequency and speed driven by audio.',
  },
  {
    name: 'Fourier Epicycles',
    science: 'Any periodic function decomposes into sine waves (Fourier series). Epicycles — circles rotating on circles — implement this geometrically. Ptolemy used them to model planetary motion; Fourier unified them with signal theory.',
    plain: 'Every shape you can draw is secretly a sum of rotating circles. Add enough circles, you can draw anything. This is how your phone compresses audio and images.',
    prompt: 'Animate nested rotating circles whose tip traces a morphing Lissajous curve, with bass-driven rotation speed and mid-driven term count.',
  },
  {
    name: 'Mandelbrot Depth',
    science: 'The Mandelbrot set is the set of complex numbers c for which z → z² + c does not diverge. Its fractal boundary has infinite detail at every scale, with Hausdorff dimension ≈ 2. Smooth coloring uses the escape-time algorithm with log-normalization.',
    plain: 'Zoom in forever and new complexity keeps appearing — spirals inside spirals inside spirals. The most famous mathematical object in existence.',
    prompt: 'Zoom into deep Mandelbrot coordinates with smooth escape-time coloring, palette rotation driven by high, coordinate jump on MTZ.',
  },
  {
    name: 'Topology Morph',
    science: 'Topology studies properties preserved under continuous deformation. A torus and sphere are topologically distinct (different genus). A Klein bottle is a non-orientable surface with no inside or outside — only embeddable without self-intersection in 4D.',
    plain: 'Mathematically speaking, a coffee cup and a donut are the same object. This shows surfaces morphing between types — some with handles, some without a real "inside".',
    prompt: 'Morph between torus, sphere, and Klein-inspired parametric surfaces in 3D, with genus-jump discontinuities on MTZ.',
  },
]

interface Props {
  visualIndex: number
  onClose: () => void
}

export default function VisualInfoPopup({ visualIndex, onClose }: Props) {
  const [tab, setTab] = useState<'science' | 'plain' | 'prompt'>('plain')
  const info = VISUAL_INFO[visualIndex] ?? VISUAL_INFO[0]

  return (
    <div style={{
      position: 'absolute', bottom: 56, left: 16, zIndex: 100,
      width: 300, borderRadius: 12,
      backgroundColor: 'rgba(6,8,22,0.95)',
      border: '1px solid rgba(255,255,255,0.12)',
      backdropFilter: 'blur(12px)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      fontFamily: 'ui-monospace,monospace',
    }}>
      <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#00ff88', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{info.name}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}>✕</button>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {(['plain', 'science', 'prompt'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '7px 0', border: 'none', cursor: 'pointer', fontSize: 9,
            fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
            backgroundColor: 'transparent',
            color: tab === t ? '#00ff88' : '#4b5563',
            borderBottom: tab === t ? '2px solid #00ff88' : '2px solid transparent',
          }}>
            {t === 'plain' ? 'Plain English' : t === 'science' ? 'Science' : 'Prompt'}
          </button>
        ))}
      </div>

      <div style={{ padding: '12px 14px 14px', minHeight: 90 }}>
        <p style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.65, margin: 0 }}>
          {info[tab]}
        </p>
      </div>
    </div>
  )
}
