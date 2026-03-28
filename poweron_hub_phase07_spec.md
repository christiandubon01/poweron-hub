# PowerOn Hub — Phase 07 Implementation Spec
## Cross-Platform: iOS, Android, Windows, Netlify Deployment
### v2.0 Capacitor.js · Electron · PWA · 11-Agent Architecture · Weeks 16–18

---

## Table of Contents

1. Overview & Architecture Summary
2. Progressive Web App (PWA) Configuration
3. iOS Build via Capacitor.js
4. Android Build via Capacitor.js
5. Windows Desktop via Electron
6. Netlify Deployment & CI/CD
7. Push Notifications (FCM, APNs, Web Push)
8. Offline-First Architecture with Service Workers
9. Native Capabilities (Camera, GPS, Biometric Auth)
10. Platform-Specific UI Adaptations
11. App Store Submission Preparation
12. Database Synchronization Strategy
13. Testing Strategy & Validation
14. File Tree After Phase 07
15. What Phase 08 Expects from Phase 07

---

## 1. Overview & Architecture Summary

Phase 07 transforms PowerOn Hub from a web-only application into a true cross-platform system supporting:

- **iOS**: Native app via Capacitor.js (deployment to App Store)
- **Android**: Native app via Capacitor.js (deployment to Google Play Store)
- **Windows**: Desktop app via Electron
- **Web**: Existing React + Vite app (deployed to Netlify)
- **Progressive Web App**: Installable on all platforms

**Key Capabilities**:
- Single codebase shared across all platforms (Capacitor + Electron)
- Push notifications (APNs for iOS, FCM for Android, Web Push for web)
- Offline-first with service workers and sync queue
- Native camera for job site photos
- GPS/geolocation for travel time and geofencing
- Biometric authentication (Face ID on iOS, fingerprint on Android)
- Platform-specific safe areas and notch handling
- App store submission-ready with metadata and privacy policy

### Tech Stack for Phase 07

| Component | Use Case | Status |
|-----------|----------|--------|
| Capacitor.js | iOS/Android wrapper for React app | Core |
| Electron | Windows desktop app | Core |
| Netlify | Web deployment, CDN, serverless functions | Core |
| Firebase Cloud Messaging (FCM) | Android push notifications | Required |
| Apple Push Notification (APNs) | iOS push notifications | Required |
| Web Push API | Web browser notifications | Required |
| Service Worker | Offline caching and sync queue | Core |
| IndexedDB | Client-side offline data storage | Core |

---

## 2. Progressive Web App (PWA) Configuration

### 2.1 Web Manifest

```json
// public/manifest.json
{
  "name": "PowerOn Hub",
  "short_name": "PowerOn Hub",
  "description": "AI-powered electrical contracting business management platform",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#ffffff",
  "theme_color": "#10b981",
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-apple-180x180.png",
      "sizes": "180x180",
      "type": "image/png",
      "purpose": "any"
    }
  ],
  "screenshots": [
    {
      "src": "/screenshots/dashboard.png",
      "sizes": "540x720",
      "type": "image/png",
      "form_factor": "narrow"
    },
    {
      "src": "/screenshots/dashboard-wide.png",
      "sizes": "1280x720",
      "type": "image/png",
      "form_factor": "wide"
    }
  ],
  "categories": ["business", "productivity"],
  "shortcuts": [
    {
      "name": "View Leads",
      "short_name": "Leads",
      "description": "Quick access to sales pipeline",
      "url": "/app/spark/leads",
      "icons": [{ "src": "/icons/leads-96x96.png", "sizes": "96x96", "type": "image/png" }]
    },
    {
      "name": "Today's Schedule",
      "short_name": "Schedule",
      "description": "View today's jobs and meetings",
      "url": "/app/chrono/today",
      "icons": [{ "src": "/icons/schedule-96x96.png", "sizes": "96x96", "type": "image/png" }]
    }
  ]
}
```

### 2.2 HTML Head (index.html)

