import type React from "react";
import type { RemovedTab } from "../../../../../common/models/Tab";
import { timeSince } from "../../../utils";
import { TabFavicon } from "./TabFavicon";

interface ITabListItemProps {
  readonly tab: RemovedTab;
}

export const TabListItem: React.FC<ITabListItemProps> = ({ tab }) => (
  <a
    className="border rounded-lg px-2.5 py-2 hover:bg-zinc-100"
    href={tab.url}
    target="_blank"
    rel="noreferrer"
  >
    <div className="flex flex-row justify-between items-center gap-8">
      <div className="flex flex-row justify-start items-center gap-3 overflow-hidden">
        <TabFavicon url={tab.favIconUrl} />

        <div className="flex flex-col gap flex-grow overflow-hidden">
          <div className="text-sm font-medium text-ellipsis truncate">
            {tab.title}
          </div>
          <div className="text-xs text-muted-foreground text-ellipsis truncate">
            {tab.url}
          </div>
        </div>
      </div>

      <div className="text-xs text-muted-foreground whitespace-nowrap">
        {timeSince(tab.removedAt)}
      </div>
    </div>
  </a>
);

TabListItem.displayName = "TabListItem";
