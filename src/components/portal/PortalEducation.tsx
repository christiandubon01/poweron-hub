import React, { useState } from 'react';
import { CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';

interface PortalEducationProps {
  onComplete: () => void;
  onBack: () => void;
}

export function PortalEducation({ onComplete, onBack }: PortalEducationProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  const checklist = [
    {
      question: 'Is the contractor licensed in California?',
      detail:
        'Verify their C-10 license (electrical) on CSLB.ca.gov. Never hire unlicensed contractors—you have no recourse if something goes wrong.',
    },
    {
      question: 'Are they bonded and insured?',
      detail:
        'They should have liability insurance and a surety bond. Ask to see the current certificates—don\'t just take their word for it.',
    },
    {
      question: 'Will they pull the necessary permits?',
      detail:
        'Licensed contractors pull permits as part of their service. If they suggest skipping permits or doing "unlicensed" work, that\'s a red flag.',
    },
    {
      question: 'Do they pull building permits and schedule inspections?',
      detail:
        'The city must inspect electrical work before you can get a certificate of occupancy. This protects you and your property.',
    },
    {
      question: 'What\'s included in their warranty?',
      detail:
        'Labor warranties (typically 1–5 years) are separate from equipment warranties. Ask in writing what\'s covered.',
    },
    {
      question: 'Can they provide recent customer references?',
      detail:
        'Call or visit past projects. Ask about budget adherence, timeline, and whether permits/inspections were handled.',
    },
  ];

  return (
    <div className="bg-white rounded-lg shadow-md p-8 max-w-3xl mx-auto">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-sm font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1"
      >
        ← Back
      </button>

      <div className="mb-8">
        <h2 className="text-3xl font-bold text-slate-900 mb-2">
          What to Ask <em>Any</em> Contractor
        </h2>
        <p className="text-lg text-slate-600">
          We believe in transparency. Here's how to hire safely and avoid common pitfalls.
        </p>
      </div>

      {/* Education Content */}
      <div className="space-y-6 mb-10">
        {checklist.map((item, index) => (
          <div key={index} className="flex gap-4 p-4 bg-gradient-to-r from-slate-50 to-slate-100 rounded-lg border border-slate-200">
            <div className="flex-shrink-0 mt-1">
              <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-slate-900 mb-2">{item.question}</h3>
              <p className="text-slate-700 text-sm leading-relaxed">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Why This Matters */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
        <div className="flex gap-3 mb-3">
          <AlertCircle className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
          <h3 className="font-bold text-slate-900">Why This Matters</h3>
        </div>
        <p className="text-slate-700 text-sm leading-relaxed mb-3">
          Unlicensed work can void your home insurance, create safety hazards, and become an expensive liability when
          you sell. Licensed contractors in California are required to:
        </p>
        <ul className="text-sm text-slate-700 space-y-2 ml-4">
          <li>• Pull permits before starting work</li>
          <li>• Schedule required city inspections</li>
          <li>• Carry workers' compensation insurance</li>
          <li>• Provide warranties on their labor</li>
          <li>• Stand behind their work through the state's contractor recovery fund</li>
        </ul>
      </div>

      {/* Our Commitment */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 mb-8">
        <h3 className="font-bold text-slate-900 mb-3">Power On Solutions' Commitment</h3>
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            <span className="font-bold text-amber-600">License:</span> C-10 #1151468 (California Electrical Contractor)
          </p>
          <p>
            <span className="font-bold text-amber-600">Bonded & Insured:</span> We carry full liability insurance and a
            surety bond
          </p>
          <p>
            <span className="font-bold text-amber-600">Permits & Inspections:</span> We handle all required permits and
            coordinate with your city
          </p>
          <p>
            <span className="font-bold text-amber-600">Warranty:</span> 1 year labor warranty on all work; equipment
            carries manufacturer coverage
          </p>
          <p className="flex gap-2 items-start">
            <span className="font-bold text-amber-600">Verify Us:</span>
            <a href="https://www.cslb.ca.gov/" target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:underline">
              Search CSLB.ca.gov for our license
            </a>
          </p>
        </div>
      </div>

      {/* Acknowledgment */}
      <div className="bg-slate-100 rounded-lg p-6 mb-8">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="w-5 h-5 rounded border-slate-300 text-amber-600 focus:ring-amber-500 mt-1 flex-shrink-0"
          />
          <span className="text-sm text-slate-900">
            I understand the importance of hiring a licensed, bonded contractor and have reviewed the checklist above.
          </span>
        </label>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 px-6 py-3 border border-slate-300 text-slate-900 font-medium rounded-lg hover:bg-slate-50 transition"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onComplete}
          disabled={!acknowledged}
          className={`flex-1 px-6 py-3 font-medium rounded-lg transition flex items-center justify-center gap-2 ${
            acknowledged
              ? 'bg-amber-600 text-white hover:bg-amber-700 cursor-pointer'
              : 'bg-slate-300 text-slate-500 cursor-not-allowed'
          }`}
        >
          Submit Request <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
