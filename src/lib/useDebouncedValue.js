import { useEffect, useState } from 'react';

// Returns `value` delayed by `delayMs` of quiet time. The visible text input
// stays instant (it holds the raw value); only the debounced copy — which
// drives filtering/queries — updates after the user pauses. A new keystroke
// cancels the pending update, so obsolete filter passes never run.
export function useDebouncedValue(value, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
