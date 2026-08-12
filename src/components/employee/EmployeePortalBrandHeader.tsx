import React, { useState } from 'react'
import { Zap } from 'lucide-react'

interface EmployeePortalBrandHeaderProps {
  companyName?: string | null
  logoUrl?: string | null
}

export function EmployeePortalBrandHeader({
  companyName,
  logoUrl,
}: EmployeePortalBrandHeaderProps) {
  const [logoFailed, setLogoFailed] = useState(false)
  const resolvedCompanyName = (companyName || '').trim() || 'Your Employer'
  const resolvedLogo = !logoFailed && logoUrl ? logoUrl : '/assets/poweron-logo.png'

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {logoFailed && !logoUrl ? (
        <div className="w-9 h-9 rounded-xl bg-green-100 border border-green-200 flex items-center justify-center flex-shrink-0">
          <Zap className="w-4 h-4 text-green-600" fill="currentColor" />
        </div>
      ) : (
        <div className="h-9 flex items-center rounded-xl bg-[#02060d] border border-white/10 px-2 flex-shrink-0">
          <img
            src={resolvedLogo}
            alt={resolvedCompanyName}
            className="h-6 w-auto object-contain"
            draggable={false}
            onError={() => setLogoFailed(true)}
          />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-sm font-bold text-gray-900 leading-tight truncate">{resolvedCompanyName}</p>
        <p className="text-[10px] text-gray-400 uppercase tracking-wider font-mono">PowerOn Hub Employee Portal</p>
      </div>
    </div>
  )
}

export default EmployeePortalBrandHeader
