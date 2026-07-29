/**
 * Theme-aware replacement for a module-scope `StyleSheet.create`.
 *
 * `StyleSheet.create({ color: colors.ink })` evaluates when the module loads, so
 * the colour is baked in and can never change theme — which is why every screen
 * in this app was light-only. `makeStyles` takes the same object as a FUNCTION
 * of the palette and returns a hook that resolves it for whichever theme is
 * active:
 *
 *   const useStyles = makeStyles((colors) => ({ root: { color: colors.ink } }));
 *   // inside the component:
 *   const styles = useStyles();
 *
 * Naming the parameter `colors` is deliberate: it shadows the module import, so
 * an existing stylesheet body needs no edits at all when it is converted.
 *
 * There are exactly two palette objects and their identities are stable, so the
 * cache holds at most two entries per stylesheet and `StyleSheet.create` runs
 * once per theme rather than on every render.
 */
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import { useThemeColors } from './ThemeProvider';
import type { Palette } from './index';

/**
 * StyleSheet.create's own constraint. Using it verbatim is what keeps literal
 * inference working: `alignItems: 'center'` has to narrow to FlexAlignType, and
 * a looser bound like `Record<string, unknown>` widens it to `string`, which
 * then fails against every View/Text style prop in the app.
 */
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

export function makeStyles<T extends NamedStyles<T> | NamedStyles<Record<string, unknown>>>(
  factory: (colors: Palette) => T,
) {
  const cache = new Map<Palette, T>();
  return function useStyles(): T {
    const colors = useThemeColors();
    let sheet = cache.get(colors);
    if (!sheet) {
      sheet = StyleSheet.create(factory(colors));
      cache.set(colors, sheet);
    }
    return sheet;
  };
}
