// @ts-nocheck
/**
 * modeDescriptions.ts — Static descriptions for all 43 AI Visual Suite modes
 * B48 — NEXUS Visual Suite Full Deploy
 */

export interface ModeDesc {
  id: number
  name: string
  bucket: 'B1' | 'B2' | 'B3'
  color: string
  sci: string
  sim: string
  prompt: string
}

export const MODE_DESCRIPTIONS: ModeDesc[] = [
  { id: 0, name: 'Orb Core', bucket: 'B1', color: '#00ff9f',
    sci: `Frequency-reactive icosahedral sphere with corona rings, vertex spike system, and particle cloud. Spikes react to highs, rings expand on bass, color shifts on mids.`,
    sim: `A glowing ball that pulses with sound. Spikes shoot out on high frequencies, rings expand on bass hits.`,
    prompt: `Build a 3D orb with [N] corona rings, [M] spike count, particle cloud of [X] particles. Bass=size, mid=color, high=spikes. MTZ multiplies all three.` },

  { id: 1, name: 'Wave Terrain', bucket: 'B1', color: '#aa44ff',
    sci: `Multi-row parametric wave terrain with noise-based amplitude. MTZ activates vertical light pillars at wave peaks with dot caps.`,
    sim: `Sound becomes a landscape. Waves of energy move through a field, taller on louder sounds. MTZ shoots pillars of light up from the peaks.`,
    prompt: `Build a wave terrain with [N] rows, amplitude controlled by bass, frequency by mid. MTZ adds vertical light pillars with glowing caps.` },

  { id: 2, name: '3D Spiral', bucket: 'B1', color: '#00e5ff',
    sci: `Toroidal spiral with perspective projection. Ring count, radius, and rotation speed all react to audio bands. MTZ doubles ring count and steepens tilt.`,
    sim: `A spinning ring tunnel that gets more complex the louder things get. MTZ makes it a full vortex.`,
    prompt: `Build a 3D spiral ring with [N] rings, perspective projection. Bass deforms radius, MTZ multiplies ring count and rotation speed.` },

  { id: 3, name: 'Wire Sphere', bucket: 'B1', color: '#ff6d00',
    sci: `Geodesic wireframe sphere with Perlin noise surface deformation. Latitude and longitude lines multiply with MTZ. Surface lumps and distorts with bass.`,
    sim: `A globe that melts and distorts with the music. More grid lines appear as MTZ increases.`,
    prompt: `Build a wireframe sphere with [N] lat/lng lines. Bass deforms vertices by noise amplitude [A]. MTZ inflates radius and multiplies grid lines.` },

  { id: 4, name: 'Kaleidoscope', bucket: 'B1', color: '#ff44aa',
    sci: `Rotational symmetry pattern with recursive petal subdivision. Sides increase 6→20 with MTZ. Sub-petals spawn recursively at higher MTZ values.`,
    sim: `A spinning crystal flower that grows more complex petals. MTZ adds petals inside petals inside petals.`,
    prompt: `Build a kaleidoscope with [N] sides, [D] petal recursion depth. MTZ increases sides to 20 and adds recursive sub-petals.` },

  { id: 5, name: 'Spectrum Bars', bucket: 'B1', color: '#ffcc00',
    sci: `64-band FFT spectrum visualizer with gradient bars, cap markers, and 3D shadow layers. Bar count and height both multiply with MTZ.`,
    sim: `Classic equalizer bars that get taller and multiply in 3D layers as MTZ increases.`,
    prompt: `Build spectrum bars: [N] bands, bass=height, color shifts red→yellow→white. MTZ stacks [M] 3D shadow layers behind each bar.` },

  { id: 6, name: 'Plexus Arc', bucket: 'B1', color: '#44aaff',
    sci: `Curved arc base with frequency bars and orbital node network. Nodes connect when within distance threshold. MTZ spawns multiple concentric arcs.`,
    sim: `A curved stage with bars shooting up and floating connected dots orbiting it. MTZ adds more arcs.`,
    prompt: `Build a plexus arc: curved base, [N] frequency bars, [M] nodes connected within [D] distance. MTZ multiplies arc count.` },

  { id: 7, name: 'Solar Flare', bucket: 'B1', color: '#ff6600',
    sci: `Bezier curve solar prominences from a central star. Flare count and length both react to bass and MTZ. Corona glow expands with energy level.`,
    sim: `A sun with loops of fire shooting off it. More loops appear and grow bigger with MTZ.`,
    prompt: `Build solar flares: [N] bezier prominences, central glow radius [R]. MTZ adds more flares and extends their reach.` },

  { id: 8, name: 'DNA Helix', bucket: 'B1', color: '#00ffcc',
    sci: `Double helix with rung connections and node markers at crossover points. MTZ adds extra strands wrapping around the primary double helix.`,
    sim: `The DNA ladder spinning. MTZ wraps more strands around it until it looks like a full rope.`,
    prompt: `Build a DNA helix: [N] strands, pitch [P], amplitude [A]. MTZ adds extra strands. Nodes glow on high frequency hits.` },

  { id: 9, name: 'Black Hole', bucket: 'B1', color: '#cc00ff',
    sci: `Accretion disk with elliptical rings, photon sphere, Hawking glow rim, and gravitational jets. Ring system and jets both expand dramatically with MTZ.`,
    sim: `A black hole pulling light around it. The jet beams fire bigger with bass. MTZ expands the whole system.`,
    prompt: `Build a black hole: [N] accretion rings, ellipse tilt [A], photon rim glow, two jets. MTZ expands ring system and lengthens jets.` },

  { id: 10, name: 'Lightning', bucket: 'B1', color: '#ffffff',
    sci: `Recursive fractal lightning bolt system with random branching. Strike count and recursion depth both increase with MTZ.`,
    sim: `Multiple lightning strikes hitting from above. MTZ adds more strikes and more branching.`,
    prompt: `Build recursive lightning: [N] strikes, [D] recursion depth, branching probability [P]. MTZ adds strikes and increases recursion depth.` },

  { id: 11, name: 'Wormhole', bucket: 'B1', color: '#4488ff',
    sci: `Non-circular infinite tunnel rings with elliptical compression simulating curved spacetime. Rings zoom inward continuously. MTZ multiplies ring count.`,
    sim: `A tunnel into another dimension that keeps zooming forever. MTZ makes it spin and adds more rings.`,
    prompt: `Build a wormhole: [N] rings zooming inward, elliptically compressed. MTZ increases ring count and zoom speed.` },

  { id: 12, name: 'Cymatics', bucket: 'B1', color: '#ffdd00',
    sci: `Lissajous-family standing wave patterns. Same mathematics as sound vibrating sand or water. MTZ increases frequency ratio complexity.`,
    sim: `The actual shape that sound makes when it vibrates sand or water. MTZ makes the pattern more complex.`,
    prompt: `Build cymatics: [N] Lissajous curves, frequency ratio [N:M]. Bass controls amplitude. MTZ increases pattern complexity and layer count.` },

  { id: 13, name: 'Lava Lamp', bucket: 'B1', color: '#ff4422',
    sci: `Metaball blob system with gradient connections forming organic bridges between blobs. MTZ speeds movement and grows blob radius dramatically.`,
    sim: `Hot glowing blobs that merge and split. MTZ makes them move faster and grow bigger.`,
    prompt: `Build a lava lamp: [N] metablobs, connection bridges when within [D]. MTZ speeds movement and grows blob radius.` },

  { id: 14, name: 'Crystal', bucket: 'B1', color: '#88eeff',
    sci: `Recursive fractal crystal facets built from polygon subdivision. Each vertex spawns child facets. MTZ increases recursion depth.`,
    sim: `A crystal growing more complex faces the deeper you look. MTZ adds more levels of detail.`,
    prompt: `Build a crystal: [N] facets per level, [D] recursive depth. MTZ adds more levels. Mid controls transparency.` },

  { id: 15, name: 'Blueprint', bucket: 'B1', color: '#0088ff',
    sci: `Electrical schematic grid with circuit paths routing audio energy as current. Voltage sine wave runs through center reacting to bass.`,
    sim: `Your job made visible. Circuit paths route audio like electrical current through a panel.`,
    prompt: `Build a blueprint visualizer: grid [G]px, [N] circuit paths routing audio as current. Voltage wave at center reacts to bass. MTZ adds more paths and increases current.` },

  { id: 16, name: 'Voltage', bucket: 'B1', color: '#ffee00',
    sci: `Three-phase bus bars (L1=yellow/L2=cyan/L3=magenta) with arc flash events between phases and oscilloscope at bottom. Arc count scales with bass and MTZ.`,
    sim: `Three power lines with electricity arcing between them. Your electrical work as art.`,
    prompt: `Build three-phase voltage: L1/L2/L3 bus bars, arc flash between phases on bass hits, oscilloscope at bottom. MTZ adds more bus bars and arc events.` },

  { id: 17, name: 'Hustle Grid', bucket: 'B1', color: '#ff3300',
    sci: `Live business metrics bar chart with active column cycling and pipeline flow particles moving horizontally across the top.`,
    sim: `PowerOn Hub numbers as a live beating dashboard. The active column lights gold as it cycles.`,
    prompt: `Build a hustle grid: [N] metric columns, active column cycles with time. Pipeline particles flow horizontally at top. MTZ grows bar heights.` },

  { id: 18, name: 'Desert Storm', bucket: 'B1', color: '#ff8844',
    sci: `Desert horizon with low sun, heat shimmer waves, sand dune silhouette, and dust particles. Sun grows and shimmer intensifies with MTZ.`,
    sim: `Desert Hot Springs at sunset. Where you built everything from. MTZ brings the storm.`,
    prompt: `Build a desert scene: low sun glow [R], heat shimmer [N] waves, dune silhouette, dust particles react to highs. MTZ grows sun and adds dust storm.` },

  { id: 19, name: 'NEXUS Mind', bucket: 'B1', color: '#00ffaa',
    sci: `11-agent orbital pyramid with data packet animation and pulse rings expanding from NEXUS core. Agents orbit faster and rings multiply with MTZ.`,
    sim: `Your actual platform — 11 AI agents orbiting the NEXUS core sending data to each other.`,
    prompt: `Build the NEXUS mind: central core, [N] agent nodes in [R] orbital rings, data packets travel connections, pulse rings expand from center. MTZ speeds orbits and adds rings.` },

  { id: 20, name: 'Empire Fall', bucket: 'B1', color: '#cc8844',
    sci: `Crumbling stone pillars with physics-based tilt, dust particle system, and stars rising above the rubble. MTZ increases crack severity.`,
    sim: `Empires fall. New ones rise from the rubble. The stars still come out. You rebuild.`,
    prompt: `Build empire fall: [N] stone pillars tilting with bass, dust particles on MTZ, stars rising above the ruins. MTZ cracks pillars harder.` },

  { id: 21, name: 'Infinite Loop', bucket: 'B1', color: '#44ffcc',
    sci: `Fibonacci golden spiral with recursive growth nodes at each spiral point and infinite tunnel rings overlaid. φ=1.618. MTZ adds spiral layers.`,
    sim: `Everything that grows follows this exact spiral. Companies, skills, wealth. You are on it.`,
    prompt: `Build the Fibonacci spiral: [N] recursive layers, golden ratio φ=1.618, growth nodes at each point, infinite tunnel overlay. MTZ adds more layers.` },

  { id: 22, name: 'Iron Will', bucket: 'B1', color: '#ff2244',
    sci: `Heartbeat EKG surge system with impact shockwaves at beat peaks and speed lines tearing left. Bass drives surge amplitude. MTZ makes it violent.`,
    sim: `The pulse that keeps you going at 3AM building. Never stop. Power on.`,
    prompt: `Build iron will: EKG heartbeat surges on bass, [N] impact shockwaves at peaks, speed lines tearing left. MTZ makes surges more violent. NEVER STOP text.` },

  { id: 23, name: 'Quantum Foam', bucket: 'B2', color: '#ff00ff',
    sci: `Spacetime at Planck scale (10⁻³⁵m). Seven quantum wave functions interfering simultaneously. Color encodes probability phase angle, brightness encodes |ψ|² probability density. Virtual particle-antiparticle pairs spontaneously emerge and annihilate from vacuum energy. Non-Euclidean wavefronts curve with time.`,
    sim: `Zoom into empty space until you hit the smallest possible scale. Space stops being smooth and becomes bubbling foam. Particles pop in and out of nothing. Colors show where things are most likely to exist. The rings are not circles because space itself is bent.`,
    prompt: `Build a quantum foam visualizer: [N] interfering wave functions, virtual particle pairs that spawn and annihilate with age cycle, non-circular wavefronts. Color=phase angle, brightness=probability density. MTZ reveals Planck topology and adds virtual pairs.` },

  { id: 24, name: 'Strange Attractor', bucket: 'B2', color: '#00ffcc',
    sci: `Lorenz chaotic attractor: dx=σ(y-x) dy=x(ρ-z)-y dz=xy-βz with σ=10 ρ=28 β=8/3. Deterministic system that never repeats. Butterfly shape from three coupled differential equations. Infinitesimal differences in initial conditions diverge exponentially.`,
    sim: `A tiny change — a butterfly flapping its wings — eventually causes a hurricane. This is that, mathematically. The butterfly SHAPE emerges from the math. It never draws the same path twice.`,
    prompt: `Build a Lorenz attractor: σ=10 ρ=28 β=8/3, trail of [N] points colored by Z-height. MTZ increases trail length and dt. Add Rössler variant as alternate parameter set.` },

  { id: 25, name: 'Hyperbolic Space', bucket: 'B2', color: '#ffaa00',
    sci: `Poincaré disk model of hyperbolic geometry. Triangle angle sum less than 180°. Parallel lines diverge. Boundary circle is infinitely far away. Tiles near edge are same size in hyperbolic units as center tiles.`,
    sim: `Normal geometry is flat like a table. This curves away from itself forever like a saddle. Every tile near the edge is the SAME SIZE as center tiles — space just compresses them. Cannot be built in 3D.`,
    prompt: `Build a Poincaré disk: [N] geodesic lines, [M] tessellation tiles. Animate by rotating the disk. Color tiles by depth. MTZ increases recursion levels and warps the metric.` },

  { id: 26, name: 'Cellular Automata', bucket: 'B2', color: '#ff4444',
    sci: `Rule 110 cellular automaton — proven Turing complete. Binary rules check 3 neighbors producing 2⁸=256 possible rule sets. Computationally irreducible — no shortcut to predict state N except running N steps.`,
    sim: `A row of lights, each turning on/off based only on its two neighbors. That simple rule can solve ANY math problem — same as your phone. This is how complexity emerges from almost nothing.`,
    prompt: `Build Rule [110/30/90] cellular automaton: grid [W×H], [X] generations per second. Color living cells by age. MTZ increases speed and shows multiple rule variants layered simultaneously.` },

  { id: 27, name: 'Field Lines', bucket: 'B2', color: '#44aaff',
    sci: `Electromagnetic field from Maxwell equations. Field lines show force direction at every point. Multiple animated charges create superposed fields. Gradient computed analytically per frame, not approximated.`,
    sim: `Every magnet and wire creates invisible force around it. This makes those invisible forces visible as lines. Lines never cross because a field only points one direction at any point. Genuinely invisible in reality.`,
    prompt: `Build EM field lines from [N] point charges moving in Lissajous orbits. [M] field lines per charge. Color by charge polarity. MTZ adds charges and shows equipotential contours.` },

  { id: 28, name: 'Reaction Diffusion', bucket: 'B2', color: '#aaff44',
    sci: `Gray-Scott system: A+2B→3B, B→P. Different diffusion rates cause Turing instability — spontaneous pattern formation. Same equations produce zebrafish stripes, leopard spots, coral branching, seashell pigmentation.`,
    sim: `Mix two invisible chemicals. They react and spread at different speeds. Somehow: stripes, spots, spirals, mazes — exactly like animal skin. The universe reuses its pattern recipes everywhere.`,
    prompt: `Build Gray-Scott reaction diffusion: feed=[F] kill=[k], grid [N×N], [X] iterations per frame. Color by chemical ratio. MTZ morphs parameters between spots→stripes→mazes→solitons.` },

  { id: 29, name: 'Flow Field', bucket: 'B2', color: '#ff8844',
    sci: `Perlin noise vector field with 2500 particles following curl-noise velocity. Divergence-free configuration ensures incompressible flow. Layered coherent noise at multiple octaves drives field direction.`,
    sim: `Imagine wind, but you could see every air molecule. 2500 particles in mathematically perfect wind — it flows without gaps or bunching. The swirling patterns come from the field, not the particles.`,
    prompt: `Build a flow field: [N] particles, [M] noise octaves, curl noise for divergence-free flow. Particles leave trails of [L] length. MTZ increases particle count and trail length. Color by speed.` },

  { id: 30, name: 'Fourier Epicycles', bucket: 'B2', color: '#ffff44',
    sci: `Any closed curve decomposes into N rotating circles (Fourier series). Radii from frequency components, each rotating at integer multiples of base frequency. Tip traces target curve exactly as N→∞.`,
    sim: `Draw ANY shape using only circles spinning on each other. The first big circle makes the rough shape. Each smaller circle adds detail. This is how your phone compresses music and photos.`,
    prompt: `Build Fourier epicycles: [N] frequency components, target shape [star/letter]. Show rotating circles. Trail fades. MTZ increases N terms. Show frequency spectrum as radial bars alongside.` },

  { id: 31, name: 'Mandelbrot Depth', bucket: 'B2', color: '#cc44ff',
    sci: `z_{n+1}=z_n²+c escape time algorithm with smooth coloring via fractional iteration count. Continuous zoom toward -0.7453+0.1127i. Hausdorff dimension ~2 at boundary. Infinite self-similar detail at every scale.`,
    sim: `One equation. Run it for every point on screen. Color by how fast it escapes. The result: infinite detail — zoom in forever, new patterns always appear. Nobody designed this. It comes entirely from x²+c.`,
    prompt: `Build Mandelbrot zoom toward [x+yi]. Smooth coloring with fractional escape. [N] max iterations. MTZ controls zoom speed and morphs to Julia set variant. Palette cycles through HSL.` },

  { id: 32, name: 'Topology Morph', bucket: 'B2', color: '#44ffaa',
    sci: `Continuous deformation between torus→Klein bottle. Homeomorphic transformations preserve genus and orientability. Klein bottle is non-orientable — no inside or outside — impossible in 3D without self-intersection.`,
    sim: `A coffee mug and a donut are mathematically the same shape. This morphs between shapes while keeping that sameness. The Klein bottle has no inside or outside. Cannot exist in real 3D space.`,
    prompt: `Build topology morph: torus→Klein bottle. Parametric surface as wireframe. Morph speed from bass. Color by Gaussian curvature. MTZ increases morph speed and lat/lng line count.` },

  { id: 33, name: 'Phase Portrait', bucket: 'B3', color: '#ff6688',
    sci: `Vector field of nonlinear oscillator showing fixed points, limit cycles, and separatrices. All possible trajectories shown simultaneously. Basin of attraction boundaries visible as separatrix curves.`,
    sim: `Every possible future of a system shown at once. Fixed points are where things get trapped. Limit cycles are endless loops. The swirling lines show every path everything could take.`,
    prompt: `Build a phase portrait: [pendulum/van der Pol] oscillator. Show fixed points as colored dots. Trace [N] trajectories. Color by divergence. MTZ reveals basins of attraction.` },

  { id: 34, name: 'Geodesic Dome', bucket: 'B3', color: '#ffaa44',
    sci: `Buckminster Fuller geodesic subdivision of icosahedron. Each face recursively subdivided and projected onto sphere. Frequency N determines subdivision level. All edges equal length — maximum structural efficiency.`,
    sim: `The most efficient way to enclose space with triangles. Every dome, satellite dish, and carbon molecule uses this math. Nature's favorite shape for enclosing things.`,
    prompt: `Build a geodesic dome: frequency [N], icosahedron base, project to sphere. Bass deforms vertices outward. Color by face normal direction. MTZ increases subdivision frequency.` },

  { id: 35, name: 'Double-Slit', bucket: 'B3', color: '#44ddff',
    sci: `Quantum double-slit experiment. Probability amplitude from two point sources sums coherently. Fringe spacing λ=wavelength/slit-separation. Each photon passes through both slits simultaneously until observed.`,
    sim: `Fire one photon at two slits. It goes through BOTH at the same time and interferes with itself. This proved particles are also waves. The stripes show where the photon was most likely to land.`,
    prompt: `Build double-slit interference: two sources at [±D], wavelength [λ]. Show probability amplitude as color intensity. MTZ reveals which-way information destroying the interference pattern.` },

  { id: 36, name: 'Voronoi Crystal', bucket: 'B3', color: '#aaffdd',
    sci: `Voronoi diagram partitions plane by nearest-seed Euclidean distance. Seeds animated by audio. Each cell boundary equidistant from two seeds. Delaunay triangulation dual shown simultaneously.`,
    sim: `Drop seeds on a table. Every point belongs to whichever seed is closest. Nature uses this for giraffe patterns, dragonfly wings, bone structure, and city planning.`,
    prompt: `Build animated Voronoi: [N] seeds moving with audio. Show cells and triangulation. Color cells by area. MTZ adds seeds and shows Lloyd relaxation animation.` },

  { id: 37, name: 'Penrose Tiling', bucket: 'B3', color: '#ffdd88',
    sci: `Aperiodic tiling using two rhombus shapes. Never repeats, never has a unit cell, yet fills the plane perfectly. Five-fold rotational symmetry impossible in periodic crystals. Found in quasicrystals — Nobel Prize 2011.`,
    sim: `Two shapes that tile a floor perfectly — but the pattern never, ever repeats. Not once, even if you tile forever. A Nobel Prize was given for discovering these existed in nature.`,
    prompt: `Build Penrose tiling: P3 thick-thin rhombus. [N] deflation levels. Animate deflation/inflation. Color by tile type and orientation. MTZ increases deflation depth.` },

  { id: 38, name: 'Spinor Field', bucket: 'B3', color: '#ff44ff',
    sci: `Spinor rotation visualization — a quantum particle requires 720° rotation to return to original state. The Dirac equation governs electrons. Belt trick / Dirac string trick made visible geometrically.`,
    sim: `A quantum particle spins TWICE as many times as you think to get back where it started. Spin it 360° — it is upside down. Another 360° — now it is back. Normal objects do not do this. Electrons do.`,
    prompt: `Build spinor field: belt trick with [N] strands, 720° periodicity. Color strands by twist angle. MTZ reveals SU(2) double cover of SO(3). Connect rotation speed to audio.` },

  { id: 39, name: 'Riemann Surface', bucket: 'B3', color: '#88aaff',
    sci: `Multi-valued complex function w=√z visualized as Riemann surface — sheets of complex plane connected at branch points. Makes multi-valued functions single-valued. Branch cuts shown as seams.`,
    sim: `Some math functions give two answers for one input. A Riemann surface is a 3D shape where both answers live on different floors. Walk up a spiral ramp and you go from one answer to the other.`,
    prompt: `Build Riemann surface of [√z/log(z)/z^(1/N)]: [N] sheets, branch point at z=0. Color by sheet number and phase. Animate by rotating complex argument. MTZ reveals additional sheets.` },

  { id: 40, name: 'Percolation', bucket: 'B3', color: '#44ff88',
    sci: `Site percolation on square lattice. Each cell occupied with probability p. At critical threshold p_c≈0.593 an infinite spanning cluster emerges — phase transition. Fractal cluster boundary dimension 1.896.`,
    sim: `Imagine a coffee filter. Water only passes through connected wet spots. At exactly the right density — snap — it suddenly flows all the way across. Same math describes forest fires, epidemics, internet resilience.`,
    prompt: `Build site percolation: [N×N] grid, probability p controlled by MTZ. Color clusters by size. Show spanning cluster highlighted. Animate p increasing through critical threshold p_c≈0.593.` },

  { id: 41, name: 'DLA Branching', bucket: 'B3', color: '#ccff44',
    sci: `Diffusion-limited aggregation: random walkers stick on contact with growing cluster. Produces fractal branching with dimension ~1.71. Same process creates lightning, snowflakes, mineral dendrites, neuron branching, and coral growth.`,
    sim: `Release particles that drift randomly until they touch the growing cluster and stick. The result looks like lightning, snowflakes, coral, and neurons — because it IS the same process. The universe uses one recipe for all branching things.`,
    prompt: `Build DLA: [N] random walkers, sticking radius [R]. Color by arrival time and branch level. MTZ releases [M] walkers simultaneously. Show fractal dimension calculation live. Bass pulses new walker releases.` },

  { id: 42, name: 'Van der Pol', bucket: 'B3', color: '#ff9944',
    sci: `Van der Pol nonlinear oscillator: ẍ-μ(1-x²)ẋ+x=0. Self-sustaining oscillations with amplitude-dependent damping. Limit cycle attracts all nearby trajectories. Used to model heart rhythms and neural firing patterns.`,
    sim: `An oscillator that self-corrects — if it swings too little it adds energy, if it swings too much it removes energy. Your heart uses this exact math to keep a steady beat. The oval shape it draws is where it always ends up.`,
    prompt: `Build van der Pol oscillator: μ=[1-5] controls nonlinearity. Show phase portrait limit cycle. Color by velocity. MTZ increases μ making oscillation more relaxation-type. Animate trajectory convergence.` }
]
