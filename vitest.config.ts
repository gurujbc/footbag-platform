import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 15_000,
    setupFiles: ['./tests/setup-env.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/types/**'],
      thresholds: {
        statements: 95,
        branches: 76,
        functions: 93,
        lines: 95,
      },
    },
  },
});
