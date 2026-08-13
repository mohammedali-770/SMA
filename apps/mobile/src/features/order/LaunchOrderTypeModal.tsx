/** Mandatory fresh-launch order-type choice shown as a modal over the app. */
import { Image } from 'expo-image';
import React from 'react';
import { Modal, Pressable, View } from 'react-native';

import { BagIcon, DeliveryIcon } from '../../components/Icons';
import { radius, space } from '../../design-system/generated/tokens';
import { Text } from '../../design-system/ui/Text';
import { useI18n } from '../../i18n/I18nProvider';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';
import type { OrderType } from '../../types/models';

export function LaunchOrderTypeModal({ onChoose }: { onChoose: (type: OrderType) => void }) {
  const styles = useStyles(); const colors = useThemeColors(); const { pick, rtlRow } = useI18n();
  return <Modal visible transparent animationType="fade" onRequestClose={() => {}}><View style={styles.backdrop}><View style={styles.card}>
    <Image source={require('../../../assets/adaptive-icon.png')} style={styles.logo} contentFit="contain" />
    <Text variant="title" align="center">{pick('Choose order type','اختر نوع الطلب')}</Text>
    <Text variant="body" tone="secondary" align="center">{pick('Choose how you’d like to receive your order.','اختر طريقة استلام طلبك.')}</Text>
    <View style={[styles.choices,rtlRow]}>
      <Choice icon={<DeliveryIcon size={44} color={colors.ember}/>} title={pick('Delivery','توصيل')} subtitle={pick('Deliver to your location','نوصل طلبك إلى موقعك')} onPress={()=>onChoose('delivery')}/>
      <Choice icon={<BagIcon size={44} color={colors.ember}/>} title={pick('Pickup','استلام من الفرع')} subtitle={pick('Collect from a branch','استلم طلبك من أحد الفروع')} onPress={()=>onChoose('pickup')}/>
    </View>
  </View></View></Modal>;
}
function Choice({icon,title,subtitle,onPress}:{icon:React.ReactNode;title:string;subtitle:string;onPress:()=>void}){const styles=useStyles();return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${subtitle}`} style={({pressed})=>[styles.choice,pressed&&styles.choicePressed]}><View style={styles.iconStage}>{icon}</View><Text variant="heading" tone="ember" align="center">{title}</Text><Text variant="caption" tone="secondary" align="center">{subtitle}</Text></Pressable>;}
const useStyles=makeStyles((colors)=>({backdrop:{flex:1,alignItems:'center' as const,justifyContent:'center' as const,padding:space.s4,backgroundColor:colors.scrim},card:{width:'100%' as const,maxWidth:430,gap:space.s3,alignItems:'center' as const,padding:space.s5,borderRadius:radius.xl,borderCurve:'continuous' as const,backgroundColor:colors.appSurface,borderWidth:1,borderColor:colors.appLine},logo:{width:62,height:62},choices:{width:'100%' as const,flexDirection:'row' as const,gap:space.s3,marginTop:space.s2},choice:{flex:1,minHeight:168,alignItems:'center' as const,justifyContent:'center' as const,gap:space.s2,padding:space.s3,borderRadius:radius.lg,borderWidth:1.5,borderColor:colors.appLine,backgroundColor:colors.appSurface2},choicePressed:{borderColor:colors.ember,opacity:.9},iconStage:{width:64,height:64,borderRadius:32,alignItems:'center' as const,justifyContent:'center' as const,backgroundColor:colors.appSurface3}}));
