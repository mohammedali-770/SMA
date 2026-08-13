/** Spacious, collision-safe order-history card. */
import React from 'react';
import { Pressable, View } from 'react-native';
import { Price } from '../../../components/Price';
import { priceAccessibilityLabel } from '../../../design-system/generated/money';
import { radius, space, type as typeScale } from '../../../design-system/generated/tokens';
import { StatusPill, type ChipTone } from '../../../design-system/ui/Chip';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';
import { orderDisplayNumber } from '../../../lib/mappers';
import { makeStyles } from '../../../theme/makeStyles';
import { useThemeColors } from '../../../theme/ThemeProvider';
import type { Order, OrderStatus } from '../../../types/models';
import { formatRiyadhDateTime } from '../../../utils/format';
import { confirmationPresentation, orderConfirmationState } from '../orderConfirmation';
import { TONE_CHIP } from './confirmationTone';
function statusTone(status:OrderStatus):ChipTone{return status==='delivered'?'success':status==='cancelled'?'danger':'info';}
function visibleBranchNumber(order:Pick<Order,'lazywaitOrderNumber'>):string|null{const raw=orderDisplayNumber(order);return raw?`#${raw.replace(/^#/,'')}`:null;}
export function OrderCard({order,statusLabel,onPress}:{order:Order;statusLabel:string;onPress:()=>void}){
  const styles=useStyles();const colors=useThemeColors();const{t,pick,lang,isRTL,rtlRow}=useI18n();const branchNo=visibleBranchNumber(order);const confirmation=confirmationPresentation(orderConfirmationState(order));const itemCount=order.items.reduce((n,it)=>n+it.quantity,0);const totalLabel=priceAccessibilityLabel(order.total,lang);const orderType=order.orderType==='delivery'?t('delivery'):t('pickup');const branchName=pick(order.branchNameEn,order.branchNameAr);
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${branchNo??t(confirmation.titleKey)} · ${statusLabel} · ${totalLabel}`} style={({pressed})=>[styles.card,pressed&&styles.pressed]}>
    <View style={[styles.header,rtlRow]}><View style={styles.referenceBlock}><Text variant="title" numberOfLines={1}>{branchNo??t('orderHistory')}</Text><Text variant="caption" tone="tertiary">{formatRiyadhDateTime(order.createdAt)}</Text></View><StatusPill label={statusLabel} tone={statusTone(order.status)}/></View>
    <View style={styles.confirmationBlock}><StatusPill label={t(confirmation.titleKey)} tone={TONE_CHIP[confirmation.tone]}/></View>
    <View style={styles.details}><View style={[styles.detailRow,rtlRow]}><Text variant="caption" tone="secondary">{pick('Order type','نوع الطلب')}</Text><Text variant="label">{orderType}</Text></View><View style={[styles.detailRow,rtlRow]}><Text variant="caption" tone="secondary">{pick('Branch','الفرع')}</Text><Text variant="label" numberOfLines={2} style={styles.detailValue}>{branchName||'—'}</Text></View><View style={[styles.detailRow,rtlRow]}><Text variant="caption" tone="secondary">{pick('Items','العناصر')}</Text><Text variant="label">{itemCount}</Text></View></View>
    <View style={[styles.totalRow,rtlRow]}><Text variant="body" tone="secondary">{pick('Total','المبلغ')}</Text><Price amount={order.total} size={typeScale.title.size} color={colors.appText} weight="700"/></View>
    <View style={[styles.footer,rtlRow]}><Text variant="label" tone="ember">{t('viewReceipt')}</Text><Text variant="title" tone="ember">{isRTL?'‹':'›'}</Text></View>
  </Pressable>;
}
const useStyles=makeStyles((c)=>({card:{backgroundColor:c.appSurface,borderRadius:radius.lg,borderCurve:'continuous' as const,borderWidth:1,borderColor:c.appLine,padding:space.s4,gap:space.s3},pressed:{opacity:.9},header:{flexDirection:'row' as const,alignItems:'flex-start' as const,justifyContent:'space-between' as const,gap:space.s3},referenceBlock:{flex:1,gap:2},confirmationBlock:{alignSelf:'flex-start' as const},details:{gap:space.s2,paddingVertical:space.s2,borderTopWidth:1,borderTopColor:c.appLine},detailRow:{flexDirection:'row' as const,alignItems:'flex-start' as const,justifyContent:'space-between' as const,gap:space.s4},detailValue:{flex:1},totalRow:{flexDirection:'row' as const,alignItems:'center' as const,justifyContent:'space-between' as const,borderTopWidth:1,borderTopColor:c.appLine,paddingTop:space.s3},footer:{flexDirection:'row' as const,alignItems:'center' as const,justifyContent:'space-between' as const,minHeight:36}}));
