import { Settings } from "lucide-react";
import type React from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Logo from "../assets/logo.svg";
import { PauseCleanup } from "../components/PauseCleanup";
import { Toggle } from "../components/Toggle";

function MainHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const isSettingsActive = location.pathname === "/settings";

  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 border-b bg-white/95 px-3 py-2 backdrop-blur-sm">
      <div className="min-w-0 flex items-center gap-3">
        <img src={Logo} alt="Tab Reaper Logo" className="h-8 w-8" />
        <div className="min-w-0">
          <h4 className="truncate text-[1.2rem] leading-none font-semibold tracking-[-0.03em]">
            Tab Reaper
          </h4>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            Quiet tab cleanup for focused browsing
          </p>
        </div>
      </div>
      <PauseCleanup route={location.pathname} />
      <Toggle
        pressed={isSettingsActive}
        onPressedChange={(active) => navigate(active ? "/settings" : "/")}
        variant="outline"
        size="sm"
        className="col-start-3 row-start-1 h-10 w-10 rounded-xl bg-zinc-50"
        aria-label={isSettingsActive ? "Return to main" : "Open settings"}
      >
        <Settings className="h-4 w-4" />
      </Toggle>
    </header>
  );
}

export const Layout: React.FC = () => (
  <main className="flex h-full w-full min-h-0 min-w-0 max-h-full max-w-full flex-col overflow-hidden bg-zinc-50 [contain:strict]">
    <MainHeader />
    <div className="flex-1 overflow-y-auto overflow-x-hidden">
      <Outlet />
    </div>
  </main>
);

Layout.displayName = "Layout";
