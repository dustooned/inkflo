import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works from any folder (static hosting, file://).
  base: './',
  server: {
    port: 5190,
    strictPort: true,
    // Godot can hold its sample ZIP open while the Inkflo dev server is running.
    watch: { ignored: ['**/examples/godot-reader', '**/examples/godot-reader/**'] },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        selfcheck: resolve(__dirname, 'selfcheck.html'),
      },
    },
  },
});
