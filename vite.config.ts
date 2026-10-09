import path from "node:path";
import { type ManifestV3Export, crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import manifestChrome from "./src/manifest.json";
import manifestSafari from "./src/manifest.safari.json";

const extensionTarget = process.env.EXTENSION_TARGET ?? "chrome";
const manifest = (
  extensionTarget === "safari" ? manifestSafari : manifestChrome
) as ManifestV3Export;
const debugEnabled = process.env.EXTENSION_DEBUG === "true";

export default defineConfig({
  plugins: [tsconfigPaths(), react(), crx({ manifest })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/popup"),
    },
  },
  define: {
    __DEBUG__: JSON.stringify(debugEnabled),
  },
});
