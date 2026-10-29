import { useRef } from 'react';

// One request id per attempt, same as the website: if the answer is lost and the player taps again, the same id goes
// to the server, which returns the first result instead of joining or paying twice. Call done() after a success.
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});

export function useRequestId() {
  const ref = useRef<string | null>(null);
  return {
    get: () => (ref.current ??= uuid()),
    done: () => { ref.current = null; },
  };
}
