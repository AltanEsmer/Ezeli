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
    { name: 'memory-import', testMatch: 'memory.setup.ts', dependencies: ['memories'] },
    { name: 'memory', testMatch: ['memory.spec.ts', 'comments.spec.ts'], dependencies: ['memory-import'] },
    // The full timeline: imports chats of its own, so it runs after the tests above have counted.
    { name: 'full-timeline', testMatch: 'full-timeline.spec.ts', dependencies: ['memory'] },
    // The people pages: they read what the earlier projects imported and what people.setup.ts adds.
    { name: 'people-import', testMatch: 'people.setup.ts', dependencies: ['full-timeline'] },
    { name: 'people', testMatch: 'people.spec.ts', dependencies: ['people-import'] },
    // Last: a few thousand made-up memories, made at test time. They are removed once every test
    // that uses them has finished (the teardown), so one failure cannot take the data from the next.
    { name: 'large-import', testMatch: 'large.setup.ts', dependencies: ['people'], teardown: 'large-clean' },
    { name: 'large', testMatch: 'large.spec.ts', dependencies: ['large-import'], fullyParallel: false },
    { name: 'large-clean', testMatch: 'large.teardown.ts' },
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
