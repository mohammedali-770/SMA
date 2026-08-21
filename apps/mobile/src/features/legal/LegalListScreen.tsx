/** Profile → Legal & Support: support channels, policies, then account privacy. */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from 'react-native';

import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { useI18n } from '../../i18n/I18nProvider';
import { failureMessage } from '../../lib/errors/reportFailure';
import { legalDocOrder } from '../../lib/legal';
import { supportDescription, visibleSupportChannels, workingHoursText, type SupportChannelKind } from '../../lib/supportContact';
import { legal } from '../../services/api';
import { useCatalog } from '../../store';
import { radius, space, type as typeScale } from '../../design-system/generated/tokens';
import { Text } from '../../design-system/ui/Text';
import type { DbLegalDocument } from '../../types/db';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';

const CHANNEL_EMOJI: Record<SupportChannelKind, string> = { phone: '📞', whatsapp: '💬', email: '✉️' };

export function LegalListScreen() {
  const styles = useStyles(); const colors = useThemeColors(); const { t, pick, lang, isRTL, rtlRow } = useI18n(); const { support } = useCatalog();
  const [docs, setDocs] = useState<DbLegalDocument[] | null>(null); const [error, setError] = useState<string | null>(null); const [openError, setOpenError] = useState(false);
  const load = () => { setError(null); setDocs(null); legal.list().then((rows) => setDocs(rows.slice().sort((a, b) => legalDocOrder(a.document_type) - legalDocOrder(b.document_type)))).catch((e) => setError(failureMessage(e, t, { subsystem: 'app', op: 'load_legal_docs' }))); };
  useEffect(load, []);
  const channels = visibleSupportChannels(support); const hours = workingHoursText(support, lang); const desc = supportDescription(support, lang);
  const channelLabel: Record<SupportChannelKind, string> = { phone: t('callSupport'), whatsapp: t('whatsappSupport'), email: t('emailSupport') };
  const openChannel = (url: string) => { setOpenError(false); Linking.openURL(url).catch(() => setOpenError(true)); };
  return <Screen background={colors.appBg} edges={['top','left','right']}><Header title={t('legalSupport')} showBack />
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {channels.length>0||hours||desc?<View style={styles.supportCard}><Text variant="title">{t('supportTitle')}</Text>{desc?<Text variant="caption" tone="secondary">{desc}</Text>:null}
        {channels.map((c)=><Pressable key={c.kind} onPress={()=>openChannel(c.url)} style={({pressed})=>[styles.supportRow,rtlRow,pressed&&styles.pressed]} accessibilityRole="button" accessibilityLabel={channelLabel[c.kind]}><Text variant="title" style={styles.emoji}>{CHANNEL_EMOJI[c.kind]}</Text><View style={{flex:1}}><Text variant="label">{channelLabel[c.kind]}</Text><Text variant="caption" tone="secondary" numberOfLines={1}>{c.display}</Text></View><Text variant="title" tone="ember">{isRTL?'‹':'›'}</Text></Pressable>)}
        {hours?<View style={[styles.supportRow,rtlRow]}><Text variant="title" style={styles.emoji}>🕘</Text><View style={{flex:1}}><Text variant="label">{t('workingHours')}</Text><Text variant="caption" tone="secondary">{hours}</Text></View></View>:null}{openError?<Text variant="label" tone="danger">{t('supportOpenFailed')}</Text>:null}</View>:null}
      {docs===null&&!error?<View style={styles.stateCard}><ActivityIndicator color={colors.ember}/><Text variant="body" tone="secondary" align="center">{t('loading')}</Text></View>:null}
      {error?<Pressable onPress={load} accessibilityRole="button" accessibilityLabel={t('retry')} style={({pressed})=>[styles.stateCard,pressed&&styles.pressed]}><Text variant="label" tone="danger" align="center">{pick('Could not load documents.','تعذّر تحميل المستندات.')}</Text><Text variant="label" tone="ember" align="center">{t('retry')}</Text></Pressable>:null}
      {docs?.map((d)=><Pressable key={d.id} onPress={()=>router.push(`/legal/${d.document_type}`)} style={({pressed})=>[styles.row,rtlRow,pressed&&styles.pressed]} accessibilityRole="button"><Text variant="label" style={styles.rowText} numberOfLines={2}>{pick(d.title_en,d.title_ar)}</Text><Text variant="title" tone="ember">{isRTL?'‹':'›'}</Text></Pressable>)}
      {docs?.length===0?<Text variant="body" tone="secondary" align="center" style={styles.empty}>{pick('No documents available.','لا توجد مستندات متاحة.')}</Text>:null}
      <Pressable onPress={()=>router.push('/profile/account')} style={({pressed})=>[styles.row,rtlRow,pressed&&styles.pressed]} accessibilityRole="button" accessibilityLabel={pick('Account & privacy','الحساب والخصوصية')}><Text variant="label" style={styles.rowText}>{pick('Account & privacy','الحساب والخصوصية')}</Text><Text variant="title" tone="ember">{isRTL?'‹':'›'}</Text></Pressable>
    </ScrollView>
  </Screen>;
}
const useStyles=makeStyles((colors)=>({scroll:{padding:space.s4,paddingBottom:space.s6,gap:space.s2},supportCard:{backgroundColor:colors.appSurface,borderRadius:radius.lg,borderCurve:'continuous' as const,borderWidth:1,borderColor:colors.appLine,padding:space.s4,gap:space.s2,marginBottom:space.s1},supportRow:{flexDirection:'row' as const,alignItems:'center' as const,gap:space.s3,paddingVertical:space.s2},emoji:{lineHeight:typeScale.title.lineHeight},pressed:{opacity:.7},row:{flexDirection:'row' as const,alignItems:'center' as const,gap:space.s3,backgroundColor:colors.appSurface,borderRadius:radius.lg,borderCurve:'continuous' as const,borderWidth:1,borderColor:colors.appLine,padding:space.s4},rowText:{flex:1},stateCard:{minHeight:88,alignItems:'center' as const,justifyContent:'center' as const,gap:space.s2,backgroundColor:colors.appSurface,borderRadius:radius.lg,borderWidth:1,borderColor:colors.appLine,padding:space.s4},empty:{marginTop:space.s5}}));
