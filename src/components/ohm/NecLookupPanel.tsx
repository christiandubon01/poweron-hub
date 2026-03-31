// @ts-nocheck
/**
 * NecLookupPanel — Offline-capable NEC code lookup tool.
 *
 * All data is sourced from src/data/necTables.ts — no network required.
 * Works with zero internet connection via service worker cache.
 *
 * Tabs:
 *   1. Conduit Fill   — NEC Chapter 9 Table 1
 *   2. Burial Depth   — NEC 300.5
 *   3. Box Fill       — NEC 314.16
 *   4. Ampacity       — Minimum circuit ampacity by load type
 *   5. GFCI / AFCI   — Protection requirements by room
 */

import { useState } from 'react'
import {
  Zap, Layers, ArrowDownToLine, Box, Gauge, ShieldCheck, WifiOff,
} from 'lucide-react'
import {
  calcConduitFill,
  getBurialDepth,
  calcBoxFill,
  getMinAmpacity,
  getProtectionRequirements,
  CONDUIT_TYPE_LABELS,
  WIRING_METHOD_LABELS,
  LOCATION_TYPE_LABELS,
  LOAD_TYPE_LABELS,
  ROOM_TYPE_LABELS,
  CONDUIT_SIZES,
  WIRE_GAUGES,
  ALL_LOAD_TYPES,
  ALL_ROOM_TYPES,
  type ConduitType,
  type WiringMethod,
  type LocationType,
  type LoadType,
  type RoomType,
} from '@/data/necTables'

// ── Helpers ──────────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">
      {children}
    </label>
  )
}

function Select({
  value, onChange, options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-green-500"
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function NumberInput({ value, onChange, min = 1, max = 999 }: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={e => onChange(Math.max(min, parseInt(e.target.value) || min))}
      className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-green-500"
    />
  )
}

function ResultBox({ pass, children }: { pass?: boolean; children: React.ReactNode }) {
  const color = pass === true ? 'border-green-500 bg-green-500/10' :
                pass === false ? 'border-red-500 bg-red-500/10' :
                'border-blue-500 bg-blue-500/10'
  return (
    <div className={`mt-4 border rounded-lg p-3 text-sm ${color}`}>
      {children}
    </div>
  )
}

// ── 1. Conduit Fill Tab ───────────────────────────────────────────────────────

function ConduitFillTab() {
  const [conduitType, setConduitType] = useState<ConduitType>('EMT')
  const [conduitSize, setConduitSize] = useState('3/4')
  const [wireGauge, setWireGauge] = useState('12')
  const [wireCount, setWireCount] = useState(3)

  const result = calcConduitFill(conduitType, conduitSize, wireGauge, wireCount)

  const conduitTypeOpts = Object.entries(CONDUIT_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))
  const conduitSizeOpts = CONDUIT_SIZES.map(s => ({ value: s, label: `${s}"` }))
  const wireGaugeOpts = WIRE_GAUGES.map(g => ({ value: g, label: `${g} AWG` }))

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-400 mb-2">NEC Chapter 9, Table 1 — Maximum conduit fill percentages</div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Conduit Type</Label>
          <Select value={conduitType} onChange={v => setConduitType(v as ConduitType)} options={conduitTypeOpts} />
        </div>
        <div>
          <Label>Conduit Size</Label>
          <Select value={conduitSize} onChange={setConduitSize} options={conduitSizeOpts} />
        </div>
        <div>
          <Label>Wire Gauge (THHN)</Label>
          <Select value={wireGauge} onChange={setWireGauge} options={wireGaugeOpts} />
        </div>
        <div>
          <Label>Wire Count</Label>
          <NumberInput value={wireCount} onChange={setWireCount} min={1} max={50} />
        </div>
      </div>

      {result.conduitArea > 0 ? (
        <ResultBox pass={result.pass}>
          <div className="font-semibold mb-1">{result.note}</div>
          <div className="text-gray-300 text-xs space-y-0.5 mt-2">
            <div>Conduit internal area: <span className="text-white">{result.conduitArea} in²</span></div>
            <div>Wire area (each): <span className="text-white">{result.wireArea} in²</span></div>
            <div>Total wire area: <span className="text-white">{result.totalFillArea.toFixed(4)} in²</span></div>
            <div>Max allowed area ({result.maxFillPct}%): <span className="text-white">{result.maxFillArea.toFixed(4)} in²</span></div>
          </div>
          <div className="mt-2 w-full bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${result.pass ? 'bg-green-500' : 'bg-red-500'}`}
              style={{ width: `${Math.min(100, result.fillPct / result.maxFillPct * 100)}%` }}
            />
          </div>
          <div className="text-xs text-gray-400 mt-1">{result.fillPct}% fill</div>
        </ResultBox>
      ) : (
        <ResultBox>
          <span className="text-yellow-400">⚠ Size not available for this conduit type</span>
        </ResultBox>
      )}
    </div>
  )
}

