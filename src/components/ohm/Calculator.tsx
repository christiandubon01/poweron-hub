// @ts-nocheck
/**
 * Calculator — Electrical calculations UI with three tabs: Wire Sizing, Conduit Fill, Load Demand.
 *
 * Features:
 * - Tab-based UI for different calculation types
 * - Input validation and real-time calculations
 * - Dark-themed interface with emerald accents
 * - NEC references and notes in results
 * - Detailed derating factors and safety warnings
 */

import { useState } from 'react'
import { Calculator as CalculatorIcon, Loader2, AlertTriangle, CheckCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { processOhmRequest } from '@/agents/ohm'
import { useAuth } from '@/hooks/useAuth'
import type {
  WireSizeResult,
  ConduitFillResult,
  LoadDemandResult,
} from '@/agents/ohm/calculators'

// ── Types ────────────────────────────────────────────────────────────────────

type CalculationType = 'wire_size' | 'conduit_fill' | 'load_demand'

interface CalculatorResult {
  type: CalculationType
  data: WireSizeResult | ConduitFillResult | LoadDemandResult
  timestamp: string
}

// ── Component ────────────────────────────────────────────────────────────────

export function Calculator() {
  const { user, org } = useAuth()
  const [activeTab, setActiveTab] = useState<CalculationType>('wire_size')
  const [result, setResult] = useState<CalculatorResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ── Wire Size Calculator ────────────────────────────────────────────────

  const [wireSize, setWireSize] = useState({
    amperage: '100',
    voltage: '240',
    distance: '50',
    conductorType: 'copper' as const,
    installationMethod: 'conduit' as const,
    ambientTemp: '86',
  })

  const handleWireSizeCalc = async () => {
    if (!user || !org) return

    setLoading(true)
    setError('')

    try {
      const response = await processOhmRequest({
        action: 'calculate',
        orgId: org.id,
        userId: user.id,
        payload: {
          type: 'wire_size',
          amperage: parseFloat(wireSize.amperage),
          voltage: parseFloat(wireSize.voltage),
          distance: parseFloat(wireSize.distance),
          conductorType: wireSize.conductorType,
          installationMethod: wireSize.installationMethod,
          ambientTemp: parseFloat(wireSize.ambientTemp),
        },
      })

      if (!response.success) {
        throw new Error(response.error || 'Calculation failed')
      }

      setResult({
        type: 'wire_size',
        data: response.data as WireSizeResult,
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Wire size calculation failed'
      setError(message)
      console.error('[Calculator] Wire size error:', err)
    } finally {
      setLoading(false)
    }
  }

  // ── Conduit Fill Calculator ─────────────────────────────────────────────

  const [conduitFill, setConduitFill] = useState({
    conductors: [{ gauge: '12', type: 'THHN' }],
    conduitType: 'PVC',
    conduitSize: '3/4',
    conductorInput: '12,10,10',
  })

  const handleConduitFillCalc = async () => {
    if (!user || !org) return

    setLoading(true)
    setError('')

    try {
      // Parse conductor input (comma-separated gauges)
      const gauges = conduitFill.conductorInput.split(',').map(g => g.trim())
      const conductors = gauges.map(gauge => ({
        gauge,
        type: 'THHN',
      }))

      const response = await processOhmRequest({
        action: 'calculate',
        orgId: org.id,
        userId: user.id,
        payload: {
          type: 'conduit_fill',
          conductors,
          conduitType: conduitFill.conduitType,
          conduitSize: conduitFill.conduitSize,
        },
      })

      if (!response.success) {
        throw new Error(response.error || 'Calculation failed')
      }

      setResult({
        type: 'conduit_fill',
        data: response.data as ConduitFillResult,
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Conduit fill calculation failed'
      setError(message)
      console.error('[Calculator] Conduit fill error:', err)
    } finally {
      setLoading(false)
    }
  }

  // ── Load Demand Calculator ──────────────────────────────────────────────

  const [loadDemand, setLoadDemand] = useState({
    lighting: '3000',
    motors: '5000',
    heating: '10000',
    serviceSize: '200',
    voltage: '240',
  })

  const handleLoadDemandCalc = async () => {
    if (!user || !org) return

    setLoading(true)
    setError('')

    try {
      const circuits = [
        {
          type: 'lighting',
          watts: parseFloat(loadDemand.lighting),
          continuous: false,
        },
        {
          type: 'motor',
          watts: parseFloat(loadDemand.motors),
          continuous: false,
        },
        {
          type: 'heating',
          watts: parseFloat(loadDemand.heating),
          continuous: true,
        },
      ].filter(c => c.watts > 0)

      const response = await processOhmRequest({
        action: 'calculate',
        orgId: org.id,
        userId: user.id,
        payload: {
          type: 'load_demand',
          circuits,
          serviceSize: parseFloat(loadDemand.serviceSize),
          voltage: parseFloat(loadDemand.voltage),
        },
      })

      if (!response.success) {
        throw new Error(response.error || 'Calculation failed')
      }

      setResult({
        type: 'load_demand',
        data: response.data as LoadDemandResult,
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Load demand calculation failed'
      setError(message)
      console.error('[Calculator] Load demand error:', err)
    } finally {
      setLoading(false)
    }
  }

  // ── Render Wire Size Tab ────────────────────────────────────────────────

  const renderWireSizeTab = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Amperage (A)</label>
          <input
            type="number"
            value={wireSize.amperage}
            onChange={e => setWireSize({ ...wireSize, amperage: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded
              text-gray-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Voltage (V)</label>
          <input
            type="number"
            value={wireSize.voltage}
            onChange={e => setWireSize({ ...wireSize, voltage: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded
              text-gray-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Distance (ft)</label>
          <input
            type="number"
            value={wireSize.distance}
            onChange={e => setWireSize({ ...wireSize, distance: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded
              text-gray-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Ambient Temp (°F)</label>
          <input
            type="number"
            value={wireSize.ambientTemp}
            onChange={e => setWireSize({ ...wireSize, ambientTemp: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded
              text-gray-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Conductor</label>
          <select
            value={wireSize.conductorType}
            onChange={e => setWireSize({ ...wireSize, conductorType: e.target.value as any })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded
              text-gray-100 focus:border-emerald-500 focus:outline-none"
          >
            <option value="copper">Copper</option>
            <option value="aluminum">Aluminum</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Installation</label>
          <select
            value={wireSize.installationMethod}
            onChange={e => setWireSize({ ...wireSize, installationMethod: e.target.value as any })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded
              text-gray-100 focus:border-emerald-500 focus:outline-none"
          >
            <option value="conduit">Conduit</option>
            <option value="free_air">Free Air</option>
            <option value="buried">Buried</option>
            <option value="cable_tray">Cable Tray</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleWireSizeCalc}
        disabled={loading}
        className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50
          text-white font-semibold rounded transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <CalculatorIcon size={16} />}
        Calculate Wire Size
      </button>
    </div>
  )

  // ── Render Conduit Fill Tab ─────────────────────────────────────────────

  const renderConduitFillTab = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-gray-300 mb-1">
          Conductor Gauges (comma-separated)
        </label>
        <input
          type="text"
          placeholder="e.g., 12,10,10"
          value={conduitFill.conductorInput}
          onChange={e => setConduitFill({ ...conduitFill, conductorInput: e.target.value })}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded
            text-gray-100 focus:border-emerald-500 focus:outline-none"
        />
        <p className="text-xs text-gray-400 mt-1">Enter wire gauges separated by commas</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Conduit Type</label>
          <select
            value={conduitFill.conduitType}
            onChange={e => setConduitFill({ ...conduitFill, conduitType: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded
              text-gray-100 focus:border-emerald-500 focus:outline-none"
          >
            <option value="PVC">PVC</option>
            <option value="RMC">RMC</option>
            <option value="IMC">IMC</option>
            <option value="EMT">EMT</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Conduit Size</label>
          <select
            value={conduitFill.conduitSize}
            onChange={e => setConduitFill({ ...conduitFill, conduitSize: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded
              text-gray-100 focus:border-emerald-500 focus:outline-none"
          >
            <option value="1/2">1/2"</option>
            <option value="3/4">3/4"</option>
            <option value="1">1"</option>
            <option value="1.25">1 1/4"</option>
            <option value="1.5">1 1/2"</option>
            <option value="2">2"</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleConduitFillCalc}
        disabled={loading}
        className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50
          text-white font-semibold rounded transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <CalculatorIcon size={16} />}
        Calculate Fill
      </button>
    </div>
  )

  // ── Render Load Demand Tab ──────────────────────────────────────────────

  const renderLoadDemandTab = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">
            Lighting Load (W)
          </label>
          <input
            type="number"
            value={loadDemand.lighting}
            onChange={e => setLoadDemand({ ...loadDemand, lighting: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded
              text-gray-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Motor Load (W)</label>
          <input
            type="number"
            value={loadDemand.motors}
            onChange={e => setLoadDemand({ ...loadDemand, motors: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded
              text-gray-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">
            Heating Load (W)
          </label>
          <input
            type="number"
            value={loadDemand.heating}
            onChange={e => setLoadDemand({ ...loadDemand, heating: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded
              text-gray-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">
            Service Size (A)
          </label>
          <input
            type="number"
            value={loadDemand.serviceSize}
            onChange={e => setLoadDemand({ ...loadDemand, serviceSize: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded
              text-gray-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      <button
        onClick={handleLoadDemandCalc}
        disabled={loading}
        className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50
          text-white font-semibold rounded transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <CalculatorIcon size={16} />}
        Calculate Demand
      </button>
    </div>
  )

  // ── Render Wire Size Result ─────────────────────────────────────────────

  const renderWireSizeResult = (data: WireSizeResult) => (
    <div className="space-y-3">
      <div className="p-3 bg-emerald-900/20 border border-emerald-700/50 rounded">
        <div className="text-sm text-gray-400 mb-1">Recommended Wire Gauge</div>
        <div className="text-2xl font-bold text-emerald-300">{data.recommendedGauge} AWG</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-gray-800/50 border border-gray-700 rounded">
          <div className="text-xs text-gray-400 mb-1">Ampacity</div>
          <div className="text-lg font-semibold text-cyan-300">{data.adjustedAmpacity} A</div>
        </div>
        <div className="p-3 bg-gray-800/50 border border-gray-700 rounded">
          <div className="text-xs text-gray-400 mb-1">Voltage Drop</div>
          <div
            className={clsx('text-lg font-semibold', data.voltageLimitExceeded
              ? 'text-red-400'
              : 'text-cyan-300')}
          >
            {data.voltageDropPercent}%
          </div>
        </div>
      </div>

      {data.voltageLimitExceeded && (
        <div className="p-3 bg-red-900/20 border border-red-700/50 rounded
          flex items-start gap-2 text-red-200 text-sm">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>Voltage drop exceeds 5% limit. Consider larger conductor.</span>
        </div>
      )}

      <div className="p-3 bg-gray-800/30 rounded text-xs">
        <div className="font-semibold text-gray-300 mb-2">Derating Factors</div>
        <div className="grid grid-cols-2 gap-2 text-gray-400">
          <div>Temperature: {(data.deratingFactors.temperature * 100).toFixed(0)}%</div>
          <div>Bundling: {(data.deratingFactors.bundling * 100).toFixed(0)}%</div>
          <div>Combined: {(data.deratingFactors.combined * 100).toFixed(0)}%</div>
        </div>
      </div>

      <div className="p-2 bg-cyan-900/20 rounded text-xs text-cyan-300">
        <strong>Reference:</strong> {data.necReference}
      </div>

      {data.notes.length > 0 && (
        <div className="space-y-1">
          {data.notes.map((note, idx) => (
            <p key={idx} className="text-xs text-amber-200">• {note}</p>
          ))}
        </div>
      )}
    </div>
  )

  // ── Render Conduit Fill Result ──────────────────────────────────────────

  const renderConduitFillResult = (data: ConduitFillResult) => (
    <div className="space-y-3">
      <div
        className={clsx(
          'p-3 rounded border',
          data.pass
            ? 'bg-emerald-900/20 border-emerald-700/50'
            : 'bg-red-900/20 border-red-700/50'
        )}
      >
        <div className="flex items-center gap-2 mb-1">
          {data.pass ? (
            <CheckCircle size={16} className="text-emerald-400" />
          ) : (
            <AlertTriangle size={16} className="text-red-400" />
          )}
          <div className="text-sm text-gray-400">Fill Percentage</div>
        </div>
        <div className={clsx('text-2xl font-bold', data.pass ? 'text-emerald-300' : 'text-red-300')}>
          {data.fillPercentage}% (Max {data.maxAllowed}%)
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-gray-800/50 border border-gray-700 rounded">
          <div className="text-xs text-gray-400 mb-1">Conductor Area</div>
          <div className="text-lg font-semibold text-cyan-300">{data.conductorArea} in²</div>
        </div>
        <div className="p-3 bg-gray-800/50 border border-gray-700 rounded">
          <div className="text-xs text-gray-400 mb-1">Conduit Area</div>
          <div className="text-lg font-semibold text-cyan-300">{data.conduitArea} in²</div>
        </div>
      </div>

      <div className="p-2 bg-cyan-900/20 rounded text-xs text-cyan-300">
        <strong>Reference:</strong> {data.necReference}
      </div>

      {data.notes.length > 0 && (
        <div className="space-y-1">
          {data.notes.map((note, idx) => (
            <p key={idx} className="text-xs text-amber-200">• {note}</p>
          ))}
        </div>
      )}
    </div>
  )

  // ── Render Load Demand Result ───────────────────────────────────────────

  const renderLoadDemandResult = (data: LoadDemandResult) => (
    <div className="space-y-3">
      <div
        className={clsx(
          'p-3 rounded border',
          data.adequate
            ? 'bg-emerald-900/20 border-emerald-700/50'
            : 'bg-red-900/20 border-red-700/50'
        )}
      >
        <div className="flex items-center gap-2 mb-1">
          {data.adequate ? (
            <CheckCircle size={16} className="text-emerald-400" />
          ) : (
            <AlertTriangle size={16} className="text-red-400" />
          )}
          <div className="text-sm text-gray-400">Service Utilization</div>
        </div>
        <div className={clsx('text-2xl font-bold', data.adequate ? 'text-emerald-300' : 'text-red-300')}>
          {data.capacityPercent}%
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="p-3 bg-gray-800/50 border border-gray-700 rounded">
          <div className="text-xs text-gray-400 mb-1">Connected</div>
          <div className="text-sm font-semibold text-cyan-300">{data.totalConnectedLoad} W</div>
        </div>
        <div className="p-3 bg-gray-800/50 border border-gray-700 rounded">
          <div className="text-xs text-gray-400 mb-1">Demand</div>
          <div className="text-sm font-semibold text-cyan-300">{data.calculatedDemand} W</div>
        </div>
        <div className="p-3 bg-gray-800/50 border border-gray-700 rounded">
          <div className="text-xs text-gray-400 mb-1">Demand Factor</div>
          <div className="text-sm font-semibold text-cyan-300">{data.demandFactor}</div>
        </div>
      </div>

      {data.demandFactorsApplied.length > 0 && (
        <div className="p-3 bg-gray-800/30 rounded text-xs">
          <div className="font-semibold text-gray-300 mb-2">Demand Factors Applied</div>
          <ul className="space-y-1 text-gray-400">
            {data.demandFactorsApplied.map((factor, idx) => (
              <li key={idx}>• {factor}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="p-2 bg-cyan-900/20 rounded text-xs text-cyan-300">
        <strong>Reference:</strong> {data.necReference}
      </div>

      {data.notes.length > 0 && (
        <div className="space-y-1">
          {data.notes.map((note, idx) => (
            <p key={idx} className="text-xs text-amber-200">• {note}</p>
          ))}
        </div>
      )}
    </div>
  )

  // ── Main Render ──────────────────────────────────────────────────────────

  return (
    <div className="h-full bg-gray-900 text-gray-100 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-400">
          <CalculatorIcon size={20} />
          Electrical Calculator
        </h2>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 px-4 gap-2">
        {(['wire_size', 'conduit_fill', 'load_demand'] as CalculationType[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              'px-3 py-2 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            )}
          >
            {tab === 'wire_size' && 'Wire Sizing'}
            {tab === 'conduit_fill' && 'Conduit Fill'}
            {tab === 'load_demand' && 'Load Demand'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="mb-4 p-3 bg-red-900/20 border border-red-700 rounded
            flex items-start gap-3 text-red-200 text-sm">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <div>{error}</div>
          </div>
        )}

        {/* Input Section */}
        <div className="mb-6 p-4 bg-gray-800/30 border border-gray-700 rounded">
          {activeTab === 'wire_size' && renderWireSizeTab()}
          {activeTab === 'conduit_fill' && renderConduitFillTab()}
          {activeTab === 'load_demand' && renderLoadDemandTab()}
        </div>

        {/* Result Section */}
        {result && result.type === activeTab && (
          <div className="p-4 bg-gray-800/30 border border-gray-700 rounded">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">Result</h3>
            {activeTab === 'wire_size' && renderWireSizeResult(result.data as WireSizeResult)}
            {activeTab === 'conduit_fill' && renderConduitFillResult(result.data as ConduitFillResult)}
            {activeTab === 'load_demand' && renderLoadDemandResult(result.data as LoadDemandResult)}
          </div>
        )}
      </div>
    </div>
  )
}
