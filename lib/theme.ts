import 'expo-sqlite/localStorage/install';
import { useSyncExternalStore } from 'react';
import { Appearance, StyleSheet } from 'react-native';

// Same palette as zafplay.com (app/globals.css there): near-black ink in dark mode, white in light mode,
// and the blue to violet to pink gradient in both.
const dark = {
  bg: '#07060d',
  card: '#11101c',
  cardAlt: '#1a1830',
  border: '#25233a',
  text: '#F4F5FB',
  muted: '#9A9EBB',
  primary: '#8b45c8',
  primaryAlt: '#5b8cff',
  blue: '#3b6cf0',
  violet: '#8b45c8',
  pink: '#f2507a',
  danger: '#FF5C6C',
  success: '#2ED3A0',
  warning: '#FFB84D',
  // calendar
  busy: '#3a3a4d',
  hold: '#6b4a12',
  currentBg: '#10261f',
  pastBg: '#0c0b14',
  gridLine: '#1b1a2b',
  noteBg: '#2a2010',
  noteBorder: '#5a4318',
};
const light: typeof dark = {
  bg: '#ffffff',
  card: '#f6f6fb',
  cardAlt: '#ececf5',
  border: '#dedeea',
  text: '#171717',
  muted: '#6a6e85',
  primary: '#8b45c8',
  primaryAlt: '#3b6cf0',
  blue: '#3b6cf0',
  violet: '#8b45c8',
  pink: '#f2507a',
  danger: '#d93a4a',
  success: '#0f9a72',
  warning: '#b06f00',
  busy: '#cfd0de',
  hold: '#f3d9a4',
  currentBg: '#dff5ec',
  pastBg: '#ececf3',
  gridLine: '#ebebf3',
  noteBg: '#fff4de',
  noteBorder: '#f0cf8f',
};

export type Mode = 'system' | 'light' | 'dark';
const KEY = 'zaf-theme-mode';

function saved(): Mode {
  try {
    const v = (globalThis as any).localStorage?.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {}
  return 'dark';
}

let mode: Mode = saved();
let version = 0;
const subs = new Set<() => void>();
const bump = () => { version++; subs.forEach((f) => f()); };
Appearance.addChangeListener(() => { if (mode === 'system') bump(); });

const scheme = (): 'light' | 'dark' => (mode === 'system' ? (Appearance.getColorScheme() === 'light' ? 'light' : 'dark') : mode);

// `colors.x` always gives the colour of the mode in use right now (read it while rendering)
export const colors = {} as typeof dark;
for (const k of Object.keys(dark) as (keyof typeof dark)[]) {
  Object.defineProperty(colors, k, { enumerable: true, get: () => (scheme() === 'light' ? light : dark)[k] });
}

export const gradient = [dark.blue, dark.violet, dark.pink] as const;
export const radius = { sm: 8, md: 12, lg: 18, xl: 24 };

export function setMode(m: Mode) {
  mode = m;
  try { (globalThis as any).localStorage?.setItem(KEY, m); } catch {}
  bump();
}

// Call at the top of a screen so it draws again when the mode changes.
export function useTheme() {
  useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => version);
  return { mode, scheme: scheme(), setMode };
}

// Like StyleSheet.create, but the styles are made again when the mode changes.
export function themed<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(make: () => T): T {
  let v = -1;
  let cache: any;
  return new Proxy({} as any, {
    get(_t, key) {
      if (v !== version || !cache) { cache = StyleSheet.create(make() as any); v = version; }
      return cache[key];
    },
  }) as T;
}
