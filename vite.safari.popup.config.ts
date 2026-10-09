import path from "node:path";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  root: path.resolve(__dirname, "src/popup"),
  publicDir: path.resolve(__dirname, "public"),
  base: "./",
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/popup"),
    },
  },
  define: {
    __DEBUG__: "false",
  },
  build: {
    emptyOutDir: false,
    sourcemap: false,
  },
});
