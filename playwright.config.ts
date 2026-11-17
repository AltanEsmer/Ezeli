// The one browser test setup: a phone-size browser, the app served by Vite,
// and the local Supabase that is already running (pnpm exec supabase start).
import { defineConfig, devices } from '@playwright/test'
import { localStack } from './tests/browser/stack.ts'

const stack = localStack()

export default defineConfig({
  testDir: 'tests/browser',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Pixel 7'],
    viewport: { width: 390, height: 844 },
    baseURL: stack.appUrl,
  },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${stack.appPort} --strictPort`,
    url: stack.appUrl,
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: stack.apiUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: stack.publishableKey,
    },
  },
})
