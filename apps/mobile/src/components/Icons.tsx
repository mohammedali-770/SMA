/**
 * Tiny geometric icon set drawn with plain Views — no icon font, no images,
 * no new dependencies. Replaces emoji used as interface icons (tab bar,
 * search field, state views) so glyphs render crisply, tint correctly and
 * look identical on iOS and Android. Every icon accepts `size` and `color`
 * and is decorative (parents carry the accessible label).
 */
import React from 'react';
import { View, type ColorValue } from 'react-native';

interface IconProps {
  size?: number;
  color?: ColorValue;
}

/** Magnifier: circle outline + angled handle. */
export function SearchIcon({ size = 18, color = '#6b6580' }: IconProps) {
  const ring = Math.round(size * 0.66);
  const stroke = Math.max(2, Math.round(size / 9));
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <View style={{
        width: ring, height: ring, borderRadius: ring / 2, borderWidth: stroke, borderColor: color,
      }} />
      <View style={{
        position: 'absolute', bottom: 0, right: 0,
        width: Math.round(size * 0.42), height: stroke, borderRadius: stroke / 2,
        backgroundColor: color, transform: [{ rotate: '45deg' }],
      }} />
    </View>
  );
}

/** House: pitched roof (rotated square) over a body outline. */
export function HomeIcon({ size = 24, color = '#6b6580' }: IconProps) {
  const stroke = Math.max(2, Math.round(size / 12));
  const roof = Math.round(size * 0.52);
  const body = Math.round(size * 0.58);
  return (
    <View style={{ width: size, height: size, alignItems: 'center' }} pointerEvents="none">
      <View style={{
        width: roof, height: roof, borderTopWidth: stroke, borderLeftWidth: stroke, borderColor: color,
        transform: [{ rotate: '45deg' }], position: 'absolute', top: Math.round(size * 0.06),
        borderTopLeftRadius: 3,
      }} />
      <View style={{
        position: 'absolute', bottom: 0, width: body, height: Math.round(size * 0.5),
        borderWidth: stroke, borderTopWidth: 0, borderColor: color,
        borderBottomLeftRadius: 3, borderBottomRightRadius: 3,
      }} />
    </View>
  );
}

/** Receipt: rounded outline with text lines. */
export function ReceiptIcon({ size = 24, color = '#6b6580' }: IconProps) {
  const stroke = Math.max(2, Math.round(size / 12));
  const w = Math.round(size * 0.7);
  const line = { height: stroke, borderRadius: stroke / 2, backgroundColor: color } as const;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
      <View style={{
        width: w, height: Math.round(size * 0.86), borderWidth: stroke, borderColor: color,
        borderRadius: 3, paddingHorizontal: Math.round(size * 0.12),
        justifyContent: 'center', gap: Math.max(2, Math.round(size * 0.12)),
      }}>
        <View style={[line, { width: '100%' }]} />
        <View style={[line, { width: '100%' }]} />
        <View style={[line, { width: '60%' }]} />
      </View>
    </View>
  );
}

/** Person: head circle + shoulder arch. */
export function PersonIcon({ size = 24, color = '#6b6580' }: IconProps) {
  const stroke = Math.max(2, Math.round(size / 12));
  const head = Math.round(size * 0.36);
  const shoulders = Math.round(size * 0.62);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }} pointerEvents="none">
      <View style={{
        width: head, height: head, borderRadius: head / 2, borderWidth: stroke, borderColor: color,
        marginBottom: Math.max(1, Math.round(size * 0.06)),
      }} />
      <View style={{
        width: shoulders, height: Math.round(shoulders * 0.52),
        borderTopLeftRadius: shoulders / 2, borderTopRightRadius: shoulders / 2,
        borderWidth: stroke, borderBottomWidth: 0, borderColor: color,
      }} />
    </View>
  );
}

/** Alert: circle outline with an exclamation mark. */
export function AlertIcon({ size = 40, color = '#e02d3d' }: IconProps) {
  const stroke = Math.max(2, Math.round(size / 14));
  const barH = Math.round(size * 0.32);
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2, borderWidth: stroke, borderColor: color,
      alignItems: 'center', justifyContent: 'center', gap: Math.max(2, Math.round(size * 0.07)),
    }} pointerEvents="none">
      <View style={{ width: stroke, height: barH, borderRadius: stroke / 2, backgroundColor: color, marginTop: Math.round(size * 0.1) }} />
      <View style={{ width: stroke + 1, height: stroke + 1, borderRadius: stroke, backgroundColor: color, marginBottom: Math.round(size * 0.08) }} />
    </View>
  );
}

