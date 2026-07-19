/**
 * Native build: re-export react-native-webview untouched, so the FROZEN Tap
 * hosted-checkout flow keeps the exact same component and behavior. The .web
 * variant of this module replaces it with a clean unsupported state (browser
 * builds cannot host the in-app checkout WebView).
 */
export { WebView } from 'react-native-webview';
