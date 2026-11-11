/**
 * Native build: re-export react-native-webview untouched, so the payment screen
 * gets the real WebView. The .web variant of this module replaces it with a
 * clear unsupported state, because a browser build cannot host the in-app
 * payment WebView.
 */
export { WebView } from 'react-native-webview';