```html
<!-- index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="theme-color" content="#10b981" />
  <meta name="description" content="AI-powered electrical contracting business management" />
  
  <!-- PWA -->
  <link rel="manifest" href="/manifest.json" />
  <link rel="icon" type="image/svg+xml" href="/vite.svg" />
  <link rel="apple-touch-icon" href="/icons/icon-apple-180x180.png" />
  <link rel="mask-icon" href="/icons/safari-mask.svg" color="#10b981" />
  
  <!-- iOS -->
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="PowerOn Hub" />
  
  <!-- Capacitor -->
  <script src="capacitor://bridge.js"></script>
  
  <title>PowerOn Hub</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

### 2.3 Service Worker (sw.ts)

```typescript
// public/sw.ts - Service Worker for caching and offline support

const CACHE_NAME = 'poweron-hub-v1';
const OFFLINE_PAGE = '/offline.html';

const CRITICAL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
];

const CACHEABLE_PATHS = [
  /\.(?:js|css|woff|woff2|ttf|svg|png|jpg|jpeg|gif)$/,
  /\/api\/.*\/GET$/, // Cache GET requests only
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CRITICAL_ASSETS).catch((err) => {
        console.warn('Failed to cache critical assets:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const { method, url } = request;
  
  // Skip non-GET requests
  if (method !== 'GET') {
    return;
  }
  
  // Skip chrome extensions, data: and blob: URLs
  if (url.startsWith('chrome-extension://') || url.startsWith('data:') || url.startsWith('blob:')) {
    return;
  }
  
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      return fetch(request)
        .then((response) => {
          // Don't cache non-200 responses
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }
          
          // Cache GET requests to APIs and static assets
          if (CACHEABLE_PATHS.some((pattern) => pattern.test(url))) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          
          return response;
        })
        .catch(() => {
          // Return offline page if available
          return caches.match(OFFLINE_PAGE) || new Response('Offline');
        })
    )
  );
});

// Background sync for offline operations
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-queue') {
    event.waitUntil(syncOfflineQueue());
  }
});

async function syncOfflineQueue(): Promise<void> {
  const db = await openIndexedDB();
  const queue = await db.getAll('sync-queue');
  
  for (const item of queue) {
    try {
      const response = await fetch(item.request.url, item.request);
      if (response.ok) {
        await db.delete('sync-queue', item.id);
      }
    } catch (error) {
      console.error('Sync failed:', error);
    }
  }
}

function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('poweron-hub', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('sync-queue')) {
        db.createObjectStore('sync-queue', { keyPath: 'id' });
      }
    };
  });
}
```

---

## 3. iOS Build via Capacitor.js

### 3.1 Capacitor Configuration (capacitor.config.ts)

```typescript
// capacitor.config.ts
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.poweronsolutions.hub',
  appName: 'PowerOn Hub',
  webDir: 'dist',
  server: {
    url: 'http://localhost:5173', // Dev server
    cleartext: true,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Camera: {
      permissions: ['camera', 'photos'],
    },
    Geolocation: {},
    BiometricAuth: {
      useBackupKey: true,
    },
  },
};

export default config;
```

### 3.2 iOS-Specific Setup

```bash
# Build steps
npm run build
npx cap add ios
npx cap open ios

# In Xcode:
# 1. Set bundle identifier: com.poweronsolutions.hub
# 2. Add Apple Push Notification (APNs) certificates
# 3. Enable capabilities: Push Notifications, Background Modes
# 4. Configure provisioning profiles
# 5. Build and archive for App Store
```

### 3.3 iOS Safe Area Handling

```typescript
// src/hooks/useIOSSafeArea.ts
import { StatusBar } from '@capacitor/status-bar';
import { App } from '@capacitor/app';

export function useIOSSafeArea() {
  useEffect(() => {
    // Set status bar to light background for dark theme
    StatusBar.setStyle({ style: 'LIGHT' });
    StatusBar.setBackgroundColor({ color: '#1F2937' }); // gray-900
  }, []);
  
  // Apply safe area insets via CSS variables
  useEffect(() => {
    const updateSafeArea = async () => {
      const info = await App.getInfo();
      if (info.platform === 'ios') {
        // CSS env(safe-area-inset-*) handles safe areas automatically
        document.documentElement.style.paddingTop = 'env(safe-area-inset-top)';
        document.documentElement.style.paddingBottom = 'env(safe-area-inset-bottom)';
        document.documentElement.style.paddingLeft = 'env(safe-area-inset-left)';
        document.documentElement.style.paddingRight = 'env(safe-area-inset-right)';
      }
    };
    updateSafeArea();
  }, []);
}

