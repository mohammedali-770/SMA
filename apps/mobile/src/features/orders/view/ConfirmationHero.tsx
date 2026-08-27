/** Customer-facing receipt hero driven only by authoritative order state. */
import React from 'react';
import { View } from 'react-native';
import { AlertIcon, CheckCircleIcon, ClockIcon } from '../../../components/Icons';
import { Logo } from '../../../components/Logo';
import { fontFamily, radius, space, type as typeScale } from '../../../design-system/generated/tokens';
import { Button } from '../../../design-system/ui/Button';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';
import { confirmationPresentation, orderConfirmationState, type CustomerOrderState } from '../orderConfirmation';
import { orderDisplayNumber } from '../../../lib/mappers';
import { TONE_COLOR } from './confirmationTone';
import type { Order } from '../../../types/models';
import { makeStyles } from '../../../theme/makeStyles';

function manualFlowBody(state:CustomerOrderState,pick:(en:string,ar:string)=>string,fallback:string):string{
  if(state==='sending_to_branch')return pick('Your order is being sent to the branch now. You can leave this screen and check the latest status in My Orders.','يتم إرسال طلبك إلى الفرع الآن. يمكنك مغادرة هذه الشاشة ومتابعة آخر حالة من صفحة طلباتي.');
  if(state==='verifying_with_branch')return pick('We could not verify whether the branch received this order. Please do not resend it while we verify, because it may already exist at the branch.','تعذر التحقق مما إذا كان الفرع قد استلم هذا الطلب. لا تُعد إرساله أثناء التحقق لأنه قد يكون موجوداً بالفعل لدى الفرع.');
  if(state==='branch_failed_retry_available')return pick('Your payment was successful, but this order was not sent to the branch. Tap Resend order below when you want to try again. Nothing will be resent automatically.','تم الدفع بنجاح، لكن هذا الطلب لم يُرسل إلى الفرع. اضغط «إعادة إرسال الطلب» أدناه عندما ترغب بالمحاولة مرة أخرى. لن تتم إعادة الإرسال تلقائياً.');
  if(state==='unpaid_branch_failed_retry_available')return pick('This order was not sent to the branch. Tap Resend order below when you want to try again. Nothing will be resent automatically.','لم يُرسل هذا الطلب إلى الفرع. اضغط «إعادة إرسال الطلب» أدناه عندما ترغب بالمحاولة مرة أخرى. لن تتم إعادة الإرسال تلقائياً.');
  return fallback;
}

export function ConfirmationHero({order,onResend,resending,resendError}:{order:Order;onResend:()=>void;resending:boolean;resendError:string|null;}){
  const styles=useStyles();const{t,pick}=useI18n();const state=orderConfirmationState(order);const p=confirmationPresentation(state);const tone=TONE_COLOR[p.tone];const body=manualFlowBody(state,pick,t(p.bodyKey));
  // VERBATIM. Lazywait issues the number already prefixed ("#1", "#10"), and
  // that string is what the branch's own screens show — so stripping the "#"
  // would print something the cashier cannot match against their system.
  // Whatever the POS returns is what appears here, unaltered.
  const branchNumber=orderDisplayNumber(order);
  return <View style={styles.wrap} accessible accessibilityLiveRegion="polite" accessibilityLabel={[p.showBranchNumber?`${t('oc_branch_order_number')} ${branchNumber??t('oc_number_pending')}`:null,t(p.titleKey),body].filter(Boolean).join('. ')}>
    {/* The cashier is handed a phone: they need to see WHOSE order this is —
        which is why this is `hero` (64px) and not `compact` (30px, sized for a
        dense header). At 30px, alone above a 72px number, it read as a stray
        icon rather than the brand identifying the order. */}
    <Logo hero />

    {/* THE thing this screen exists to show across a counter. Always LTR so a
        two-digit number can never render reversed in an Arabic layout.

        GATED on p.showBranchNumber, which is the whole point of that flag. The
        card used to render unconditionally — the flag had no consumer at all —
        so an order on a channel with NO POS step still read "not issued yet"
        above "it will appear here as soon as the branch issues it". For a
        delivery order that promise can never come true. */}
    {p.showBranchNumber ? (
      <View style={styles.numberCard}>
        <Text variant="label" tone="tertiary" align="center" style={styles.numberLabel}>{t('oc_branch_order_number')}</Text>
        {branchNumber
          ? <Text align="center" style={styles.number} accessibilityElementsHidden>{branchNumber}</Text>
          : <><Text variant="title" tone="tertiary" align="center">{t('oc_number_pending')}</Text>
              <Text variant="caption" tone="tertiary" align="center">{t('oc_number_pending_hint')}</Text></>}
      </View>
    ) : null}

    {/* Reassurance, not the headline: once the number is visible the customer
        has what they came for, so the state becomes a compact pill. */}
    <View style={[styles.pill,{backgroundColor:tone.bg,borderColor:tone.line}]}>
      {p.success?<CheckCircleIcon size={16} color={tone.fg}/>:p.tone==='danger'?<AlertIcon size={16} color={tone.fg}/>:<ClockIcon size={16} color={tone.fg}/>}
      <Text variant="label" style={{color:tone.fg}}>{t(p.titleKey)}</Text>
    </View>
    <Text variant="body" tone="secondary" align="center">{body}</Text>

    {p.canResend?<View style={styles.action}><Button label={resending?t('oc_resending'):t('oc_resend')} onPress={onResend} loading={resending} variant="primary"/>{resendError?<Text variant="label" tone="danger" align="center" accessibilityLiveRegion="polite">{resendError}</Text>:null}</View>:null}
    {order.refundState&&order.refundState!=='none'?<View style={[styles.refund,{backgroundColor:tone.bg,borderColor:tone.line}]}><Text variant="label" tone="secondary">{t('oc_refund_status')}</Text><Text variant="heading" style={{color:tone.fg}}>{order.refundState==='refunded'?t('oc_refunded'):order.refundState==='failed'?t('oc_refund_failed'):t('oc_refund_pending')}</Text></View>:null}
  </View>;
}
const useStyles=makeStyles((color)=>({
  wrap:{alignItems:'center' as const,paddingVertical:space.s5,gap:space.s2},
  numberCard:{alignSelf:'stretch' as const,marginTop:space.s3,paddingVertical:space.s4,paddingHorizontal:space.s3,backgroundColor:color.appSurface,borderWidth:1.5,borderColor:color.appLine,borderRadius:radius.xl,borderCurve:'continuous' as const,alignItems:'center' as const,gap:2},
  numberLabel:{letterSpacing:0.6},
  // Sized to be read at arm's length across a counter, not on a phone held close.
  number:{fontSize:72,lineHeight:78,color:color.ember,fontFamily:fontFamily.num.semibold,writingDirection:'ltr' as const},
  pill:{flexDirection:'row' as const,alignItems:'center' as const,gap:space.s2,paddingVertical:space.s2,paddingHorizontal:space.s3,borderRadius:radius.pill,borderWidth:1,marginTop:space.s3},
  badge:{width:76,height:76,borderRadius:38,alignItems:'center' as const,justifyContent:'center' as const,borderWidth:1,marginBottom:space.s2},action:{alignSelf:'stretch' as const,marginTop:space.s3,gap:space.s2},refund:{alignSelf:'stretch' as const,marginTop:space.s3,padding:space.s3,borderWidth:1,borderRadius:radius.md,borderCurve:'continuous' as const,gap:2}}));
