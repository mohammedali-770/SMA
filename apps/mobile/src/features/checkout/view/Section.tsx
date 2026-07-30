/**
 * One checkout section: a heading and its body.
 *
 * Checkout is a long single column, so the ONE thing that has to be consistent
 * is the rhythm between sections — heading size, the gap under it, and the gap
 * to the next section. Restating that in nine places is how a screen ends up
 * with three slightly different spacings that nobody can see individually but
 * that make the page feel unresolved.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { space } from '../../../design-system/generated/tokens';
import { Text } from '../../../design-system/ui/Text';

export function Section({
  title,
  children,
  style,
}: {
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ gap: space.s3 }, style]}>
      {title ? <Text variant="title">{title}</Text> : null}
      {children}
    </View>
  );
}
