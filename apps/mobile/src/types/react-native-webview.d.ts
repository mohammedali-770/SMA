/**
 * TYPE-ONLY correction for react-native-webview 14.0.x. It has no runtime effect.
 *
 * WHY. 14.0.0 changed the class's default type argument from `P = {}`, as 13.x
 * declared it, to `P = undefined`:
 *
 *     declare class WebView<P = undefined> extends Component<WebViewProps & P>
 *
 * An object type intersected with `undefined` is `never`. So every
 * `<WebView …>` written without a type argument fails to typecheck, each prop
 * "not assignable to type 'never'". That includes the payment screen
 * (`src/app/payment/checkout.tsx`) and the delivery map. Correcting the type
 * once, here, keeps a dependency upgrade from having to edit either.
 *
 * HOW. `tsconfig.json` maps the exact specifier `react-native-webview` to this
 * file, for TypeScript. Metro reads the same `paths`, but Expo's resolver skips
 * an alias that resolves to no source file (`getOptionalResolve` in
 * `@expo/cli`'s `createTypescriptResolver.js`), and a `.d.ts` is never one. The
 * bundle therefore still imports the real package. That was checked by bundling,
 * not assumed.
 *
 * WHAT IT CHANGES. Only the default, back to `P = {}`. Every member is inherited
 * from the package's own class, and every other export is the package's own.
 *
 * REMOVE IT, with its `paths` entry, when the package declares `P = {}` again.
 * `webviewTypeShim.test.ts` fails on the day it does, so this cannot outlive the
 * bug it works around.
 */
import UpstreamWebView from 'react-native-webview/index';

export * from 'react-native-webview/index';

declare class WebView<P = {}> extends UpstreamWebView<P> {}

export { WebView };
export default WebView;
