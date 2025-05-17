import type React from "react";
import { useContext, useEffect, useState } from "react";
import { RecentlyClosedTabsBufferSize } from "../../../../../common/constants";
import type { RemovedTab } from "../../../../../common/models/Tab";
import { ScrollArea } from "../../../components/ScrollArea";
import { BackgroundCommunicationContext } from "../../../contexts/BackgroundCommunication";
import { TabListItem } from "../components/TabListItem";

export const RecentlyClosedTabs: React.FC = () => {
  const { sendMessage } = useContext(BackgroundCommunicationContext);
  const [tabs, setTabs] = useState<ReadonlyArray<RemovedTab>>([]);

  useEffect(() => {
    sendMessage?.("getRecentlyClosedTabs", undefined).then((response) => {
      setTabs(response.tabs);
    });
  }, [sendMessage]);

  return (
    <section className="flex flex-col flex-grow overflow-auto w-full h-full gap-3">
      <header className="pt-4 px-3">
        <h4 className="text-sm font-medium">Recently closed</h4>
      </header>

      <div className="overflow-auto flex-grow w-full">
        {tabs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <p className="px-3 text-sm text-center text-muted-foreground mt-[-25%]">
              All set for now! Tabs you haven't visited in a while will appear
              here once they're reaped.
            </p>
          </div>
        ) : (
          <ScrollArea className="w-full h-full px-3">
            <div className="flex flex-col gap-2 pb-6">
              {tabs.map((tab: RemovedTab) => (
                <TabListItem key={tab.id} tab={tab} />
              ))}

              {tabs.length === RecentlyClosedTabsBufferSize && (
                <p className="text-sm text-center text-muted-foreground">
                  Only the last {RecentlyClosedTabsBufferSize} tabs are shown.
                </p>
              )}
            </div>
          </ScrollArea>
        )}
      </div>
    </section>
  );
};

RecentlyClosedTabs.displayName = "RecentlyClosedTabs";
