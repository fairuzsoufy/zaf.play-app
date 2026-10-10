import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { colors, fonts, themed } from '@/lib/theme';
import { Logo } from './Logo';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const SIZE = 240;
const R = 47;
const LENGTH = 2 * Math.PI * R;

// The website's intro: a gradient ring draws itself around the logo, the tagline rises, then it all fades away.
export function Splash() {
  const s = useS();
  const [done, setDone] = useState(false);
  const ring = useRef(new Animated.Value(0)).current;
  const logoIn = useRef(new Animated.Value(0)).current;
  const tagIn = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(ring, { toValue: 1, duration: 1000, easing: Easing.bezier(0.6, 0, 0.2, 1), useNativeDriver: false }),
      Animated.sequence([
        Animated.delay(350),
        Animated.timing(logoIn, { toValue: 1, duration: 600, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
        Animated.timing(tagIn, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.delay(600),
        Animated.timing(out, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]),
    ]).start(() => setDone(true));
  }, [ring, logoIn, tagIn, out]);

  if (done) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, s.wrap, { opacity: out }]} pointerEvents="none">
      <View style={{ width: SIZE, height: SIZE }}>
        <Svg viewBox="0 0 100 100" style={[StyleSheet.absoluteFill, { transform: [{ rotate: '-90deg' }] }]}>
          <Defs>
            <LinearGradient id="zafRing" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={colors.brandBlue} />
              <Stop offset="0.5" stopColor={colors.brandPurple} />
              <Stop offset="1" stopColor={colors.brandPink} />
            </LinearGradient>
          </Defs>
          <AnimatedCircle
            cx="50" cy="50" r={R} fill="none" stroke="url(#zafRing)" strokeWidth={1.4} strokeLinecap="round"
            strokeDasharray={LENGTH}
            strokeDashoffset={ring.interpolate({ inputRange: [0, 1], outputRange: [LENGTH, 0] })}
          />
        </Svg>
        <Animated.View style={[s.logo, { opacity: logoIn, transform: [{ scale: logoIn.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }] }]}>
          <Logo size={SIZE * 0.76} />
        </Animated.View>
      </View>
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
  logo: { position: 'absolute', top: SIZE * 0.12, left: SIZE * 0.12 },
  tag: { color: colors.muted, fontFamily: fonts.displaySemi, fontSize: 17, marginTop: 16 },
  tagStrong: { color: colors.brandPink, fontFamily: fonts.display },
}));
