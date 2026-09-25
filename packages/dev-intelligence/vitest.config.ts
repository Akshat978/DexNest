import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    testTimeout: 60_000,
    // node:sqlite (the test driver) is flagged experimental; the notice is noise per worker.
    execArgv: ['--disable-warning=ExperimentalWarning'],
    hookTimeout: 60_000,
  },
});
