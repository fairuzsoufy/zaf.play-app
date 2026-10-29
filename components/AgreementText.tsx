import { Fragment } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@/components/AppText';
import { colors } from '@/lib/theme';

// The agreement text from the database, in the same small part of Markdown as the website's AgreementText:
// "## " headings, "- " bullets, "|" tables, "---" lines, **bold** and plain paragraphs.
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <Text key={i} style={{ fontWeight: '800' }}>{part.slice(2, -2)}</Text>
      : <Fragment key={i}>{part}</Fragment>
  );
}

const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export default function AgreementText({ body }: { body: string }) {
  const p = { color: colors.text, fontSize: 14, lineHeight: 21, marginBottom: 10 };
  return (
    <View>
      {body.trim().split(/\n\s*\n/).map((block, i) => {
        const lines = block.split('\n');
        if (block.trim() === '---') return <View key={i} style={{ height: 1, backgroundColor: colors.border, marginVertical: 12 }} />;
        if (block.startsWith('## ')) return <Text key={i} style={{ color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 8, marginBottom: 8 }}>{block.slice(3)}</Text>;
        if (lines.every((l) => l.trim().startsWith('|'))) {
          const [head, , ...rows] = lines;
          return (
            <ScrollView key={i} horizontal style={{ marginBottom: 10 }}>
              <View>
                {[head, ...rows].map((r, k) => (
                  <View key={k} style={{ flexDirection: 'row' }}>
                    {cells(r).map((c, j) => (
                      <Text key={j} style={{ color: colors.text, width: 150, padding: 6, borderWidth: 0.5, borderColor: colors.border, fontSize: 13, fontWeight: k === 0 ? '800' : '400' }}>{inline(c)}</Text>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          );
        }
        if (lines.every((l) => l.startsWith('- '))) {
          return (
            <View key={i} style={{ marginBottom: 10 }}>
              {lines.map((l, j) => <Text key={j} style={[p, { marginBottom: 4 }]}>•  {inline(l.slice(2))}</Text>)}
            </View>
          );
        }
        return <Text key={i} style={p}>{inline(lines.join(' '))}</Text>;
      })}
    </View>
  );
}
