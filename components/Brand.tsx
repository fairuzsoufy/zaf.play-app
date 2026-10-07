import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradient, useTheme } from '@/lib/theme';

const logo = require('../assets/logo.png');

export function Logo({ size = 72 }: { size?: number }) {
  return <Image source={logo} style={{ width: size, height: size, borderRadius: size * 0.22 }} contentFit="cover" />;
}

// "Play. Compete. Connect." with the last word in the brand gradient colour
export function Tagline() {
  return (
    <Text style={{ color: colors.muted, fontSize: 15, fontStyle: 'italic', letterSpacing: 0.5 }}>
      Play. Compete. <Text style={{ color: colors.pink, fontWeight: '800' }}>Connect.</Text>
    </Text>
  );
}

export function GradientBar({ height = 3 }: { height?: number }) {
  return <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height, borderRadius: height }} />;
}

// The first thing people see when the app opens: the logo, then it fades into the app.
export function BrandSplash({ ready }: { ready: boolean }) {
  const [gone, setGone] = useState(false);
  const [minTime, setMinTime] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  const pop = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 6, useNativeDriver: true }).start();
    const t = setTimeout(() => setMinTime(true), 1400);
    return () => clearTimeout(t);
  }, [pop]);

  useEffect(() => {
    if (!ready || !minTime) return;
    Animated.timing(fade, { toValue: 0, duration: 450, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => setGone(true));
  }, [ready, minTime, fade]);

  if (gone) return null;
  return (
    <Animated.View
      pointerEvents={ready && minTime ? 'none' : 'auto'}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', opacity: fade, zIndex: 50 }}
    >
      <Animated.View style={{ alignItems: 'center', transform: [{ scale: pop }] }}>
        <Logo size={190} />
        <View style={{ marginTop: 18 }}><Tagline /></View>
      </Animated.View>
    </Animated.View>
  );
}

// Light / dark switch (the website's sun and moon button)
export function ThemeToggle() {
  const { scheme, setMode } = useTheme();
  return (
    <Pressable onPress={() => setMode(scheme === 'light' ? 'dark' : 'light')} hitSlop={10} accessibilityRole="button"
      accessibilityLabel={scheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      style={{ position: 'absolute', right: 0, top: 0, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ fontSize: 18 }}>{scheme === 'light' ? '🌙' : '☀️'}</Text>
    </Pressable>
  );
}
