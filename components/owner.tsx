import { createContext, useContext, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from '@/components/AppText';
import { Skeleton } from '@/components/ui';
import { useT } from '@/lib/ownerLang';
import type { Access } from '@/lib/access';
import { colors, radius } from '@/lib/theme';

// Shared pieces of the owner screens: who is logged in (loaded once by app/owner/_layout.tsx) and small UI bits.

type OwnerCtx = { access: Access; reload: () => Promise<void> };
export const OwnerContext = createContext<OwnerCtx | null>(null);

export function useOwner() {
  const ctx = useContext(OwnerContext);
  if (!ctx) throw new Error('useOwner outside the owner screens');
  return ctx;
}

export const frozenOf = (a: Access) => a.status === 'frozen';

export function Loading() {
  return <Skeleton />;
}

export function Badge({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'info' }) {
  const c = { neutral: colors.muted, ok: colors.success, warn: colors.warning, bad: colors.danger, info: colors.primaryAlt }[tone];
  return (
    <View style={{ borderWidth: 1, borderColor: c, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: c, fontSize: 12, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

// a choice chip (filters, tabs inside a screen)
export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, marginRight: 8, marginBottom: 8,
        borderColor: on ? colors.accent : colors.border, backgroundColor: on ? colors.soft : colors.card }}>
      <Text style={{ color: on ? colors.text : colors.muted, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>{children}</View>;
}

export function Box({ children, style, tone }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'warn' | 'bad' | 'ok' }) {
  const border = tone === 'warn' ? colors.noteBorder : tone === 'bad' ? colors.danger : tone === 'ok' ? colors.success : colors.border;
  const bg = tone === 'warn' ? colors.noteBg : colors.card;
  return <View style={[{ backgroundColor: bg, borderColor: border, borderWidth: 1, borderRadius: radius.lg, padding: 14, marginBottom: 12 }, style]}>{children}</View>;
}

export function H2({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 8, marginTop: 6 }}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[{ color: colors.muted, fontSize: 13, lineHeight: 19 }, style]}>{children}</Text>;
}

// a small text button ("Cancel", "Edit")
export function LinkButton({ title, onPress, danger, disabled }: { title: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} accessibilityRole="button" style={{ opacity: disabled ? 0.5 : 1, marginRight: 16, paddingVertical: 4 }}>
      <Text style={{ color: danger ? colors.danger : colors.primaryAlt, fontWeight: '700', fontSize: 14 }}>{title}</Text>
    </Pressable>
  );
}

export const fmtEGP = (value: number) => `${Number(value || 0).toLocaleString('en-EG', { maximumFractionDigits: 2 })} EGP`;

export const PAGE_SIZE = 10;

// "‹ 1 / 4 ›" under a long list
export function Pager({ page, total, onChange, size = PAGE_SIZE }: { page: number; total: number; onChange: (p: number) => void; size?: number }) {
  const pages = Math.ceil(total / size);
  if (pages <= 1) return null;
  const btn = (label: string, to: number, off: boolean) => (
    <Pressable onPress={() => !off && onChange(to)} disabled={off} hitSlop={8} accessibilityRole="button"
      style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, opacity: off ? 0.4 : 1 }}>
      <Text style={{ color: colors.text, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginVertical: 12 }}>
      {btn('‹', page - 1, page <= 1)}
      <Text style={{ color: colors.muted }}>{page} / {pages}</Text>
      {btn('›', page + 1, page >= pages)}
    </View>
  );
}

// a panel that slides up from the bottom (the website's Sheet), closed by tapping outside or ×
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t, lang } = useT();
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityRole="button" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} accessibilityLabel={t('Close')} />
        <View style={{ maxHeight: '88%', backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, direction: lang === 'ar' ? 'rtl' : 'ltr' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18, paddingBottom: 6 }}>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800', flex: 1 }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Close')}>
              <Text style={{ color: colors.muted, fontSize: 26 }}>×</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 6, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
