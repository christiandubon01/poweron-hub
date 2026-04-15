// @ts-nocheck
/**
 * ProjectSummaryBoxes — horizontal summary card row shown at the top of every project detail view.
 *
 * Layout (6 boxes):
 *   [Total Hours]  [Total Materials $]  [Total Miles]  [Log Count]  [Remaining Balance]  [Collected]
 *
 * Data source: calculateProjectFinancials — SAME canonical formula used by the Field Log panel.
 * This guarantees all numbers match the Field Log running-totals bar exactly (no drift).
 *
 * Log Count enables Christian to calculate miles-per-day efficiency manually:
 *   Miles per Day = Total Miles ÷ Log Count
 */

import { calculateProjectFinancials, VAN_MILE_RATE } from '@/utils/calculateProjectFinancials'

interface ProjectSummaryBoxesProps {
  /** Project ID to summarize */
  projectId: string
  /** Full backup object from getBackupData() */
  backup: any
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  if (!n && n !== 0) return '$0'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 10000) return sign + '$' + Math.round(abs / 1000) + 'k'
  if (abs >= 1000)  return sign + '$' + (Math.floor(abs / 100) / 10).toFixed(1) + 'k'
  return sign + '$' + Math.round(abs)
}

function getBalanceColor(remaining: number, quote: number): string {
  if (remaining < 0) return '#ef4444'                  // red: negative
  if (quote <= 0)    return '#10b981'                  // green fallback
  const pctLeft = remaining / quote
  if (pctLeft > 0.20) return '#10b981'                 // green: > 20% left
  if (pctLeft > 0.10) return '#f59e0b'                 // yellow: 10–20% left
  return '#f97316'                                     // orange: < 10% left
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProjectSummaryBoxes({ projectId, backup }: ProjectSummaryBoxesProps) {
  if (!backup || !projectId) return null

  const project = (backup.projects || []).find((p: any) => p.id === projectId)
  if (!project) return null

  // Use canonical formula — same as Field Log panel BUG-3-FIX calculation
  const mileRate = Number(backup?.settings?.mileRate) || VAN_MILE_RATE
  const laborRate = Number(backup?.settings?.opCost) || 55
  const fin = calculateProjectFinancials(project, backup.logs || [], mileRate, laborRate)

  // Log count = number of field log entries for this project
  const logCount = (backup.logs || []).filter((l: any) => l.projId === projectId || l.projectId === projectId).length

  const balColor = getBalanceColor(fin.remaining_balance, fin.quote)

  const boxes: Array<{ label: string; value: string; color: string; title?: string }> = [
    {
      label: 'Total Hours',
      value: fin.total_hours.toFixed(1) + 'h',
      color: '#f0f0f0',
    },
    {
      label: 'Total Miles',
      value: fin.total_miles.toFixed(1),
      color: '#60a5fa',
      title: 'Total transportation miles logged',
    },
    {
      label: 'Log Count',
      value: String(logCount),
      color: '#d1d5db',
      title: 'Days/entries worked — use with Total Miles to find miles-per-day efficiency',
    },
    {
      label: 'Remaining',
      value: fmtMoney(fin.remaining_balance),
      color: balColor,
      title: 'Remaining Balance = Quote − Total Costs (Labor + Materials + Transport)',
    },
    {
      label: 'Mat Purchased',
      value: fmtMoney(fin.material_cost),
      color: '#fb923c',
      title: 'Total materials purchased across all field log entries',
    },
    {
      label: 'Collected',
      value: fmtMoney(fin.total_collected),
      color: '#34d399',
    },
  ]

  return (
    <div
      style={{
        display:       'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap:           6,
        padding:       '10px 16px 12px',
        backgroundColor: 'rgba(17,24,39,0.5)',
        borderBottom:  '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {boxes.map(box => (
        <div
          key={box.label}
          title={box.title}
          style={{
            textAlign:       'center',
            padding:         '8px 4px',
            borderRadius:    6,
            backgroundColor: 'rgba(255,255,255,0.03)',
            border:          '1px solid rgba(255,255,255,0.06)',
            cursor:          box.title ? 'help' : 'default',
          }}
        >
          <div
            style={{
              fontSize:      9,
              fontWeight:    700,
              color:         '#6b7280',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom:  4,
              whiteSpace:    'nowrap',
              overflow:      'hidden',
              textOverflow:  'ellipsis',
            }}
          >
            {box.label}
          </div>
          <div
            style={{
              fontSize:   13,
              fontWeight: 800,
              fontFamily: 'monospace',
              color:      box.color,
              lineHeight: 1.2,
            }}
          >
            {box.value}
          </div>
        </div>
      ))}
    </div>
  )
}
