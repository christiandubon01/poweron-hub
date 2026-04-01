// src/lib/chartSetup.ts
// Synchronous Chart.js initialization — imported at app start in main.tsx
// Uses namespace import to avoid TDZ on individual named bindings from circular modules
import * as CJS from 'chart.js'

let ChartConstructor: any = null

try {
  // Access Chart from namespace — avoids TDZ on destructured named imports
  ChartConstructor = (CJS as any).Chart || (CJS as any).default?.Chart || CJS
  if (ChartConstructor && typeof ChartConstructor.register === 'function') {
    ChartConstructor.register(
      (CJS as any).CategoryScale,
      (CJS as any).LinearScale,
      (CJS as any).BarController,
      (CJS as any).BarElement,
      (CJS as any).LineController,
      (CJS as any).LineElement,
      (CJS as any).PointElement,
      (CJS as any).ArcElement,
      (CJS as any).DoughnutController,
      (CJS as any).Title,
      (CJS as any).Tooltip,
      (CJS as any).Legend,
      (CJS as any).Filler
    )
    ;(window as any)._chartReady = true
  } else {
    console.warn('Chart.js: Chart constructor not found')
    ;(window as any)._chartReady = false
  }
} catch (e) {
  console.warn('Chart.js init failed:', e)
  ;(window as any)._chartReady = false
}

export const ChartJS = ChartConstructor
export default ChartConstructor