// CSS: Apply safe-area-inset in tailwind
// <div className="pb-[env(safe-area-inset-bottom)]">...</div>
```

---

## 4. Android Build via Capacitor.js

### 4.1 Android Configuration

```gradle
// android/app/build.gradle
android {
    compileSdk 34
    
    defaultConfig {
        minSdk 24
        targetSdk 34
        versionCode 1
        versionName "1.0"
        
        // FCM
        manifestPlaceholders = [
            firebaseMessagingVersion: "23.2.1"
        ]
    }
    
    signingConfigs {
        release {
            storeFile file("poweron-hub.keystore")
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }
    
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            shrinkResources true
        }
    }
}
```

### 4.2 Android Permissions (AndroidManifest.xml)

```xml
<!-- android/app/src/main/AndroidManifest.xml -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  
  <!-- Camera -->
  <uses-permission android:name="android.permission.CAMERA" />
  <uses-feature android:name="android.hardware.camera" android:required="false" />
  
  <!-- GPS/Location -->
  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
  <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
  
  <!-- Biometric -->
  <uses-permission android:name="android.permission.USE_BIOMETRIC" />
  <uses-permission android:name="android.permission.USE_FINGERPRINT" />
  
  <!-- Notifications -->
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
  
  <!-- Background sync -->
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.WAKE_LOCK" />
  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
  
  <application>
    <!-- Activities, services, etc. -->
  </application>
</manifest>
```

---

## 5. Windows Desktop via Electron

### 5.1 Electron Main Process

```typescript
// electron/main.ts
import { app, BrowserWindow, Menu, ipcMain, nativeTheme } from 'electron';
import path from 'path';
import isDev from 'electron-is-dev';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const startUrl = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../dist/index.html')}`;

  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Dark theme support
ipcMain.handle('get-theme', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

nativeTheme.on('updated', () => {
  mainWindow?.webContents.send('theme-changed', {
    isDark: nativeTheme.shouldUseDarkColors,
  });
});
```

### 5.2 Electron Preload (Security)

```typescript
// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onThemeChanged: (callback: (isDark: boolean) => void) => {
    ipcRenderer.on('theme-changed', (_, { isDark }) => {
      callback(isDark);
    });
  },
  isElectron: true,
});
```

---

## 6. Netlify Deployment & CI/CD

### 6.1 Netlify Configuration (netlify.toml)

```toml
# netlify.toml
[build]
  command = "npm run build"
  functions = "netlify/functions"
  publish = "dist"

[build.environment]
  NODE_VERSION = "18.17.0"
  VITE_API_URL = "https://api.poweronhub.com"

[context.production]
  environment = { VITE_ENVIRONMENT = "production" }

[context.staging]
  environment = { VITE_ENVIRONMENT = "staging" }

[context.deploy-preview]
  environment = { VITE_ENVIRONMENT = "preview" }

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "SAMEORIGIN"
    X-XSS-Protection = "1; mode=block"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "camera=(), microphone=(), geolocation=()"

[[headers]]
  for = "/app/*"
  [headers.values]
    Permissions-Policy = "camera=(self), microphone=(self), geolocation=(self)"
```

### 6.2 GitHub Actions CI/CD

```yaml
# .github/workflows/deploy.yml
name: Deploy to Netlify

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main, staging]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm run test
      
      - name: Build
        run: npm run build
        env:
          VITE_API_URL: ${{ secrets.VITE_API_URL }}
          VITE_OPENAI_API_KEY: ${{ secrets.VITE_OPENAI_API_KEY }}
      
      - name: Deploy to Netlify
        uses: netlify/actions/cli@master
        with:
          args: deploy --prod
        env:
          NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}
```

---

## 7. Push Notifications

### 7.1 Firebase Cloud Messaging (Android)

```typescript
// src/services/fcm.ts
import { PushNotifications } from '@capacitor/push-notifications';

export async function setupFCM(orgId: string, userId: string) {
  await PushNotifications.requestPermissions();
  
  await PushNotifications.addListener('registration', async (token) => {
    console.log('FCM Token:', token.value);
    await fetch('/api/notifications/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        org_id: orgId,
        user_id: userId,
        platform: 'android',
        token: token.value,
      }),
    });
  });
  
  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.log('Push notification received:', notification);
  });
  
  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const data = action.notification.data;
    handleNotificationAction(data);
  });
}

