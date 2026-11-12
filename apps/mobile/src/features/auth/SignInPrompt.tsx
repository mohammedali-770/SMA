/**
 * The one "this needs an account" card, shown wherever a guest reaches a
 * feature that belongs to a customer: the Orders and Profile tabs, and
 * delivery (addresses are saved to an account).
 *
 * Its button goes to login carrying `returnTo`, so the customer comes back to
 * this exact place after signing in. `returnTo` is checked against the
 * allow-list in `returnPath.ts`; an unknown route degrades to the home tab.
 */
import { router } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';

import { Screen } from '../../components/Screen';
import { space } from '../../design-system/generated/tokens';
import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { columnStyles } from '../../design-system/ui/ContentColumn';
import { Text } from '../../design-system/ui/Text';
import { useI18n } from '../../i18n/I18nProvider';
import { useNavigationLatch } from '../../lib/useNavigationLatch';
import { makeStyles } from '../../theme/makeStyles';
import { loginHref } from './returnPath';

interface PromptProps {
  title: string;
  body: string;
  returnTo: string;
}

export function SignInPrompt({ title, body, returnTo }: PromptProps) {
  const { pick } = useI18n();
  const s = useStyles();
  // A double tap pushed login twice, so the first "Not now" left the customer
  // on a second login screen.
  const guardNavigation = useNavigationLatch();
  return (
    <Card>
      <View style={s.stack}>
        <Text variant="heading">{title}</Text>
        <Text variant="body" tone="secondary">
          {body}
        </Text>
        <Button label={pick('Sign in', 'تسجيل الدخول')} onPress={() => guardNavigation(() => router.push(loginHref(returnTo)))} />
      </View>
    </Card>
  );
}

/** A whole tab for a guest: the tab's own title, then the prompt. */
export function SignInScreen({ heading, ...prompt }: PromptProps & { heading: string }) {
  const s = useStyles();
  return (
    <Screen>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={[columnStyles.column, s.column]}>
          <Text variant="display">{heading}</Text>
          <SignInPrompt {...prompt} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  stack: { gap: space.s2 },
  scroll: { padding: space.s5, paddingBottom: space.s6, alignItems: 'center' as const },
  column: { gap: space.s4 },
}));
