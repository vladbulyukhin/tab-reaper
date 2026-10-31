import { useContext, useReducer } from "react";
import { BackgroundCommunicationContext } from "../../../contexts/BackgroundCommunication";

type RecoveryState = {
  confirming: boolean;
  pending: boolean;
  error: string | null;
};
type RecoveryAction =
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "started" }
  | { type: "completed" }
  | { type: "failed" };

function recoveryReducer(
  _state: RecoveryState,
  action: RecoveryAction,
): RecoveryState {
  switch (action.type) {
    case "confirm":
      return { confirming: true, pending: false, error: null };
    case "cancel":
    case "completed":
      return { confirming: false, pending: false, error: null };
    case "started":
      return { confirming: true, pending: true, error: null };
    case "failed":
      return {
        confirming: true,
        pending: false,
        error: "Could not forget saved Keeps. Please try again.",
      };
  }
}

export function SavedKeepRecovery({
  onRecovered,
}: { onRecovered: () => Promise<unknown> }) {
  const { sendMessage } = useContext(BackgroundCommunicationContext);
  const [state, dispatch] = useReducer(recoveryReducer, {
    confirming: false,
    pending: false,
    error: null,
  });

  async function forgetSavedKeeps() {
    if (!sendMessage || state.pending) return;
    dispatch({ type: "started" });

    try {
      const response = await sendMessage(
        "forgetCurrentTabSavedKeeps",
        undefined,
      );
      if (response.status !== "ok") throw new Error("Recovery failed");
      await onRecovered();
      dispatch({ type: "completed" });
    } catch {
      dispatch({ type: "failed" });
    }
  }

  return (
    <div className="mt-2">
      {state.confirming ? (
        <>
          <p>
            Forget saved Keeps for this address? This may remove protection from
            tabs in hidden groups or previous sessions. Visible kept tabs stay
            protected.
          </p>
          <button
            type="button"
            disabled={state.pending}
            className="mt-2 underline"
            onClick={() => void forgetSavedKeeps()}
          >
            Forget saved Keeps
          </button>{" "}
          <button
            type="button"
            disabled={state.pending}
            className="underline"
            onClick={() => dispatch({ type: "cancel" })}
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          className="underline"
          onClick={() => dispatch({ type: "confirm" })}
        >
          Resolve old saved Keeps…
        </button>
      )}
      {state.error ? (
        <p role="alert" className="mt-2 text-red-700">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
