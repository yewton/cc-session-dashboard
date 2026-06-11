import { useEffect, useState } from "react";

export interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function useFetch<T>(fn: () => Promise<T>, deps: unknown[]): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ data: null, error: null, loading: true });
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((err) => {
        if (!cancelled) setState({ data: null, error: String(err), loading: false });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
