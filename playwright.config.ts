import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://castly:castly@localhost:5432/castly_test";

/**
 * Full-stack e2e: real Next.js production server + real Postgres, with
 * dev auth, local storage, mock image provider and mock Razorpay.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : undefined,
      },
    },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL,
      APP_URL: `http://localhost:${PORT}`,
      SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
      AUTH_PROVIDER: "dev",
      STORAGE_DRIVER: "local",
      LOCAL_STORAGE_DIR: ".data/e2e-storage",
      IMAGE_PROVIDER_MODE: "mock",
      PAYMENTS_MOCK: "true",
      PROMPT_LLM: "template",
      RAZORPAY_WEBHOOK_SECRET: "whsec_e2e",
      MOCK_IMAGE_DELAY_MS: "800",
      ALLOW_INSECURE_DEV_MODE: "true",
    },
  },
});
