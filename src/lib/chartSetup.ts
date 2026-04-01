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

export { Chart as ChartJS }
export default Chart
