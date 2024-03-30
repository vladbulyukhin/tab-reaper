import type React from "react";
import { RouterProvider, createHashRouter } from "react-router-dom";
import { BackgroundCommunicationProvider } from "./contexts/BackgroundCommunication";
import { Home } from "./pages/Home";
import { Layout } from "./pages/Layout";
import { Settings } from "./pages/Settings";

const router = createHashRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      {
        index: true,
        element: <Home />,
      },
      {
        path: "settings",
        element: <Settings />,
      },
    ],
  },
]);

export const App: React.FC = () => {
  return (
    <BackgroundCommunicationProvider>
      <RouterProvider router={router} />
    </BackgroundCommunicationProvider>
  );
};

App.displayName = "App";
