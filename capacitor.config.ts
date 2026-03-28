import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor Configuration — PowerOn Hub
 *
 * Build for iOS/Android with: npx cap sync && npx cap open ios
 * Requires dist/ to be built first: npm run build
 *
 * Setup steps (run from project root on host machine):
 *   1. npm install @capacitor/core @capacitor/cli
 *   2. npx cap init "PowerOn Hub" "com.poweronsolutions.hub" --web-dir dist
 *   3. npm install @capacitor/ios @capacitor/android
 *   4. npx cap add ios
 *   5. npx cap add android
 *   6. npm install @capacitor/haptics @capacitor/status-bar @capacitor/splash-screen @capacitor/keyboard @capacitor/push-notifications
 *   7. npx cap sync
 *   8. npx cap open ios  (or android)
 */

const config: CapacitorConfig = {
  appId: 'com.poweronsolutions.hub',
  appName: 'PowerOn Hub',
  webDir: 'dist',
  bundledWebRuntime: false,

  server: {
    // Allow self-signed certs in dev
    androidScheme: 'https',
    iosScheme: 'https',
    // For dev: uncomment to point at Vite dev server
    // url: 'http://192.168.1.x:5173',
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#111827', // bg-gray-900
      androidScaleType: 'CENTER_CROP',
      showSpinner: true,
      spinnerColor: '#10b981', // emerald-500
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#111827',
    },
    Keyboard: {
      resize: 'body',
      style: 'DARK',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Haptics: {
      // Default haptic feedback enabled
    },
  },

  // iOS-specific
  ios: {
    scheme: 'PowerOn Hub',
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    backgroundColor: '#111827',
  },

  // Android-specific
  android: {
    backgroundColor: '#111827',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
}

export default config
