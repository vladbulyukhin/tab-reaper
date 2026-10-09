import type React from "react";
import { useCallback, useContext, useMemo, useReducer } from "react";
import {
  extensionApi,
  extensionApiType,
  getTabGroupCapabilities,
} from "../../../api/extensionApi";
import { BackgroundCommunicationContext } from "../../contexts/BackgroundCommunication";
import { errorMessage, useAsyncResource } from "../../hooks/useAsyncResource";
import {
  copyJsonToClipboard,
  sanitizeDiagnosticsForSupport,
} from "./DiagnosticsClipboard";

type DiagnosticAction =
  | { type: "clear-started" }
  | { type: "copy-started" }
  | { type: "completed" }
  | { type: "copied" }
  | { type: "failed"; error: string };

type DiagnosticState = {
  clearing: boolean;
  copyState: "idle" | "copying" | "copied";
  error: string | null;
};

function diagnosticReducer(
  state: DiagnosticState,
  action: DiagnosticAction,
): DiagnosticState {
  switch (action.type) {
    case "clear-started":
      return { clearing: true, copyState: "idle", error: null };
    case "copy-started":
      return { clearing: false, copyState: "copying", error: null };
    case "completed":
      return { ...state, clearing: false, error: null };
    case "copied":
      return { clearing: false, copyState: "copied", error: null };
    case "failed":
      return { clearing: false, copyState: "idle", error: action.error };
  }
}

export const Diagnostics: React.FC = () => {
  const { sendMessage } = useContext(BackgroundCommunicationContext);
  const load = useCallback(async () => {
    if (!sendMessage) throw new Error("Background connection unavailable");
    return sendMessage("getCleanupDiagnostics", undefined);
  }, [sendMessage]);
  const resource = useAsyncResource(sendMessage ? load : null);
  const { data: snapshot, loading } = resource;
  const [state, dispatch] = useReducer(diagnosticReducer, {
    clearing: false,
    copyState: "idle",
    error: null,
  });
  const { clearing, copyState } = state;
  const error = state.error ?? resource.error;
  const busy = loading || clearing || copyState === "copying";

  async function refresh() {
    dispatch({ type: "completed" });
    await resource.refresh().catch(() => undefined);
  }

  async function clear() {
    if (!sendMessage || busy) return;
    dispatch({ type: "clear-started" });

    try {
      const result = await sendMessage("clearCleanupDiagnostics", undefined);
      if (result.status !== "ok")
        throw new Error("Background diagnostics could not be cleared");
      await resource.refresh();
      dispatch({ type: "completed" });
    } catch (reason) {
      dispatch({ type: "failed", error: errorMessage(reason) });
    }
  }

  async function copy() {
    if (!snapshot || busy) return;
    dispatch({ type: "copy-started" });

    try {
      await copyJsonToClipboard(sanitizeDiagnosticsForSupport(snapshot));
      dispatch({ type: "copied" });
    } catch (reason) {
      dispatch({
        type: "failed",
        error: `Copy failed: ${errorMessage(reason)}`,
      });
    }
  }

  const summary = useMemo(() => {
    const allTabs = snapshot?.queries.allTabs ?? [];
    return {
      allTabs: allTabs.length,
      inactiveTabs: snapshot?.queries.inactiveTabs.length ?? 0,
      windowCount: new Set(
        allTabs
          .map((tab) => tab.windowId)
          .filter(
            (windowId): windowId is number => typeof windowId === "number",
          ),
      ).size,
    };
  }, [snapshot]);

  const capabilities = getTabGroupCapabilities();
  const extensionVersion = extensionApi.runtime.getManifest().version;

  return (
    <section
      className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm"
      data-testid="cleanupDiagnostics"
    >
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Support & diagnostics
        </p>
        <h4 className="mt-1 text-lg font-semibold">Cleanup activity</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Review a private snapshot of cleanup activity across every browser
          window. It may include tab URLs; copy it only when you choose to share
          it with support.
        </p>
      </div>
      <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
        Version {extensionVersion} • {extensionApiType} • {summary.windowCount}{" "}
        windows • {summary.allTabs} tabs • {summary.inactiveTabs} inactive
        {snapshot
          ? ` • background ${snapshot.background.sessionStorageKind}`
          : " • loading background snapshot"}
      </p>

      <details className="mt-4 rounded-2xl border bg-zinc-50/70 p-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
          Advanced details
          <span className="rounded-full border bg-white px-3 py-1 text-xs font-medium text-foreground">
            View
          </span>
        </summary>
        <div className="mt-3 rounded-2xl border bg-white p-3">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <p>
                Background snapshot: {summary.windowCount} windows •{" "}
                {summary.allTabs} tabs • {summary.inactiveTabs} inactive (api=
                {extensionApiType}).
              </p>
              <p>
                tabGroups: extensionApi=
                {String(capabilities.extensionApi)} • browser query=
                {String(capabilities.browserQuery)} • chrome query=
                {String(capabilities.chromeQuery)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="h-9 rounded-full border bg-white px-3 text-xs font-medium disabled:opacity-50"
                disabled={busy || !sendMessage}
                onClick={refresh}
              >
                {loading ? "Refreshing..." : "Refresh"}
              </button>
              <button
                type="button"
                className="h-9 rounded-full border bg-white px-3 text-xs font-medium disabled:opacity-50"
                disabled={!snapshot || busy}
                onClick={copy}
              >
                {copyState === "copying"
                  ? "Copying..."
                  : copyState === "copied"
                    ? "Copied"
                    : "Copy report"}
              </button>
              <button
                type="button"
                className="h-9 rounded-full border bg-zinc-50 px-3 text-xs font-medium text-foreground disabled:opacity-50"
                disabled={busy || !sendMessage}
                onClick={clear}
              >
                {clearing ? "Clearing..." : "Clear diagnostic history"}
              </button>
            </div>
          </div>

          {error ? (
            <p className="mt-3 text-xs text-destructive">Error: {error}</p>
          ) : null}

          <pre className="mt-3 max-h-96 overflow-auto rounded-xl bg-zinc-50 p-3 text-[11px] leading-snug whitespace-pre-wrap">
            {snapshot ? JSON.stringify(snapshot, null, 2) : "No data yet."}
          </pre>
        </div>
      </details>
    </section>
  );
};

Diagnostics.displayName = "Diagnostics";
