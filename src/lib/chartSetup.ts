// src/lib/chartSetup.ts
// Synchronous Chart.js initialization — imported at app start in main.tsx
// Uses named imports from chart.js (dedupe + es2015 target in vite.config.ts
// ensures single instance and correct initialization order)
import {
  Chart,
  CategoryScale,
  LinearScale,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  ArcElement,
  DoughnutController,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'

try {
  Chart.register(
    CategoryScale,
    LinearScale,
    BarController,
    BarElement,
    LineController,
    LineElement,
    PointElement,
    ArcElement,
    DoughnutController,
    Title,
    Tooltip,
    Legend,
    Filler
  )
  ;(window as any)._chartReady = true
} catch (e) {
  console.warn('Chart.js init failed:', e)
  ;(window as any)._chartReady = false
}

export { Chart as ChartJS }
export default Chart
