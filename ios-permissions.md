# iOS Permissions — PowerOn Hub

Copy-paste these entries into `ios/App/App/Info.plist` after running `npx cap add ios`.
Place them inside the top-level `<dict>` element.

```xml
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- PowerOn Hub — iOS Permission Entries                                   -->
<!-- Copy everything between the XML comments into Info.plist <dict> block  -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

<!-- Microphone — ECHO voice assistant + STT -->
<key>NSMicrophoneUsageDescription</key>
<string>PowerOn Hub uses the microphone for voice commands and the ECHO voice assistant.</string>

<!-- Speech Recognition — Whisper STT fallback on-device -->
<key>NSSpeechRecognitionUsageDescription</key>
<string>PowerOn Hub uses speech recognition to convert voice commands to text.</string>

<!-- Camera — Receipt scanning for material cost tracking -->
<key>NSCameraUsageDescription</key>
<string>PowerOn Hub uses the camera to scan material receipts and capture job site photos.</string>

<!-- Photo Library — Upload receipt images from gallery -->
<key>NSPhotoLibraryUsageDescription</key>
<string>PowerOn Hub accesses your photo library to upload receipt images for cost tracking.</string>

<!-- Location — Job site mileage tracking -->
<key>NSLocationWhenInUseUsageDescription</key>
<string>PowerOn Hub uses your location to auto-fill job site addresses and calculate mileage.</string>

<!-- Calendar — CHRONO Google Calendar sync -->
<key>NSCalendarsUsageDescription</key>
<string>PowerOn Hub syncs your schedule with the CHRONO calendar agent.</string>

<!-- Contacts — GC Contact directory sync -->
<key>NSContactsUsageDescription</key>
<string>PowerOn Hub accesses contacts to sync your general contractor contact directory.</string>

<!-- Push Notifications — handled by Capacitor PushNotifications plugin -->
<!-- No Info.plist entry needed; Capacitor manages the entitlement -->

<!-- Face ID / Touch ID — Biometric auth for passcode bypass -->
<key>NSFaceIDUsageDescription</key>
<string>PowerOn Hub uses Face ID for quick authentication.</string>
```

## Android Permissions

Add to `android/app/src/main/AndroidManifest.xml` inside the `<manifest>` tag:

```xml
<!-- Microphone — ECHO voice assistant -->
<uses-permission android:name="android.permission.RECORD_AUDIO" />

<!-- Camera — Receipt scanning -->
<uses-permission android:name="android.permission.CAMERA" />

<!-- Location — Mileage tracking -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />

<!-- Calendar — CHRONO sync -->
<uses-permission android:name="android.permission.READ_CALENDAR" />
<uses-permission android:name="android.permission.WRITE_CALENDAR" />

<!-- Contacts — GC directory -->
<uses-permission android:name="android.permission.READ_CONTACTS" />

<!-- Network -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

<!-- Vibration — Haptic feedback -->
<uses-permission android:name="android.permission.VIBRATE" />

<!-- Push Notifications (Android 13+) -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<!-- Biometric auth -->
<uses-permission android:name="android.permission.USE_BIOMETRIC" />
```

## Capacitor Sync Command

```bash
# After adding permissions, sync web assets to native projects:
npm run build && npx cap sync
npx cap open ios    # Opens in Xcode
npx cap open android  # Opens in Android Studio
```
