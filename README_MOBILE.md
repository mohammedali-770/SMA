# 📱 Spicy Meal - Expo EAS Build Mobile Wrapper

This directory is fully configured with a production-grade **Expo Mobile Wrapper** that allows you to bundle and build your responsive Saudi Food Delivery & POS web application into native `.apk`, `.aab` (Android), and `.ipa` (iOS) binaries using **Expo Application Services (EAS Build)**.

The mobile shell wraps the localized web interface in a performance-optimized fullscreen native `WebView` container.

---

## ✨ Enterprise-Grade Mobile Features Included

1. **Android Hardware Back Button Integration**: Intercepts physical back clicks on Android. It navigates backwards through the webview's internal history instead of instantly crashing or quitting the app (the industry standard for polished store wrapper apps).
2. **Beautiful Custom Native Loader**: While the web page is loading for the first time, users see a polished custom screen with a large glowing Spicy Meal icon 🌶️, brand titles, and a localized Saudi Arabic/English welcome message alongside an activity spinner.
3. **Smart Offline & Failure State**: If there is no internet connection or if the web service undergoes maintenance (e.g. status code >= 400), a beautiful native fallback screen is shown with a connection check guide and a tap-to-retry mechanism.
4. **Notch & Safe Area Support**: Fully integrates with native Safe Areas (`react-native-safe-area-context`) to ensure headers and touch elements never overlap with hardware notches, the Dynamic Island (iOS), or home swipe indicators.
5. **Expo Status Bar Syncing**: Programmatically sets the Android status bar and iOS top bar colors to match our brand deep-violet background (`#422e87`) with high-contrast light labels.

---

## 🛠️ Step-by-Step EAS Build Instructions

To build native applications, you must install the Expo development CLI on your machine and run the cloud-based EAS compiler. Follow these simple steps:

### 1. Prerequisite Packages (Native Shell Dependencies)
Before starting, ensure that these standard Expo wrapper dependencies are populated if you build locally or when initializing. If you run in this directory, install the mobile packages as dev dependencies or move them to a mobile subfolder:
```bash
# Add native dependencies
npm install react-native react-native-webview react-native-safe-area-context expo-status-bar expo-build-properties
# Add expo build utilities globally
npm install -g eas-cli
```

### 2. Configure & Log In to Expo (EAS)
Log in to your Expo account (create one for free at [expo.dev](https://expo.dev)):
```bash
# Login via terminal
eas login
```

Once logged in, link this project to your Expo account dashboard:
```bash
# This creates/retrieves an Expo Project ID and links it in your configurations
eas project:init
```
*Note: This command will automatically update the `projectId` field inside your `app.json`.*

### 3. Start Local Development (Optional)
To test the mobile wrapper locally on your physical device (using the Expo Go app) or on an iOS/Android Simulator:
```bash
# Launch local developer server
npx expo start
```
- Open **Expo Go** on your iPhone/Android.
- Scan the QR code displayed in your terminal to see the live app load instantly.

---

## 🚀 Running EAS Cloud Builds

With EAS Build, you do not need Xcode (Mac) or Android Studio (Windows) installed on your machine. The builds are compiled securely in the cloud.

### 🍏 Build for Apple iOS
To compile an App Store ready `.ipa` file or a simulator binary:
```bash
# Build for App Store / TestFlight distribution
eas build --platform ios --profile production

# Build for testing on an iOS Simulator
eas build --platform ios --profile preview
```

### 🤖 Build for Google Android
To compile an Android package:
```bash
# Build a universal testing .apk file (perfect for instant sharing/sideloading)
eas build --platform android --profile preview

# Build an App Bundle (.aab) ready to submit to the Google Play Console
eas build --platform android --profile production
```

---

## 🌐 Dynamic URL Updates
To point your mobile app to a different domain (e.g., local staging or a custom branded domain):
1. Open the `/App.js` file.
2. Locate the `WEB_APP_URL` variable at the top of the file:
   ```javascript
   const WEB_APP_URL = 'https://ais-pre-jpn4zie7guhsch4aclhgog-275700298674.europe-west2.run.app';
   ```
3. Change it to your desired web domain, save, and rebuild!

---

## 📦 Directory Structure Mapping
- `app.json`: Expo application name, bundle identifiers (`com.spicymeal.app`), permissions (Camera, Location, Internet), and adaptive icon themes.
- `eas.json`: Compiling profile settings (Development, Preview, and Production).
- `App.js`: Screen loader, offline fallback, back navigation binder, and Webview runner.
- `metro.config.js`: Module resolution bundler for React Native bundles.
- `babel.config.js`: Preset configuration for ES6 / TypeScript decorators.
