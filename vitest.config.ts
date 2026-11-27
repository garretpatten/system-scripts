import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['github/__tests__/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['github/src/**'],
      exclude: ['node_modules/**', 'backups/dist/**'],
    },
  },
});
