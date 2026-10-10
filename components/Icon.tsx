import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

// The website's line icons (app/components/Icon.tsx), drawn with react-native-svg.
const shapes = {
  ball: <><Circle cx="12" cy="12" r="9" /><Path d="M12 7.5l4.3 3.1-1.6 5H9.3l-1.6-5z" /><Path d="M12 3v4.5M20.5 9.5l-4.2 1.1M17.5 19l-2.8-3.4M6.5 19l2.8-3.4M3.5 9.5l4.2 1.1" /></>,
  calendar: <><Rect x="3" y="5" width="18" height="16" rx="2" /><Path d="M3 10h18M8 3v4M16 3v4" /></>,
  user: <><Circle cx="12" cy="8" r="4" /><Path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>,
  clock: <><Circle cx="12" cy="12" r="9" /><Path d="M12 7v5l3 2" /></>,
  info: <><Circle cx="12" cy="12" r="9" /><Path d="M12 11v5M12 8h.01" /></>,
  sun: <><Circle cx="12" cy="12" r="4" /><Path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <><Path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></>,
  whatsapp: <><Path d="M4 20l1.3-4A8 8 0 1 1 8.3 19z" /><Path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-1.8-1.8l.8-1-1-2z" /></>,
  check: <><Circle cx="12" cy="12" r="9" /><Path d="M8 12l3 3 5-6" /></>,
  edit: <><Path d="M4 20h4L19 9l-4-4L4 16z" /><Path d="M13 7l4 4" /></>,
};

export type IconName = keyof typeof shapes;

export function Icon({ name, color, size = 22, strokeWidth = 1.8 }: { name: IconName; color: ColorValue; size?: number; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {shapes[name]}
    </Svg>
  );
}
