/** Entry route: branded startup moment, then tabs or login. */
import { Image } from 'expo-image';
import { Redirect } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

import { radius, space } from '../design-system/generated/tokens';
import { Text } from '../design-system/ui/Text';
import { useI18n } from '../i18n/I18nProvider';
import { useAuth } from '../store';
import { makeStyles } from '../theme/makeStyles';

const INTRO_MIN_MS = 900;

function BrandIntro() {
  const styles = useStyles(); const { pick } = useI18n();
  const opacity = useRef(new Animated.Value(0)).current; const scale = useRef(new Animated.Value(0.88)).current; const ringScale = useRef(new Animated.Value(0.72)).current; const ringOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.parallel([Animated.timing(opacity,{toValue:1,duration:320,easing:Easing.out(Easing.cubic),useNativeDriver:true}),Animated.spring(scale,{toValue:1,friction:7,tension:70,useNativeDriver:true}),Animated.sequence([Animated.delay(90),Animated.parallel([Animated.timing(ringScale,{toValue:1,duration:520,easing:Easing.out(Easing.cubic),useNativeDriver:true}),Animated.timing(ringOpacity,{toValue:.42,duration:260,useNativeDriver:true})])])]).start(); },[opacity,ringOpacity,ringScale,scale]);
  return <View style={styles.introRoot} accessibilityLabel={pick('Spicy Meal. Since 1997.','سبايسي ميل. منذ 1997.')}><View style={styles.markStage}><Animated.View style={[styles.ring,{opacity:ringOpacity,transform:[{scale:ringScale}]}]}/><Animated.View style={{opacity,transform:[{scale}]}}><Image source={require('../../assets/adaptive-icon.png')} style={styles.introMark} contentFit="contain"/></Animated.View></View><Animated.View style={[styles.introCopy,{opacity}]}><Text variant="display" align="center">{pick('Spicy Meal','سبايسي ميل')}</Text><Text variant="heading" tone="ember" align="center">{pick('Since 1997','منذ 1997')}</Text></Animated.View><View style={styles.dots} accessibilityElementsHidden><View style={[styles.dot,styles.dotActive]}/><View style={styles.dot}/><View style={styles.dot}/></View></View>;
}
export default function Index(){const{status}=useAuth();const[introDone,setIntroDone]=useState(false);useEffect(()=>{const timer=setTimeout(()=>setIntroDone(true),INTRO_MIN_MS);return()=>clearTimeout(timer);},[]);if(status==='loading'||!introDone)return <BrandIntro/>;return <Redirect href={status==='signed_in'?'/(tabs)':'/(auth)/login'}/>;}
const useStyles=makeStyles((colors)=>({introRoot:{flex:1,alignItems:'center' as const,justifyContent:'center' as const,gap:space.s4,backgroundColor:colors.appBg,paddingHorizontal:space.s5},markStage:{width:220,height:220,alignItems:'center' as const,justifyContent:'center' as const},ring:{position:'absolute' as const,width:190,height:190,borderRadius:95,borderWidth:2,borderColor:colors.ember,backgroundColor:colors.appSurface2},introMark:{width:150,height:150},introCopy:{alignItems:'center' as const,gap:space.s2},dots:{flexDirection:'row' as const,gap:space.s2,marginTop:space.s3},dot:{width:7,height:7,borderRadius:radius.pill,backgroundColor:colors.appLine},dotActive:{width:24,backgroundColor:colors.ember}}));
