/**
 * ResponsiveFormUtilities.tsx — Responsive form component helpers
 * 
 * Features:
 * - Full-width forms on phone (not cut off)
 * - Proper input sizing (16px font to prevent iOS zoom)
 * - Minimum 44px touch targets for buttons/inputs
 * - Responsive modal sizing
 * - Safe area support for notched devices
 * - Accessible input labels
 */

import React from 'react'

interface ResponsiveInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
  fullWidth?: boolean
  minHeight?: number
}

export function ResponsiveInput({
  label,
  error,
  helperText,
  fullWidth = true,
  minHeight = 44,
  className = '',
  ...props
}: ResponsiveInputProps) {
  return (
    <div className={`${fullWidth ? 'w-full' : ''}`}>
      {label && (
        <label className="block text-sm font-semibold text-gray-200 mb-1.5">
          {label}
        </label>
      )}
      <input
        {...props}
        style={{
          minHeight: `${minHeight}px`,
          fontSize: '16px', // Prevents iOS zoom on focus
          ...props.style,
        }}
        className={`w-full px-4 py-2 rounded-lg border border-gray-600 bg-gray-900 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none transition-colors ${
          error
            ? 'border-red-500 focus:border-red-500'
            : ''
        } ${className}`}
      />
      {error && (
        <p className="text-red-400 text-sm mt-1">{error}</p>
      )}
      {helperText && (
        <p className="text-gray-400 text-xs mt-1">{helperText}</p>
      )}
    </div>
  )
}

interface ResponsiveButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'small' | 'medium' | 'large'
  fullWidth?: boolean
}

export function ResponsiveButton({
  variant = 'primary',
  size = 'medium',
  fullWidth = false,
  className = '',
  children,
  ...props
}: ResponsiveButtonProps) {
  const baseClasses = 'font-semibold transition-colors rounded-lg'
  
  const variantClasses = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-gray-700 hover:bg-gray-600 text-gray-200',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
  }

  const sizeClasses = {
    small: 'px-3 py-2 text-sm min-h-[40px]',
    medium: 'px-4 py-2.5 text-base min-h-[44px]',
    large: 'px-6 py-3 text-lg min-h-[48px]',
  }

  return (
    <button
      {...props}
      className={`
        ${baseClasses}
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${fullWidth ? 'w-full' : ''}
        touch-target
        ${className}
      `}
    >
      {children}
    </button>
  )
}

interface ResponsiveModalProps {
  isOpen: boolean
  title?: string
  children: React.ReactNode
  onClose: () => void
  fullHeight?: boolean
}

export function ResponsiveModal({
  isOpen,
  title,
  children,
  onClose,
  fullHeight = false,
}: ResponsiveModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div
        className={`
          bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full sm:w-auto
          max-h-[90vh] sm:max-h-[80vh] overflow-y-auto
          border border-gray-800 shadow-xl
          modal-safe
        `}
        style={{
          maxWidth: '90vw',
          maxHeight: fullHeight ? '100dvh' : '80dvh',
        }}
      >
        {/* Header */}
        {title && (
          <div className="sticky top-0 px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-gray-900">
            <h2 className="text-lg font-bold text-white">{title}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors touch-target"
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>
        )}

        {/* Content */}
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}

interface ResponsiveGridProps {
  children: React.ReactNode
  cols?: { mobile?: number; tablet?: number; desktop?: number }
  gap?: number
  className?: string
}

export function ResponsiveGrid({
  children,
  cols = { mobile: 1, tablet: 2, desktop: 3 },
  gap = 1.5,
  className = '',
}: ResponsiveGridProps) {
  const gridColsClass = `
    grid-cols-${cols.mobile || 1}
    sm:grid-cols-${cols.tablet || 2}
    lg:grid-cols-${cols.desktop || 3}
  `

  return (
    <div className={`grid gap-${Math.round(gap * 4)} ${gridColsClass} ${className}`}>
      {children}
    </div>
  )
}

export default {
  ResponsiveInput,
  ResponsiveButton,
  ResponsiveModal,
  ResponsiveGrid,
}
