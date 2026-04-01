// src/lib/chartSetup.ts
// Force Chart.js CJS build to avoid ES module circular dependency TDZ errors
// The resolve.alias in vite.config.ts maps 'chart.js' → 'chart.js/dist/chart.cjs'
// Imported at app start in main.tsx before any component mounts
import * as ChartModule from 'chart.js'

const {
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
} = ChartModule as any

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
