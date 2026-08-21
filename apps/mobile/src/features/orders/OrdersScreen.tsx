/** Order history with compact status filters and full-width cards. */
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, View } from 'react-native';
import { AlertIcon, ReceiptIcon } from '../../components/Icons';
import { Screen } from '../../components/Screen';
import { EmptyView, ErrorView } from '../../components/StateViews';
import { space } from '../../design-system/generated/tokens';
import { SelectableChip } from '../../design-system/ui/Chip';
import { columnStyles } from '../../design-system/ui/ContentColumn';
import { Text } from '../../design-system/ui/Text';
import { useI18n } from '../../i18n/I18nProvider';
import { failureMessage } from '../../lib/errors/reportFailure';
import { mapOrder } from '../../lib/mappers';
import { orders } from '../../services/api';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';
import type { Order, OrderStatus } from '../../types/models';
import { ORDERS_PAGE_LIMIT } from './ordersRefresh';
import { OrderCard } from './view/OrderCard';
import { OrdersSkeleton } from './view/Skeletons';

const STATUS_KEY: Record<OrderStatus, 'status_received'|'status_preparing'|'status_ready'|'status_out_for_delivery'|'status_delivered'|'status_cancelled'> = { received:'status_received', preparing:'status_preparing', ready:'status_ready', out_for_delivery:'status_out_for_delivery', delivered:'status_delivered', cancelled:'status_cancelled' };
type Filter = 'all'|'active'|'delivered'|'cancelled';

export function OrdersScreen() {
  const styles = useStyles(); const colors = useThemeColors(); const { t, pick, isRTL } = useI18n();
  const [list,setList]=useState<Order[]>([]); const [filter,setFilter]=useState<Filter>('all'); const [loading,setLoading]=useState(true); const [refreshing,setRefreshing]=useState(false); const [error,setError]=useState<string|null>(null); const hasData=useRef(false);
  const load=useCallback(async(mode:'focus'|'refresh'='focus')=>{ if(mode==='refresh')setRefreshing(true); else if(!hasData.current)setLoading(true); try{const rows=await orders.listWithItems(ORDERS_PAGE_LIMIT);setList(rows.map(mapOrder));setError(null);hasData.current=true;}catch(e){if(!hasData.current)setError(failureMessage(e,t,{subsystem:'orders',op:'load_orders'}));}finally{setLoading(false);setRefreshing(false);}},[t]);
  useFocusEffect(useCallback(()=>{void load('focus');},[load]));
  const filtered=useMemo(()=>list.filter((o)=>filter==='all'?true:filter==='delivered'?o.status==='delivered':filter==='cancelled'?o.status==='cancelled':o.status!=='delivered'&&o.status!=='cancelled'),[list,filter]);
  const filters:{key:Filter;label:string}[]=[{key:'all',label:pick('All','الكل')},{key:'active',label:pick('Active','جاري')},{key:'delivered',label:pick('Delivered','تم التوصيل')},{key:'cancelled',label:pick('Cancelled','ملغي')}];
  return <Screen background={colors.appBg}>
    <View style={styles.headerBar}><View style={columnStyles.column}><Text variant="display">{t('orderHistory')}</Text></View></View>
    {!loading&&!error&&list.length>0?<ScrollView style={styles.filterScroller} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.filters,isRTL&&styles.filtersRTL]}>{filters.map((f)=><SelectableChip key={f.key} label={f.label} selected={filter===f.key} onPress={()=>setFilter(f.key)} style={styles.filterChip}/>)}</ScrollView>:null}
    {loading?<OrdersSkeleton/>:error?<ErrorView message={error} onRetry={()=>load('focus')} retryLabel={t('retry')} icon={<AlertIcon/>} fallbackTitle={pick("Your orders didn't load",'تعذّر تحميل طلباتك')}/>:list.length===0?<EmptyView icon={<ReceiptIcon size={44} color={colors.heatOff}/>} title={t('noOrders')} subtitle={t('noOrdersSub')}/>:filtered.length===0?<EmptyView icon={<ReceiptIcon size={40} color={colors.heatOff}/>} title={pick('No orders in this filter','لا توجد طلبات في هذا التصنيف')}/>:<FlatList data={filtered} keyExtractor={(o)=>o.id} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>load('refresh')} tintColor={colors.ember}/>} renderItem={({item})=><View style={[columnStyles.column,styles.orderItem]}><OrderCard order={item} statusLabel={t(STATUS_KEY[item.status])} onPress={()=>router.push(`/receipt/${item.id}`)}/></View>}/>} 
  </Screen>;
}
const useStyles=makeStyles(()=>({headerBar:{paddingHorizontal:space.s4,paddingTop:space.s2,paddingBottom:space.s2,alignItems:'center' as const},filterScroller:{flexGrow:0,maxHeight:56},filters:{paddingHorizontal:space.s4,paddingBottom:space.s3,gap:space.s2,alignItems:'center' as const},filtersRTL:{flexDirection:'row-reverse' as const},filterChip:{height:40,minHeight:40,paddingVertical:0},list:{paddingHorizontal:space.s4,paddingBottom:space.s6,gap:space.s3,alignItems:'stretch' as const},orderItem:{width:'100%' as const,alignSelf:'center' as const}}));
