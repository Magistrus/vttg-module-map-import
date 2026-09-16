import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

/** Тесты — чистая логика парсера и конвертера, поэтому среда обычная node. */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
