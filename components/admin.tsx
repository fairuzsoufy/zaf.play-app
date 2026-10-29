import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { Text } from '@/components/AppText';
import { supabase, uploadPhoto } from '@/lib/supabase';
import { isPdfPath } from '@/lib/admin';
import { egp } from '@/lib/format';
import { cancelReasonText, refundInfo } from '@/lib/refundKind';
import { colors, radius } from '@/lib/theme';
import { Button } from './ui';

// Pieces the admin screens share.

// screenshots or PDFs from signed links; a tap opens the full file
export function ProofImages({ paths, urls, size = 110 }: { paths: string[]; urls: Record<string, string>; size?: number }) {
  if (!paths.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 6 }}>
      {paths.map((p, i) => {
        const url = urls[p];
        if (!url) return <Text key={p} style={{ color: colors.muted, fontSize: 12 }}>Loading…</Text>;
        return (
          <Pressable key={p} onPress={() => Linking.openURL(url)}>
            {isPdfPath(p)
              ? <View style={{ width: size, height: size * 1.4, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.text }}>📄 PDF {i + 1}</Text></View>
              : <Image source={{ uri: url }} style={{ width: size, height: size * 1.4, borderRadius: 8, backgroundColor: colors.cardAlt }} />}
          </Pressable>
        );
      })}
    </View>
  );
}

export type Picked = { uri: string; mimeType: string } | null;

// pick one photo (a transfer receipt)
export function PhotoPick({ value, onChange, title }: { value: Picked; onChange: (p: Picked) => void; title: string }) {
  async function pick() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!r.canceled) onChange({ uri: r.assets[0].uri, mimeType: r.assets[0].mimeType || 'image/jpeg' });
  }
  return (
    <View style={{ marginVertical: 6 }}>
      {value ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image source={{ uri: value.uri }} style={{ width: 60, height: 80, borderRadius: 6 }} />
          <Text style={{ color: colors.danger }} onPress={() => onChange(null)}>Remove</Text>
        </View>
      ) : <Button small variant="ghost" title={`📷 ${title}`} onPress={pick} />}
    </View>
  );
}

// uploads a picked photo to <bucket>/<folder>/<random>.<ext>; the path, or an error
export async function uploadPicked(bucket: string, folder: string, p: { uri: string; mimeType: string }): Promise<{ path?: string; error?: string }> {
  const ext = p.mimeType === 'image/png' ? 'png' : p.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const err = await uploadPhoto(bucket, path, p.uri, p.mimeType);
  return err ? { error: err } : { path };
}

export function Card({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return (
    <View style={{ backgroundColor: colors.card, borderWidth: tone === 'warn' ? 2 : 1, borderColor: tone === 'warn' ? colors.warning : colors.border, borderRadius: radius.lg, padding: 14, marginBottom: 12 }}>
      {children}
    </View>
  );
}

export function Line({ children, muted, bold, size = 13 }: { children: React.ReactNode; muted?: boolean; bold?: boolean; size?: number }) {
  return <Text style={{ color: muted ? colors.muted : colors.text, fontSize: size, fontWeight: bold ? '700' : '400', marginTop: 2 }}>{children}</Text>;
}


// where to send money: a link opens InstaPay, a number or handle copies
export function InstapayValue({ value }: { value: string | null | undefined }) {
  const v = (value || '').trim();
  if (!v) return <Text style={{ color: colors.text, fontWeight: '700' }}>player — contact them for their InstaPay</Text>;
  if (/^https?:\/\//i.test(v)) return <Text style={{ color: colors.primaryAlt, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(v)}>{v} ↗</Text>;
  return <Text style={{ color: colors.primaryAlt }} onPress={() => Clipboard.setStringAsync(v)}>{v} (tap to copy)</Text>;
}

// a live "mm:ss left" or the overdue text
export function Countdown({ until, label, overdue }: { until: string | number | Date; label: string; overdue: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const ms = new Date(until).getTime() - now;
  if (ms <= 0) return <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>{overdue}</Text>;
  const s = Math.floor(ms / 1000);
  return <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '700' }}>{label} {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</Text>;
}

// whether a refund is full or partial, why, how much and where it stands (the website's RefundKindNote, admin side)
export function RefundKindNote({ b }: { b: any }) {
  const info = refundInfo(b);
  if (!info) return null;
  const tone = info.tone === 'green' ? colors.success : info.tone === 'amber' ? colors.warning : colors.danger;
  const reason = !(info.kind === 'full' && b.cancelled_by === 'admin') ? cancelReasonText(b) : '';
  return (
    <View style={{ marginTop: 4 }}>
      <Text style={{ color: tone, fontSize: 12, fontWeight: '700' }}>{info.label}{info.sent ? ' · ✅ Refund sent' : info.due ? ' · ⏳ Refund waiting for you to send' : ''}</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{info.detail}</Text>
      {!!reason && <Text style={{ color: colors.muted, fontSize: 12 }}>{reason}.</Text>}
      {info.refund > 0 && <Text style={{ color: colors.muted, fontSize: 12 }}>Refund {egp(info.refund)}{info.fee > 0 ? ` (after ${egp(info.fee)} InstaPay fee)` : ''}{info.kept > 0 ? ` · kept ${egp(info.kept)}` : ''}</Text>}
    </View>
  );
}
