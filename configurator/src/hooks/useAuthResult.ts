import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AuthResult, consumeAuthResult } from '@/api/onboarding';

/**
 * Consumes the BFF's one-use result exactly once, including under React
 * StrictMode's development effect replay, and removes the opaque id from the
 * visible URL immediately.
 */
export function useAuthResult() {
  const [searchParams, setSearchParams] = useSearchParams();
  const started = useRef<string | null>(null);
  const [result, setResult] = useState<AuthResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = searchParams.get('authResult');
    if (!id || started.current === id) return;
    started.current = id;

    const next = new URLSearchParams(searchParams);
    next.delete('authResult');
    setSearchParams(next, { replace: true });

    consumeAuthResult(id)
      .then((value) => {
        setResult(value);
      })
      .catch(() => {
        setError('That sign-in message expired. Please try again.');
      });
    // The URL is intentionally captured once for each new opaque result id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('authResult')]);

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, error, clear };
}
