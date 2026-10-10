import 'expo-sqlite/localStorage/install';
import { createContext, createElement, useContext, useState, type ReactNode } from 'react';

// Same colours as the website (app/globals.css there): near-black "ink" in dark mode, white in light mode,
// and the logo's blue → purple → pink gradient for buttons and anything chosen.
const dark = {
  bg: '#07060D',
  card: '#11101C',
  cardAlt: '#1A1828',
  border: '#25233A',
  borderStrong: '#34304F',
  text: '#F4F5FB',
  muted: '#9A95B6',
  primary: '#A38BFF', // accent text (links, small highlights)
  primaryAlt: '#7C9BFF', // links
  soft: '#2A2350', // light accent background (pills, pressed)
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
  bg: '#F7F6FB',
  card: '#FFFFFF',
  cardAlt: '#F1EFF8',
  border: '#E7E4F2',
  borderStrong: '#D3CFE6',
  text: '#171717',
  muted: '#6B6785',
  primary: '#5B3FD6',
  primaryAlt: '#3B6CF0',
  soft: '#ECE7FD',
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

export const radius = { sm: 8, md: 12, lg: 18, xl: 24 };

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

// The website's display font (Saira, italic, heavy) for titles, numbers and buttons. Loaded in app/_layout.tsx.
export const fonts = {
  display: 'Saira-ExtraBoldItalic',
  displayBold: 'Saira-BoldItalic',
  displaySemi: 'Saira-SemiBoldItalic',
};
