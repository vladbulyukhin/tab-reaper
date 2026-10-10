import type React from "react";
import { useCallback, useContext, useMemo, useReducer, useRef } from "react";
import { RecentlyClosedTabsBufferSize } from "../../../../common/constants";
import type { RemovedTab } from "../../../../common/models/Tab";
import { Badge } from "../../../components/Badge";
import { Input } from "../../../components/Input";
import { BackgroundCommunicationContext } from "../../../contexts/BackgroundCommunication";
import { useAsyncResource } from "../../../hooks/useAsyncResource";
import { TabListItem } from "../components/TabListItem";
import { useHistoryAcknowledgement } from "./useHistoryAcknowledgement";

type HistoryState = {
  expanded: boolean;
  query: string;
  reasonFilter: "all" | "idle" | "duplicate";
  isClearing: boolean;
  error: string | null;
};
type HistoryAction =
  | { type: "toggle" }
  | { type: "query"; value: string }
  | { type: "filter"; value: HistoryState["reasonFilter"] }
  | { type: "clear-started" }
  | { type: "cleared" }
  | { type: "clear-failed" };

const initialHistoryState: HistoryState = {
  expanded: false,
  query: "",
  reasonFilter: "all",
  isClearing: false,
  error: null,
};

function historyReducer(
  state: HistoryState,
  action: HistoryAction,
): HistoryState {
  switch (action.type) {
    case "toggle":
      return {
        ...state,
        expanded: !state.expanded,
        query: "",
        reasonFilter: "all",
      };
    case "query":
      return { ...state, query: action.value };
    case "filter":
      return { ...state, reasonFilter: action.value };
    case "clear-started":
      return { ...state, isClearing: true, error: null };
    case "cleared":
      return initialHistoryState;
    case "clear-failed":
      return {
        ...state,
        isClearing: false,
        error: "Could not clear recently closed tabs. Please try again.",
      };
  }
}

export const RecentlyClosedTabs: React.FC = () => {
  const { sendMessage } = useContext(BackgroundCommunicationContext);
  const [state, dispatch] = useReducer(historyReducer, initialHistoryState);
  const { expanded, query, reasonFilter, isClearing } = state;
  const historyContent = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    if (!sendMessage) throw new Error("Background connection unavailable");
    return sendMessage("getRecentlyClosedTabs", undefined);
  }, [sendMessage]);
  const resource = useAsyncResource(sendMessage ? load : null);
  const tabs = resource.data?.tabs ?? [];
  const historyError =
    state.error ??
    (resource.error
      ? "Could not load recently closed tabs. Please try again."
      : null);
  useHistoryAcknowledgement(historyContent, resource.data?.activityToken);

  async function clearHistory() {
    if (!sendMessage || isClearing) return;
    dispatch({ type: "clear-started" });

    try {
      const response = await sendMessage("clearRecentlyClosedTabs", undefined);
      if (response.status !== "ok") throw new Error("Could not clear");
      await resource.refresh();
      dispatch({ type: "cleared" });
    } catch {
      dispatch({ type: "clear-failed" });
    }
  }

  const filteredTabs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tabs.filter((t) => {
      const reason = (t.reason ?? "idle") as string;
      if (reasonFilter !== "all" && reason !== reasonFilter) return false;
      if (!q) return true;
      const title = (t.title ?? "").toLowerCase();
      const url = (t.url ?? "").toLowerCase();
      return title.includes(q) || url.includes(q);
    });
  }, [tabs, query, reasonFilter]);

  const visibleTabs = expanded ? filteredTabs : tabs.slice(0, 3);
  const hasExtraTabs = tabs.length > 3;
  function toggleExpanded() {
    dispatch({ type: "toggle" });
  }

  return (
    <section className="rounded-2xl border bg-white shadow-sm">
      <header className="px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Recently closed
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="rounded-full bg-zinc-50 px-3 py-1 whitespace-nowrap"
            >
              {tabs.length} saved
            </Badge>
          </div>
        </div>
        <h3 className="mt-2 text-lg font-semibold leading-snug text-foreground">
          Recently reaped tabs
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Select a tab to reopen it.
        </p>
        {historyError ? (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {historyError}
          </p>
        ) : null}
        {resource.error ? (
          <button
            type="button"
            className="mt-2 underline text-xs"
            onClick={() => void resource.refresh().catch(() => undefined)}
          >
            Retry loading history
          </button>
        ) : null}
      </header>

      {tabs.length === 0 ? (
        <div ref={historyContent} className="px-4 py-8">
          <p className="text-sm text-muted-foreground">
            All set for now. Tabs you haven't visited in a while will show up
            here once they are cleaned up.
          </p>
        </div>
      ) : (
        <>
          {expanded ? (
            <div className="border-t px-4 pt-4">
              <div className="flex items-center gap-2">
                <Input
                  data-testid="recentlyClosedSearch"
                  value={query}
                  onChange={(e) =>
                    dispatch({ type: "query", value: e.target.value })
                  }
                  placeholder="Search by title or URL..."
                  className="h-10 flex-1 rounded-xl bg-zinc-50 ring-offset-0 focus-visible:ring-1"
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {(
                  [
                    ["all", "All"],
                    ["idle", "Idle"],
                    ["duplicate", "Duplicates"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    data-testid={`recentlyClosedReason-${value}`}
                    className={`h-8 rounded-full border px-3 text-xs font-medium disabled:opacity-50 ${
                      reasonFilter === value
                        ? "border-foreground bg-foreground text-background"
                        : "bg-zinc-50"
                    }`}
                    onClick={() => dispatch({ type: "filter", value })}
                    aria-pressed={reasonFilter === value}
                  >
                    {label}
                  </button>
                ))}
                <p className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                  {filteredTabs.length} shown
                </p>
              </div>
            </div>
          ) : null}

          <div
            ref={historyContent}
            className="px-4 pb-4 pt-3 flex flex-col gap-2"
          >
            {visibleTabs.length === 0 ? (
              <div className="rounded-2xl border border-dashed bg-zinc-50 px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No matches for the current search and filters.
                </p>
              </div>
            ) : (
              visibleTabs.map((tab: RemovedTab) => (
                <TabListItem
                  key={tab.entryId ?? `${tab.id}:${tab.removedAt}:${tab.url}`}
                  tab={tab}
                />
              ))
            )}

            {hasExtraTabs || expanded ? (
              <button
                type="button"
                data-testid="recentlyClosedExpand"
                className="h-9 rounded-full border bg-zinc-50 px-3 text-xs font-medium hover:bg-muted"
                onClick={toggleExpanded}
              >
                {expanded ? "Show less" : `View all ${tabs.length} tabs`}
              </button>
            ) : null}

            {tabs.length === RecentlyClosedTabsBufferSize && (
              <div className="rounded-xl bg-zinc-50 px-3 py-2 text-center">
                <p className="text-xs text-muted-foreground">
                  Only the last {RecentlyClosedTabsBufferSize} closed tabs are
                  stored.
                </p>
              </div>
            )}
            {tabs.length > 0 ? (
              <button
                type="button"
                className="h-9 rounded-full border px-3 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                onClick={clearHistory}
                disabled={isClearing}
              >
                {isClearing ? "Clearing…" : "Clear list"}
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
};

RecentlyClosedTabs.displayName = "RecentlyClosedTabs";
