import { createContext, forwardRef, useContext } from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps, type TextStyle } from 'react-native';
import { fonts } from '@/lib/theme';

// Text and TextInput in the website's text font, Figtree. Phones do not draw a bold custom font from fontWeight
// alone, so the weight picks the matching Figtree file. Text inside Text keeps its parent's weight, as before.
// A style with its own fontFamily (the Bricolage titles) is left as it is.
const FAMILY: Record<string, string> = {
  '100': fonts.body, '200': fonts.body, '300': fonts.body, '400': fonts.body, normal: fonts.body,
  '500': fonts.bodyMedium, '600': fonts.bodySemi, '700': fonts.bodyBold, bold: fonts.bodyBold, '800': fonts.bodyHeavy, '900': fonts.bodyHeavy,
};
const Weight = createContext<string | null>(null);

function figtree(style: TextProps['style'], inherited: string | null): { family: TextStyle | null; weight: string | null } {
  const flat = (StyleSheet.flatten(style) || {}) as TextStyle;
  if (flat.fontFamily) return { family: null, weight: null };
  const weight = flat.fontWeight != null ? String(flat.fontWeight) : inherited ?? '400';
  return { family: { fontFamily: FAMILY[weight] ?? fonts.body, fontWeight: 'normal' }, weight };
}

export const Text = forwardRef<RNText, TextProps>(function Text({ style, ...rest }, ref) {
  const inherited = useContext(Weight);
  const { family, weight } = figtree(style, inherited);
  const text = <RNText ref={ref} {...rest} style={family ? [style, family] : style} />;
  return weight && weight !== inherited ? <Weight.Provider value={weight}>{text}</Weight.Provider> : text;
});

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, ...rest }, ref) {
  const { family } = figtree(style, null);
  return <RNTextInput ref={ref} {...rest} style={family ? [style, family] : style} />;
});
// so `useRef<TextInput>` keeps working
export type TextInput = RNTextInput;
