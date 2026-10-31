import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Linking, Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Text } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { colors, fonts, radius } from '@/lib/theme';
import { countdown, dateLabel, egp, timeLabel } from '@/lib/format';
import { FREE_CHANGE_HOURS, REVIEW_MINUTES } from '@/lib/payment';

// The website's booked / waiting-for-approval ticket (app/bookings/[id]/pay): a gradient ticket with the day big,
// things rising in one by one, and small buttons with the icon beside the word. Motion is off when the phone asks for less.

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

function Rise({ delay = 0, reduce, children }: { delay?: number; reduce: boolean; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) { v.setValue(1); return; }
    Animated.timing(v, { toValue: 1, duration: 500, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduce, delay, v]);
  return <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>{children}</Animated.View>;
}

// two soft rings pulse out around a magnifier that circles: "we're checking"
function Checking({ reduce }: { reduce: boolean }) {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const ping = (x: Animated.Value) => Animated.loop(Animated.timing(x, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    const l1 = ping(a); l1.start();
    let l2: Animated.CompositeAnimation | null = null;
    const t = setTimeout(() => { l2 = ping(b); l2.start(); }, 900);
    const l3 = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }));
    l3.start();
    return () => { clearTimeout(t); l1.stop(); l2?.stop(); l3.stop(); };
  }, [reduce, a, b, spin]);
  const ring = (x: Animated.Value) => (
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)',
      opacity: reduce ? 0 : x.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }), transform: [{ scale: x.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }] }} />
  );
  const turn = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const back = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });
  return (
    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
      {ring(a)}{ring(b)}
      <Animated.View style={{ transform: [{ rotate: turn }, { translateX: 3 }, { rotate: back }] }}>
        <Icon name="search" color="#fff" size={18} strokeWidth={2.2} />
      </Animated.View>
    </View>
  );
}

function SmallButton({ icon, tint, title, onPress }: { icon: IconName; tint: string; title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => ({ flexBasis: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 8,
        borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
      <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} color="#fff" size={16} strokeWidth={2.2} />
      </View>
      <Text style={{ color: colors.text, fontFamily: fonts.bodyBold, fontSize: 14 }}>{title}</Text>
    </Pressable>
  );
}

export function BookingTicket({ b, mode, now, reviewLeft, isChange }: { b: any; mode: 'booked' | 'waiting'; now: number; reviewLeft: number | null; isChange: boolean }) {
  const router = useRouter();
  const reduce = useReduceMotion();
  const pop = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) { pop.setValue(1); return; }
    Animated.spring(pop, { toValue: 1, delay: 350, friction: 5, useNativeDriver: true }).start();
  }, [reduce, pop]);

  const start = new Date(b.start_time);
  const mins = Math.round((new Date(b.end_time).getTime() - start.getTime()) / 60000);
  const freeUntil = start.getTime() - FREE_CHANGE_HOURS * 3600000;
  const lat = b.court?.facility?.latitude, lng = b.court?.facility?.longitude;
  const maps = b.court?.maps_url || (lat != null && lng != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null);
  const canChange = mode === 'booked' && start.getTime() > now;
  const waiting = mode === 'waiting';
  const pill = { alignSelf: 'center' as const, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 };

  return (
    <View style={{ gap: 12 }}>
      <Rise reduce={reduce}>
        <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 24, textAlign: 'center' }}>
          {waiting ? 'Payment sent!' : isChange ? 'Change confirmed' : 'You’re booked!'}
        </Text>
        <Text style={{ color: colors.muted, textAlign: 'center' }}>{waiting ? 'This page updates by itself.' : 'See you on court.'}</Text>
      </Rise>
      <Rise reduce={reduce} delay={80}>
        <View style={{ borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
          <LinearGradient colors={['#2d5bff', '#8a4bff', '#e0206f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 16, alignItems: 'center' }}>
            <Animated.View style={[pill, { opacity: pop, transform: [{ scale: pop }] }]}>
              {!waiting && <Icon name="check" color="#fff" size={14} strokeWidth={2.4} />}
              <Text style={{ color: '#fff', fontFamily: fonts.bodyBold, fontSize: 12 }}>{waiting ? 'Waiting for approval…' : 'Confirmed'}</Text>
            </Animated.View>
            <Text style={{ color: '#fff', fontFamily: fonts.display, fontSize: 30, marginTop: 8 }}>{dateLabel(b.start_time)}</Text>
            <Text style={{ color: '#fff', fontFamily: fonts.bodyBold }}>{timeLabel(b.start_time)} – {timeLabel(b.end_time)} · {mins} min</Text>
            {waiting && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }} accessibilityLiveRegion="polite">
                <Checking reduce={reduce} />
                {reviewLeft !== null && reviewLeft > 0 ? (
                  <View>
                    <Text style={{ color: '#fff', fontFamily: fonts.bodySemi, fontSize: 12, opacity: 0.9 }}>We’re checking your payment</Text>
                    <Text style={{ color: '#fff', fontFamily: fonts.display, fontSize: 24 }}>{countdown(reviewLeft)}</Text>
                  </View>
                ) : (
                  <Text style={{ color: '#fff', fontFamily: fonts.bodyBold, flexShrink: 1 }}>Taking a little longer than usual. We’re on it.</Text>
                )}
              </View>
            )}
            {!waiting && freeUntil > now && (
              <View style={[pill, { marginTop: 8 }]}>
                <Text style={{ color: '#fff', fontFamily: fonts.bodyBold, fontSize: 13 }}>Free change or cancel until {timeLabel(new Date(freeUntil).toISOString())}</Text>
              </View>
            )}
          </LinearGradient>
          <View style={{ padding: 12, alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontFamily: fonts.bodySemi }}>{b.court?.name}</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{[b.court?.facility?.name, b.sport?.name].filter(Boolean).join(' · ')}</Text>
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{waiting ? 'Sent by InstaPay' : Number(b.amount_due) > 0 ? 'Paid by InstaPay' : 'Total paid'}</Text>
            <Text style={{ color: colors.muted, fontSize: 13, fontFamily: fonts.bodyBold }}>{egp(b.amount_due)}</Text>
          </View>
        </View>
      </Rise>
      {waiting && <Rise reduce={reduce} delay={200}><Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>We approve it in about {REVIEW_MINUTES} minutes.</Text></Rise>}
      <Rise reduce={reduce} delay={300}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {!waiting && maps && <SmallButton icon="pin" tint="#0f9f63" title="Directions" onPress={() => Linking.openURL(maps)} />}
          {canChange && <SmallButton icon="edit" tint="#f0a020" title="Change" onPress={() => router.push({ pathname: '/change/[id]', params: { id: b.id } })} />}
          <SmallButton icon="list" tint={canChange ? '#2d5bff' : '#f0a020'} title="Bookings" onPress={() => router.replace('/bookings')} />
          <SmallButton icon="home" tint="#e0206f" title="Home" onPress={() => router.replace('/')} />
        </View>
      </Rise>
    </View>
  );
}
