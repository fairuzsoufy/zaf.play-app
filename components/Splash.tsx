import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { colors, themed } from '@/lib/theme';
import { Logo } from './Logo';


// The logo and tagline shown over the app when it opens, then faded away (like the website's intro).
export function Splash() {
  const s = useS();
  const [done, setDone] = useState(false);
  const logoIn = useRef(new Animated.Value(0)).current;
  const tagIn = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(logoIn, { toValue: 1, duration: 650, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
      Animated.timing(tagIn, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.delay(700),
      Animated.timing(out, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start(() => setDone(true));
  }, [logoIn, tagIn, out]);

  if (done) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, s.wrap, { opacity: out }]} pointerEvents="none">
      <Animated.View style={{ opacity: logoIn, transform: [{ scale: logoIn.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }] }}>
        <Logo size={240} />
      </Animated.View>
      <Animated.View style={{ opacity: tagIn, transform: [{ translateY: tagIn.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
        <Text style={s.tag}>
          Play. Compete. <Text style={s.tagStrong}>Connect.</Text>
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const useS = themed(() => StyleSheet.create({
  wrap: { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  logo: { width: 240, height: 240 },
  tag: { color: colors.muted, fontSize: 18, fontStyle: 'italic', letterSpacing: 0.5, marginTop: 4 },
  tagStrong: { color: colors.brandPink, fontWeight: '800' },
}));
