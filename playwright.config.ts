// The one browser test setup: a phone-size browser, the app served by Vite,
// and the local Supabase that is already running (pnpm exec supabase start).
import { defineConfig, devices } from '@playwright/test'
import { localStack } from './tests/stack.ts'

const stack = localStack()

export default defineConfig({
  testDir: 'tests/browser',
  globalSetup: './tests/browser/wipe.ts',
  // In order: the tests that need an empty timeline, then the real import on the made-up
  // exports, then the tests that look at what it saved.
  projects: [
    { name: 'sign-in', testMatch: ['sign-in.spec.ts', 'replace-link.spec.ts'] },
    { name: 'import', testMatch: 'import.setup.ts', dependencies: ['sign-in'] },
    { name: 'memories', testMatch: 'timeline.spec.ts', dependencies: ['import'] },
    // Last: a few thousand made-up memories, made at test time, which the tests above must not see.
    { name: 'large-import', testMatch: 'large.setup.ts', dependencies: ['memories'] },
    { name: 'large', testMatch: 'large.spec.ts', dependencies: ['large-import'], fullyParallel: false },
  ],
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
