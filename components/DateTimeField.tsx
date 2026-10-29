import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Text } from '@/components/AppText';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useT } from '@/lib/ownerLang';
import { colors, radius, useTheme } from '@/lib/theme';
import { Button } from './ui';

// A date and time field (the website's datetime-local input), in the phone's own time like the website.
// Android opens the date dialog, then the time dialog; iOS shows the wheel under the field.
export function DateTimeField({ label, value, onChange }: { label: string; value: Date; onChange: (d: Date) => void }) {
  const { scheme } = useTheme();
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const text = value.toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/am|pm/, (x) => x.toUpperCase());

  function press() {
    if (Platform.OS !== 'android') return setOpen(!open);
    DateTimePickerAndroid.open({
      value, mode: 'date',
      onChange: (e, day) => {
        if (e.type !== 'set' || !day) return;
        DateTimePickerAndroid.open({
          value: day, mode: 'time',
          onChange: (e2, time) => { if (e2.type === 'set' && time) onChange(time); },
        });
      },
    });
  }

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: colors.muted, marginBottom: 6, fontSize: 13, fontWeight: '600' }}>{label}</Text>
      <Pressable onPress={press} accessibilityRole="button" accessibilityLabel={`${label}: ${text}`}
        style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 13 }}>
        <Text style={{ color: colors.text, fontSize: 16 }}>{text}</Text>
      </Pressable>
      {open && Platform.OS === 'ios' && (
        <View>
          <DateTimePicker value={value} mode="datetime" display="spinner" themeVariant={scheme} onChange={(_e, d) => d && onChange(d)} />
          <Button small variant="ghost" title={t('Done')} onPress={() => setOpen(false)} />
        </View>
      )}
    </View>
  );
}
