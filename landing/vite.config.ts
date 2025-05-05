import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/tab-reaper/",
  plugins: [tailwindcss()],
});
