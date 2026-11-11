import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 600_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      executablePath:
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    },
  },
  webServer: [
    {
      command: "pnpm preview --host 127.0.0.1",
      url: "http://127.0.0.1:4173/react.html",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command:
        "pnpm --dir ../example preview --host 127.0.0.1 --port 4174 --strictPort",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
