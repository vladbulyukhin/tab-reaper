import { useCallback, useEffect, useReducer, useRef } from "react";

export type ResourceState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

export type ResourceAction<T> =
  | { type: "loading" }
  | { type: "loaded"; data: T }
  | { type: "failed"; error: string };

export function resourceReducer<T>(
  state: ResourceState<T>,
  action: ResourceAction<T>,
): ResourceState<T> {
  switch (action.type) {
    case "loading":
      return { ...state, loading: true, error: null };
    case "loaded":
      return { data: action.data, loading: false, error: null };
    case "failed":
      return { ...state, loading: false, error: action.error };
  }
}

export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

// Loaders should be memoized. Only the latest request may update the mounted UI.
// Refresh rejects so feature-specific mutations can distinguish read failures.
export function useAsyncResource<T>(loader: (() => Promise<T>) | null) {
  const [state, dispatch] = useReducer(resourceReducer<T>, {
    data: null,
    loading: false,
    error: null,
  });
  const generation = useRef(0);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    if (!loader) throw new Error("Background connection unavailable");

    const request = ++generation.current;
    dispatch({ type: "loading" });

    try {
      const data = await loader();
      if (mounted.current && request === generation.current) {
        dispatch({ type: "loaded", data });
      }
      return data;
    } catch (reason) {
      if (mounted.current && request === generation.current) {
        dispatch({ type: "failed", error: errorMessage(reason) });
      }
      throw reason;
    }
  }, [loader]);

  useEffect(() => {
    mounted.current = true;
    if (loader) void refresh().catch(() => undefined);

    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [loader, refresh]);

  return { ...state, refresh };
}
