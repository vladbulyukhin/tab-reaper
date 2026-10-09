import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "tests/**"],
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    testTimeout: 20_000,
    // Build integration tests spawn Vite/CRX, which can touch shared outputs.
    // Keep those builds sequential until each has a fully isolated checkout.
    threads: false,
  },
});
