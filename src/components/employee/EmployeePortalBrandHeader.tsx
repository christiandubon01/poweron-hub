import React, { useState } from 'react'
import { Zap } from 'lucide-react'

/**
 * EmployeePortalBrandHeader — brand cluster for the employee portal header.
 *
 * Branding source note (TIME-6 audit):
 *   The admin Theme & Branding logo (settings.logoDark / settings.logoLight) is
 *   stored in the OWNER's tenant backup data (data.settings in V15rSettingsPanel).
 *   That is owner app state and is not safely readable from the employee portal
 *   without a cross-tenant read that would expose owner data / fall outside the
 *   employee RLS scope. So we intentionally use the shared static Power On logo
 *   asset (public/assets/poweron-logo.png) — the same asset LoginFlow and
 *   InitialSetupFlow already use. If the image fails to load we fall back to the
 *   Zap glyph so the header never breaks.
 */
export function EmployeePortalBrandHeader() {
  const [logoFailed, setLogoFailed] = useState(false)

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {logoFailed ? (
        <div className="w-9 h-9 rounded-xl bg-green-100 border border-green-200 flex items-center justify-center flex-shrink-0">
          <Zap className="w-4 h-4 text-green-600" fill="currentColor" />
        </div>
      ) : (
        // Dark chip so the logo's light wordmark stays legible on the white header.
        <div className="h-9 flex items-center rounded-xl bg-[#02060d] border border-white/10 px-2 flex-shrink-0">
          <img
            src="/assets/poweron-logo.png"
            alt="Power On Solutions"
            className="h-6 w-auto object-contain"
            draggable={false}
            onError={() => setLogoFailed(true)}
          />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-sm font-bold text-gray-900 leading-tight truncate">Power On Solutions</p>
        <p className="text-[10px] text-gray-400 uppercase tracking-wider font-mono">Employee Portal</p>
      </div>
    </div>
  )
}

export default EmployeePortalBrandHeader
