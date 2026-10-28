import 'expo-sqlite/localStorage/install';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AR } from './ownerAr';
import { colors } from './theme';

// English / Arabic for the owner screens, the same as the website's lib/ownerLang.tsx. Text is written in
// English and wrapped in t('...'); in Arabic, t() looks the English up in AR (lib/ownerAr.ts, copied from the
// website) and falls back to English when a line is missing. The choice is kept on this phone.
// Arabic is for reading only: owner fields never take Arabic letters (Field strips them inside the provider).

type Lang = 'en' | 'ar';
type Vars = Record<string, string | number>;
type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (s: string, vars?: Vars) => string; tm: (time: string) => string; locale: string; owner: boolean };

const KEY = 'zaf-owner-lang';
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;

function fill(s: string, vars?: Vars) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

const same = (x: string) => x;
const english: Ctx = { lang: 'en', setLang: () => {}, t: fill, tm: same, locale: 'en-GB', owner: false };
const arTime = (x: string) => x.replace(/\s?AM\b/gi, ' ص').replace(/\s?PM\b/gi, ' م').replace(/^Midnight$/, 'منتصف الليل');
const LangContext = createContext<Ctx>(english);

function savedLang(): Lang {
  try { return localStorage.getItem(KEY) === 'ar' ? 'ar' : 'en'; } catch { return 'en'; }
}

export function OwnerLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(savedLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch {}
  }, []);
  const value = useMemo<Ctx>(() => ({
    lang,
    setLang,
    t: lang === 'ar' ? (s, vars) => fill(AR[s] ?? s, vars) : fill,
    tm: lang === 'ar' ? arTime : same,
    // month names in Arabic, digits stay 0-9 so prices and times read the same
    locale: lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB',
    owner: true,
  }), [lang, setLang]);
  return (
    <LangContext.Provider value={value}>
      <View style={{ flex: 1, direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{children}</View>
    </LangContext.Provider>
  );
}

// Outside the owner screens there is no provider, so t() simply gives back the English.
export function useT() {
  return useContext(LangContext);
}

// what a field on an owner screen keeps: Arabic letters are dropped (null when nothing was dropped)
export function withoutArabic(text: string): string | null {
  const out = text.replace(ARABIC, '');
  return out === text ? null : out;
}

export function LangSwitch() {
  const { lang, setLang } = useT();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Language / اللغة"
      style={{ flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 999, padding: 2, alignSelf: 'flex-start' }}>
      {(['en', 'ar'] as const).map((l) => (
        <Pressable key={l} onPress={() => setLang(l)} accessibilityRole="radio" accessibilityState={{ selected: lang === l }}
          style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: lang === l ? colors.text : 'transparent' }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: lang === l ? colors.bg : colors.muted }}>{l === 'en' ? 'English' : 'العربية'}</Text>
        </Pressable>
      ))}
    </View>
  );
}
