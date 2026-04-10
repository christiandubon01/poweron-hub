import React, { useState, useEffect } from 'react';
import { Sun, TrendingDown } from 'lucide-react';

interface SolarCalculatorProps {
  onDataChange: (data: {
    roofType?: string;
    utilityProvider?: string;
    monthlyBill?: number;
    batteryInterest?: boolean;
  }) => void;
}

export function SolarCalculator({ onDataChange }: SolarCalculatorProps) {
  const [monthlyBill, setMonthlyBill] = useState<number>(150);
  const [roofType, setRoofType] = useState<string>('asphalt-shingle');
  const [utilityProvider, setUtilityProvider] = useState<string>('');
  const [batteryInterest, setBatteryInterest] = useState<boolean>(false);

  useEffect(() => {
    onDataChange({
      roofType,
      utilityProvider,
      monthlyBill,
      batteryInterest,
    });
  }, [monthlyBill, roofType, utilityProvider, batteryInterest, onDataChange]);

  // Solar estimation logic
  const estimatedSystemSize = Math.ceil(monthlyBill / 100 * 6); // Rough estimate: 6kW per $600/month
  const itcCredit = estimatedSystemSize * 8000 * 0.30; // 30% ITC on $8k/kW
  const paybackPeriod = estimatedSystemSize > 0 ? 8 : 0; // Typical 8-year payback
  const estimatedSavings = monthlyBill * 0.80; // ~80% of electric bill

  return (
    <div className="space-y-6 bg-gradient-to-br from-amber-50 to-yellow-50 p-6 rounded-lg border border-amber-200">
      <div className="flex items-center gap-2 mb-4">
        <Sun className="w-6 h-6 text-amber-600" />
        <h3 className="text-xl font-bold text-slate-900">Solar Feasibility Assessment</h3>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-900 mb-2">
          Average Monthly Electric Bill *
        </label>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="50"
            max="500"
            value={monthlyBill}
            onChange={(e) => setMonthlyBill(Number(e.target.value))}
            className="flex-1 h-2 bg-amber-200 rounded-lg appearance-none cursor-pointer"
          />
          <div className="text-2xl font-bold text-amber-600 min-w-20">${monthlyBill}</div>
        </div>
        <p className="text-xs text-slate-600 mt-2">Adjust the slider to match your typical monthly bill</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-900 mb-2">Roof Type *</label>
        <select
          value={roofType}
          onChange={(e) => setRoofType(e.target.value)}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
        >
          <option value="asphalt-shingle">Asphalt Shingle</option>
          <option value="metal">Metal</option>
          <option value="tile">Tile</option>
          <option value="flat-tar">Flat (Tar/Built-up)</option>
          <option value="slate">Slate</option>
          <option value="clay-tile">Clay Tile</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-900 mb-2">Utility Provider</label>
        <select
          value={utilityProvider}
          onChange={(e) => setUtilityProvider(e.target.value)}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
        >
          <option value="">Select your provider...</option>
          <option value="pge">Pacific Gas & Electric (PG&E)</option>
          <option value="socal">Southern California Edison</option>
          <option value="sdge">San Diego Gas & Electric</option>
          <option value="other">Other California Utility</option>
          <option value="out-of-state">Out of State</option>
        </select>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <input
          type="checkbox"
          id="battery"
          checked={batteryInterest}
          onChange={(e) => setBatteryInterest(e.target.checked)}
          className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
        />
        <label htmlFor="battery" className="text-sm font-medium text-slate-900">
          Interested in battery storage backup?
        </label>
      </div>

      {/* Estimated Results */}
      <div className="bg-white rounded-lg p-4 border border-amber-300 mt-6">
        <h4 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
          <TrendingDown className="w-5 h-5 text-green-600" />
          Estimated Solar Benefits
        </h4>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-blue-50 p-3 rounded border border-blue-200">
            <p className="text-xs text-slate-600 font-medium">Est. System Size</p>
            <p className="text-lg font-bold text-blue-600">{estimatedSystemSize} kW</p>
          </div>

          <div className="bg-green-50 p-3 rounded border border-green-200">
            <p className="text-xs text-slate-600 font-medium">Annual Savings</p>
            <p className="text-lg font-bold text-green-600">${(estimatedSavings * 12).toLocaleString()}</p>
          </div>

          <div className="bg-purple-50 p-3 rounded border border-purple-200">
            <p className="text-xs text-slate-600 font-medium">ITC 30% Credit</p>
            <p className="text-lg font-bold text-purple-600">${itcCredit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>

          <div className="bg-amber-50 p-3 rounded border border-amber-200">
            <p className="text-xs text-slate-600 font-medium">Payback Period</p>
            <p className="text-lg font-bold text-amber-600">~{paybackPeriod} years</p>
          </div>
        </div>

        <div className="mt-4 p-3 bg-yellow-50 rounded border border-yellow-200">
          <p className="text-xs font-medium text-slate-900 mb-2">📋 What You Should Know:</p>
          <ul className="text-xs text-slate-700 space-y-1">
            <li>• <strong>NEM 3.0:</strong> California's net metering rules have changed. Ask your contractor about current compensation rates.</li>
            <li>• <strong>SGIP Eligibility:</strong> You may qualify for state storage incentives if interested in batteries.</li>
            <li>• <strong>30% Federal ITC:</strong> Tax credit available through 2032, stepping down 2% per year after.</li>
            <li>• These estimates are preliminary. A licensed installer will provide exact figures after a site survey.</li>
          </ul>
        </div>
      </div>

      {/* Education Section */}
      <div className="bg-white rounded-lg p-4 border border-slate-200 mt-6">
        <h4 className="font-bold text-slate-900 mb-3">Questions to Ask Any Solar Contractor</h4>
        <ul className="text-sm text-slate-700 space-y-2">
          <li className="flex gap-2">
            <span className="font-bold text-amber-600">1.</span>
            <span>Are you licensed in California? (License type and number)</span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-amber-600">2.</span>
            <span>Do you pull permits, or do I need to?</span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-amber-600">3.</span>
            <span>What happens under NEM 3.0? How are exports compensated?</span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-amber-600">4.</span>
            <span>Are equipment and labor warranties separate? For how long?</span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-amber-600">5.</span>
            <span>Can you provide references from completed systems in my area?</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