function handleNotificationAction(data: any) {
  switch (data.type) {
    case 'lead_assigned':
      window.location.href = `/app/spark/leads/${data.lead_id}`;
      break;
    case 'job_reminder':
      window.location.href = `/app/chrono/schedule`;
      break;
    default:
      break;
  }
}
```

### 7.2 Apple Push Notification (iOS)

```typescript
// src/services/apns.ts
import { PushNotifications } from '@capacitor/push-notifications';

export async function setupAPNs(orgId: string, userId: string) {
  await PushNotifications.requestPermissions();
  
  const result = await PushNotifications.getDeliveredNotifications();
  console.log('Delivered notifications:', result);
  
  await PushNotifications.addListener('registration', async (token) => {
    console.log('APNs Device Token:', token.value);
    await fetch('/api/notifications/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        org_id: orgId,
        user_id: userId,
        platform: 'ios',
        token: token.value,
      }),
    });
  });
  
  await PushNotifications.addListener('registrationError', (error) => {
    console.error('Push registration error:', error);
  });
  
  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.log('Notification received in app:', notification);
  });
  
  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    handleNotificationAction(action.notification.data);
  });
}
```

### 7.3 Web Push Notifications

```typescript
// src/services/webPush.ts
export async function setupWebPush(orgId: string, userId: string) {
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
      // Send subscription to server
      await fetch('/api/notifications/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: orgId,
          user_id: userId,
          platform: 'web',
          subscription: subscription.toJSON(),
        }),
      });
    }
  }
}
```

---

## 8. Offline-First Architecture

### 8.1 Sync Queue Implementation

```typescript
// src/services/syncQueue.ts
interface QueuedRequest {
  id: string;
  url: string;
  method: string;
  body?: any;
  timestamp: number;
  retries: number;
}

export class SyncQueue {
  private dbPromise: Promise<IDBDatabase>;
  
  constructor() {
    this.dbPromise = this.initDB();
  }
  
  private async initDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('poweron-sync', 1);
      
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('queue')) {
          db.createObjectStore('queue', { keyPath: 'id' });
        }
      };
    });
  }
  
  async enqueue(request: Omit<QueuedRequest, 'id' | 'timestamp' | 'retries'>): Promise<void> {
    const db = await this.dbPromise;
    const item: QueuedRequest = {
      id: crypto.randomUUID(),
      ...request,
      timestamp: Date.now(),
      retries: 0,
    };
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction('queue', 'readwrite');
      const req = tx.objectStore('queue').add(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
  
  async processQueue(): Promise<void> {
    const db = await this.dbPromise;
    
    return new Promise((resolve) => {
      const tx = db.transaction('queue', 'readwrite');
      const store = tx.objectStore('queue');
      const req = store.getAll();
      
      req.onsuccess = async () => {
        const items = req.result as QueuedRequest[];
        
        for (const item of items) {
          try {
            const response = await fetch(item.url, {
              method: item.method,
              headers: { 'Content-Type': 'application/json' },
              body: item.body ? JSON.stringify(item.body) : undefined,
            });
            
            if (response.ok) {
              const deleteTx = db.transaction('queue', 'readwrite');
              deleteTx.objectStore('queue').delete(item.id);
            } else if (item.retries < 3) {
              item.retries++;
              const updateTx = db.transaction('queue', 'readwrite');
              updateTx.objectStore('queue').put(item);
            }
          } catch (error) {
            if (item.retries < 3) {
              item.retries++;
              const updateTx = db.transaction('queue', 'readwrite');
              updateTx.objectStore('queue').put(item);
            }
          }
        }
        resolve();
      };
    });
  }
}
```

---

## 9. Native Capabilities

### 9.1 Camera Integration

```typescript
// src/services/camera.ts
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

export async function captureJobSitePhoto(): Promise<string> {
  const image = await Camera.getPhoto({
    quality: 90,
    allowEditing: false,
    resultType: CameraResultType.Uri,
    source: CameraSource.Camera,
    promptLabelPhoto: 'Take photo',
    promptLabelPicture: 'Choose photo',
  });
  
  return image.webPath || '';
}

export async function uploadPhotoToProject(
  projectId: string,
  photoUri: string
): Promise<void> {
  const blob = await fetch(photoUri).then(r => r.blob());
  const formData = new FormData();
  formData.append('file', blob);
  formData.append('project_id', projectId);
  
  await fetch('/api/projects/photos', {
    method: 'POST',
    body: formData,
  });
}
```

### 9.2 GPS/Geolocation

```typescript
// src/services/geolocation.ts
import { Geolocation } from '@capacitor/geolocation';

export async function getCurrentLocation(): Promise<{ latitude: number; longitude: number }> {
  const coordinates = await Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 3600000,
  });
  
  return {
    latitude: coordinates.coords.latitude,
    longitude: coordinates.coords.longitude,
  };
}

