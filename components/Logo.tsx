import { Image } from 'expo-image';

const logo = require('@/assets/zaf-logo.png'); // background removed, works on light and dark screens

// The Zaf Play logo on its own, with no box or circle behind it.
export function Logo({ size }: { size: number }) {
  return <Image source={logo} style={{ width: size, height: size }} contentFit="contain" accessibilityLabel="Zaf Play" />;
}
