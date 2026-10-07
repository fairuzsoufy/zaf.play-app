import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, useTheme } from '@/lib/theme';
import { Icon } from './Icon';

type Toast = { id: number; text: string; kind: 'ok' | 'error' };
let listener: ((t: Toast) => void) | null = null;
let nextId = 1;

// Show a short banner at the top of the screen that goes away by itself, e.g. toast('Saved').
export function toast(text: string, kind: 'ok' | 'error' = 'ok') {
  listener?.({ id: nextId++, text, kind });
}

export function Toaster() {
  useTheme();
  const insets = useSafeAreaInsets();
  const [t, setT] = useState<Toast | null>(null);
  const y = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    listener = setT;
    return () => { listener = null; };
  }, []);

  useEffect(() => {
    if (!t) return;
    y.setValue(0);
    const anim = Animated.sequence([
      Animated.timing(y, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(2500),
      Animated.timing(y, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => { if (finished) setT(null); });
    return () => anim.stop();
  }, [t, y]);

  if (!t) return null;
  const tint = t.kind === 'ok' ? colors.success : colors.danger;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        s.wrap,
        { top: insets.top + 8, opacity: y, transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }] },
      ]}
    >
      <View style={[s.banner, { backgroundColor: colors.card, borderColor: tint }]}>
        <Icon name={t.kind === 'ok' ? 'check' : 'info'} color={tint} size={20} />
        <Text style={[s.text, { color: colors.text }]}>{t.text}</Text>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, zIndex: 200, alignItems: 'center' },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  text: { fontWeight: '700', fontSize: 15 },
});
