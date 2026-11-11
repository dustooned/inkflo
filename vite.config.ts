import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works from any folder (static hosting, file://).
  base: './',
  server: { port: 5190, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        selfcheck: resolve(__dirname, 'selfcheck.html'),
      },
    },
  },
});
