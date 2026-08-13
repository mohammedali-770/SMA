/** Customer-facing receipt hero driven only by authoritative order state. */
import React from 'react';
import { View } from 'react-native';
import { AlertIcon, CheckCircleIcon, ClockIcon } from '../../../components/Icons';
import { radius, space } from '../../../design-system/generated/tokens';
import { Button } from '../../../design-system/ui/Button';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';
import { confirmationPresentation, orderConfirmationState, type CustomerOrderState } from '../orderConfirmation';
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
  return <View style={styles.wrap} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${t(p.titleKey)}. ${body}`}>
    <View style={[styles.badge,{backgroundColor:tone.bg,borderColor:tone.line}]}>{p.success?<CheckCircleIcon size={40} color={tone.fg}/>:p.tone==='danger'?<AlertIcon size={40} color={tone.fg}/>:<ClockIcon size={40} color={tone.fg}/>}</View>
    <Text variant="display" align="center" style={{color:tone.fg}}>{t(p.titleKey)}</Text><Text variant="body" tone="secondary" align="center">{body}</Text>
    {p.canResend?<View style={styles.action}><Button label={resending?t('oc_resending'):t('oc_resend')} onPress={onResend} loading={resending} variant="primary"/>{resendError?<Text variant="label" tone="danger" align="center" accessibilityLiveRegion="polite">{resendError}</Text>:null}</View>:null}
    {order.refundState&&order.refundState!=='none'?<View style={[styles.refund,{backgroundColor:tone.bg,borderColor:tone.line}]}><Text variant="label" tone="secondary">{t('oc_refund_status')}</Text><Text variant="heading" style={{color:tone.fg}}>{order.refundState==='refunded'?t('oc_refunded'):order.refundState==='failed'?t('oc_refund_failed'):t('oc_refund_pending')}</Text></View>:null}
  </View>;
}
const useStyles=makeStyles(()=>({wrap:{alignItems:'center' as const,paddingVertical:space.s5,gap:space.s2},badge:{width:76,height:76,borderRadius:38,alignItems:'center' as const,justifyContent:'center' as const,borderWidth:1,marginBottom:space.s2},action:{alignSelf:'stretch' as const,marginTop:space.s3,gap:space.s2},refund:{alignSelf:'stretch' as const,marginTop:space.s3,padding:space.s3,borderWidth:1,borderRadius:radius.md,borderCurve:'continuous' as const,gap:2}}));
