// @ts-nocheck
import React, { useState } from 'react';

interface SideBySideCardProps {
  whatYouSaid: string;
  strongerAlternative: string;
  explanation: string;
  category: string;
  onPlayAudio?: () => void;
}

export const SideBySideCard: React.FC<SideBySideCardProps> = ({
  whatYouSaid,
  strongerAlternative,
  explanation,
  category,
  onPlayAudio,
}) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-gray-200 rounded-lg p-6 mb-4 bg-white dark:bg-gray-800 dark:border-gray-700">
      {/* Category header */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
          {category}
        </h3>
      </div>

      {/* Side-by-side comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Left: What you said (Red) */}
        <div className="border-l-4 border-red-500 bg-red-50 dark:bg-red-900/20 p-4 rounded">
          <h4 className="text-xs font-bold text-red-700 dark:text-red-300 mb-2 uppercase">
            What You Said
          </h4>
          <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
            "{whatYouSaid}"
          </p>
        </div>

        {/* Right: Stronger alternative (Green) */}
        <div className="border-l-4 border-green-500 bg-green-50 dark:bg-green-900/20 p-4 rounded">
          <h4 className="text-xs font-bold text-green-700 dark:text-green-300 mb-2 uppercase">
            Stronger Alternative
          </h4>
          <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
            "{strongerAlternative}"
          </p>
        </div>
      </div>

      {/* Explanation */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded p-4 mb-4">
        <details open={expanded} className="cursor-pointer">
          <summary
            onClick={() => setExpanded(!expanded)}
            className="text-sm font-semibold text-blue-700 dark:text-blue-300 mb-2 cursor-pointer"
          >
            Why the alternative is better →
          </summary>
          {expanded && (
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mt-2">
              {explanation}
            </p>
          )}
        </details>
      </div>

      {/* Play audio button */}
      {onPlayAudio && (
        <button
          onClick={onPlayAudio}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 rounded transition-colors"
        >
          🔊 Hear the stronger alternative
        </button>
      )}
    </div>
  );
};

export default SideBySideCard;
