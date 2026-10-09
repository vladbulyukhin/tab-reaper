import React from "react";
import ReactDOM from "react-dom/client";
import { initDebug } from "../common/utils/debug";
import { initializePopupDiagnostics } from "../common/utils/debug/PopupDiagnostics";
import { App } from "./App";
import "./index.css";
import { initializePopupViewport } from "./utils/viewport";

initDebug();
initializePopupViewport();
initializePopupDiagnostics();

const root = document.getElementById("root");
if (!root) throw new Error("Popup root element is missing");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
