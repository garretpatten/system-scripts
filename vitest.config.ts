import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['backups/__tests__/**/*.test.ts', 'github/__tests__/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['backups/src/**'],
      exclude: ['node_modules/**', 'backups/dist/**'],
    },
  },
});
