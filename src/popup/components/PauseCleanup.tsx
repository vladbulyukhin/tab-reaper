import { Clock } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { MessageResponses } from "../../common/models/Message";
import { BackgroundCommunicationContext } from "../contexts/BackgroundCommunication";

type SnoozeStatus = MessageResponses["getSnoozeStatus"];
type PauseState = {
  expanded: boolean;
  error: string | null;
  busy: boolean;
  status: SnoozeStatus;
};
type PauseAction =
  | { type: "expanded"; value: boolean }
  | { type: "error"; value: string | null }
  | { type: "busy"; value: boolean }
  | { type: "status"; value: SnoozeStatus };

const initialPauseState: PauseState = {
  expanded: false,
  error: null,
  busy: false,
  status: { snoozed: false, until: null, remainingMinutes: null },
};

function pauseReducer(state: PauseState, action: PauseAction): PauseState {
  switch (action.type) {
    case "expanded":
      return { ...state, expanded: action.value };
    case "error":
      return { ...state, error: action.value };
    case "busy":
      return { ...state, busy: action.value };
    case "status":
      return { ...state, status: action.value };
  }
}

export function formatRemaining(minutes: number | null): string | null {
  if (typeof minutes !== "number") return null;
  if (minutes < 60) return `${Math.max(minutes, 0)}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function PauseCleanup({ route }: { route: string }) {
  const { sendMessage } = useContext(BackgroundCommunicationContext);
  const pauseToggleRef = useRef<HTMLButtonElement>(null);
  const [state, dispatch] = useReducer(pauseReducer, initialPauseState);
  const {
    expanded: pauseExpanded,
    error: pauseError,
    busy: pauseBusy,
    status,
  } = state;
  const retryPause = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (route) dispatch({ type: "expanded", value: false });
  }, [route]);

  const readSnooze = useCallback(async () => {
    if (!sendMessage) throw new Error("Background connection unavailable");
    const response = await sendMessage("getSnoozeStatus", undefined);
    if (response.status === "error")
      throw new Error("Pause status unavailable");
    dispatch({ type: "status", value: response });
  }, [sendMessage]);

  const refreshSnooze = useCallback(() => {
    void readSnooze().catch(() => {
      dispatch({
        type: "error",
        value: "Could not load pause status. Try again.",
      });
      retryPause.current = () => {
        void readSnooze()
          .then(() => dispatch({ type: "error", value: null }))
          .catch(() => undefined);
      };
    });
  }, [readSnooze]);

  useEffect(() => {
    refreshSnooze();
  }, [refreshSnooze]);

  useEffect(() => {
    if (!status.snoozed) return;
    const id = window.setInterval(refreshSnooze, 30_000);
    return () => window.clearInterval(id);
  }, [status.snoozed, refreshSnooze]);

  const remainingLabel = useMemo(
    () => formatRemaining(status.remainingMinutes),
    [status.remainingMinutes],
  );

  function collapsePausePanelAndRestoreFocus() {
    dispatch({ type: "expanded", value: false });
    window.requestAnimationFrame(() => pauseToggleRef.current?.focus());
  }

  async function changeSnooze(minutes: number | null) {
    if (!sendMessage || pauseBusy) return;
    dispatch({ type: "busy", value: true });
    dispatch({ type: "error", value: null });
    try {
      const response =
        minutes === null
          ? await sendMessage("clearSnooze", undefined)
          : await sendMessage("setSnooze", { minutes });
      if (response.status !== "ok") throw new Error("Pause change failed");
      // Retry a failed status read without restarting a successfully saved pause.
      retryPause.current = () => refreshSnooze();
      await readSnooze();
      collapsePausePanelAndRestoreFocus();
    } catch {
      dispatch({
        type: "error",
        value: "Could not confirm the pause change. Try again.",
      });
    } finally {
      dispatch({ type: "busy", value: false });
    }
  }

  function requestSnoozeChange(minutes: number | null) {
    retryPause.current = () => {
      void changeSnooze(minutes);
    };
    void changeSnooze(minutes);
  }

  return (
    <>
      <button
        ref={pauseToggleRef}
        type="button"
        data-testid="pause-cleanup-toggle"
        className={`flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors ${
          status.snoozed
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "bg-zinc-50 text-foreground hover:bg-muted"
        }`}
        onClick={() => dispatch({ type: "expanded", value: !pauseExpanded })}
        title="Pause automatic tab cleanup"
        aria-expanded={pauseExpanded}
      >
        <Clock className="h-4 w-4" />
        <span>{status.snoozed ? remainingLabel ?? "Paused" : "Pause"}</span>
      </button>
      {pauseExpanded ? (
        <div className="col-span-3 mt-2 rounded-2xl border bg-zinc-50/80 p-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">
                Pause cleanup
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Temporarily stop automatic tab closing.
              </p>
            </div>
            {status.snoozed ? (
              <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                Paused {remainingLabel ?? ""}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="snooze-30m"
              className="h-9 min-w-[58px] rounded-full border bg-white px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
              onClick={() => requestSnoozeChange(30)}
              disabled={!sendMessage || pauseBusy}
            >
              30m
            </button>
            <button
              type="button"
              data-testid="snooze-1h"
              className="h-9 min-w-[58px] rounded-full border bg-white px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
              onClick={() => requestSnoozeChange(60)}
              disabled={!sendMessage || pauseBusy}
            >
              1h
            </button>
            <button
              type="button"
              data-testid="snooze-24h"
              className="h-9 min-w-[58px] rounded-full border bg-white px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
              onClick={() => requestSnoozeChange(24 * 60)}
              disabled={!sendMessage || pauseBusy}
            >
              24h
            </button>
            <button
              type="button"
              data-testid="snooze-resume"
              className="h-9 rounded-full border bg-foreground px-3 text-xs font-medium text-background disabled:opacity-50"
              onClick={() => requestSnoozeChange(null)}
              disabled={!sendMessage || !status.snoozed || pauseBusy}
            >
              Resume
            </button>
          </div>
        </div>
      ) : null}
      {pauseError ? (
        <div role="alert" className="col-span-3 mt-2 text-xs text-red-700">
          {pauseError}{" "}
          <button
            type="button"
            disabled={pauseBusy}
            className="underline"
            onClick={() => retryPause.current?.()}
          >
            Retry
          </button>
        </div>
      ) : null}
    </>
  );
}
