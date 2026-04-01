// @ts-nocheck
/**
 * NecTablesPanel — Searchable NEC reference tables for the OHM compliance panel.
 *
 * Session 8 addition: NEC Tables Tab
 *
 * Contains 4 reference sections:
 *   1. Wire Ampacity    — NEC Table 310.16 (Copper + Aluminum)
 *   2. Conduit Fill     — NEC Chapter 9, Table 1 fill percentages
 *   3. Breaker/Wire     — Quick reference 15A–400A circuits
 *   4. Voltage Drop     — Interactive calculator with pass/fail + recommendation
 *
 * All data is static — no network required.
 * Search bar at top filters all three static tables simultaneously.
 * Voltage drop calculator updates in real time.
 */

import { useState, useMemo, useCallback } from 'react'
import {
  Search, Zap, Layers, CircuitBoard, TrendingDown, ChevronDown, ChevronUp,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// NEC DATA — Wire Ampacity Table 310.16 (NEC 2023)
// ─────────────────────────────────────────────────────────────────────────────

interface AmpacityRow {
  size: string        // AWG or kcmil label
  copper60: number | null
  copper75: number | null
  copper90: number | null
  alum60: number | null
  alum75: number | null
  alum90: number | null
  types: string
}

const AMPACITY_ROWS: AmpacityRow[] = [
  // ── Copper only below 8 AWG ──
  { size: '14 AWG',      copper60: 15,  copper75: 20,  copper90: 25,  alum60: null, alum75: null, alum90: null, types: 'TW, UF' },
  { size: '12 AWG',      copper60: 20,  copper75: 25,  copper90: 30,  alum60: 15,   alum75: 20,   alum90: 25,   types: 'TW, UF' },
  { size: '10 AWG',      copper60: 30,  copper75: 35,  copper90: 40,  alum60: 25,   alum75: 30,   alum90: 35,   types: 'TW, UF' },
  { size: '8 AWG',       copper60: 40,  copper75: 50,  copper90: 55,  alum60: 30,   alum75: 40,   alum90: 45,   types: 'RHW, THHW, THW, THWN, XHHW' },
  { size: '6 AWG',       copper60: 55,  copper75: 65,  copper90: 75,  alum60: 40,   alum75: 50,   alum90: 60,   types: 'TW, UF / RHW, THHW, THW, THWN, XHHW' },
  { size: '4 AWG',       copper60: 70,  copper75: 85,  copper90: 95,  alum60: 55,   alum75: 65,   alum90: 75,   types: 'TW, UF / RHW, THHW, THW, THWN, XHHW' },
  { size: '3 AWG',       copper60: 85,  copper75: 100, copper90: 110, alum60: 65,   alum75: 75,   alum90: 85,   types: 'TW, UF / RHW, THHW, THW, THWN, XHHW' },
  { size: '2 AWG',       copper60: 95,  copper75: 115, copper90: 130, alum60: 75,   alum75: 90,   alum90: 100,  types: 'TW, UF / RHW, THHW, THW, THWN, XHHW' },
  { size: '1 AWG',       copper60: 110, copper75: 130, copper90: 150, alum60: 85,   alum75: 100,  alum90: 115,  types: 'TW, UF / RHW, THHW, THW, THWN, XHHW' },
  { size: '1/0 AWG',     copper60: 125, copper75: 150, copper90: 170, alum60: 100,  alum75: 120,  alum90: 135,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '2/0 AWG',     copper60: 145, copper75: 175, copper90: 195, alum60: 115,  alum75: 135,  alum90: 150,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '3/0 AWG',     copper60: 165, copper75: 200, copper90: 225, alum60: 130,  alum75: 155,  alum90: 175,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '4/0 AWG',     copper60: 195, copper75: 230, copper90: 260, alum60: 150,  alum75: 180,  alum90: 205,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '250 kcmil',   copper60: 215, copper75: 255, copper90: 290, alum60: 170,  alum75: 205,  alum90: 230,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '300 kcmil',   copper60: 240, copper75: 285, copper90: 320, alum60: 195,  alum75: 230,  alum90: 260,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '350 kcmil',   copper60: 260, copper75: 310, copper90: 350, alum60: 210,  alum75: 250,  alum90: 280,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '400 kcmil',   copper60: 280, copper75: 335, copper90: 380, alum60: 225,  alum75: 270,  alum90: 305,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '500 kcmil',   copper60: 320, copper75: 380, copper90: 430, alum60: 260,  alum75: 310,  alum90: 350,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '600 kcmil',   copper60: 350, copper75: 420, copper90: 475, alum60: 285,  alum75: 340,  alum90: 385,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '700 kcmil',   copper60: 385, copper75: 460, copper90: 520, alum60: 315,  alum75: 375,  alum90: 425,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '750 kcmil',   copper60: 400, copper75: 475, copper90: 535, alum60: 320,  alum75: 385,  alum90: 435,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '800 kcmil',   copper60: 410, copper75: 490, copper90: 555, alum60: 330,  alum75: 395,  alum90: 445,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '900 kcmil',   copper60: 435, copper75: 520, copper90: 585, alum60: 355,  alum75: 425,  alum90: 480,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '1000 kcmil',  copper60: 455, copper75: 545, copper90: 615, alum60: 375,  alum75: 445,  alum90: 500,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '1250 kcmil',  copper60: 495, copper75: 590, copper90: 665, alum60: 405,  alum75: 485,  alum90: 545,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '1500 kcmil',  copper60: 525, copper75: 625, copper90: 705, alum60: 435,  alum75: 520,  alum90: 585,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '1750 kcmil',  copper60: 545, copper75: 650, copper90: 735, alum60: 455,  alum75: 545,  alum90: 615,  types: 'THHN, THWN-2, XHHW-2' },
  { size: '2000 kcmil',  copper60: 555, copper75: 665, copper90: 750, alum60: 470,  alum75: 560,  alum90: 630,  types: 'THHN, THWN-2, XHHW-2' },
]

// ─────────────────────────────────────────────────────────────────────────────
// NEC DATA — Conduit Fill (NEC Chapter 9, Table 1)
// ─────────────────────────────────────────────────────────────────────────────

interface ConduitFillRow {
  conduitType: string
  tradeSize: string
  internalAreaIn2: number // internal cross-section in²
  max1Wire: number        // max fill area in² for 1 conductor (53%)
  max2Wire: number        // max fill area in² for 2 conductors (31%)
  max3Wire: number        // max fill area in² for 3+ conductors (40%)
}

// Internal areas from NEC Chapter 9, Table 4
const CONDUIT_FILL_ROWS: ConduitFillRow[] = [
  // EMT
  { conduitType: 'EMT', tradeSize: '1/2"',  internalAreaIn2: 0.304,  max1Wire: 0.161, max2Wire: 0.094, max3Wire: 0.122 },
  { conduitType: 'EMT', tradeSize: '3/4"',  internalAreaIn2: 0.533,  max1Wire: 0.283, max2Wire: 0.165, max3Wire: 0.213 },
  { conduitType: 'EMT', tradeSize: '1"',    internalAreaIn2: 0.864,  max1Wire: 0.458, max2Wire: 0.268, max3Wire: 0.346 },
  { conduitType: 'EMT', tradeSize: '1-1/4"',internalAreaIn2: 1.496,  max1Wire: 0.793, max2Wire: 0.464, max3Wire: 0.598 },
  { conduitType: 'EMT', tradeSize: '1-1/2"',internalAreaIn2: 2.036,  max1Wire: 1.079, max2Wire: 0.631, max3Wire: 0.814 },
  { conduitType: 'EMT', tradeSize: '2"',    internalAreaIn2: 3.356,  max1Wire: 1.779, max2Wire: 1.040, max3Wire: 1.342 },
  { conduitType: 'EMT', tradeSize: '2-1/2"',internalAreaIn2: 5.858,  max1Wire: 3.105, max2Wire: 1.816, max3Wire: 2.343 },
  { conduitType: 'EMT', tradeSize: '3"',    internalAreaIn2: 8.846,  max1Wire: 4.688, max2Wire: 2.742, max3Wire: 3.538 },
  { conduitType: 'EMT', tradeSize: '3-1/2"',internalAreaIn2: 11.545, max1Wire: 6.119, max2Wire: 3.579, max3Wire: 4.618 },
  { conduitType: 'EMT', tradeSize: '4"',    internalAreaIn2: 14.753, max1Wire: 7.819, max2Wire: 4.573, max3Wire: 5.901 },
  { conduitType: 'EMT', tradeSize: '6"',    internalAreaIn2: 34.353, max1Wire: 18.207, max2Wire: 10.649, max3Wire: 13.741 },
  // IMC
  { conduitType: 'IMC', tradeSize: '1/2"',  internalAreaIn2: 0.342,  max1Wire: 0.181, max2Wire: 0.106, max3Wire: 0.137 },
  { conduitType: 'IMC', tradeSize: '3/4"',  internalAreaIn2: 0.586,  max1Wire: 0.311, max2Wire: 0.182, max3Wire: 0.235 },
  { conduitType: 'IMC', tradeSize: '1"',    internalAreaIn2: 0.959,  max1Wire: 0.508, max2Wire: 0.297, max3Wire: 0.384 },
  { conduitType: 'IMC', tradeSize: '1-1/4"',internalAreaIn2: 1.647,  max1Wire: 0.873, max2Wire: 0.511, max3Wire: 0.659 },
  { conduitType: 'IMC', tradeSize: '1-1/2"',internalAreaIn2: 2.225,  max1Wire: 1.179, max2Wire: 0.690, max3Wire: 0.890 },
  { conduitType: 'IMC', tradeSize: '2"',    internalAreaIn2: 3.630,  max1Wire: 1.924, max2Wire: 1.125, max3Wire: 1.452 },
  { conduitType: 'IMC', tradeSize: '2-1/2"',internalAreaIn2: 5.135,  max1Wire: 2.722, max2Wire: 1.592, max3Wire: 2.054 },
  { conduitType: 'IMC', tradeSize: '3"',    internalAreaIn2: 7.922,  max1Wire: 4.199, max2Wire: 2.456, max3Wire: 3.169 },
  { conduitType: 'IMC', tradeSize: '3-1/2"',internalAreaIn2: 10.584, max1Wire: 5.610, max2Wire: 3.281, max3Wire: 4.234 },
  { conduitType: 'IMC', tradeSize: '4"',    internalAreaIn2: 13.631, max1Wire: 7.224, max2Wire: 4.226, max3Wire: 5.452 },
  { conduitType: 'IMC', tradeSize: '6"',    internalAreaIn2: 30.857, max1Wire: 16.354, max2Wire: 9.566, max3Wire: 12.343 },
  // RMC (Rigid Metal)
  { conduitType: 'RMC', tradeSize: '1/2"',  internalAreaIn2: 0.314,  max1Wire: 0.166, max2Wire: 0.097, max3Wire: 0.125 },
  { conduitType: 'RMC', tradeSize: '3/4"',  internalAreaIn2: 0.549,  max1Wire: 0.291, max2Wire: 0.170, max3Wire: 0.220 },
  { conduitType: 'RMC', tradeSize: '1"',    internalAreaIn2: 0.887,  max1Wire: 0.470, max2Wire: 0.275, max3Wire: 0.355 },
  { conduitType: 'RMC', tradeSize: '1-1/4"',internalAreaIn2: 1.526,  max1Wire: 0.809, max2Wire: 0.473, max3Wire: 0.610 },
  { conduitType: 'RMC', tradeSize: '1-1/2"',internalAreaIn2: 2.071,  max1Wire: 1.098, max2Wire: 0.642, max3Wire: 0.828 },
  { conduitType: 'RMC', tradeSize: '2"',    internalAreaIn2: 3.408,  max1Wire: 1.806, max2Wire: 1.056, max3Wire: 1.363 },
  { conduitType: 'RMC', tradeSize: '2-1/2"',internalAreaIn2: 4.866,  max1Wire: 2.579, max2Wire: 1.508, max3Wire: 1.946 },
  { conduitType: 'RMC', tradeSize: '3"',    internalAreaIn2: 7.499,  max1Wire: 3.975, max2Wire: 2.325, max3Wire: 3.000 },
  { conduitType: 'RMC', tradeSize: '3-1/2"',internalAreaIn2: 10.010, max1Wire: 5.305, max2Wire: 3.103, max3Wire: 4.004 },
  { conduitType: 'RMC', tradeSize: '4"',    internalAreaIn2: 12.882, max1Wire: 6.827, max2Wire: 3.993, max3Wire: 5.153 },
  { conduitType: 'RMC', tradeSize: '6"',    internalAreaIn2: 29.158, max1Wire: 15.454, max2Wire: 9.039, max3Wire: 11.663 },
]

// ─────────────────────────────────────────────────────────────────────────────
// NEC DATA — Breaker / Wire Quick Reference
// ─────────────────────────────────────────────────────────────────────────────

interface BreakerRow {
  circuitUse: string
  wireSize: string
  breakerSize: string
  maxLoad: string
  notes: string
  category: 'residential' | 'commercial' | 'motor'
}

const BREAKER_ROWS: BreakerRow[] = [
  // Residential
  { circuitUse: 'Lighting / General Residential',  wireSize: '14 AWG Cu', breakerSize: '15A',  maxLoad: '1,440 W',  notes: '80% continuous = 12A', category: 'residential' },
  { circuitUse: 'General Receptacles',              wireSize: '12 AWG Cu', breakerSize: '20A',  maxLoad: '1,920 W',  notes: '80% continuous = 16A', category: 'residential' },
  { circuitUse: 'Kitchen Small Appliance Circuits', wireSize: '12 AWG Cu', breakerSize: '20A',  maxLoad: '1,920 W',  notes: '2 circuits required (NEC 210.11(C)(1))', category: 'residential' },
  { circuitUse: 'Bathroom Circuit',                 wireSize: '12 AWG Cu', breakerSize: '20A',  maxLoad: '1,920 W',  notes: 'GFCI required; can serve multiple bathrooms', category: 'residential' },
  { circuitUse: 'Washer',                           wireSize: '12 AWG Cu', breakerSize: '20A',  maxLoad: '1,920 W',  notes: 'Dedicated circuit recommended', category: 'residential' },
  { circuitUse: 'Dishwasher',                       wireSize: '12 AWG Cu', breakerSize: '20A',  maxLoad: '1,920 W',  notes: 'Dedicated; GFCI per NEC 210.8', category: 'residential' },
  { circuitUse: 'Refrigerator',                     wireSize: '12 AWG Cu', breakerSize: '20A',  maxLoad: '1,920 W',  notes: 'Dedicated circuit recommended', category: 'residential' },
  { circuitUse: 'Microwave',                        wireSize: '12 AWG Cu', breakerSize: '20A',  maxLoad: '1,920 W',  notes: 'Dedicated; verify nameplate', category: 'residential' },
  { circuitUse: 'Garbage Disposal',                 wireSize: '12 AWG Cu', breakerSize: '20A',  maxLoad: '1,920 W',  notes: 'GFCI required per NEC 210.8', category: 'residential' },
  { circuitUse: 'Electric Dryer (240V)',            wireSize: '10 AWG Cu', breakerSize: '30A',  maxLoad: '5,400 W',  notes: '4-wire with neutral; NEMA 14-30R', category: 'residential' },
  { circuitUse: 'Electric Range (240V)',            wireSize: '6 AWG Cu',  breakerSize: '50A',  maxLoad: '12,000 W', notes: '4-wire with neutral; NEMA 14-50R', category: 'residential' },
  { circuitUse: 'Electric Oven/Cooktop (240V)',     wireSize: '8 AWG Cu',  breakerSize: '40A',  maxLoad: '9,600 W',  notes: 'Verify nameplate ampacity', category: 'residential' },
  { circuitUse: 'Electric Water Heater (240V)',     wireSize: '10 AWG Cu', breakerSize: '30A',  maxLoad: '4,500 W',  notes: '125% of continuous load', category: 'residential' },
  { circuitUse: 'Residential A/C (240V, 20A)',      wireSize: '12 AWG Cu', breakerSize: '20A',  maxLoad: '3,840 W',  notes: 'Size per unit nameplate (125% MCA)', category: 'residential' },
  { circuitUse: 'Residential A/C (240V, 30A)',      wireSize: '10 AWG Cu', breakerSize: '30A',  maxLoad: '5,760 W',  notes: 'Size per unit nameplate (125% MCA)', category: 'residential' },
  { circuitUse: 'EV Charger Level 2 (32A)',         wireSize: '8 AWG Cu',  breakerSize: '40A',  maxLoad: '7,680 W',  notes: '125% = 40A breaker; NEC 625.42', category: 'residential' },
  { circuitUse: 'EV Charger Level 2 (48A)',         wireSize: '6 AWG Cu',  breakerSize: '60A',  maxLoad: '11,520 W', notes: '125% = 60A breaker; NEC 625.42', category: 'residential' },
  { circuitUse: 'Subpanel / Feeder (60A)',          wireSize: '6 AWG Cu',  breakerSize: '60A',  maxLoad: '—',        notes: '4-wire feeder (2P, N, G)', category: 'residential' },
  { circuitUse: 'Subpanel / Feeder (100A)',         wireSize: '3 AWG Cu',  breakerSize: '100A', maxLoad: '—',        notes: '4-wire feeder; verify derating', category: 'residential' },
  // Commercial
  { circuitUse: 'Commercial Lighting (20A)',        wireSize: '12 AWG Cu', breakerSize: '20A',  maxLoad: '1,920 W',  notes: '80% = 1,536 W continuous', category: 'commercial' },
  { circuitUse: 'Commercial Receptacle (20A)',      wireSize: '12 AWG Cu', breakerSize: '20A',  maxLoad: '1,920 W',  notes: 'GFCI where required by 210.8(B)', category: 'commercial' },
  { circuitUse: 'Commercial HVAC (60A, 240V)',      wireSize: '6 AWG Cu',  breakerSize: '60A',  maxLoad: '14,400 W', notes: 'Size per nameplate MCA/MOP', category: 'commercial' },
  { circuitUse: 'Service 100A Residential',        wireSize: '4 AWG Cu',  breakerSize: '100A', maxLoad: '—',        notes: 'Min 3-wire service entrance', category: 'commercial' },
  { circuitUse: 'Service 200A Residential',        wireSize: '2/0 AWG Cu',breakerSize: '200A', maxLoad: '—',        notes: 'Standard modern service', category: 'commercial' },
  { circuitUse: 'Service 400A Commercial',         wireSize: '3/0 AWG Al',breakerSize: '400A', maxLoad: '—',        notes: 'Aluminum common for service entrance', category: 'commercial' },
  { circuitUse: 'Feeder 200A',                     wireSize: '3/0 AWG Cu',breakerSize: '200A', maxLoad: '—',        notes: 'Copper feeder; verify conduit derating', category: 'commercial' },
  { circuitUse: 'Feeder 400A',                     wireSize: '600 kcmil Cu',breakerSize: '400A',maxLoad: '—',       notes: 'Or parallel conductors', category: 'commercial' },
  // Motor
  { circuitUse: '1/2 HP Motor (120V)',             wireSize: '14 AWG Cu', breakerSize: '15A',  maxLoad: '580 W',    notes: 'FLA ≈ 4.9A; 125% = 6.1A wire; breaker = 250% FLA max', category: 'motor' },
  { circuitUse: '1 HP Motor (120V)',               wireSize: '14 AWG Cu', breakerSize: '15A',  maxLoad: '960 W',    notes: 'FLA ≈ 8A; 125% = 10A wire; breaker = 250% FLA max', category: 'motor' },
  { circuitUse: '2 HP Motor (240V)',               wireSize: '14 AWG Cu', breakerSize: '15A',  maxLoad: '1,700 W',  notes: 'FLA ≈ 6.8A (240V); wire = 125% FLA', category: 'motor' },
  { circuitUse: '5 HP Motor (240V)',               wireSize: '10 AWG Cu', breakerSize: '30A',  maxLoad: '4,200 W',  notes: 'FLA ≈ 15.2A; 125% = 19A; breaker 250%', category: 'motor' },
  { circuitUse: '10 HP Motor (240V)',              wireSize: '8 AWG Cu',  breakerSize: '60A',  maxLoad: '8,400 W',  notes: 'FLA ≈ 28A (240V single phase)', category: 'motor' },
  { circuitUse: '10 HP Motor (480V, 3Ø)',          wireSize: '12 AWG Cu', breakerSize: '20A',  maxLoad: '8,400 W',  notes: 'FLA ≈ 14A (480V 3Ø); NEC Table 430.250', category: 'motor' },
  { circuitUse: '25 HP Motor (480V, 3Ø)',          wireSize: '6 AWG Cu',  breakerSize: '60A',  maxLoad: '21,000 W', notes: 'FLA ≈ 34A (480V 3Ø); wire = 125% FLA', category: 'motor' },
  { circuitUse: '50 HP Motor (480V, 3Ø)',          wireSize: '4 AWG Cu',  breakerSize: '100A', maxLoad: '42,000 W', notes: 'FLA ≈ 65A (480V 3Ø); verify nameplate', category: 'motor' },
  { circuitUse: '100 HP Motor (480V, 3Ø)',         wireSize: '1/0 AWG Cu',breakerSize: '200A', maxLoad: '84,000 W', notes: 'FLA ≈ 124A (480V 3Ø); wire = 125% FLA', category: 'motor' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Voltage Drop Calculator Data
// ─────────────────────────────────────────────────────────────────────────────

// Resistance in Ω per 1000 ft at 75°C, copper (NEC Chapter 9, Table 9)
const WIRE_RESISTANCE: Record<string, number> = {
  '14 AWG': 3.140,
  '12 AWG': 1.980,
  '10 AWG': 1.240,
  '8 AWG':  0.778,
  '6 AWG':  0.491,
  '4 AWG':  0.308,
  '3 AWG':  0.245,
  '2 AWG':  0.194,
  '1 AWG':  0.154,
  '1/0 AWG': 0.122,
  '2/0 AWG': 0.0967,
  '3/0 AWG': 0.0766,
  '4/0 AWG': 0.0608,
  '250 kcmil': 0.0515,
  '300 kcmil': 0.0429,
  '350 kcmil': 0.0367,
  '400 kcmil': 0.0321,
  '500 kcmil': 0.0258,
  '600 kcmil': 0.0214,
  '700 kcmil': 0.0184,
  '750 kcmil': 0.0171,
}

const WIRE_SIZES = Object.keys(WIRE_RESISTANCE)

// Recommended upgrade path
const WIRE_SIZE_ORDER = WIRE_SIZES // already smallest to largest

function getNextWireSize(currentSize: string): string | null {
  const idx = WIRE_SIZE_ORDER.indexOf(currentSize)
  if (idx === -1 || idx === WIRE_SIZE_ORDER.length - 1) return null
  return WIRE_SIZE_ORDER[idx + 1]
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Components
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="text-emerald-400">{icon}</div>
      <div>
        <div className="text-sm font-semibold text-gray-100">{title}</div>
        <div className="text-[10px] text-gray-500 uppercase tracking-wide">{subtitle}</div>
      </div>
    </div>
  )
}

function CopyableCell({ value, className = '' }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const handleClick = () => {
    navigator.clipboard?.writeText(value).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <td
      onClick={handleClick}
      title="Click to copy"
      className={`px-2 py-1.5 text-xs cursor-pointer select-none whitespace-nowrap transition-colors
        hover:bg-emerald-500/20 active:bg-emerald-500/40 ${copied ? 'bg-emerald-500/30 text-emerald-300' : ''} ${className}`}
    >
      {copied ? '✓ copied' : value}
    </td>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-Section 1: Wire Ampacity Table
// ─────────────────────────────────────────────────────────────────────────────

function AmpacityTable({ search }: { search: string }) {
  const [showAlum, setShowAlum] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const filtered = useMemo(() => {
    if (!search) return AMPACITY_ROWS
    const q = search.toLowerCase()
    return AMPACITY_ROWS.filter(r =>
      r.size.toLowerCase().includes(q) ||
      r.types.toLowerCase().includes(q) ||
      String(r.copper75).includes(q) ||
      String(r.copper90).includes(q) ||
      (showAlum && r.alum75 !== null && String(r.alum75).includes(q))
    )
  }, [search, showAlum])

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <SectionHeader
          icon={<Zap size={16} />}
          title="Wire Ampacity — NEC Table 310.16"
          subtitle="Conductors in raceway/cable (not more than 3 current-carrying, 30°C ambient)"
        />
        <button
          onClick={() => setCollapsed(v => !v)}
          className="text-gray-500 hover:text-gray-300 transition p-1"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Copper / Aluminum toggle */}
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setShowAlum(false)}
              className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                !showAlum ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              Copper
            </button>
            <button
              onClick={() => setShowAlum(true)}
              className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                showAlum ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              Aluminum / Cu-Clad
            </button>
          </div>

          <div className="overflow-x-auto rounded border border-gray-700">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-800 border-b border-gray-700">
                  <th className="px-2 py-2 text-left text-gray-400 sticky left-0 bg-gray-800 z-10 min-w-[90px]">
                    AWG / kcmil
                  </th>
                  <th className="px-2 py-2 text-center text-yellow-400">60°C (140°F)</th>
                  <th className="px-2 py-2 text-center text-orange-400">75°C (167°F)</th>
                  <th className="px-2 py-2 text-center text-red-400">90°C (194°F)</th>
                  <th className="px-2 py-2 text-left text-gray-500 min-w-[140px]">Wire Types</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const c60 = showAlum ? row.alum60 : row.copper60
                  const c75 = showAlum ? row.alum75 : row.copper75
                  const c90 = showAlum ? row.alum90 : row.copper90
                  const unavail = showAlum && row.alum60 === null
                  return (
                    <tr
                      key={row.size}
                      className={`border-b border-gray-800 ${
                        unavail ? 'opacity-30' : i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-900/60'
                      }`}
                    >
                      <td className="px-2 py-1.5 font-semibold text-gray-200 sticky left-0 bg-inherit z-10">
                        {row.size}
                        {unavail && <span className="text-gray-600 font-normal ml-1">(Cu only)</span>}
                      </td>
                      <CopyableCell value={c60 !== null ? `${c60}A` : '—'} className="text-yellow-300 text-center" />
                      <CopyableCell value={c75 !== null ? `${c75}A` : '—'} className="text-orange-300 text-center font-semibold" />
                      <CopyableCell value={c90 !== null ? `${c90}A` : '—'} className="text-red-300 text-center" />
                      <td className="px-2 py-1.5 text-gray-500 text-[10px]">{row.types}</td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-4 text-center text-gray-600 text-xs">
                      No rows match "{search}"
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-600 mt-1">
            * 75°C column is most common for field use. Click any cell to copy value. Correction factors apply for &gt;3 conductors or ambient &gt;30°C.
          </p>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-Section 2: Conduit Fill Reference Table
// ─────────────────────────────────────────────────────────────────────────────

function ConduitFillTable({ search }: { search: string }) {
  const [collapsed, setCollapsed] = useState(false)
  const [selectedType, setSelectedType] = useState<'all' | 'EMT' | 'IMC' | 'RMC'>('all')

  const filtered = useMemo(() => {
    let rows = CONDUIT_FILL_ROWS
    if (selectedType !== 'all') rows = rows.filter(r => r.conduitType === selectedType)
    if (!search) return rows
    const q = search.toLowerCase()
    return rows.filter(r =>
      r.conduitType.toLowerCase().includes(q) ||
      r.tradeSize.toLowerCase().includes(q) ||
      String(r.internalAreaIn2).includes(q)
    )
  }, [search, selectedType])

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <SectionHeader
          icon={<Layers size={16} />}
          title="Conduit Fill — NEC Chapter 9, Table 1"
          subtitle="Internal areas and maximum fill by conduit type / trade size"
        />
        <button
          onClick={() => setCollapsed(v => !v)}
          className="text-gray-500 hover:text-gray-300 transition p-1"
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Type filter */}
          <div className="flex gap-1.5 mb-2">
            {(['all', 'EMT', 'IMC', 'RMC'] as const).map(t => (
              <button
                key={t}
                onClick={() => setSelectedType(t)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  selectedType === t
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {t === 'all' ? 'All Types' : t}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded border border-gray-700">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-800 border-b border-gray-700">
                  <th className="px-2 py-2 text-left text-gray-400 sticky left-0 bg-gray-800 z-10">Type</th>
                  <th className="px-2 py-2 text-left text-gray-400 min-w-[70px]">Trade Size</th>
                  <th className="px-2 py-2 text-center text-gray-300">Internal in²</th>
                  <th className="px-2 py-2 text-center text-yellow-400">1 Wire (53%)<br /><span className="text-gray-600 font-normal">max in²</span></th>
                  <th className="px-2 py-2 text-center text-orange-400">2 Wire (31%)<br /><span className="text-gray-600 font-normal">max in²</span></th>
                  <th className="px-2 py-2 text-center text-emerald-400">3+ Wire (40%)<br /><span className="text-gray-600 font-normal">max in²</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr
                    key={`${row.conduitType}-${row.tradeSize}`}
                    className={`border-b border-gray-800 ${i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-900/60'}`}
                  >
                    <td className="px-2 py-1.5 font-semibold text-blue-300 sticky left-0 bg-inherit z-10">
                      {row.conduitType}
                    </td>
                    <CopyableCell value={row.tradeSize} className="text-gray-200" />
                    <CopyableCell value={row.internalAreaIn2.toFixed(3)} className="text-gray-300 text-center" />
                    <CopyableCell value={row.max1Wire.toFixed(3)} className="text-yellow-300 text-center" />
                    <CopyableCell value={row.max2Wire.toFixed(3)} className="text-orange-300 text-center" />
                    <CopyableCell value={row.max3Wire.toFixed(3)} className="text-emerald-300 text-center" />
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-4 text-center text-gray-600 text-xs">
                      No rows match "{search}"
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-600 mt-1">
            * Fill percentages per NEC Ch. 9 Table 1. Click any cell to copy value. Nipples ≤24" may be filled to 60%.
          </p>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-Section 3: Breaker / Wire Sizing Quick Reference
// ─────────────────────────────────────────────────────────────────────────────

function BreakerTable({ search }: { search: string }) {
  const [collapsed, setCollapsed] = useState(false)
  const [catFilter, setCatFilter] = useState<'all' | 'residential' | 'commercial' | 'motor'>('all')

  const filtered = useMemo(() => {
    let rows = BREAKER_ROWS
    if (catFilter !== 'all') rows = rows.filter(r => r.category === catFilter)
    if (!search) return rows
    const q = search.toLowerCase()
    return rows.filter(r =>
      r.circuitUse.toLowerCase().includes(q) ||
      r.wireSize.toLowerCase().includes(q) ||
      r.breakerSize.toLowerCase().includes(q) ||
      r.notes.toLowerCase().includes(q)
    )
  }, [search, catFilter])

  const catLabels = { all: 'All', residential: 'Residential', commercial: 'Commercial', motor: 'Motor' }
  const catColors = {
    all: 'bg-gray-700',
    residential: 'bg-emerald-700',
    commercial: 'bg-blue-700',
    motor: 'bg-amber-700',
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <SectionHeader
          icon={<CircuitBoard size={16} />}
          title="Breaker / Wire Sizing Quick Reference"
          subtitle="Common circuits 15A–400A — residential, commercial, motor"
        />
        <button
          onClick={() => setCollapsed(v => !v)}
          className="text-gray-500 hover:text-gray-300 transition p-1"
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Category filter */}
          <div className="flex gap-1.5 mb-2 flex-wrap">
            {(['all', 'residential', 'commercial', 'motor'] as const).map(cat => (
              <button
                key={cat}
                onClick={() => setCatFilter(cat)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  catFilter === cat
                    ? `${catColors[cat]} text-white`
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {catLabels[cat]}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded border border-gray-700">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-800 border-b border-gray-700">
                  <th className="px-2 py-2 text-left text-gray-400 sticky left-0 bg-gray-800 z-10 min-w-[160px]">Circuit Use</th>
                  <th className="px-2 py-2 text-center text-gray-300">Wire Size</th>
                  <th className="px-2 py-2 text-center text-emerald-400">Breaker</th>
                  <th className="px-2 py-2 text-center text-blue-400">Max Load</th>
                  <th className="px-2 py-2 text-left text-gray-500 min-w-[160px]">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr
                    key={row.circuitUse}
                    className={`border-b border-gray-800 ${i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-900/60'}`}
                  >
                    <td className="px-2 py-1.5 text-gray-200 sticky left-0 bg-inherit z-10 font-medium">
                      {row.circuitUse}
                    </td>
                    <CopyableCell value={row.wireSize} className="text-gray-300 text-center" />
                    <CopyableCell value={row.breakerSize} className="text-emerald-300 font-semibold text-center" />
                    <CopyableCell value={row.maxLoad} className="text-blue-300 text-center" />
                    <td className="px-2 py-1.5 text-gray-500 text-[10px]">{row.notes}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-4 text-center text-gray-600 text-xs">
                      No rows match "{search}"
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-600 mt-1">
            * Always verify against nameplate data, NEC 210, 240, 430 and local AHJ requirements. Click any cell to copy.
          </p>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-Section 4: Voltage Drop Calculator
// ─────────────────────────────────────────────────────────────────────────────

function VoltageDropCalculator() {
  const [voltage, setVoltage] = useState<120 | 208 | 240 | 277 | 480>(120)
  const [phase, setPhase] = useState<'1ph' | '3ph'>('1ph')
  const [wireSize, setWireSize] = useState('12 AWG')
  const [distance, setDistance] = useState(50)
  const [load, setLoad] = useState(15)
  const [collapsed, setCollapsed] = useState(false)

  // Enforce 3Ø voltage options
  const handlePhaseChange = useCallback((ph: '1ph' | '3ph') => {
    setPhase(ph)
    if (ph === '3ph' && voltage === 120) setVoltage(208)
    if (ph === '1ph' && voltage === 208) setVoltage(120)
  }, [voltage])

  const result = useMemo(() => {
    const R = WIRE_RESISTANCE[wireSize]
    if (!R || !distance || !load) return null

    // VD = (2 × R × I × D) / 1000 for 1ph
    // VD = (√3 × R × I × D) / 1000 for 3ph
    const multiplier = phase === '1ph' ? 2 : Math.sqrt(3)
    const vdVolts = (multiplier * R * load * distance) / 1000
    const vdPct = (vdVolts / voltage) * 100

    // NEC recommendation: ≤3% branch, ≤5% feeder (combined ≤5%)
    const passBranch = vdPct <= 3
    const passFeeder = vdPct <= 5

    // Find recommended wire size if failing
    let recommendedSize: string | null = null
    if (!passBranch) {
      // Find smallest wire where vd ≤ 3%
      for (const size of WIRE_SIZE_ORDER) {
        const r = WIRE_RESISTANCE[size]
        const vd = (multiplier * r * load * distance) / 1000
        const pct = (vd / voltage) * 100
        if (pct <= 3) {
          recommendedSize = size
          break
        }
      }
    }

    return { vdVolts, vdPct, passBranch, passFeeder, recommendedSize }
  }, [wireSize, distance, load, voltage, phase])

  const voltageOptions = phase === '1ph'
    ? [120, 240, 277] as const
    : [208, 480] as const

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <SectionHeader
          icon={<TrendingDown size={16} />}
          title="Voltage Drop Calculator"
          subtitle="Real-time pass/fail — NEC recommends ≤3% branch, ≤5% feeder"
        />
        <button
          onClick={() => setCollapsed(v => !v)}
          className="text-gray-500 hover:text-gray-300 transition p-1"
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {!collapsed && (
        <div className="border border-gray-700 rounded-lg p-4 bg-gray-900/50">
          {/* Inputs */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {/* Phase toggle */}
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Phase</label>
              <div className="flex gap-1">
                {(['1ph', '3ph'] as const).map(ph => (
                  <button
                    key={ph}
                    onClick={() => handlePhaseChange(ph)}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded transition-colors ${
                      phase === ph
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {ph === '1ph' ? '1Ø' : '3Ø'}
                  </button>
                ))}
              </div>
            </div>

            {/* Voltage */}
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Voltage</label>
              <select
                value={voltage}
                onChange={e => setVoltage(Number(e.target.value) as any)}
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500"
              >
                {voltageOptions.map(v => (
                  <option key={v} value={v}>{v}V</option>
                ))}
              </select>
            </div>

            {/* Wire Size */}
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Wire Size (Copper)</label>
              <select
                value={wireSize}
                onChange={e => setWireSize(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500"
              >
                {WIRE_SIZES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Load (amps) */}
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Load (Amps)</label>
              <input
                type="number"
                value={load}
                min={1}
                max={1000}
                onChange={e => setLoad(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Distance */}
            <div className="col-span-2">
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">
                One-Way Distance (ft)
              </label>
              <input
                type="number"
                value={distance}
                min={1}
                max={10000}
                onChange={e => setDistance(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Results */}
          {result && (
            <div
              className={`rounded-lg p-4 border-2 ${
                result.passBranch
                  ? 'border-emerald-500 bg-emerald-500/10'
                  : result.passFeeder
                  ? 'border-yellow-500 bg-yellow-500/10'
                  : 'border-red-500 bg-red-500/10'
              }`}
            >
              {/* Main badge */}
              <div className="flex items-center gap-2 mb-3">
                <div
                  className={`text-sm font-bold px-3 py-1 rounded-full ${
                    result.passBranch
                      ? 'bg-emerald-500 text-white'
                      : result.passFeeder
                      ? 'bg-yellow-500 text-black'
                      : 'bg-red-500 text-white'
                  }`}
                >
                  {result.passBranch
                    ? '✓ PASS — Branch Circuit OK'
                    : result.passFeeder
                    ? '⚠ CAUTION — Feeder OK, Branch over 3%'
                    : '✗ FAIL — Exceeds 5% limit'}
                </div>
              </div>

              {/* Voltage drop values */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-gray-800/50 rounded p-2 text-center">
                  <div className={`text-2xl font-bold ${result.passBranch ? 'text-emerald-400' : result.passFeeder ? 'text-yellow-400' : 'text-red-400'}`}>
                    {result.vdVolts.toFixed(2)}V
                  </div>
                  <div className="text-[10px] text-gray-500 uppercase">Voltage Drop</div>
                </div>
                <div className="bg-gray-800/50 rounded p-2 text-center">
                  <div className={`text-2xl font-bold ${result.passBranch ? 'text-emerald-400' : result.passFeeder ? 'text-yellow-400' : 'text-red-400'}`}>
                    {result.vdPct.toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-gray-500 uppercase">% Drop</div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mb-3">
                <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                  <span>0%</span>
                  <span className="text-emerald-400">3% branch</span>
                  <span className="text-yellow-400">5% feeder</span>
                  <span>10%+</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2.5 relative">
                  {/* 3% marker */}
                  <div className="absolute top-0 h-2.5 w-px bg-emerald-500" style={{ left: '30%' }} />
                  {/* 5% marker */}
                  <div className="absolute top-0 h-2.5 w-px bg-yellow-500" style={{ left: '50%' }} />
                  <div
                    className={`h-2.5 rounded-full transition-all ${
                      result.passBranch ? 'bg-emerald-500' : result.passFeeder ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${Math.min(100, (result.vdPct / 10) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Recommendation */}
              {result.recommendedSize && (
                <div className="bg-blue-900/30 border border-blue-500/40 rounded p-2 text-xs">
                  <span className="text-blue-300 font-semibold">Recommended wire: </span>
                  <span className="text-white font-bold">{result.recommendedSize}</span>
                  <span className="text-gray-400"> to reduce drop to ≤3%</span>
                </div>
              )}

              {/* Formula note */}
              <div className="text-[10px] text-gray-600 mt-2">
                Formula: VD = {phase === '1ph' ? '(2 × R × I × D)' : '(√3 × R × I × D)'} / 1000
                {' '}| R = {WIRE_RESISTANCE[wireSize]} Ω/1000ft ({wireSize} Cu @ 75°C)
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Panel Export
// ─────────────────────────────────────────────────────────────────────────────

export function NecTablesPanel() {
  const [search, setSearch] = useState('')

  return (
    <div className="flex flex-col h-full">
      {/* Global search bar */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-2.5 text-gray-500 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search all tables — AWG, ampacity, conduit size, circuit type…"
          className="w-full pl-8 pr-3 py-2 text-sm bg-gray-800 border border-gray-700 text-gray-100 rounded
            placeholder-gray-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-2 top-2.5 text-gray-500 hover:text-gray-300 transition"
            title="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {/* Tables — scrollable */}
      <div className="flex-1 overflow-y-auto pr-1">
        <AmpacityTable search={search} />
        <ConduitFillTable search={search} />
        <BreakerTable search={search} />
        <VoltageDropCalculator />
        <div className="pb-6 text-[10px] text-gray-700 text-center">
          NEC 2023 reference data — always verify against current code edition and local AHJ amendments
        </div>
      </div>
    </div>
  )
}
