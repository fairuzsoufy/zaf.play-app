import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { colors } from '@/lib/theme';

// The website's line icons (app/components/Icon.tsx there). The active one is drawn in the brand gradient.
const paths = {
  ball: <><Circle cx="12" cy="12" r="9" /><Path d="M12 7.5l4.3 3.1-1.6 5H9.3l-1.6-5z" /><Path d="M12 3v4.5M20.5 9.5l-4.2 1.1M17.5 19l-2.8-3.4M6.5 19l2.8-3.4M3.5 9.5l4.2 1.1" /></>,
  calendar: <><Rect x="3" y="5" width="18" height="16" rx="2" /><Path d="M3 10h18M8 3v4M16 3v4" /></>,
  user: <><Circle cx="12" cy="8" r="4" /><Path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>,
};

export function TabIcon({ name, focused, size = 26 }: { name: keyof typeof paths; focused: boolean; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={focused ? 'url(#zaf)' : colors.muted}
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Defs>
        <LinearGradient id="zaf" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={colors.blue} />
          <Stop offset="0.5" stopColor={colors.violet} />
          <Stop offset="1" stopColor={colors.pink} />
        </LinearGradient>
      </Defs>
      {paths[name]}
    </Svg>
  );
}
