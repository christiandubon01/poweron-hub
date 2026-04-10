import React, { useState, useEffect } from 'react';
import { TrendingUp, Battery, AlertCircle } from 'lucide-react';

export interface SolarCalculatorProps {
  monthlyBill?: number;
  roofType?: string;
  utilityProvider?: string;
  interestedInBattery?: boolean;
  onCalculate?: (results: SolarCalculationResults) => void;
}

export interface SolarCalculationResults {
  estimatedSystemSizeKw: number;
  itcCredit: number;
  sgipEligible: boolean;
  nem30Explanation: string;
  estimatedSavingsMin: number;
  estimatedSavingsMax: number;
  paybackPeriodYears: number;
  monthlyProduction: number;
}

export function SolarCalculator({
  monthlyBill = 0,
  roofType = '',
  utilityProvider = '',
  interestedInBattery = false,
  onCalculate,
}: SolarCalculatorProps) {
  const [results, setResults] = useState<SolarCalculationResults | null>(null);

  useEffect(() => {
    if (monthlyBill && monthlyBill > 0) {
      calculateEstimates();
    }
  }, [monthlyBill, roofType]);

  const calculateEstimates = () => {
    if (!monthlyBill || monthlyBill <= 0) {
      setResults(null);
      return;
    }

    // Conservative estimate: California average residential is ~$0.15-0.22/kWh
    // Based on monthly bill, estimate monthly consumption
    const estimatedMonthlyKwh = monthlyBill / 0.18; // Using $0.18/kWh average
    const estimatedSystemKw = estimatedMonthlyKwh / 5; // Systems typically produce ~5 kWh/day/kW in California

    // ITC (Investment Tax Credit) = 30% through 2032
    const itcCredit = estimatedSystemKw * 3000 * 0.30; // Rough $3000/kW cost estimate

    // SGIP (Self-Generation Incentive Program) eligibility
    // In CA, residential solar + battery is eligible
    const sgipEligible =
      interestedInBattery && (utilityProvider === 'PG&E' || utilityProvider === 'SDGE' || utilityProvider === '');

    // Estimate annual production
    const annualProduction = estimatedSystemKw * 365 * 5; // 5 kWh/day/kW
    const monthlyProduction = annualProduction / 12;

    // Annual savings (conservative: offset 70-85% of bill depending on battery)
    const offsetPercentage = interestedInBattery ? 0.85 : 0.75;
    const annualSavings = monthlyBill * 12 * offsetPercentage;

    // System cost estimate: $2.50-$3.50/watt after incentives
    const systemCostBeforeIncentives = estimatedSystemKw * 1000 * 3.0;
    const systemCostAfterItc = systemCostBeforeIncentives - itcCredit;
    const batteryAdder = interestedInBattery ? 10000 : 0;
    const totalCost = systemCostAfterItc + batteryAdder;

    // Payback period in years
    const paybackPeriod = totalCost / annualSavings;

    // Savings range based on inflation and rate changes
    const estimatedSavingsMin = annualSavings * 25; // 25-year lifespan minimum
    const estimatedSavingsMax = annualSavings * 30; // 30-year lifespan with rate increases

    const nem30Text =
      utilityProvider === 'PG&E'
        ? "PG&E NEM 3.0: You'll receive credit for excess power at a lower rate. Consider battery backup for maximum savings."
        : utilityProvider === 'SDGE'
          ? 'SDGE Rate Structure: Time-of-use rates mean solar production during peak hours provides maximum value.'
          : "Your utility likely has favorable solar interconnection policies. We'll optimize your design for your specific rate structure.";

    const calculatedResults: SolarCalculationResults = {
      estimatedSystemSizeKw: parseFloat(estimatedSystemKw.toFixed(1)),
      itcCredit: Math.round(itcCredit),
      sgipEligible,
      nem30Explanation: nem30Text,
      estimatedSavingsMin: Math.round(estimatedSavingsMin),
      estimatedSavingsMax: Math.round(estimatedSavingsMax),
      paybackPeriodYears: parseFloat(paybackPeriod.toFixed(1)),
      monthlyProduction: Math.round(monthlyProduction),
    };

    setResults(calculatedResults);
    onCalculate?.(calculatedResults);
  };

  if (!results) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <p className="text-gray-600">Enter your monthly bill amount above to see solar estimates.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* System Size & Production */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4">
          <p className="text-xs text-gray-600 font-semibold uppercase tracking-wider mb-1">
            Estimated System Size
          </p>
          <p className="text-2xl font-bold text-gray-900">{results.estimatedSystemSizeKw} kW</p>
          <p className="text-xs text-gray-600 mt-1">Based on your usage</p>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4">
          <p className="text-xs text-gray-600 font-semibold uppercase tracking-wider mb-1">
            Monthly Production
          </p>
          <p className="text-2xl font-bold text-gray-900">{results.monthlyProduction.toLocaleString()} kWh</p>
          <p className="text-xs text-gray-600 mt-1">Average output</p>
        </div>
      </div>

      {/* Federal & State Incentives */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <h4 className="font-semibold text-gray-900 mb-3">Federal & State Incentives</h4>
        <div className="space-y-2">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-gray-900">Federal ITC (30%)</p>
              <p className="text-xs text-gray-600">Through 2032</p>
            </div>
            <p className="text-lg font-bold text-gray-900">${results.itcCredit.toLocaleString()}</p>
          </div>

          {results.sgipEligible && (
            <div className="border-t border-amber-200 pt-2">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-gray-900">SGIP Eligibility</p>
                  <p className="text-xs text-gray-600">Self-Generation Incentive Program (with battery)</p>
                </div>
                <span className="inline-block px-2 py-1 bg-green-200 text-green-800 text-xs font-semibold rounded">
                  Eligible
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Savings Estimate */}
      <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4">
        <div className="flex items-start gap-2 mb-3">
          <TrendingUp className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-gray-900">Estimated Lifetime Savings</h4>
            <p className="text-xs text-gray-600">Over 25-30 year system lifespan</p>
          </div>
        </div>

        <div className="bg-white rounded border border-green-100 p-3">
          <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Range</p>
          <p className="text-xl font-bold text-gray-900">
            ${results.estimatedSavingsMin.toLocaleString()} - ${results.estimatedSavingsMax.toLocaleString()}
          </p>
          <p className="text-xs text-gray-600 mt-2">
            Payback period: <span className="font-semibold">{results.paybackPeriodYears} years</span>
          </p>
        </div>
      </div>

      {/* Utility Rate Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-gray-900 mb-2">Your Utility Rate Structure</p>
            <p className="text-sm text-gray-700">{results.nem30Explanation}</p>
          </div>
        </div>
      </div>

      {/* Educational Content - What to Ask */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="font-semibold text-gray-900 mb-3">What to Ask Any Solar Contractor</h4>
        <ul className="space-y-2 text-sm">
          <li className="flex gap-2">
            <span className="text-blue-600 font-bold flex-shrink-0">✓</span>
            <span className="text-gray-700">
              <strong>Warranties:</strong> What's covered? (20-25 year panel + 10 year workmanship standard)
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-600 font-bold flex-shrink-0">✓</span>
            <span className="text-gray-700">
              <strong>Permits & Interconnection:</strong> Will you pull permits and handle utility approval?
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-600 font-bold flex-shrink-0">✓</span>
            <span className="text-gray-700">
              <strong>License & Insurance:</strong> Show me your California C-46 license and general liability
              insurance
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-600 font-bold flex-shrink-0">✓</span>
            <span className="text-gray-700">
              <strong>Monitoring:</strong> Do I get real-time production monitoring and app access?
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-600 font-bold flex-shrink-0">✓</span>
            <span className="text-gray-700">
              <strong>Microinverters vs String Inverters:</strong> Why this design for my roof/shading?
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-606 font-bold flex-shrink-0">✓</span>
            <span className="text-gray-700">
              <strong>References:</strong> Can you provide local customer references from the last 12 months?
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-606 font-bold flex-shrink-0">✓</span>
            <span className="text-gray-700">
              <strong>Timeline:</strong> From contract to grid connection, how long will this take?
            </span>
          </li>
        </ul>
      </div>

      {/* Educational Footer */}
      <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3">
        <p>
          <strong>Disclaimer:</strong> These estimates are for informational purposes only and are based on typical
          California residential rates and conditions. Actual costs and savings will vary based on your specific
          location, roof condition, shading, system design, and utility rate changes. Get quotes from at least 3 licensed
          contractors and compare warranties, not just price.
        </p>
      </div>
    </div>
  );
}

export default SolarCalculator;
