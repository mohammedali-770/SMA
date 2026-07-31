/**
 * The responsive content column.
 *
 * Every customer screen is ONE column of decisions. On a tablet, letting that
 * column run the full width turns a 40-character line into a 120-character one
 * and drags a money value metres away from the label it belongs to. Below the
 * cap — every phone — this changes nothing at all.
 *
 * This is the pattern Checkout adopted first, promoted here verbatim so the
 * other screens share it rather than each inventing a slightly different
 * number. Two pieces, and both are needed:
 *
 *   `centered`  goes on the SCROLL CONTENT CONTAINER (or any parent): it
 *               centres the child horizontally via `alignItems`.
 *   `column`    goes on the CHILD: `width: '100%'` up to the cap.
 *
 * `alignItems` on the parent plus `width: '100%'` on the child — NOT
 * `alignSelf` on the content container itself. The latter centres on web but is
 * not dependable for a ScrollView's content container on native, which would
 * leave a tablet column pinned to the reading edge instead of centred.
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/** Widest the content column ever gets. */
export const CONTENT_MAX_WIDTH = 640;

export const columnStyles = StyleSheet.create({
  /** For the scrolling/flex parent. */
  centered: { alignItems: 'center' },
  /** For the child that holds the actual content. */
  column: { width: '100%', maxWidth: CONTENT_MAX_WIDTH },
});

/**
 * Convenience wrapper for the common case: a capped, centred column inside an
 * already-centred parent. Screens that need to pass their own gap/padding can
 * use `columnStyles` directly instead.
 */
export function ContentColumn({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[columnStyles.column, style]}>{children}</View>;
}
