import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";
import { type ManifestV3Export, crx } from "@crxjs/vite-plugin";
import manifestJson from "./src/manifest.json";

const manifest = manifestJson as ManifestV3Export;

export default defineConfig({
  plugins: [tsconfigPaths(), react(), crx({ manifest })],
});
