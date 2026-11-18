import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/import/**/*.test.ts'],
    // The import sweeps files with no row at once here, not a minute later (cli/import/regroup.ts).
    env: { EZELI_SWEEP_AFTER_MS: '0' },
  },
})