// ── 2. Burial Depth Tab ───────────────────────────────────────────────────────

function BurialDepthTab() {
  const [wiringMethod, setWiringMethod] = useState<WiringMethod>('UF-cable')
  const [locationType, setLocationType] = useState<LocationType>('general')

  const result = getBurialDepth(wiringMethod, locationType)

  const methodOpts = Object.entries(WIRING_METHOD_LABELS).map(([v, l]) => ({ value: v, label: l }))
  const locationOpts = Object.entries(LOCATION_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-400 mb-2">NEC 300.5, Table 300.5 — Minimum cover requirements</div>

      <div>
        <Label>Wiring Method</Label>
        <Select value={wiringMethod} onChange={v => setWiringMethod(v as WiringMethod)} options={methodOpts} />
      </div>
      <div>
        <Label>Location Type</Label>
        <Select value={locationType} onChange={v => setLocationType(v as LocationType)} options={locationOpts} />
      </div>

      <ResultBox>
        <div className="flex items-center gap-3">
          <div className="text-3xl font-bold text-green-400">{result.minDepthIn}"</div>
          <div>
            <div className="text-white font-semibold">{result.minDepthFt}</div>
            <div className="text-xs text-gray-400">{result.necRef}</div>
          </div>
        </div>
        <div className="text-xs text-gray-300 mt-2">{result.note}</div>
      </ResultBox>
    </div>
  )
}

// ── 3. Box Fill Tab ───────────────────────────────────────────────────────────

function BoxFillTab() {
  const [boxVol, setBoxVol] = useState(18)
  const [gauge, setGauge] = useState('12')
  const [conductors, setConductors] = useState(4)
  const [grounds, setGrounds] = useState(2)
  const [devices, setDevices] = useState(1)
  const [clamps, setClamps] = useState(0)

  const wireGaugeOpts = ['14', '12', '10', '8', '6'].map(g => ({ value: g, label: `${g} AWG` }))

  const result = calcBoxFill({
    boxVolumeCuIn: boxVol,
    conductorGauge: gauge,
    conductorCount: conductors,
    groundCount: grounds,
    deviceCount: devices,
    internalClampCount: clamps,
  })

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-400 mb-2">NEC 314.16(B) — Box fill calculation</div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Box Volume (in³)</Label>
          <NumberInput value={boxVol} onChange={setBoxVol} min={1} max={200} />
        </div>
        <div>
          <Label>Largest Wire Gauge</Label>
          <Select value={gauge} onChange={setGauge} options={wireGaugeOpts} />
        </div>
        <div>
          <Label>Conductors (all current-carrying)</Label>
          <NumberInput value={conductors} onChange={setConductors} min={0} />
        </div>
        <div>
          <Label>Ground Wires (all count as 1)</Label>
          <NumberInput value={grounds} onChange={setGrounds} min={0} />
        </div>
        <div>
          <Label>Devices / Receptacles</Label>
          <NumberInput value={devices} onChange={setDevices} min={0} />
        </div>
        <div>
          <Label>Internal Clamp Sets</Label>
          <NumberInput value={clamps} onChange={setClamps} min={0} />
        </div>
      </div>

      <ResultBox pass={result.pass}>
        <div className="font-semibold mb-1">
          {result.pass ? '✅ Box size OK' : '❌ Box too small — upgrade required'}
        </div>
        <div className="text-xs text-gray-300 space-y-0.5 mt-2">
          <div>Required volume: <span className="text-white font-bold">{result.requiredVolumeCuIn} in³</span></div>
          <div>Box volume: <span className="text-white">{result.boxVolumeCuIn} in³</span></div>
          {!result.pass && (
            <div className="text-red-400 mt-1">Need at least {result.requiredVolumeCuIn} in³ box</div>
          )}
        </div>
        <pre className="text-xs text-gray-400 mt-2 whitespace-pre-wrap leading-relaxed">{result.breakdown}</pre>
        <div className="text-xs text-gray-500 mt-1">{result.necRef}</div>
      </ResultBox>
    </div>
  )
}

// ── 4. Ampacity Tab ───────────────────────────────────────────────────────────

