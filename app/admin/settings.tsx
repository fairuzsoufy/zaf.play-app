import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { Line } from '@/components/admin';
import { Box, H2, LinkButton, Loading, Muted } from '@/components/owner';
import { Button, Field, Note } from '@/components/ui';

// Settings, like the website's admin page: the late fee and its split, referral / tournament / open game numbers,
// and Telegram alerts.
export default function AdminSettings() {
  const [loaded, setLoaded] = useState(false);
  const [lateFee, setLateFee] = useState('');
  const [zafShare, setZafShare] = useState('50');
  const [feeMsg, setFeeMsg] = useState('');
  const [tg, setTg] = useState<{ connected: boolean; chat_id: string | null }>({ connected: false, chat_id: null });
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [tgMsg, setTgMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [game, setGame] = useState({ referral: '5', share: '50', fill: '3' });
  const [gameMsg, setGameMsg] = useState('');

  const load = useCallback(async () => {
    const { data: s } = await supabase.from('app_settings').select('late_fee_percent, late_fee_zaf_share, referral_percent, tournament_zaf_share, open_game_fill_hours').single();
    const x = s as any;
    setGame({ referral: String(x?.referral_percent ?? 5), share: String(x?.tournament_zaf_share ?? 20), fill: String(x?.open_game_fill_hours ?? 3) });
    setLateFee(String(x?.late_fee_percent ?? 50));
    setZafShare(String(x?.late_fee_zaf_share ?? 50));
    const { data: t } = await supabase.rpc('admin_telegram_status');
    setTg((t as any) || { connected: false, chat_id: null });
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveFee() {
    setBusy(true);
    setFeeMsg('');
    const { error: e1 } = await supabase.rpc('admin_set_late_fee', { p_percent: Number(lateFee) });
    const { error: e2 } = e1 ? { error: null } : await supabase.rpc('admin_set_late_fee_share', { p_zaf_share: Number(zafShare) });
    const error = e1 || e2;
    setBusy(false);
    setFeeMsg(error ? `❌ ${error.message}` : '✅ Saved. Every court now uses this fee for new changes and cancellations.');
  }

  async function saveGame() {
    setBusy(true);
    const { error } = await supabase.rpc('admin_set_game_settings', { p_referral_percent: Number(game.referral), p_tournament_zaf_share: Number(game.share), p_open_game_fill_hours: Number(game.fill) });
    setBusy(false);
    setGameMsg(error ? `❌ ${error.message}` : '✅ Saved. New tournaments use the new share; existing ones keep theirs.');
  }

  async function saveTelegram(disconnect = false) {
    setBusy(true);
    setTgMsg('');
    const { error } = await supabase.rpc('admin_set_telegram', { p_bot_token: disconnect ? '' : token, p_chat_id: disconnect ? '' : chatId });
    if (error) { setBusy(false); return setTgMsg(`❌ ${error.message}`); }
    if (!disconnect) await supabase.rpc('admin_test_telegram');
    setBusy(false);
    setToken('');
    setChatId('');
    setTgMsg(disconnect ? 'Telegram alerts turned off.' : '✅ Connected — a test message is on its way to your Telegram.');
    load();
  }

  async function test() {
    setBusy(true);
    setTgMsg('');
    const { error } = await supabase.rpc('admin_test_telegram');
    setBusy(false);
    setTgMsg(error ? `❌ ${error.message}` : 'Test message sent — check Telegram.');
  }

  const pct = (v: string) => v.replace(/[^\d.]/g, '');

  return (
    <>
      <Stack.Screen options={{ title: 'Settings' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {!loaded ? <Loading /> : (
          <>
            <Box>
              <H2>Late change / cancellation fee</H2>
              <Muted>Kept from the player&apos;s payment when they change or cancel less than 3 hours before the game. The same for every court; owners can&apos;t change it.</Muted>
              <Field label="% kept" value={lateFee} onChangeText={(v) => setLateFee(pct(v))} keyboardType="decimal-pad" />
              <Muted>How the kept fee is split:</Muted>
              <Field label="Zaf Play %" value={zafShare} onChangeText={(v) => setZafShare(pct(v))} keyboardType="decimal-pad" />
              <Line muted>Owner {Math.max(0, 100 - Number(zafShare || 0))}%</Line>
              <View style={{ marginTop: 8 }}><Button small title="Save" onPress={saveFee} disabled={busy} /></View>
              {!!feeMsg && <Text style={{ color: colors.text, marginTop: 8 }}>{feeMsg}</Text>}
            </Box>

            <Box>
              <H2>Referrals, tournaments & open games</H2>
              <Field label="Referral discount %" value={game.referral} onChangeText={(v) => setGame({ ...game, referral: pct(v) })} keyboardType="decimal-pad" />
              <Field label="Zaf Play share of tournament fees %" value={game.share} onChangeText={(v) => setGame({ ...game, share: pct(v) })} keyboardType="decimal-pad" />
              <Field label="Open games must fill by (hours before)" value={game.fill} onChangeText={(v) => setGame({ ...game, fill: v.replace(/\D/g, '') })} keyboardType="number-pad" />
              <Button small title="Save" onPress={saveGame} disabled={busy} />
              {!!gameMsg && <Text style={{ color: colors.text, marginTop: 8 }}>{gameMsg}</Text>}
            </Box>

            <Box>
              <H2>Telegram alerts on your phone</H2>
              <Muted>Get a Telegram message for every new payment to approve, cancellation request, new owner, new court and plan request — even when the website is closed.</Muted>
              {tg.connected ? (
                <Note kind="ok">✅ Connected (chat {tg.chat_id}).</Note>
              ) : (
                <View style={{ marginTop: 8 }}>
                  <Line>1. In Telegram, open <Text style={{ fontWeight: '800' }}>@BotFather</Text>, send /newbot, give it a name (e.g. Zaf Play Alerts) and a username ending in bot. It replies with a <Text style={{ fontWeight: '800' }}>token</Text> like 123456789:AAH…. Copy it.</Line>
                  <Line>2. Open your new bot and press <Text style={{ fontWeight: '800' }}>Start</Text> (send it any message) — a bot can only message people who wrote to it first.</Line>
                  <Line>3. Open <Text style={{ fontWeight: '800' }}>@userinfobot</Text> and press Start. It replies with your <Text style={{ fontWeight: '800' }}>Id</Text> (a number). That is your chat ID.</Line>
                  <Line>4. Paste both below and press Connect. You&apos;ll get a test message straight away.</Line>
                  <View style={{ marginTop: 10 }}>
                    <Field label="Bot token" value={token} onChangeText={setToken} placeholder="123456789:AAH..." secureTextEntry autoCapitalize="none" autoCorrect={false} />
                    <Field label="Your chat ID" value={chatId} onChangeText={setChatId} placeholder="123456789" keyboardType="numbers-and-punctuation" />
                    <Button small title="Connect" onPress={() => saveTelegram(false)} disabled={busy || !token.trim() || !chatId.trim()} />
                  </View>
                </View>
              )}
              {tg.connected && (
                <View style={{ flexDirection: 'row' }}>
                  <LinkButton title="Send a test message" onPress={test} disabled={busy} />
                  <LinkButton title="Turn off" onPress={() => saveTelegram(true)} disabled={busy} />
                </View>
              )}
              {!!tgMsg && <Text style={{ color: colors.text, marginTop: 8 }}>{tgMsg}</Text>}
              <Muted style={{ fontSize: 12, marginTop: 8 }}>The token is stored privately in the database and is never shown again on this page.</Muted>
            </Box>
          </>
        )}
      </ScrollView>
    </>
  );
}
