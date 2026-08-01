/**
 * Saved addresses — list, make default, delete, and the way in to the editor.
 *
 * Reads and writes the shared address book (store/AddressProvider), never
 * `services/api` directly, so anything done here is visible immediately in
 * Checkout and the order-type gate without a restart. That is the whole reason
 * the book exists; going around it would put this screen back in the position
 * the old per-screen `useState` lists were in.
 *
 * Deleting the address the customer is CURRENTLY ordering to clears the order
 * context. The context caches a copy of the address (id, coordinates, landmark),
 * so leaving it in place would hand `place_order` an id that no longer resolves.
 * The blocking gate then re-asks — one tap, against a book that is now correct.
 */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import { color, space } from '../../design-system/generated/tokens';
import { Button } from '../../design-system/ui/Button';
import { columnStyles } from '../../design-system/ui/ContentColumn';
import { Notice } from '../../design-system/ui/Notice';
import { Text } from '../../design-system/ui/Text';
import { ConfirmDialog } from '../checkout/view/Dialog';
import { AddressCard } from './view/AddressCard';
import { contextNeedsReset, NEW_ADDRESS } from '../../store/addressBook';
import { useI18n } from '../../i18n/I18nProvider';
import { useAddressBook, useOrderContext } from '../../store';
import type { SavedAddress } from '../../types/models';

export function AddressListScreen() {
  const { t } = useI18n();
  const book = useAddressBook();
  const orderCtx = useOrderContext();

  // The address awaiting confirmation. Holding the ROW (not just an id) keeps
  // its name in the dialog, so the customer confirms a specific address rather
  // than "an address".
  const [confirming, setConfirming] = useState<SavedAddress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // `book.error` is one app-wide field, and nothing on a navigation path clears
  // it. Without this, a delete that failed here still showed as a red banner
  // when the customer came back — or, worse, on the editor for a different
  // address. An error belongs to the attempt that produced it, not to the book
  // forever.
  const { clearError } = book;
  useEffect(() => { clearError(); }, [clearError]);

  const openEditor = (id: string) => router.push(`/profile/address/${id}`);

  const refresh = async () => {
    setRefreshing(true);
    setNotice(null);
    try { await book.reload(); } finally { setRefreshing(false); }
  };

  const confirmDelete = async () => {
    const target = confirming;
    if (!target) return;
    setConfirming(null);
    // Read the flag BEFORE the delete: once the row is gone the context still
    // points at it, and that is exactly what has to be repaired.
    const wasActive = contextNeedsReset(orderCtx.context, target.id);
    try {
      await book.remove(target.id);
      if (wasActive) {
        orderCtx.clear();
        setNotice(t('addrContextReset'));
      } else {
        setNotice(t('addrDeleted'));
      }
    } catch {
      // The book already holds the customer-facing message; the Notice below
      // renders it. Nothing to add here, and nothing was deleted.
    }
  };

  const makeDefault = async (id: string) => {
    setNotice(null);
    try { await book.setDefault(id); } catch { /* surfaced via book.error */ }
  };

  const loading = book.status === 'loading' && book.addresses.length === 0;
  const failedEmpty = book.status === 'error' && book.addresses.length === 0;

  return (
    <Screen background={color.appBg}>
      <Header title={t('addrTitle')} showBack safeTop />

      {loading ? (
        <LoadingView label={t('addrLoading')} />
      ) : failedEmpty ? (
        <ErrorView
          message={book.error ?? t('somethingWentWrong')}
          title={book.error ?? undefined}
          fallbackTitle={t('somethingWentWrong')}
          onRetry={() => { void book.reload(); }}
          retryLabel={t('addrRetry')}
        />
      ) : book.addresses.length === 0 ? (
        // The banner sits ABOVE the empty state on purpose: deleting your only
        // address is exactly when "you were ordering to this address" matters,
        // and rendering it only in the list branch meant that message was
        // unreachable in the one case that needed it.
        <View style={styles.flex}>
          {notice ? <View style={styles.emptyNotice}><Notice title={notice} tone="success" /></View> : null}
          <EmptyView
            title={t('addrEmptyTitle')}
            subtitle={t('addrEmptySub')}
            actionLabel={t('addrAdd')}
            onAction={() => openEditor(NEW_ADDRESS)}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={color.ember} />
          }
        >
          <View style={[columnStyles.column, styles.column]}>
            <Text variant="caption" tone="secondary">{t('addrManageHint')}</Text>

            {/* A failure that still left a usable list is a banner, not a
                takeover — the customer can keep using the addresses they have.
                The retry is a real control: the `action` line used to say "pull
                to retry" on a list that had no pull gesture at all. */}
            {book.error ? (
              <>
                <Notice title={book.error} tone="warning" />
                <Button
                  label={t('addrRetry')}
                  variant="secondary"
                  onPress={() => { void refresh(); }}
                  loading={refreshing}
                />
              </>
            ) : null}

            {notice ? <Notice title={notice} tone="success" /> : null}

            {book.addresses.map((a) => (
              <AddressCard
                key={a.id}
                address={a}
                busy={book.pending === a.id}
                fallbackLabel={t('addrUnnamed')}
                defaultLabel={t('addrDefault')}
                setDefaultLabel={t('addrSetDefault')}
                editLabel={t('addrEdit')}
                deleteLabel={t('addrDelete')}
                onEdit={() => openEditor(a.id)}
                onSetDefault={() => { void makeDefault(a.id); }}
                onDelete={() => { setNotice(null); setConfirming(a); }}
              />
            ))}

            <Button
              label={t('addrAdd')}
              onPress={() => openEditor(NEW_ADDRESS)}
              style={styles.add}
            />
          </View>
        </ScrollView>
      )}

      {/* Deletion is confirmed, always. The body says what survives (past
          orders) so the customer is not guessing what they are about to lose. */}
      <ConfirmDialog
        visible={confirming !== null}
        title={t('addrDeleteTitle')}
        message={
          confirming
            ? `${confirming.label || t('addrUnnamed')}\n${t('addrDeleteBody')}`
            : t('addrDeleteBody')
        }
        confirmLabel={t('addrDelete')}
        cancelLabel={t('cancel')}
        onConfirm={() => { void confirmDelete(); }}
        onCancel={() => setConfirming(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: space.s4, paddingBottom: space.s6 * 2, alignItems: 'center' },
  column: { gap: space.s3 },
  emptyNotice: { padding: space.s4, paddingBottom: 0 },
  add: { marginTop: space.s3 },
});
