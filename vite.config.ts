import path from "node:path";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { type ManifestV3Export, crx } from "@crxjs/vite-plugin";
import manifestJson from "./src/manifest.json";

const manifest = manifestJson as ManifestV3Export;

export default defineConfig({
  plugins: [tsconfigPaths(), react(), crx({ manifest })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/popup"),
    },
  },
});
