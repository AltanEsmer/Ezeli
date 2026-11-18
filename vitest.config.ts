import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/import/**/*.test.ts'],
  },
})
