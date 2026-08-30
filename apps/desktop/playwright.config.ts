import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node ../../scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'standard',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'minimum',
      use: { ...devices['Desktop Chrome'], viewport: { width: 960, height: 640 } },
    },
    {
      name: 'compact',
      use: { ...devices['Desktop Chrome'], viewport: { width: 800, height: 700 } },
    },
  ],
})
