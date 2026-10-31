import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// The website's useBusyPing: reads a court's busy times again the moment a booking, hold or block changes.
// The database sends an empty "busy" message on the topic "court-busy:<court id>". Also reads again when the
// screen or the app comes back, and every 2 minutes if live messages can't connect.
export function useBusyPing(topic: string | null, onPing: () => void) {
  const cb = useRef(onPing);
  useEffect(() => { cb.current = onPing; });

  useEffect(() => {
    if (!topic) return;
    let poll: ReturnType<typeof setInterval> | null = null;
    let wait: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (wait) return;
      wait = setTimeout(() => { wait = null; cb.current(); }, 300 + Math.floor(Math.random() * 1200));
    };
    const channel = supabase
      .channel(topic)
      .on('broadcast', { event: 'busy' }, fire)
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') { if (poll) clearInterval(poll); poll = null; }
        else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !poll) poll = setInterval(() => cb.current(), 120_000);
      });
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') cb.current(); });
    return () => { if (poll) clearInterval(poll); if (wait) clearTimeout(wait); app.remove(); supabase.removeChannel(channel); };
  }, [topic]);

  // coming back to the screen (e.g. from Pay) reads again
  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    cb.current();
  }, []));
}
