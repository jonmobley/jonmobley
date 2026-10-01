import { defineConfig, devices } from "@playwright/test";

// Moxie Studio's standard browser tests: every test runs in Chromium and WebKit
// (Safari's engine), signed in as this app's Studio test account — a made-up
// login that exists only in the draft database. Run them with `studio-test run`,
// which points them at Studio's preview, shows Chromium live in Studio's Live
// tab, and saves screenshots and traces to the job.
const baseURL = process.env.STUDIO_PREVIEW_URL || "http://localhost:5173";
const signedIn = "e2e/.auth/state.json";
// studio-test runs Chromium itself so Studio can show it live; tests connect to it.
const liveChromium = process.env.STUDIO_PW_CHROMIUM_WS ? { wsEndpoint: process.env.STUDIO_PW_CHROMIUM_WS } : undefined;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  retries: 0,
  reporter: process.env.STUDIO_REPORTER ? [["list"], [process.env.STUDIO_REPORTER]] : [["list"]],
  // A screenshot and a trace (a step-by-step replay) of every test, kept by Studio on the job.
  use: { baseURL, screenshot: "on", trace: "on" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { screenshot: "off" } },
    { name: "chromium", use: { ...devices["Desktop Chrome"], storageState: signedIn, connectOptions: liveChromium }, dependencies: ["setup"], testIgnore: /auth\.setup\.ts/ },
    { name: "webkit", use: { ...devices["Desktop Safari"], storageState: signedIn }, dependencies: ["setup"], testIgnore: /auth\.setup\.ts/ },
  ],
});
