import type React from "react";
import type { RemovedTab } from "../../../../common/models/Tab";
import { timeSince } from "../../../utils";
import { TabFavicon } from "./TabFavicon";

interface ITabListItemProps {
  readonly tab: RemovedTab;
}

const reasonLabel = (
  reason: RemovedTab["reason"] | undefined,
): string | null => {
  switch (reason) {
    case "duplicate":
      return "Duplicate";
    case "idle":
      return "Idle";
    case "manual":
      return "Manual";
    case "unknown":
      return "Closed";
    default:
      return null;
  }
};

const hostnameFromUrl = (url: string | undefined): string | null => {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

export const isSafeReopenUrl = (url: string | undefined): boolean => {
  if (!url) {
    return false;
  }

  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

export const TabListItem: React.FC<ITabListItemProps> = ({ tab }) => {
  const label = reasonLabel(tab.reason);
  const hostname = hostnameFromUrl(tab.url);
  const canReopen = isSafeReopenUrl(tab.url);

  return (
    <a
      className="group rounded-2xl border bg-zinc-50 px-3 py-3 transition-colors hover:bg-white"
      href={canReopen ? tab.url : undefined}
      target={canReopen ? "_blank" : undefined}
      rel={canReopen ? "noreferrer" : undefined}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3 overflow-hidden">
          <TabFavicon
            favIconUrl={tab.favIconUrl}
            pageUrl={tab.url}
            title={tab.title}
          />

          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="truncate text-sm font-semibold text-foreground group-hover:text-zinc-900">
              {tab.title || hostname || "Untitled tab"}
            </div>
            <div className="mt-0.5 truncate text-xs font-medium text-zinc-700">
              {hostname || tab.url || "Unknown site"}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {label ? (
            <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
              {label}
            </span>
          ) : null}
          <div className="text-xs text-muted-foreground whitespace-nowrap">
            {timeSince(tab.removedAt)}
          </div>
        </div>
      </div>
    </a>
  );
};

TabListItem.displayName = "TabListItem";
