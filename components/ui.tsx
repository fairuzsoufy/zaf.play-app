import React, { useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { LinearGradient } from 'expo-linear-gradient';
import RNMaskedView from '@react-native-masked-view/masked-view';
import { colors, fonts, radius, themed, useTheme } from '@/lib/theme';
import { useT, withoutArabic } from '@/lib/ownerLang';
import { Icon, type IconName } from '@/components/Icon';
import { tap } from '@/lib/haptics';

// masked-view 0.3.2 (the newest, the one SDK 58 expects) still ships class typings that React 19.3's JSX types reject; it works the same at run time
const MaskedView = RNMaskedView as unknown as React.ComponentType<{ maskElement: React.ReactElement; children?: React.ReactNode; style?: StyleProp<ViewStyle> }>;

// The website's brand gradient (blue → purple → pink), used for buttons and anything chosen.
export const GRADIENT = [colors.brandBlue, colors.brandPink] as const;

// Fills its parent with the gradient; the parent needs overflow: 'hidden' and rounded corners.
export function GradientFill({ style }: { style?: object }) {
  return <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0.3 }} end={{ x: 1, y: 0.7 }} style={[StyleSheet.absoluteFill, style]} pointerEvents="none" />;
}

// Text painted with the brand gradient (like the website's "Connect.").
export function GradientText({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <MaskedView maskElement={<Text style={style}>{children}</Text>}>
      <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
        <Text style={[style, { opacity: 0 }]}>{children}</Text>
      </LinearGradient>
    </MaskedView>
  );
}

// Pressable that springs down a little when touched, so taps feel alive.
export function PressableScale({ style, children, scaleTo = 0.96, ...rest }: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; scaleTo?: number; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(1)).current;
  const to = (x: number) => Animated.spring(v, { toValue: x, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return (
    <Pressable accessibilityRole="button" {...rest} onPressIn={(e) => { to(scaleTo); rest.onPressIn?.(e); }} onPressOut={(e) => { to(1); rest.onPressOut?.(e); }}>
      <Animated.View style={[style, { transform: [{ scale: v }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// A card; `glow` gives it the website's gradient border.
export function Card({ children, style, glow }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; glow?: boolean }) {
  const s = useS();
  if (!glow) return <View style={[s.card, style]}>{children}</View>;
  return (
    <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.glowWrap, style && { marginBottom: (StyleSheet.flatten(style) as ViewStyle).marginBottom }]}>
      <View style={[s.card, s.glowInner, style, { marginBottom: 0 }]}>{children}</View>
    </LinearGradient>
  );
}

export function Button({
  title, onPress, loading, disabled, variant = 'primary', small,
}: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; variant?: 'primary' | 'ghost'; small?: boolean }) {
  const s = useS();
  const off = disabled || loading;
  const primary = variant === 'primary';
  return (
    <PressableScale
      onPress={() => { tap(); onPress(); }}
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
  const { owner, t } = useT();
  const [arabicNote, setArabicNote] = useState(false);
  const { label, style, onChangeText, ...rest } = props;
  // on the owner screens Arabic is for reading only: Arabic letters never reach the form or the database
  function change(text: string) {
    const kept = owner ? withoutArabic(text) : null;
    if (kept !== null) {
      setArabicNote(true);
      setTimeout(() => setArabicNote(false), 4000);
    }
    onChangeText?.(kept ?? text);
  }
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput aria-label={label} placeholderTextColor={colors.muted} keyboardAppearance={scheme} style={[s.input, style]} {...rest} onChangeText={change} />
      {arabicNote && <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{t('Please type in English (A–Z). Arabic letters can’t be used in fields.')}</Text>}
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

// Grey placeholder cards that pulse while a screen loads, so it does not jump when data arrives.
export function Skeleton({ rows = 3, style }: { rows?: number; style?: StyleProp<ViewStyle> }) {
  useTheme();
  const v = useRef(new Animated.Value(0.5)).current;
  React.useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.5, duration: 700, useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [v]);
  const bar = (w: number | `${number}%`, h: number) => <View style={{ width: w, height: h, borderRadius: 6, backgroundColor: colors.cardAlt, marginBottom: 10 }} />;
  return (
    <Animated.View style={[{ padding: 16, opacity: v }, style]} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 14 }}>
          {bar('60%', 18)}{bar('90%', 12)}{bar('40%', 12)}
        </View>
      ))}
    </Animated.View>
  );
}

// A friendly empty list: icon, title, one helpful line and an optional button.
export function EmptyState({ icon, title, text, action, onAction }: { icon: IconName; title: string; text?: string; action?: string; onAction?: () => void }) {
  useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 36, paddingHorizontal: 24 }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
        <Icon name={icon} color={colors.brandPink} size={28} />
      </View>
      <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 18, textAlign: 'center' }}>{title}</Text>
      {!!text && <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 20 }}>{text}</Text>}
      {!!action && onAction && <View style={{ marginTop: 16, alignSelf: 'stretch' }}><Button title={action} onPress={onAction} small /></View>}
    </View>
  );
}

const useS = themed(() => StyleSheet.create({
  btn: {
    borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  btnSmall: { paddingVertical: 10, paddingHorizontal: 16 },
  btnPrimary: {
    backgroundColor: colors.accent,
    shadowColor: colors.accent, shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  btnGhost: { backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  btnText: { color: '#fff', fontFamily: fonts.displayBold, fontSize: 17, letterSpacing: 0.3 },
  label: { color: colors.muted, marginBottom: 6, fontSize: 13, fontWeight: '600' },
  input: {
    backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, color: colors.text, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16,
  },
  note: { borderWidth: 1, borderRadius: radius.md, padding: 12, marginBottom: 14 },
  card: { backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 14 },
  glowWrap: {
    borderRadius: radius.xl, padding: 1.5, marginBottom: 14,
    shadowColor: colors.accent, shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  glowInner: { borderWidth: 0, borderRadius: radius.xl - 1.5 },
}));
