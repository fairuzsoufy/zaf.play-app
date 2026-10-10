import 'expo-sqlite/localStorage/install';
import { createContext, createElement, useContext, useState, type ReactNode } from 'react';

// Calm neutral surfaces with one accent colour (the logo's violet) for buttons and anything chosen.
// The logo's blue → purple → pink gradient is kept for the logo itself.
const dark = {
  bg: '#0B0B0F',
  card: '#15151B',
  cardAlt: '#1E1E26',
  border: '#26262F',
  borderStrong: '#363642',
  text: '#F5F5F7',
  muted: '#9B9BA8',
  primary: '#A594FF', // accent text (links, small highlights)
  primaryAlt: '#A594FF', // links
  accent: '#7357F6', // filled buttons and chosen items (white text on it)
  soft: '#262142', // light accent background (pills, pressed)
  danger: '#FF5C6C',
  success: '#2ED3A0',
  warning: '#FFB84D',
  noteBg: '#2A2210',
  noteBorder: '#6B5317',
  noteText: '#FCD98A',
  taken: '#23202F',
  hold: '#251D38',
  night: '#15131F',
  past: '#0D0C14',
  current: '#10B981',
  brandBlue: '#3B6CF0',
  brandPurple: '#8B45C8',
  brandPink: '#F2507A',
};

export type Palette = typeof dark;

const light: Palette = {
  bg: '#F6F6F8',
  card: '#FFFFFF',
  cardAlt: '#F2F2F5',
  border: '#E8E8EE',
  borderStrong: '#D4D4DD',
  text: '#121217',
  muted: '#6E6E7A',
  primary: '#5B3FD6',
  primaryAlt: '#5B3FD6',
  accent: '#5B3FD6',
  soft: '#EFEBFF',
  danger: '#DC2650',
  success: '#0F9F6E',
  warning: '#B7791F',
  noteBg: '#FFFBEB',
  noteBorder: '#FDE68A',
  noteText: '#78350F',
  taken: '#ECEBF1',
  hold: '#F3ECFB',
  night: '#F3F1FA',
  past: '#F2F1F6',
  current: '#10B981',
  brandBlue: '#3B6CF0',
  brandPurple: '#8B45C8',
  brandPink: '#F2507A',
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 20 };

export type Scheme = 'dark' | 'light';
const THEME_KEY = 'zaf-theme'; // same key as the website

function saved(): Scheme {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

let current: Scheme = saved();

// The colours in use right now. Read them while rendering (not in module-level constants), so they follow the theme.
export const colors: Palette = { ...(current === 'dark' ? dark : light) };

const ThemeContext = createContext<{ scheme: Scheme; setScheme: (s: Scheme) => void }>({ scheme: current, setScheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, set] = useState<Scheme>(current);
  const setScheme = (s: Scheme) => {
    current = s;
    Object.assign(colors, s === 'dark' ? dark : light);
    try { localStorage.setItem(THEME_KEY, s); } catch {}
    set(s);
  };
  return createElement(ThemeContext.Provider, { value: { scheme, setScheme } }, children);
}

// Call in every screen/component that draws colours, so it re-draws when the theme changes.
export function useTheme() {
  return useContext(ThemeContext);
}

// Styles that use colours: `const useS = themed(() => StyleSheet.create({...}))`, then `const s = useS()` in the component.
export function themed<T>(make: () => T): () => T {
  let cache: { scheme: Scheme; value: T } | null = null;
  return function useThemedStyles() {
    const { scheme } = useTheme();
    if (!cache || cache.scheme !== scheme) cache = { scheme, value: make() };
    return cache.value;
  };
}

// Inter for titles, numbers and buttons: plain and upright, easy to read. Loaded in app/_layout.tsx.
export const fonts = {
  display: 'Inter-Bold',
  displayBold: 'Inter-SemiBold',
  displaySemi: 'Inter-Medium',
};
