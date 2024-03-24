import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { type ManifestV3Export, crx } from "@crxjs/vite-plugin";
import manifestJson from "./src/manifest.json";

const manifest = manifestJson as ManifestV3Export;

export default defineConfig({
  plugins: [tsconfigPaths(), crx({ manifest })],
});
