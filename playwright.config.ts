import { defineConfig } from "@playwright/test";

// End-to-end tests run against a real stack: `scripts/local-supabase/start.sh` + `pnpm build && pnpm start`.
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined,
  },
});
