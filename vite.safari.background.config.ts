import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    __DEBUG__: "false",
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/background/index.ts"),
      name: "TabReaperBackground",
      formats: ["iife"],
      fileName: () => "background.js",
    },
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
