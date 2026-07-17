import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

const runId = process.env.SITE_TEST_RUN_ID?.trim() || "manual";
const outputRoot = process.env.SITE_TEST_OUTPUT_ROOT?.trim() ||
  resolve(process.cwd(), "outputs", "site-test", runId);

export default defineConfig({
  testDir: "./tests/experience/scenarios",
  outputDir: resolve(outputRoot, "diagnostics", "playwright"),
  workers: 1,
  retries: 0,
  reporter: [["line"]],
  use: {
    trace: "off",
    video: "off"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        viewport: { width: 1440, height: 900 }
      }
    }
  ]
});
