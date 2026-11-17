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
    { name: 'memories', testMatch: ['timeline.spec.ts', 'language.spec.ts'], dependencies: ['import'] },
    // Imports more chats of its own, so it runs after the timeline tests have counted.
    { name: 'memory', testMatch: 'memory.spec.ts', dependencies: ['memories'] },
    // Hides things of a chat of its own, after the tests that count memories.
    { name: 'hiding', testMatch: 'hiding.spec.ts', dependencies: ['memory'] },
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
