/**
 * Sticky place-order footer.
 *
 * Information hierarchy, top to bottom — this order is the whole reason the
 * footer is its own component:
 *   1. the blocking problem + the exact fix — loudest;
 *   2. any submit error;
 *   3. the action itself;
 *   4. legal consent — smallest and quietest, still fully legible and
 *      link-accessible.
 *
 * The legal paragraph used to sit ABOVE the block reason at the same size, so
 * the policy text dominated the screen while the reason the button was dead
 * read as a footnote. Reduced prominence, never reduced availability: the links
 * keep AA contrast and are never hidden behind a disclosure.
 *
 * The consent line uses the platform Text, not the design-system one: inline
 * links have to compose inside a SINGLE text node to wrap correctly, so the
 * fonts and tokens are applied directly here. Same reasoning as the login
 * screen's legal footer.
 */
import React from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';

import { color, fontFamily, space, type as typeScale } from '../../../design-system/generated/tokens';
import { Button } from '../../../design-system/ui/Button';
import { Notice } from '../../../design-system/ui/Notice';
import { useI18n } from '../../../i18n/I18nProvider';
import { CONTENT_MAX_WIDTH } from './layout';
import { makeStyles } from '../../../theme/makeStyles';
import { useThemeColors } from '../../../theme/ThemeProvider';

export interface LegalLink {
  key: string;
  title: string;
  onPress: () => void;
}

export function CheckoutFooter({
  block,
  error,
  submitLabel,
  submitDisabled,
  submitting,
  onSubmit,
  consentPrefix,
  consentSeparator,
  consentLastSeparator,
  links,
  paddingBottom,
}: {
  block: { title: string; action: string | null; amount?: number; amountLabel?: string } | null;
  error: string | null;
  submitLabel: string;
  submitDisabled: boolean;
  submitting: boolean;
  onSubmit: () => void;
  consentPrefix: string;
  consentSeparator: string;
  consentLastSeparator: string;
  links: LegalLink[];
  paddingBottom: number;
}) {
  const styles = useStyles();
  const colors = useThemeColors();
  const { lang, rtlText } = useI18n();
  const bodyFamily = lang === 'ar' ? fontFamily.ar.regular : fontFamily.en.regular;
  const linkFamily = lang === 'ar' ? fontFamily.ar.semibold : fontFamily.en.semibold;

  return (
    <View style={[styles.footer, { paddingBottom }]}>
      <View style={styles.column}>
      {block ? (
        <Notice
          title={block.title}
          action={block.action}
          amount={block.amount}
          amountLabel={block.amountLabel}
          tone="blocking"
        />
      ) : null}
      {error ? <Notice title={error} tone="blocking" /> : null}

      <Button
        label={submitLabel}
        onPress={onSubmit}
        disabled={submitDisabled}
        loading={submitting}
        variant="primary"
      />

      <RNText style={[styles.consent, rtlText, { fontFamily: bodyFamily, color: colors.appText3 }]}>
        {consentPrefix}
        {links.map((l, i) => (
          <RNText key={l.key}>
            <RNText
              accessibilityRole="link"
              onPress={l.onPress}
              style={[styles.link, { fontFamily: linkFamily, color: colors.ember }]}
            >
              {l.title}
            </RNText>
            {i < links.length - 2 ? consentSeparator : i === links.length - 2 ? consentLastSeparator : ''}
          </RNText>
        ))}
        {'.'}
      </RNText>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // The bar spans the full width (so it reads as a floor), but its CONTENTS are
  // capped to the same column as the page above — otherwise on a tablet the
  // action drifts away from the summary it confirms.
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.appSurface,
    borderTopWidth: 1, borderTopColor: colors.appLine,
    paddingHorizontal: space.s4, paddingTop: space.s3,
  },
  column: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', gap: space.s2 },
  consent: {
    fontSize: typeScale.caption.size,
    lineHeight: typeScale.caption.lineHeight + 3,
    textAlign: 'center',
  },
  link: { fontSize: typeScale.caption.size },
}));
