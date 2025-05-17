import type React from "react";
import { CurrentTabStatus } from "./containers/CurrentTabStatus";
import { RecentlyClosedTabs } from "./containers/RecentlyClosedTabs";

export const Home: React.FC = () => (
  <>
    <CurrentTabStatus />
    <RecentlyClosedTabs />
  </>
);

Home.displayName = "Home";
