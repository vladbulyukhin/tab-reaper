import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/tab-reaper/",
  plugins: [tailwindcss()],
  build: {
    rollupOptions: {
      input: ["index.html", "privacy.html", "terms.html", "support.html"],
    },
  },
});