function AmpacityTab() {
  const [loadType, setLoadType] = useState<LoadType>('general-lighting')

  const result = getMinAmpacity(loadType)

  const loadOpts = ALL_LOAD_TYPES.map(lt => ({
    value: lt,
    label: LOAD_TYPE_LABELS[lt],
  }))

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-400 mb-2">Minimum circuit ampacity and wire gauge by load type</div>

      <div>
        <Label>Load Type</Label>
        <Select value={loadType} onChange={v => setLoadType(v as LoadType)} options={loadOpts} />
      </div>

      <ResultBox>
        <div className="grid grid-cols-3 gap-4 text-center mb-3">
          <div>
            <div className="text-2xl font-bold text-green-400">{result.minAmpacity}A</div>
            <div className="text-[10px] uppercase text-gray-500">Min Ampacity</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-blue-400">{result.recommendedWireGauge}</div>
            <div className="text-[10px] uppercase text-gray-500">Wire Gauge</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-yellow-400">{result.recommendedBreakerSize}A</div>
            <div className="text-[10px] uppercase text-gray-500">Breaker Size</div>
          </div>
        </div>
        <div className="text-xs text-gray-300">{result.note}</div>
        <div className="text-xs text-gray-500 mt-1">{result.necRef}</div>
      </ResultBox>
    </div>
  )
}

// ── 5. GFCI / AFCI Tab ───────────────────────────────────────────────────────

function ProtectionTab() {
  const [roomType, setRoomType] = useState<RoomType>('bathroom')

  const result = getProtectionRequirements(roomType)

  const roomOpts = ALL_ROOM_TYPES.map(rt => ({
    value: rt,
    label: ROOM_TYPE_LABELS[rt],
  }))

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-400 mb-2">NEC 210.8 (GFCI) / 210.12 (AFCI) — Protection requirements</div>

      <div>
        <Label>Room / Location Type</Label>
        <Select value={roomType} onChange={v => setRoomType(v as RoomType)} options={roomOpts} />
      </div>

      <ResultBox pass={result.gfciRequired || result.afciRequired}>
        <div className="flex gap-4 mb-3">
          {/* GFCI */}
          <div className={`flex-1 rounded p-2 text-center ${result.gfciRequired ? 'bg-green-500/20 border border-green-500' : 'bg-gray-700/40 border border-gray-700'}`}>
            <div className={`text-lg font-bold ${result.gfciRequired ? 'text-green-400' : 'text-gray-500'}`}>
              {result.gfciRequired ? '✅ GFCI' : '— GFCI'}
            </div>
            <div className="text-[10px] text-gray-400">{result.gfciRequired ? 'REQUIRED' : 'NOT REQUIRED'}</div>
            {result.gfciRef && <div className="text-[9px] text-gray-500 mt-0.5">{result.gfciRef}</div>}
          </div>

          {/* AFCI */}
          <div className={`flex-1 rounded p-2 text-center ${result.afciRequired ? 'bg-blue-500/20 border border-blue-500' : 'bg-gray-700/40 border border-gray-700'}`}>
            <div className={`text-lg font-bold ${result.afciRequired ? 'text-blue-400' : 'text-gray-500'}`}>
              {result.afciRequired ? '✅ AFCI' : '— AFCI'}
            </div>
            <div className="text-[10px] text-gray-400">{result.afciRequired ? 'REQUIRED' : 'NOT REQUIRED'}</div>
            {result.afciRef && <div className="text-[9px] text-gray-500 mt-0.5">{result.afciRef}</div>}
          </div>
        </div>

        {result.bothRequired && (
          <div className="text-xs text-yellow-400 font-semibold mb-2">
            ⚡ Dual-function AFCI/GFCI breaker recommended
          </div>
        )}

        <div className="text-xs text-gray-300">{result.note}</div>
      </ResultBox>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

type Tab = 'conduit' | 'burial' | 'boxfill' | 'ampacity' | 'protection'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'conduit', label: 'Conduit Fill', icon: <Layers size={13} /> },
  { id: 'burial', label: 'Burial Depth', icon: <ArrowDownToLine size={13} /> },
  { id: 'boxfill', label: 'Box Fill', icon: <Box size={13} /> },
  { id: 'ampacity', label: 'Ampacity', icon: <Gauge size={13} /> },
  { id: 'protection', label: 'GFCI/AFCI', icon: <ShieldCheck size={13} /> },
]

export function NecLookupPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('conduit')

  return (
    <div className="flex flex-col h-full">
      {/* Offline badge */}
      <div className="flex items-center gap-2 px-1 mb-3">
        <WifiOff size={12} className="text-green-400" />
        <span className="text-[10px] text-green-400 font-semibold uppercase tracking-wide">
          Available Offline
        </span>
        <span className="text-[10px] text-gray-500">— NEC 2023 data cached locally</span>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === t.id
                ? 'bg-green-500 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700'
            }`}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'conduit'    && <ConduitFillTab />}
        {activeTab === 'burial'     && <BurialDepthTab />}
        {activeTab === 'boxfill'    && <BoxFillTab />}
        {activeTab === 'ampacity'   && <AmpacityTab />}
        {activeTab === 'protection' && <ProtectionTab />}
      </div>
    </div>
  )
}