/** Medal: ring + core + ribbon legs — used for the loyalty balance. */
export function AwardIcon({ size = 24, color = '#422e87' }: IconProps) {
  const stroke = Math.max(2, Math.round(size / 12));
  const ring = Math.round(size * 0.58);
  const core = Math.round(size * 0.2);
  const legW = stroke + 1;
  const legH = Math.round(size * 0.34);
  return (
    <View style={{ width: size, height: size, alignItems: 'center' }} pointerEvents="none">
      <View style={{
        width: ring, height: ring, borderRadius: ring / 2, borderWidth: stroke, borderColor: color,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <View style={{ width: core, height: core, borderRadius: core / 2, backgroundColor: color }} />
      </View>
      <View style={{ flexDirection: 'row', gap: Math.round(size * 0.14), marginTop: -2 }}>
        <View style={{ width: legW, height: legH, borderRadius: legW / 2, backgroundColor: color, transform: [{ rotate: '16deg' }] }} />
        <View style={{ width: legW, height: legH, borderRadius: legW / 2, backgroundColor: color, transform: [{ rotate: '-16deg' }] }} />
      </View>
    </View>
  );
}

/** Door + outward arrow — used for the sign-out action. */
export function SignOutIcon({ size = 20, color = '#ffffff' }: IconProps) {
  const stroke = Math.max(2, Math.round(size / 10));
  const frameH = Math.round(size * 0.9);
  const frameW = Math.round(size * 0.46);
  const tip = Math.round(size * 0.3);
  return (
    <View style={{ width: size, height: size, justifyContent: 'center' }} pointerEvents="none">
      <View style={{
        position: 'absolute', left: 0, width: frameW, height: frameH,
        borderWidth: stroke, borderRightWidth: 0, borderColor: color,
        borderTopLeftRadius: 4, borderBottomLeftRadius: 4,
      }} />
      <View style={{
        position: 'absolute', left: Math.round(size * 0.3), right: Math.round(size * 0.12),
        height: stroke, borderRadius: stroke / 2, backgroundColor: color,
      }} />
      <View style={{
        position: 'absolute', right: Math.round(size * 0.06),
        width: tip, height: tip, borderTopWidth: stroke, borderRightWidth: stroke, borderColor: color,
        transform: [{ rotate: '45deg' }],
      }} />
    </View>
  );
}

/** Shopping bag: rounded body + handle arch — used for the empty cart. */
export function BagIcon({ size = 40, color = '#c9c4d6' }: IconProps) {
  const stroke = Math.max(2, Math.round(size / 16));
  const bodyW = Math.round(size * 0.72);
  const handleW = Math.round(size * 0.36);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }} pointerEvents="none">
      <View style={{
        width: handleW, height: Math.round(handleW * 0.62),
        borderTopLeftRadius: handleW / 2, borderTopRightRadius: handleW / 2,
        borderWidth: stroke, borderBottomWidth: 0, borderColor: color,
        marginBottom: -stroke,
      }} />
      <View style={{
        width: bodyW, height: Math.round(size * 0.58), borderWidth: stroke, borderColor: color,
        borderTopLeftRadius: 4, borderTopRightRadius: 4,
        borderBottomLeftRadius: Math.round(size * 0.16), borderBottomRightRadius: Math.round(size * 0.16),
      }} />
    </View>
  );
}

/** Plate: concentric circles — used for empty menu / missing dish imagery. */
export function DishIcon({ size = 40, color = '#c9c4d6' }: IconProps) {
  const stroke = Math.max(2, Math.round(size / 16));
  const inner = Math.round(size * 0.5);
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2, borderWidth: stroke, borderColor: color,
      alignItems: 'center', justifyContent: 'center',
    }} pointerEvents="none">
      <View style={{ width: inner, height: inner, borderRadius: inner / 2, borderWidth: stroke, borderColor: color }} />
    </View>
  );
}
