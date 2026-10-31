import '@/lib/localStorage';
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import { Appearance } from 'react-native';

// Night Match, the website's colours (app/globals.css there): a navy ground in dark mode, a pale blue ground in
// light mode, blue for what you can press, pink for what needs attention, and one blue → pink gradient moment.
const dark = {
  bg: '#0B1030', // ink
  card: '#151E55', // surface
  cardAlt: '#1B2566', // chips, inputs and tiles inside a card
  border: '#2A3472', // line
  borderStrong: '#3A4590',
  text: '#F4F6FF',
  muted: '#9AA8E0',
  primary: '#7FA3FF', // sky: accent text (links, small highlights) on dark
  primaryAlt: '#7FA3FF', // links
  soft: '#1F2C78', // light accent background (pills, pressed)
  danger: '#FF5C7A',
  success: '#3DDC97', // mint
  warning: '#FFB547', // amber
  noteBg: '#2A1A3A',
  noteBorder: '#6B2A55',
  noteText: '#FFC2DB', // "careful" notes are pink, like the website
  taken: '#1A2258',
  hold: '#2A1E4F',
  night: '#121A4A',
  past: '#0E1440',
  current: '#3DDC97',
  accent: '#2D5BFF', // blue: what is chosen or can be pressed
  brandBlue: '#2D5BFF',
  brandPink: '#E0206F', // pink deep, behind white text
  brandPinkBright: '#FF3E8A', // pink on dark grounds only
  tabOn: '#E6E9F5', // the chosen tab icon: light grey, not blue
  linkSoft: '#C9CEDF', // quiet links on the login screen: light grey
};

export type Palette = typeof dark;

const light: Palette = {
  bg: '#F4F6FF', // day
  card: '#FFFFFF',
  cardAlt: '#EEF1FF',
  border: '#DCE2FF',
  borderStrong: '#C5CFF5',
  text: '#0B1030',
  muted: '#5A66A8',
  primary: '#2D5BFF',
  primaryAlt: '#2D5BFF',
  soft: '#E3EAFF',
  danger: '#C81E4A',
  success: '#0F9F63',
  warning: '#B86E00',
  noteBg: '#FFF0F6',
  noteBorder: '#FFC2DB',
  noteText: '#7A0F3D',
  taken: '#E6E9F7',
  hold: '#FFE0EE',
  night: '#EEF1FF',
  past: '#F0F2FA',
  current: '#0F9F63',
  accent: '#2D5BFF',
  brandBlue: '#2D5BFF',
  brandPink: '#E0206F',
  brandPinkBright: '#E0206F', // bright pink fails on white, so light screens use pink deep
  tabOn: '#3A4060',
  linkSoft: '#4A5070',
};

export const radius = { sm: 8, md: 12, lg: 18, xl: 24 };

export type Scheme = 'dark' | 'light';
const THEME_KEY = 'zaf-theme'; // same key as the website

export type Choice = Scheme | 'system';

// What the player picked; nothing saved means follow the phone's own light / dark setting.
function saved(): Choice {
  try { const v = localStorage.getItem(THEME_KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; }
}
const phone = (): Scheme => (Appearance.getColorScheme() === 'light' ? 'light' : 'dark');
const resolve = (c: Choice): Scheme => (c === 'system' ? phone() : c);

let choice: Choice = saved();
let current: Scheme = resolve(choice);

// The colours in use right now. Read them while rendering (not in module-level constants), so they follow the theme.
export const colors: Palette = { ...(current === 'dark' ? dark : light) };

const ThemeContext = createContext<{ scheme: Scheme; choice: Choice; setScheme: (s: Choice) => void }>({ scheme: current, choice, setScheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, set] = useState<Scheme>(current);
  const [picked, setPicked] = useState<Choice>(choice);
  const apply = (s: Scheme) => {
    current = s;
    Object.assign(colors, s === 'dark' ? dark : light);
    set(s);
  };
  const setScheme = (c: Choice) => {
    choice = c;
    try { if (c === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, c); } catch {}
    setPicked(c);
    apply(resolve(c));
  };
  // while following the phone, switch when the phone switches
  useEffect(() => {
    const sub = Appearance.addChangeListener(() => { if (choice === 'system') apply(phone()); });
    return () => sub.remove();
  }, []);
  return createElement(ThemeContext.Provider, { value: { scheme, choice: picked, setScheme } }, children);
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

// The website's fonts: Bricolage Grotesque for titles, numbers and buttons, Figtree for text (components/AppText.tsx). Loaded in app/_layout.tsx.
export const fonts = {
  display: 'Bricolage-ExtraBold',
  displayBold: 'Bricolage-Bold',
  displaySemi: 'Bricolage-SemiBold',
  body: 'Figtree-Regular',
  bodyMedium: 'Figtree-Medium',
  bodySemi: 'Figtree-SemiBold',
  bodyBold: 'Figtree-Bold',
  bodyHeavy: 'Figtree-ExtraBold',
};
