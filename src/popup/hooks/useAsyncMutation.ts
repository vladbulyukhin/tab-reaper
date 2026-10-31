import { useEffect, useReducer, useRef } from "react";
import { errorMessage } from "./useAsyncResource";

type MutationState = { pending: boolean; error: string | null };
type MutationAction =
  | { type: "started" }
  | { type: "completed" }
  | { type: "failed"; error: string };

export function mutationReducer(
  _state: MutationState,
  action: MutationAction,
): MutationState {
  switch (action.type) {
    case "started":
      return { pending: true, error: null };
    case "completed":
      return { pending: false, error: null };
    case "failed":
      return { pending: false, error: action.error };
  }
}

// A synchronous lock prevents double submission before React renders pending.
// Feature modules own the write and subsequent read; this hook owns UI feedback.
export function useAsyncMutation() {
  const [state, dispatch] = useReducer(mutationReducer, {
    pending: false,
    error: null,
  });
  const locked = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  async function run(operation: () => Promise<unknown>): Promise<boolean> {
    if (locked.current || !mounted.current) return false;
    locked.current = true;
    const request = generation.current;
    dispatch({ type: "started" });

    try {
      await operation();
      if (mounted.current && request === generation.current)
        dispatch({ type: "completed" });
      return true;
    } catch (reason) {
      if (mounted.current && request === generation.current)
        dispatch({ type: "failed", error: errorMessage(reason) });
      return false;
    } finally {
      locked.current = false;
    }
  }

  function clearError() {
    dispatch({ type: "completed" });
  }

  return { ...state, run, clearError };
}
