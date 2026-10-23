import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts'],
      exclude: ['lib/openai.ts', 'lib/google-calendar.ts', 'lib/s3.ts', 'lib/keka.ts', 'lib/email.ts'],
      reporter: ['text', 'html'],
    },
  },
})
