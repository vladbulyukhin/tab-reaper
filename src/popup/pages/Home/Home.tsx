import type React from "react";
import { CurrentTabStatus } from "./containers/CurrentTabStatus";
import { RecentlyClosedTabs } from "./containers/RecentlyClosedTabs";
import { SweepDuplicates } from "./containers/SweepDuplicates";

export const Home: React.FC = () => (
  <>
    <CurrentTabStatus />
    <SweepDuplicates />
    <RecentlyClosedTabs />
  </>
);

Home.displayName = "Home";
