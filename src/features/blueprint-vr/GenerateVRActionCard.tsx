/**
 * src/features/blueprint-vr/GenerateVRActionCard.tsx
 *
 * Reusable action card component for Blueprint VR generation.
 * Matches the existing Blueprint AI action card visual style.
 * 
 * This component provides a clean, accessible button interface for triggering
 * VR scene generation from blueprints. It displays clear loading states and
 * respects disabled conditions.
 */

import { Loader2 } from 'lucide-react'

export interface GenerateVRActionCardProps {
  /**
   * Whether the button is disabled.
   * @default false
   */
  disabled?: boolean

  /**
   * Whether VR generation is currently in progress.
   * @default false
   */
  isGenerating?: boolean

  /**
   * Callback fired when the user clicks the action card.
   */
  onClick: () => void

  /**
   * Optional helper text displayed below the title.
   * Provides context about the action.
   */
  helperText?: string
}

/**
 * GenerateVRActionCard
 *
 * A reusable action card for Blueprint VR generation.
 * Styled to match existing Blueprint AI action cards with dark theme,
 * thin border, and concise typography.
 *
 * @example
 * ```tsx
 * <GenerateVRActionCard
 *   onClick={handleGenerateVR}
 *   isGenerating={isProcessing}
 *   disabled={!selectedBlueprint}
 *   helperText="Create a 3D scene from blueprint"
 * />
 * ```
 */
export function GenerateVRActionCard({
  disabled = false,
  isGenerating = false,
  onClick,
  helperText,
}: GenerateVRActionCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isGenerating}
      className={`group text-left rounded-xl border px-4 py-3 min-h-[76px] transition-colors ${
        isGenerating || disabled
          ? 'border-gray-800 bg-gray-900/20 text-gray-400 cursor-not-allowed opacity-60'
          : 'border-indigo-700/60 bg-indigo-950/20 hover:bg-indigo-950/35 text-indigo-200'
      }`}
      aria-busy={isGenerating}
      aria-disabled={disabled || isGenerating}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-inherit">Generate VR</p>
          {helperText && (
            <p className="text-xs text-inherit/80 mt-1 opacity-90">
              {helperText}
            </p>
          )}
        </div>
        {isGenerating && (
          <span className="flex-shrink-0">
            <Loader2
              size={16}
              className="animate-spin text-indigo-300"
              aria-hidden="true"
            />
          </span>
        )}
      </div>
    </button>
  )
}

export default GenerateVRActionCard
