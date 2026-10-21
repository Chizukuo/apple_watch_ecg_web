/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  use: {
    channel: process.env.PW_BROWSER_CHANNEL,
    baseURL: "http://127.0.0.1:8788",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command:
      "npm run dev -- --ip 127.0.0.1 --port 8788 --show-interactive-dev-session=false",
    url: "http://127.0.0.1:8788/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
