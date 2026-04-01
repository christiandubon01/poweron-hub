// src/lib/chartSetup.ts
// Force synchronous Chart.js initialization to prevent TDZ errors
// Imported at app start in main.tsx before any component mounts
import { Chart } from 'chart.js'
import {
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
