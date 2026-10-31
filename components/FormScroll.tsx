import { createContext, forwardRef, useCallback, useContext, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, ScrollView, type HostInstance, type ScrollViewInstance, type ScrollViewProps } from 'react-native';

// A scrolling form that keeps what you type above the keyboard, on Android and iPhone:
// the screen shrinks by the keyboard's height (padding on both, since Android now draws edge to edge and no longer
// shrinks the window by itself), and a tapped Field scrolls itself to about a third from the top.
type Reveal = (node: HostInstance | null) => void;
const RevealContext = createContext<Reveal>(() => {});
export const useRevealOnFocus = () => useContext(RevealContext);

type Props = ScrollViewProps & { children: ReactNode };

export const FormScroll = forwardRef<ScrollViewInstance | null, Props>(function FormScroll({ children, onScroll, ...rest }, ref) {
  const scroll = useRef<ScrollViewInstance>(null);
  const y = useRef(0);
  // how far the form starts from the top of the screen (a header, the status bar): the keyboard padding needs it
  const [offset, setOffset] = useState(0);
  useImperativeHandle(ref, () => scroll.current as ScrollViewInstance, []);

  const reveal = useCallback<Reveal>((node) => {
    if (!node) return;
    // wait for the keyboard to open and the screen to shrink, then measure
    const run = () => {
      const sv = scroll.current as unknown as HostInstance | null;
      if (!sv) return;
      node.measureInWindow((_x, fy, _w, fh) => {
        sv.measureInWindow((_sx, sy, _sw, sh) => {
          const top = fy - sy;
          if (top >= 8 && top + fh + 24 <= sh) return; // already in view
          scroll.current?.scrollTo({ y: Math.max(0, y.current + top - sh / 3), animated: true });
        });
      });
    };
    const sub = Keyboard.addListener('keyboardDidShow', () => { sub.remove(); setTimeout(run, 60); });
    // the keyboard may already be open (moving from one field to the next)
    setTimeout(() => { sub.remove(); run(); }, 350);
  }, []);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={offset}
      onLayout={() => (scroll.current as unknown as HostInstance | null)?.measureInWindow((_x, top) => setOffset(Math.max(0, Math.round(top))))}>
      <RevealContext.Provider value={reveal}>
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={32}
          onScroll={(e) => { y.current = e.nativeEvent.contentOffset.y; onScroll?.(e); }}
          {...rest}
        >
          {children}
        </ScrollView>
      </RevealContext.Provider>
    </KeyboardAvoidingView>
  );
});
