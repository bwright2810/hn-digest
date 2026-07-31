import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://fixture:fixture@127.0.0.1:5432/fixture",
      OPENAI_API_KEY: "playwright-placeholder",
      ADMIN_PASSWORD: "playwright-admin-password",
      SUBSCRIBER_EMAIL_ENCRYPTION_KEY:
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      SUBSCRIBER_LOOKUP_HMAC_KEY:
        "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
      NEWSLETTER_PUBLIC_SIGNUP_ENABLED: "true",
      RESEND_API_KEY: "playwright-resend-placeholder",
      NEWSLETTER_FROM_EMAIL: "digest@example.com",
      PLAYWRIGHT_FIXTURES: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    url: "http://localhost:3000/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "mobile-320",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 320, height: 800 },
      },
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
});
