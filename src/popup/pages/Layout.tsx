import { Settings } from "lucide-react";
import type React from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Logo from "../assets/logo.svg";
import { Toggle } from "../components/Toggle";

const MainHeader: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const toggleSettingsRoute = (shouldRedirectToSettings: boolean) => {
    if (shouldRedirectToSettings) {
      navigate("/settings");
    } else {
      navigate("/");
    }
  };

  const isSettingsActive = location.pathname === "/settings";

  return (
    <header className="px-2 py-2.5 border-b">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={Logo} alt="Tab Reaper Logo" className="w-7 h-7" />
          <h4 className="text-lg font-semibold">Tab Reaper</h4>
        </div>

        <Toggle
          pressed={isSettingsActive}
          onPressedChange={toggleSettingsRoute}
        >
          <Settings className="h-4 w-4" />
        </Toggle>
      </div>
    </header>
  );
};

MainHeader.displayName = "MainHeader";

export const Layout: React.FC = () => (
  <main className="bg-white w-96 h-[600px] flex flex-col">
    <MainHeader />
    <Outlet />
  </main>
);

Layout.displayName = "Layout";
