import { useState, useCallback, useRef } from 'react';

interface UseRateLimitOptions {
  maxAttempts: number;
  windowMs: number;
}

export function useRateLimit({ maxAttempts, windowMs }: UseRateLimitOptions) {
  const [remainingAttempts, setRemainingAttempts] = useState(maxAttempts);
  const [isLimited, setIsLimited] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const timestamps = useRef<number[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const checkLimit = useCallback((): boolean => {
    const now = Date.now();
    // Remove expired timestamps
    timestamps.current = timestamps.current.filter(t => now - t < windowMs);

    if (timestamps.current.length >= maxAttempts) {
      const oldest = timestamps.current[0];
      const unlockAt = oldest + windowMs;
      const secondsLeft = Math.ceil((unlockAt - now) / 1000);

      setIsLimited(true);
      setCooldownSeconds(secondsLeft);
      setRemainingAttempts(0);

      // Start countdown
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        const remaining = Math.ceil((unlockAt - Date.now()) / 1000);
        if (remaining <= 0) {
          setIsLimited(false);
          setCooldownSeconds(0);
          setRemainingAttempts(maxAttempts);
          timestamps.current = [];
          if (timerRef.current) clearInterval(timerRef.current);
        } else {
          setCooldownSeconds(remaining);
        }
      }, 1000);

      return false;
    }

    timestamps.current.push(now);
    setRemainingAttempts(maxAttempts - timestamps.current.length);
    return true;
  }, [maxAttempts, windowMs]);

  return { checkLimit, isLimited, cooldownSeconds, remainingAttempts };
}
