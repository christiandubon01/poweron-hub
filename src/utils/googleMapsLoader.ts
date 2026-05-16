import { useJsApiLoader } from '@react-google-maps/api'

export const GOOGLE_MAPS_BROWSER_KEY = (import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string) ?? ''
export const V15R_GOOGLE_MAPS_LOADER_ID = 'v15r-google-maps'
export const V15R_GOOGLE_MAPS_LIBRARIES = ['places'] as const
export const V15R_GOOGLE_MAPS_VERSION = 'weekly'
export const V15R_GOOGLE_MAPS_LANGUAGE = 'en'
export const V15R_GOOGLE_MAPS_REGION = 'US'

let googleMapsScriptPromise: Promise<void> | null = null

export function loadV15rGoogleMapsScript(): Promise<void> {
  if (!GOOGLE_MAPS_BROWSER_KEY) return Promise.reject(new Error('Google Maps browser key is not configured.'))
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve()
  if ((window as any).google?.maps?.places) return Promise.resolve()

  if (!googleMapsScriptPromise) {
    googleMapsScriptPromise = new Promise((resolve, reject) => {
      const existing = (
        document.getElementById(V15R_GOOGLE_MAPS_LOADER_ID) ||
        document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]')
      ) as HTMLScriptElement | null

      if (existing) {
        if ((window as any).google?.maps) {
          resolve()
          return
        }
        existing.addEventListener('load', () => resolve(), { once: true })
        existing.addEventListener('error', () => reject(new Error('Google Maps failed to load.')), { once: true })
        return
      }

      const params = new URLSearchParams({
        key: GOOGLE_MAPS_BROWSER_KEY,
        v: V15R_GOOGLE_MAPS_VERSION,
        language: V15R_GOOGLE_MAPS_LANGUAGE,
        region: V15R_GOOGLE_MAPS_REGION,
        libraries: V15R_GOOGLE_MAPS_LIBRARIES.join(','),
      })
      const script = document.createElement('script')
      script.id = V15R_GOOGLE_MAPS_LOADER_ID
      script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Google Maps failed to load.'))
      document.head.appendChild(script)
    })
  }

  return googleMapsScriptPromise
}

export function useV15rGoogleMapsLoader() {
  return useJsApiLoader({
    id: V15R_GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: GOOGLE_MAPS_BROWSER_KEY,
    version: V15R_GOOGLE_MAPS_VERSION,
    language: V15R_GOOGLE_MAPS_LANGUAGE,
    region: V15R_GOOGLE_MAPS_REGION,
    libraries: V15R_GOOGLE_MAPS_LIBRARIES as any,
  })
}
