import { useState } from 'react';
import { Image, Linking, Pressable, View } from 'react-native';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { useT } from '@/lib/ownerLang';
import { colors } from '@/lib/theme';
import { fmtEGP, LinkButton, Muted, Pager, PAGE_SIZE } from './owner';

// shared by Owner → Money and the admin's Owner Settlements
// "Show the bookings in this transfer"
export function PayoutDetails({ payoutId, pending }: { payoutId?: string; pending?: { ownerId: string; day: string; instapayKey: string } }) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ bookings: any[]; deductions: any[] } | null>(null);
  const [error, setError] = useState('');

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (data) return;
    const { data: d, error: e } = pending
      ? await supabase.rpc('admin_settlement_details', { p_owner_id: pending.ownerId, p_day: pending.day, p_instapay_key: pending.instapayKey })
      : await supabase.rpc('payout_details', { p_payout_id: payoutId });
    if (e) setError(e.message);
    else setData({ bookings: (d as any)?.bookings || [], deductions: (d as any)?.deductions || [] });
  }

  const when = (s: string, e: string) => {
    const o = { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', hour12: true } as const;
    return `${new Date(s).toLocaleString(locale, { ...o, weekday: 'short', day: 'numeric', month: 'short' })}–${new Date(e).toLocaleTimeString(locale, o)}`.replace(/am|pm/g, (x) => x.toUpperCase());
  };
  const shown = (data?.bookings || []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const net = (data?.bookings || []).reduce((a, b) => a + Number(b.owner_net), 0) - (data?.deductions || []).reduce((a, d) => a + Number(d.amount), 0);

  return (
    <View style={{ marginTop: 6 }}>
      <LinkButton title={open ? t('Hide the bookings') : t('Show the bookings in this transfer')} onPress={toggle} />
      {open && (
        <View style={{ marginTop: 6 }}>
          {!!error && <Text style={{ color: colors.danger }}>{error}</Text>}
          {!data && !error && <Muted>{t('Loading...')}</Muted>}
          {data && (
            <>
              {shown.map((b) => (
                <View key={b.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{when(b.start_time, b.end_time)}</Text>
                  <Muted style={{ fontSize: 12 }}>{b.court} · {b.sport} · {b.branch}{b.player ? ` · ${b.player}` : ''}</Muted>
                  {b.status === 'cancelled' && <Text style={{ color: colors.warning, fontSize: 12 }}>{t('late cancellation fee')}</Text>}
                  <Muted style={{ fontSize: 12 }}>{t('Paid')} {fmtEGP(b.price)} · Zaf Play − {fmtEGP(b.commission)} ({Number(b.commission_rate)}%) · {t('You get')} {fmtEGP(b.owner_net)}</Muted>
                </View>
              ))}
              {data.deductions.map((d, i) => (
                <View key={`d${i}`} style={{ paddingVertical: 6, borderTopWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: Number(d.amount) < 0 ? colors.success : colors.danger, fontSize: 13, fontWeight: '700' }}>
                    {Number(d.amount) < 0 ? t('Tournament share') : t('Deduction')} · {d.branch}: {Number(d.amount) < 0 ? `+ ${fmtEGP(-Number(d.amount))}` : `− ${fmtEGP(d.amount)}`}
                  </Text>
                  <Muted style={{ fontSize: 12 }}>{d.reason}</Muted>
                </View>
              ))}
              <Text style={{ color: colors.text, fontWeight: '800', marginTop: 6 }}>
                {t('{n} booking(s)', { n: data.bookings.length })}{data.deductions.length > 0 ? ` · ${t('{n} deduction(s)', { n: data.deductions.length })}` : ''} · {fmtEGP(net)}
              </Text>
              <Pager page={page} total={data.bookings.length} onChange={setPage} />
            </>
          )}
        </View>
      )}
    </View>
  );
}

// the transfer receipts Zaf Play uploaded (private files, opened with a short-lived link)
export function ProofGallery({ paths }: { paths: string[] }) {
  const [items, setItems] = useState<{ url: string; isPdf: boolean }[] | null>(null);
  const [error, setError] = useState('');
  if (!paths.length) return null;

  async function toggle() {
    if (items) return setItems(null);
    const { data, error: e } = await supabase.storage.from('payout-proofs').createSignedUrls(paths, 3600);
    if (e) return setError('Could not load the proof files.');
    setItems((data || []).filter((d) => d.signedUrl).map((d) => ({ url: d.signedUrl as string, isPdf: (d.path || '').toLowerCase().endsWith('.pdf') })));
  }

  return (
    <View style={{ marginTop: 4 }}>
      <LinkButton title={items ? 'Hide proof' : `View transfer proof (${paths.length})`} onPress={toggle} />
      {!!error && <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text>}
      {items && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
          {items.map((it, i) => (
            <Pressable accessibilityRole="button" key={i} onPress={() => Linking.openURL(it.url)}>
              {it.isPdf
                ? <View style={{ width: 90, height: 120, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.text }}>📄 PDF {i + 1}</Text></View>
                : <Image source={{ uri: it.url }} style={{ width: 90, height: 120, borderRadius: 8 }} />}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
