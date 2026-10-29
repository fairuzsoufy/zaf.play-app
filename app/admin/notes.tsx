import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { Text, TextInput } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { newSalt, deriveKey, seal, open, type Sealed } from '@/lib/passphraseCrypto';
import { colors, radius } from '@/lib/theme';
import { LinkButton, Loading, Muted } from '@/components/owner';
import { Button, Field } from '@/components/ui';

const SAVE_AFTER_MS = 400; // saves a moment after each change, so every word is kept
const IDLE_LOCK_MS = 5 * 60 * 1000;

type NotesRow = { body: string | null; updated_at: string | null; enc_salt?: string | null; enc_iv?: string | null; enc_data?: string | null };
type State = 'loading' | 'missing' | 'plain' | 'locked' | 'open';

// The admin's notes, like the website's: saved as you type, and optionally scrambled with a passphrase that is
// never stored (it locks again after 5 quiet minutes or when the app goes to the background).
export default function AdminNotes() {
  const [state, setStateRaw] = useState<State>('loading');
  const [canEncrypt, setCanEncrypt] = useState(true);
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [setupOpen, setSetupOpen] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef('');
  const lastSaved = useRef('');
  const sealed = useRef<Sealed | null>(null);
  const key = useRef<Uint8Array | null>(null);
  const salt = useRef<Uint8Array | null>(null);
  const stateRef = useRef<State>('loading');
  const setState = (s: State) => { stateRef.current = s; setStateRaw(s); };

  const save = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const text = latest.current;
    if (text === lastSaved.current) return;
    setStatus('saving');
    const now = new Date().toISOString();
    let error: { message: string } | null;
    if (stateRef.current === 'open' && key.current && salt.current) {
      const s = seal(text, key.current, salt.current);
      ({ error } = await supabase.from('admin_notes').upsert({ id: true, body: '', enc_salt: s.salt, enc_iv: s.iv, enc_data: s.data, updated_at: now }));
      if (!error) sealed.current = s;
    } else {
      ({ error } = await supabase.from('admin_notes').upsert({ id: true, body: text, updated_at: now }));
    }
    if (error) return setStatus('error');
    lastSaved.current = text;
    setSavedAt(new Date());
    setStatus(latest.current === text ? 'saved' : 'unsaved');
  }, []);

  const lock = useCallback(async () => {
    if (stateRef.current !== 'open') return;
    if (latest.current !== lastSaved.current) await save();
    key.current = null;
    salt.current = null;
    latest.current = '';
    lastSaved.current = '';
    setBody('');
    setPass('');
    setState('locked');
  }, [save]);

  const touch = useCallback(() => {
    if (idle.current) clearTimeout(idle.current);
    if (stateRef.current === 'open') idle.current = setTimeout(lock, IDLE_LOCK_MS);
  }, [lock]);

  useEffect(() => {
    (async () => {
      let res = await supabase.from('admin_notes').select('body, updated_at, enc_salt, enc_iv, enc_data').eq('id', true).maybeSingle();
      if (res.error && /enc_/i.test(res.error.message)) {
        // the encryption columns aren't in the database yet: plain notes only
        setCanEncrypt(false);
        res = await supabase.from('admin_notes').select('body, updated_at').eq('id', true).maybeSingle() as typeof res;
      }
      if (res.error) return setState(/admin_notes|does not exist|schema cache/i.test(res.error.message) ? 'missing' : 'plain');
      const row = res.data as NotesRow | null;
      if (row?.updated_at) setSavedAt(new Date(row.updated_at));
      if (row?.enc_data && row.enc_salt && row.enc_iv) {
        sealed.current = { salt: row.enc_salt, iv: row.enc_iv, data: row.enc_data };
        return setState('locked');
      }
      const text = row?.body || '';
      latest.current = text;
      lastSaved.current = text;
      setBody(text);
      setState('plain');
    })();
  }, []);

  // keep what was typed when leaving the screen or the app, and lock when the app goes to the background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') return;
      if (stateRef.current === 'open') lock();
      else if (latest.current !== lastSaved.current) save();
    });
    return () => {
      sub.remove();
      if (latest.current !== lastSaved.current) save();
      if (idle.current) clearTimeout(idle.current);
    };
  }, [save, lock]);

  function onType(text: string) {
    setBody(text);
    latest.current = text;
    setStatus('unsaved');
    touch();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_AFTER_MS);
  }

  async function unlock() {
    setErr('');
    if (!sealed.current) return;
    setBusy(true);
    try {
      const r = await open(sealed.current, pass);
      key.current = r.key;
      salt.current = r.salt;
      latest.current = r.text;
      lastSaved.current = r.text;
      setBody(r.text);
      setPass('');
      setState('open');
      touch();
    } catch {
      setErr('Wrong passphrase.');
    }
    setBusy(false);
  }

  // turns the plain notes into encrypted ones (the readable copy in the database is emptied)
  async function encryptNow() {
    setErr('');
    if (pass.length < 10) return setErr('Use at least 10 characters. A few random words is best.');
    if (pass !== pass2) return setErr('The two passphrases are not the same.');
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    const s = newSalt();
    const k = await deriveKey(pass, s);
    const text = latest.current;
    const sl = seal(text, k, s);
    const { error } = await supabase.from('admin_notes').upsert({ id: true, body: '', enc_salt: sl.salt, enc_iv: sl.iv, enc_data: sl.data, updated_at: new Date().toISOString() });
    setBusy(false);
    if (error) return setErr('Could not save. Check your internet and try again.');
    sealed.current = sl;
    key.current = k;
    salt.current = s;
    lastSaved.current = text;
    setPass('');
    setPass2('');
    setSetupOpen(false);
    setSavedAt(new Date());
    setStatus('saved');
    setState('open');
    touch();
  }

  const statusText = status === 'saving' ? 'Saving…' : status === 'unsaved' ? 'Typing…' : status === 'error' ? 'Not saved — check your internet'
    : savedAt ? `Saved ${savedAt.toLocaleString('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/am|pm/, (x) => x.toUpperCase())}` : 'Saved';

  return (
    <>
      <Stack.Screen options={{ title: state === 'locked' || state === 'open' ? 'Notes 🔒' : 'Notes' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {state === 'loading' && <Loading />}
        {state === 'missing' && <Muted>Notes aren&apos;t switched on in the database yet.</Muted>}
        {state === 'locked' && (
          <View>
            <Muted>Your notes are encrypted. Enter your passphrase to open them.</Muted>
            <Field label="Passphrase" value={pass} onChangeText={setPass} secureTextEntry autoCapitalize="none" autoCorrect={false} autoFocus returnKeyType="go" onSubmitEditing={() => !busy && unlock()} />
            {!!err && <Text style={{ color: colors.danger, marginBottom: 8 }}>{err}</Text>}
            <Button title={busy ? 'Opening... (this takes a few seconds)' : 'Open notes'} onPress={unlock} loading={busy} disabled={!pass} />
          </View>
        )}
        {state === 'plain' && canEncrypt && (
          <View style={{ borderWidth: 1, borderColor: colors.warning, borderRadius: radius.lg, padding: 12, marginBottom: 12 }}>
            <Text style={{ color: colors.text }}><Text style={{ fontWeight: '800' }}>These notes are saved as plain text.</Text> Anyone with database access could read them, so don&apos;t keep passwords here until you encrypt them.</Text>
            {!setupOpen ? <LinkButton title="🔒 Encrypt my notes" onPress={() => setSetupOpen(true)} /> : (
              <View style={{ marginTop: 8 }}>
                <Text style={{ color: colors.text, marginBottom: 8 }}>Choose a passphrase. It is never stored anywhere — <Text style={{ fontWeight: '800' }}>write it down somewhere safe</Text>. If you forget it, the notes can&apos;t be recovered.</Text>
                <Field label="Passphrase (10+ characters)" value={pass} onChangeText={setPass} secureTextEntry autoCapitalize="none" autoCorrect={false} />
                <Field label="Type it again" value={pass2} onChangeText={setPass2} secureTextEntry autoCapitalize="none" autoCorrect={false} />
                {!!err && <Text style={{ color: colors.danger, marginBottom: 8 }}>{err}</Text>}
                <Button small title={busy ? 'Encrypting...' : 'Encrypt'} onPress={encryptNow} loading={busy} disabled={!pass} />
                <LinkButton title="Cancel" onPress={() => { setSetupOpen(false); setErr(''); }} />
              </View>
            )}
          </View>
        )}
        {(state === 'plain' || state === 'open') && (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ color: status === 'error' ? colors.danger : colors.muted, fontSize: 12, flex: 1 }}>
                {statusText}{state === 'open' ? ' · scrambled · locks after 5 quiet minutes' : ''}
              </Text>
              {state === 'open' && <LinkButton title="Lock" onPress={lock} />}
            </View>
            <TextInput value={body} onChangeText={onType} onBlur={() => save()} multiline textAlignVertical="top" autoFocus={state === 'open'}
              style={{ flex: 1, minHeight: 420, color: colors.text, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 14, fontSize: 16, lineHeight: 24 }} />
          </>
        )}
      </ScrollView>
    </>
  );
}
