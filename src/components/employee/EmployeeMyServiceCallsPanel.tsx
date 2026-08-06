/**
 * EmployeeMyServiceCallsPanel — SERVICE-LOG-1 employee-facing service calls.
 *
 * Shows the Service Log jobs the signed-in employee is assigned to. The read is
 * RLS-scoped to their own assignment rows (migration 115), and the stored row
 * carries job facts only — every owner-side money field is absent from the
 * table by design, so there is nothing financial here to render.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Loader2, MapPin, Wrench } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  getMyServiceCallAssignments,
  type ServiceCallAssignmentRow,
} from '@/services/serviceCallAssignmentService'

const STATUS_LABEL: Record<string, string> = {
  assigned: 'Assigned',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export default function EmployeeMyServiceCallsPanel() {
  const { employeeProfileId } = useAuth()
  const [rows, setRows] = useState<ServiceCallAssignmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const result = await getMyServiceCallAssignments(employeeProfileId ?? null)
    if (result.success) {
      setRows(result.data)
    } else {
      setRows([])
      setLoadError(result.error || 'Could not load your service calls.')
    }
    setLoading(false)
  }, [employeeProfileId])

  useEffect(() => { void load() }, [load])

  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm mx-auto w-full max-w-2xl">
      <header className="flex items-center gap-2 mb-3">
        <Wrench className="w-5 h-5 text-orange-500" />
        <h2 className="text-base font-bold text-gray-900">My Service Calls</h2>
      </header>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
          <Loader2 size={16} className="animate-spin text-green-600" />
          Loading your service calls…
        </div>
      )}

      {!loading && loadError && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {!loading && !loadError && rows.length === 0 && (
        <p className="text-sm text-gray-500 py-6 text-center">
          No service calls are assigned to you right now.
        </p>
      )}

      {!loading && !loadError && rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="border border-gray-200 rounded-xl p-3 bg-gray-50"
              data-service-call-assignment-id={row.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{row.customer_name || 'Customer'}</p>
                  {row.job_type && (
                    <p className="text-xs text-gray-600 mt-0.5">{row.job_type}</p>
                  )}
                </div>
                <span className="text-[11px] font-semibold text-gray-600 bg-white border border-gray-200 rounded-full px-2 py-0.5 whitespace-nowrap">
                  {STATUS_LABEL[row.assignment_status] || row.assignment_status}
                </span>
              </div>

              {row.address && (
                <p className="flex items-start gap-1.5 text-xs text-gray-600 mt-2">
                  <MapPin size={13} className="mt-0.5 flex-shrink-0 text-gray-400" />
                  <span className="break-words">{row.address}</span>
                </p>
              )}

              {row.scheduled_date && (
                <p className="text-xs text-gray-500 mt-1">{row.scheduled_date}</p>
              )}

              {row.work_description && (
                <p className="text-xs text-gray-700 mt-2 whitespace-pre-wrap leading-relaxed">
                  {row.work_description}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
