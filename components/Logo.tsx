import { Image } from 'expo-image';
import { useTheme } from '@/lib/theme';

const onDark = require('@/assets/zaf-logo.png'); // background removed, sits on the dark screen
const badge = require('@/assets/zaf-icon.png'); // the original logo on its black square

// The Zaf Play logo: as is on dark screens; on light screens, on its own black circle so the colours stay strong.
export function Logo({ size }: { size: number }) {
  const { scheme } = useTheme();
  if (scheme === 'dark') return <Image source={onDark} style={{ width: size, height: size }} contentFit="contain" accessibilityLabel="Zaf Play" />;
  const d = size * 0.86;
  return <Image source={badge} style={{ width: d, height: d, borderRadius: d / 2, margin: (size - d) / 2 }} contentFit="cover" accessibilityLabel="Zaf Play" />;
}
