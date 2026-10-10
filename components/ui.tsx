import React, { useRef } from 'react';
import {
  ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { colors, fonts, radius, themed, useTheme } from '@/lib/theme';

// The logo's gradient (blue → purple → pink); kept for the logo ring and a few brand touches.
export const GRADIENT = [colors.brandBlue, colors.brandPurple, colors.brandPink] as const;

// Fills its parent with the accent colour (buttons, chosen chips); the parent needs overflow: 'hidden' and rounded corners.
export function GradientFill({ style }: { style?: object }) {
  useTheme();
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.accent }, style]} pointerEvents="none" />;
}

// Text in the accent colour.
export function GradientText({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  useTheme();
  return <Text style={[style, { color: colors.primary }]}>{children}</Text>;
}

// A big screen title in the website's display font.
export function Title({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  useTheme();
  return <Text style={[{ color: colors.text, fontFamily: fonts.display, fontSize: 28, lineHeight: 34 }, style]}>{children}</Text>;
}

// Pressable that springs down a little when touched, so taps feel alive.
export function PressableScale({ style, children, scaleTo = 0.96, ...rest }: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; scaleTo?: number; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(1)).current;
  const to = (x: number) => Animated.spring(v, { toValue: x, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return (
    <Pressable {...rest} onPressIn={(e) => { to(scaleTo); rest.onPressIn?.(e); }} onPressOut={(e) => { to(1); rest.onPressOut?.(e); }}>
      <Animated.View style={[style, { transform: [{ scale: v }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// A plain card; `glow` gives it a thin accent border to stand out a little.
export function Card({ children, style, glow }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; glow?: boolean }) {
  const s = useS();
  return <View style={[s.card, glow && { borderColor: colors.primary }, style]}>{children}</View>;
}

export function Button({
  title, onPress, loading, disabled, variant = 'primary', small,
}: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; variant?: 'primary' | 'ghost'; small?: boolean }) {
  const s = useS();
  const off = disabled || loading;
  const primary = variant === 'primary';
  return (
    <PressableScale
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      style={[s.btn, small && s.btnSmall, primary ? s.btnPrimary : s.btnGhost, off && { opacity: 0.5 }]}
    >
      {primary && <GradientFill />}
      {loading
        ? <ActivityIndicator color={primary ? '#fff' : colors.text} />
        : <Text style={[s.btnText, small && { fontSize: 15 }, !primary && { color: colors.text }]}>{title}</Text>}
    </PressableScale>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const s = useS();
  const { scheme } = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput aria-label={label} placeholderTextColor={colors.muted} keyboardAppearance={scheme} style={[s.input, style]} {...rest} />
    </View>
  );
}

export function Note({ kind, children }: { kind: 'error' | 'ok'; children: React.ReactNode }) {
  const s = useS();
  const c = kind === 'error' ? colors.danger : colors.success;
  return (
    <View style={[s.note, { borderColor: c, backgroundColor: kind === 'error' ? 'rgba(255,92,108,0.08)' : 'rgba(46,211,160,0.08)' }]}>
      <Text style={{ color: c, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

const useS = themed(() => StyleSheet.create({
  btn: {
    borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  btnSmall: { paddingVertical: 10, paddingHorizontal: 16 },
  btnPrimary: { backgroundColor: colors.accent },
  btnGhost: { backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  btnText: { color: '#fff', fontFamily: fonts.displayBold, fontSize: 16 },
  label: { color: colors.muted, marginBottom: 6, fontSize: 13, fontWeight: '600' },
  input: {
    backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, color: colors.text, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16,
  },
  note: { borderWidth: 1, borderRadius: radius.md, padding: 12, marginBottom: 14 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 12 },
}));
