import { defineConfig } from "vite";

export default defineConfig({
  base: "/tab-reaper/",
  build: {
    rollupOptions: {
      input: ["index.html", "privacy.html", "terms.html", "support.html"],
    },
  },
});