export async function watchLocation(
  callback: (coords: { latitude: number; longitude: number }) => void
): Promise<string> {
  const watchId = await Geolocation.watchPosition(
    {
      enableHighAccuracy: true,
      maximumAge: 0,
    },
    (position, err) => {
      if (position) {
        callback({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      }
    }
  );
  
  return watchId;
}
```

### 9.3 Biometric Authentication

```typescript
// src/services/biometric.ts
import { BiometricAuth } from '@capacitor-community/biometric-auth';

export async function enableBiometricAuth(orgId: string, userId: string): Promise<boolean> {
  try {
    const result = await BiometricAuth.isAvailable();
    if (!result.isAvailable) {
      return false;
    }
    
    // Test biometric
    await BiometricAuth.authenticate({
      reason: 'Authenticate to enable biometric login',
      biometryType: ['biometryFaceID', 'biometryFingerprint'],
    });
    
    // Save preference
    await fetch('/api/auth/biometric', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: orgId, user_id: userId, enabled: true }),
    });
    
    return true;
  } catch (error) {
    console.error('Biometric auth setup failed:', error);
    return false;
  }
}

export async function authenticateWithBiometric(): Promise<boolean> {
  try {
    await BiometricAuth.authenticate({
      reason: 'Unlock PowerOn Hub',
      biometryType: ['biometryFaceID', 'biometryFingerprint'],
    });
    return true;
  } catch {
    return false;
  }
}
```

---

## 10. Platform-Specific UI Adaptations

### 10.1 Safe Area Aware Layout

```typescript
// src/hooks/usePlatformUI.ts
import { Platform } from '@ionic/core';
import { App } from '@capacitor/app';

export function usePlatformUI() {
  const [platform, setPlatform] = useState<string>('web');
  const [safeAreas, setSafeAreas] = useState({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  });
  
  useEffect(() => {
    const detectPlatform = async () => {
      const info = await App.getInfo();
      setPlatform(info.platform);
      
      // Update CSS variables for safe areas
      const envVars = {
        top: 'env(safe-area-inset-top)',
        bottom: 'env(safe-area-inset-bottom)',
        left: 'env(safe-area-inset-left)',
        right: 'env(safe-area-inset-right)',
      };
      
      Object.entries(envVars).forEach(([key, value]) => {
        document.documentElement.style.setProperty(`--safe-area-${key}`, value);
      });
    };
    
    detectPlatform();
  }, []);
  
  return { platform, safeAreas };
}
```

### 10.2 Responsive Design with Safe Areas

```typescript
// src/components/Layout/SafeAreaContainer.tsx
export function SafeAreaContainer({ children }: { children: React.ReactNode }) {
  const { platform } = usePlatformUI();
  
  const paddingClasses = {
    ios: 'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]',
    android: 'pt-6 pb-6',
    web: 'p-4',
    windows: 'p-6',
  };
  
  return (
    <div className={`bg-gray-900 min-h-screen ${paddingClasses[platform as keyof typeof paddingClasses]}`}>
      {children}
    </div>
  );
}
```

---

## 11. App Store Submission Preparation

### 11.1 iOS App Store Metadata

```typescript
// docs/app-store-metadata.json
{
  "name": "PowerOn Hub",
  "description": "AI-powered field management for electrical contractors. Manage leads, schedule jobs, track projects, and collaborate with your team in real-time.",
  "keywords": ["electrical", "contracting", "field management", "business management", "scheduling"],
  "support_url": "https://support.poweronhub.com",
  "privacy_policy_url": "https://poweronhub.com/privacy",
  "marketing_url": "https://poweronhub.com",
  "screenshots": [
    { "path": "screenshots/ios/1-dashboard.png", "text": "Dashboard with KPIs" },
    { "path": "screenshots/ios/2-leads.png", "text": "Sales pipeline management" },
    { "path": "screenshots/ios/3-schedule.png", "text": "Job scheduling and dispatch" },
    { "path": "screenshots/ios/4-projects.png", "text": "Project lifecycle tracking" },
  ],
  "app_review_notes": "PowerOn Hub is a B2B business management application for electrical contracting. Features: lead tracking, job scheduling, project management, financial tracking. No user-generated content or external payments.",
}
```

### 11.2 Privacy Policy Template

```markdown
# Privacy Policy - PowerOn Hub

