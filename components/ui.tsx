import React from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { colors, gradient, radius, themed } from '@/lib/theme';

export function Button({
  title, onPress, loading, disabled, variant = 'primary',
}: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; variant?: 'primary' | 'ghost' }) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [s.btn, variant === 'primary' ? s.btnPrimary : s.btnGhost, off && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
    >
      {variant === 'primary' && (
        <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      )}
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{title}</Text>}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput aria-label={label} placeholderTextColor={colors.muted} style={[s.input, style]} {...rest} />
    </View>
  );
}

export function Note({ kind, children }: { kind: 'error' | 'ok'; children: React.ReactNode }) {
  return (
    <View style={[s.note, { borderColor: kind === 'error' ? colors.danger : colors.success }]}>
      <Text style={{ color: kind === 'error' ? colors.danger : colors.success }}>{children}</Text>
    </View>
  );
}

const s = themed(() => ({
  btn: { borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: colors.primary, overflow: 'hidden' },
  btnGhost: { backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  label: { color: colors.muted, marginBottom: 6, fontSize: 13 },
  input: {
    backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, color: colors.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16,
  },
  note: { borderWidth: 1, borderRadius: radius.md, padding: 12, marginBottom: 14 },
}));

// The brand gradient as a fill: put it first inside a `overflow: 'hidden'` view.
export function GradientFill() {
  return <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} pointerEvents="none" />;
}
