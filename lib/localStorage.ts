import { requireOptionalNativeModule } from 'expo';

// localStorage for the app (the login, theme, favourites...), saved on the phone by expo-sqlite.
// A build whose native side has no expo-sqlite used to crash on start ("Cannot find native module 'ExpoSQLite'"):
// it now gets a memory-only localStorage instead, so the app still opens (a login then lasts until the app is closed).
if (requireOptionalNativeModule('ExpoSQLite')) {
  require('expo-sqlite/localStorage/install');
} else if (!(globalThis as any).localStorage) {
  const m = new Map<string, string>();
  (globalThis as any).localStorage = {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
  if (__DEV__) console.warn('expo-sqlite is not in this build: localStorage is kept in memory only');
}