## Data Collection
PowerOn Hub collects:
- User profile information (name, email, phone)
- Business data (projects, leads, estimates, invoices)
- Location data (GPS for job scheduling and travel time)
- Photos (job site documentation)
- Device identifiers (for push notifications)

## Data Storage
- Data encrypted in transit (HTTPS/TLS)
- Data at rest encrypted (Supabase encryption)
- Backups stored on Cloudflare R2

## User Rights
- Users can request export of their data
- Users can request deletion of data
- Data retention: Until account deletion

## Third-Party Services
- Anthropic Claude API (for AI agent features)
- Google Maps (for location and travel time)
- ElevenLabs (for text-to-speech)
- Twilio (for SMS notifications)
- Firebase (for push notifications)

## Contact
privacy@poweronsolutions.com
```

---

## 12. Database Synchronization Strategy

Two-way sync keeps device data and cloud data in sync:

**Device → Cloud (Upload)**:
- Changes queued if offline; synced when online
- Timestamps prevent conflicts
- Retry logic handles transient failures

**Cloud → Cloud (Multi-Device)**:
- Real-time sync via Supabase realtime subscriptions
- Resolves conflicts using last-write-wins + version vectors

---

## 13. Testing Strategy & Validation

**Platform-Specific Tests**:
- iOS: Build, code sign, run on simulator/device
- Android: Build, run on emulator/device
- Windows: Build Electron, test on Windows 10+
- Web: Test in modern browsers

**Cross-Platform Tests**:
- Offline-first: Disable network, make changes, re-enable
- Push notifications: Trigger from backend, verify delivery
- Biometric: Test Face ID, fingerprint, and fallback
- Camera: Take photo, upload, verify storage
- GPS: Check location permissions, accuracy

---

## 14. File Tree After Phase 07

```
├── public/
│   ├── manifest.json (NEW)
│   ├── sw.ts (NEW)
│   ├── offline.html (NEW)
│   └── icons/ (NEW)
├── capacitor.config.ts (NEW)
├── electron/ (NEW)
│   ├── main.ts
│   ├── preload.ts
│   └── tsconfig.json
├── android/ (NEW - generated)
├── ios/ (NEW - generated)
├── netlify.toml (NEW)
├── netlify/
│   └── functions/ (NEW)
├── .github/
│   └── workflows/
│       └── deploy.yml (NEW)
└── src/
    ├── services/
    │   ├── voice.ts (from Phase 06)
    │   ├── fcm.ts (NEW)
    │   ├── apns.ts (NEW)
    │   ├── webPush.ts (NEW)
    │   ├── syncQueue.ts (NEW)
    │   ├── camera.ts (NEW)
    │   ├── geolocation.ts (NEW)
    │   └── biometric.ts (NEW)
    ├── hooks/
    │   ├── useIOSSafeArea.ts (NEW)
    │   └── usePlatformUI.ts (NEW)
    └── ... (existing)
```

---

## 15. What Phase 08 Expects from Phase 07

1. **All platforms building successfully**: iOS, Android, Windows, web.

2. **Push notification infrastructure**: All three notification systems (FCM, APNs, Web Push) working.

3. **Offline-first functional**: Sync queue persisting, processing, and resolving conflicts.

4. **Native features operational**: Camera, GPS, biometric auth working on each platform.

5. **App store ready**: Metadata, privacy policy, screenshots prepared for submission.

6. **Cross-device sync**: Data syncing across iOS, Android, Windows, web seamlessly.

7. **CI/CD pipeline**: GitHub Actions → Netlify deploying main branch automatically.

**Phase 08 (Stripe + Security + Launch)** will add billing, security hardening, and production launch preparation.
