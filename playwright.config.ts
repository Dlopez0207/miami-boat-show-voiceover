import { devices, PlaywrightTestConfig } from "@playwright/test";
import { screenReaderConfig } from "@guidepup/playwright";

// screenReaderConfig = { workers: 1, fullyParallel: false, use: { headless: false } }
// Screen readers do not work against headless browsers.
const config: PlaywrightTestConfig = {
  ...screenReaderConfig,
  testDir: "./tests",
  outputDir: "test-results",
  reportSlowTests: null,
  // One test per page template; each runs several hundred VoiceOver commands (>1 s each is possible).
  // The spec stops issuing commands after VO_BUDGET_MIN (30 min) so the transcript is always written first.
  timeout: 38 * 60 * 1000,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    // Service workers would bypass page.route(); block them so every request goes through the write blocker.
    serviceWorkers: "block",
  },
  projects: [
    {
      // Playwright's WebKit build (macOS app "Playwright"); the pairing Guidepup recommends for VoiceOver.
      name: "webkit",
      use: { ...devices["Desktop Safari"], headless: false, video: "on", serviceWorkers: "block" },
    },
    {
      // "Google Chrome For Testing" (applicationNameMap.chromium); green in Guidepup's own CI on macos-15/26.
      name: "chromium",
      use: { ...devices["Desktop Chrome"], headless: false, video: "on", serviceWorkers: "block" },
    },
  ],
};

export default config;
