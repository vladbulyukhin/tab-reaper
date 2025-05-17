import path from "node:path";
import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: "src",
  imports: false,
  modules: ["@wxt-dev/module-react"],
  manifestVersion: 3,
  manifest: {
    name: "Tab Reaper: Idle Tab Collector",
    description:
      "Automatically closes idle tabs, freeing up clutter and helping you stay focused on what matters most.",
    version: "0.2.1",
    permissions: ["alarms", "tabs", "storage"],
    icons: {
      "16": "icons/icon-active-16.png",
      "32": "icons/icon-active-32.png",
      "48": "icons/icon-active-48.png",
      "128": "icons/icon-active-128.png",
    },
  },
  alias: {
    "@": path.resolve(__dirname, "./src/entrypoints/popup"),
  },
});
