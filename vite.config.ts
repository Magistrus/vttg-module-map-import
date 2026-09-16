import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/**
 * Сборка внешнего модуля VTTG.
 *
 * Хост грузит `client.js` обычным `<script>` (не ESM), поэтому формат — IIFE.
 * Vue в бандл НЕ попадает: хост кладёт весь неймспейс Vue в `globalThis.Vue`
 * (см. `moduleBootstrap.ts` ядра), и rollup переписывает импорты на этот глобал.
 * Так модуль работает на том же экземпляре Vue, что и приложение.
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('./src/main.ts', import.meta.url)),
      name: 'VttgMapImport',
      formats: ['iife'],
      fileName: () => 'client.js',
      cssFileName: 'styles',
    },
    rollupOptions: {
      external: ['vue'],
      output: {
        globals: { vue: 'Vue' },
        extend: true,
      },
    },
  },
});
