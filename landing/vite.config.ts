import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: ["index.html", "privacy.html", "terms.html", "support.html"],
    },
  },
});
