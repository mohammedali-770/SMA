/**
 * The customer's name, and the one place it can be changed.
 *
 * `profiles.full_name` is seeded at signup from the auth metadata and was
 * read-only afterwards, so a typo (or an empty name, which rendered as "Guest")
 * was permanent. The name stays editable for the life of the account.
 *
 * No new customer-name field is introduced: this writes `profiles.full_name`,
 * the column `auth.myProfile()` already reads and `mapProfile` already maps to
 * `UserProfile.fullName`. On success it calls `refreshProfile()` from
 * AuthProvider, so every screen already reading that value — the identity card
 * here, and anything else consuming `useAuth().profile` — updates in place with
 * no sign-out and no restart.
 *
 * Validation, normalization and the save/refresh sequencing live in
 * `customerName.ts` (framework-free, unit-tested); this component only renders
 * the outcome.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { color, radius, space } from '../../design-system/generated/tokens';
import { Button } from '../../design-system/ui/Button';
import { Field } from '../../design-system/ui/Field';
import { Notice } from '../../design-system/ui/Notice';
import { Text } from '../../design-system/ui/Text';
import { checkCustomerName, nameCopy, nameMessage, saveCustomerName, type NameProblem } from './customerName';
import { useI18n } from '../../i18n/I18nProvider';
import { profile as profileApi } from '../../services/api';
import { useAuth } from '../../store';

export function EditableName() {
  const { lang, rtlRow, t } = useI18n();
  const { profile, refreshProfile } = useAuth();
  const copy = nameCopy[lang];

  const current = profile?.fullName ?? '';

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [problem, setProblem] = useState<NameProblem | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = () => {
    // Seed from the CURRENT profile every time, not from the last draft — an
    // abandoned edit must not reappear as the starting value.
    setDraft(current);
    setProblem(null);
    setFailed(false);
    setSaved(false);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setProblem(null);
    setFailed(false);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const outcome = await saveCustomerName(draft, current, {
        update: (fullName) => profileApi.updateName(fullName),
        refresh: () => refreshProfile(),
      });

      if (outcome.status === 'invalid') { setProblem(outcome.problem); return; }
      if (outcome.status === 'failed') { setFailed(true); return; }

      // 'saved' and 'unchanged' both close the editor. 'unchanged' issued no
      // write, so it does not claim one: only a real save shows the confirmation.
      setProblem(null);
      setSaved(outcome.status === 'saved');
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const displayName = current || t('guest');
  const initials = displayName.trim().charAt(0).toUpperCase();

  return (
    <View style={styles.card}>
      <View style={[styles.identity, rtlRow]}>
        <View style={styles.avatar}>
          <Text variant="title" tone="onEmber">{initials}</Text>
        </View>
        <View style={styles.identityBody}>
          <Text variant="heading" numberOfLines={1}>{displayName}</Text>
          {profile?.email ? (
            <Text variant="caption" tone="secondary" numberOfLines={1}>{profile.email}</Text>
          ) : null}
        </View>
        {editing ? null : (
          <Button
            label={copy.edit}
            variant="secondary"
            size="md"
            onPress={open}
            accessibilityLabel={copy.edit}
          />
        )}
      </View>

      {editing ? (
        <View style={styles.editor}>
          <Field
            id="profile-full-name"
            label={copy.label}
            required
            value={draft}
            onChangeText={(v) => { setDraft(v); if (problem) setProblem(null); }}
            // Validate on blur so the customer is not told "too short" while
            // typing the second letter of a name they have not finished.
            onBlur={() => setProblem(checkCustomerName(draft).problem)}
            error={nameMessage(problem, lang)}
            placeholder={copy.placeholder}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => { void submit(); }}
          />

          {failed ? <Notice title={copy.failed} tone="blocking" /> : null}

          <View style={[styles.actions, rtlRow]}>
            <Button label={copy.save} onPress={() => { void submit(); }} loading={busy} style={styles.action} />
            <Button label={copy.cancel} variant="ghost" onPress={cancel} disabled={busy} style={styles.action} />
          </View>
        </View>
      ) : null}

      {saved && !editing ? <Notice title={copy.saved} tone="success" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.s3,
    backgroundColor: color.appSurface,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: color.appLine,
    padding: space.s4,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  identityBody: { flex: 1, gap: 2 },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: color.ember, alignItems: 'center', justifyContent: 'center',
  },
  editor: { gap: space.s3 },
  actions: { flexDirection: 'row', gap: space.s2 },
  action: { flex: 1 },
});
