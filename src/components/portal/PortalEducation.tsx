import React, { useState } from 'react';
import { CheckCircle2, AlertCircle, Award, Shield, FileCheck } from 'lucide-react';

export interface ContractorChecklistItem {
  id: string;
  question: string;
  description: string;
  whyMatters: string;
  redFlag: string;
}

export function PortalEducation() {
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  const checklist: ContractorChecklistItem[] = [
    {
      id: 'license',
      question: 'Is the contractor licensed?',
      description:
        'Verify they hold a current California C-10 (Electrical) or C-7 (Low Voltage Specialist) license. Check online at the CSLB website.',
      whyMatters:
        'Licensed contractors are insured, bonded, and held to state standards. They can legally pull permits and sign off on inspections.',
      redFlag:
        'Contractor claims "license is in the mail" or offers cash discount to avoid licensing/permits. Unlicensed work can create liability and safety issues.',
    },
    {
      id: 'insurance',
      question: 'Does the contractor have proof of insurance?',
      description:
        'Ask for a Certificate of Insurance showing General Liability (at least $1M) and Workers Compensation. Verify the certificate is current.',
      whyMatters:
        "If someone is injured on your property or property is damaged, the contractor's insurance (not yours) should cover it. No insurance = you're liable.",
      redFlag:
        "Contractor says \"I don't need insurance\" or can't produce a certificate within 24 hours. Handwritten or expired certificates are not valid.",
    },
    {
      id: 'bonding',
      question: 'Are they bonded?',
      description:
        'A surety bond guarantees the job will be completed to code. Ask for the bond number and verify with the bonding company.',
      whyMatters:
        'If the contractor abandons the job or does shoddy work, the bond protects you by paying for completion or correction by another contractor.',
      redFlag:
        'Contractor has no bond. Bonding typically costs 1-3% of the contract and protects you — contractors without it are taking unnecessary risk.',
    },
    {
      id: 'permits',
      question: 'Will they pull permits and handle inspections?',
      description:
        'Permits are not optional for electrical work. Licensed contractors pull permits, pay fees, and coordinate inspections. This is part of their job.',
      whyMatters:
        'Permitted work is inspected by city/county authorities to ensure it meets NEC code. Unpermitted work can fail inspections, create safety hazards, and sink your home sale.',
      redFlag:
        'Contractor offers to "save money" by skipping permits or says permits are "not needed for this size job." All electrical work typically requires permits.',
    },
    {
      id: 'references',
      question: 'Can they provide recent local references?',
      description:
        'Ask for 3–5 customer references from the past 12 months in your area. Call them directly (not through the contractor) and ask about quality, timeliness, and whether they\'d hire again.',
      whyMatters:
        'References reveal whether the contractor delivers quality work, respects timelines, and stands behind their warranty. Local references show they have staying power in your community.',
      redFlag:
        'Contractor has no references or only gives references from 5+ years ago. Generic 5-star online reviews without details are not substitutes for direct conversations.',
    },
    {
      id: 'warranty',
      question: 'What warranty do they offer?',
      description:
        'Reputable contractors offer at least 1 year workmanship warranty. Some offer 5–10 years. Get it in writing as part of the contract.',
      whyMatters:
        'If something fails shortly after completion due to poor installation (not parts failure), the warranty covers the fix at no cost to you.',
      redFlag:
        "\"No warranty\" or verbal-only warranty. Warranty should be in the written contract with clear start/end dates and what's covered.",
    },
  ];

  const toggleCheck = (id: string) => {
    const newChecked = new Set(checkedItems);
    if (newChecked.has(id)) {
      newChecked.delete(id);
    } else {
      newChecked.add(id);
    }
    setCheckedItems(newChecked);
  };

  const checkedCount = checkedItems.size;
  const progressPercent = (checkedCount / checklist.length) * 100;

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Award className="h-6 w-6 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-900">What to Ask Any Electrical Contractor</h2>
        </div>
        <p className="text-gray-600">
          Before hiring, verify these six credentials. This checklist favors licensed, bonded, permit-pulling
          contractors — the industry standard for quality and protection.
        </p>
      </div>

      {/* Progress Bar */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-semibold text-gray-900">Contractor Verification Progress</span>
          <span className="text-sm text-gray-600">
            {checkedCount}/{checklist.length} verified
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Checklist Items */}
      <div className="space-y-4">
        {checklist.map((item, index) => (
          <div key={item.id} className="border border-gray-200 rounded-lg overflow-hidden">
            {/* Checkbox Header */}
            <button
              onClick={() => toggleCheck(item.id)}
              className="w-full px-6 py-4 bg-white hover:bg-gray-50 transition-colors flex items-start gap-4 text-left"
            >
              <div className="flex-shrink-0 mt-1">
                <div
                  className={`h-6 w-6 rounded border-2 flex items-center justify-center transition-colors ${
                    checkedItems.has(item.id)
                      ? 'bg-green-600 border-green-600'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  {checkedItems.has(item.id) && (
                    <CheckCircle2 className="h-5 w-5 text-white" strokeWidth={3} />
                  )}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      {index + 1}. {item.question}
                    </h3>
                    <p className="text-sm text-gray-600">{item.description}</p>
                  </div>
                </div>
              </div>

              <div className="text-gray-400 flex-shrink-0">
                <svg
                  className={`h-5 w-5 transition-transform ${checkedItems.has(item.id) ? 'transform rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>
            </button>

            {/* Expanded Content */}
            {checkedItems.has(item.id) && (
              <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 space-y-4">
                {/* Why It Matters */}
                <div>
                  <div className="flex items-start gap-2 mb-1">
                    <Shield className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <h4 className="font-semibold text-gray-900">Why This Matters</h4>
                  </div>
                  <p className="text-sm text-gray-700 ml-7">{item.whyMatters}</p>
                </div>

                {/* Red Flags */}
                <div>
                  <div className="flex items-start gap-2 mb-1">
                    <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <h4 className="font-semibold text-gray-900">Red Flags to Avoid</h4>
                  </div>
                  <p className="text-sm text-gray-700 ml-7">{item.redFlag}</p>
                </div>

                {/* Action Items */}
                <div className="bg-blue-50 border border-blue-200 rounded p-3">
                  <p className="text-xs font-semibold text-blue-900 uppercase tracking-wider mb-2">What to do:</p>
                  <ul className="text-sm text-blue-900 space-y-1">
                    {item.id === 'license' && (
                      <>
                        <li>• Ask for their license number</li>
                        <li>• Search online at cslb.ca.gov</li>
                        <li>• Verify "Active" status and check for complaints</li>
                      </>
                    )}
                    {item.id === 'insurance' && (
                      <>
                        <li>• Request Certificate of Insurance</li>
                        <li>• Verify coverage dates (should extend past project end)</li>
                        <li>• Note your address as "certificate holder"</li>
                      </>
                    )}
                    {item.id === 'bonding' && (
                      <>
                        <li>• Get bond number and bonding company name</li>
                        <li>• Ask if it's a per-job bond or continuous bond</li>
                        <li>• Verify with bonding company before signing</li>
                      </>
                    )}
                    {item.id === 'permits' && (
                      <>
                        <li>• Confirm permits will be pulled before work starts</li>
                        <li>• Get permit numbers in writing on the contract</li>
                        <li>• Plan for city inspector access during work</li>
                      </>
                    )}
                    {item.id === 'references' && (
                      <>
                        <li>• Ask for 3–5 names and phone numbers</li>
                        <li>• Call directly (skip online reviews)</li>
                        <li>• Ask about timeliness, quality, and warranty service</li>
                      </>
                    )}
                    {item.id === 'warranty' && (
                      <>
                        <li>• Get warranty in the signed contract</li>
                        <li>• Ask what's covered (labor, parts, or both)</li>
                        <li>• Confirm who to contact if issues arise</li>
                      </>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Summary Box */}
      <div className="mt-8 bg-green-50 border border-green-200 rounded-lg p-6">
        <div className="flex items-start gap-3">
          <FileCheck className="h-6 w-6 text-green-600 flex-shrink-0 mt-1" />
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Bottom Line</h3>
            <p className="text-sm text-gray-700 mb-3">
              Electrical work is safety-critical and heavily regulated in California. A licensed, bonded contractor who
              pulls permits may cost slightly more upfront, but protects you from:
            </p>
            <ul className="text-sm text-gray-700 space-y-1 mb-3">
              <li>• Liability if someone is injured during work</li>
              <li>• Unpermitted work failing home inspections or sales</li>
              <li>• Faulty installations causing fires or electrocution</li>
              <li>• No recourse if the contractor disappears mid-project</li>
            </ul>
            <p className="text-sm font-semibold text-gray-900">
              Never choose price over credentials. Get at least 3 quotes and compare based on license, insurance, bonding, warranty, and references.
            </p>
          </div>
        </div>
      </div>

      {/* Additional Resources */}
      <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Additional Resources</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <a
            href="https://www.cslb.ca.gov"
            target="_blank"
            rel="noopener noreferrer"
            className="p-4 bg-white border border-blue-200 rounded hover:border-blue-400 transition-colors"
          >
            <h4 className="font-semibold text-blue-600 mb-1">CSLB License Search</h4>
            <p className="text-xs text-gray-600">Verify contractor license status and history</p>
          </a>

          <a
            href="https://en.wikipedia.org/wiki/National_Electrical_Code"
            target="_blank"
            rel="noopener noreferrer"
            className="p-4 bg-white border border-blue-200 rounded hover:border-blue-400 transition-colors"
          >
            <h4 className="font-semibold text-blue-600 mb-1">NEC (National Electrical Code)</h4>
            <p className="text-xs text-gray-600">Industry standard for electrical safety</p>
          </a>

          <a
            href="https://recovery.poweron.com"
            target="_blank"
            rel="noopener noreferrer"
            className="p-4 bg-white border border-blue-200 rounded hover:border-blue-400 transition-colors"
          >
            <h4 className="font-semibold text-blue-600 mb-1">Verify Power On Solutions</h4>
            <p className="text-xs text-gray-600">Look up our license and credentials</p>
          </a>

          <a
            href="https://www.bbb.org"
            target="_blank"
            rel="noopener noreferrer"
            className="p-4 bg-white border border-blue-200 rounded hover:border-blue-400 transition-colors"
          >
            <h4 className="font-semibold text-blue-600 mb-1">Better Business Bureau</h4>
            <p className="text-xs text-gray-600">Check contractor reviews and complaints</p>
          </a>
        </div>
      </div>
    </div>
  );
}

export default PortalEducation;
