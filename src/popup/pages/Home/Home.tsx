import type React from "react";
import { CurrentTabStatus } from "./containers/CurrentTabStatus";
import { RecentlyClosedTabs } from "./containers/RecentlyClosedTabs";

export const Home: React.FC = () => (
  <div className="flex w-full flex-col gap-3 px-3 py-4">
    <CurrentTabStatus />
    <RecentlyClosedTabs />
  </div>
);

Home.displayName = "Home";
