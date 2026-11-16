import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { nativeRendererGuard } from './scripts/native-renderer-guard.ts';
import { bundledNotices } from './scripts/bundled-notices';

export default defineConfig({
  main: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  preload: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          computerOverlay: resolve('src/renderer/computer-overlay.html'),
        },
      },
    },
    base: './',
    resolve: { alias: { '@': resolve('src/renderer') } },
    publicDir: false,
    plugins: [
      react(),
      nativeRendererGuard(),
      bundledNotices(resolve('.')),
      {
        name: 'studio-native-branding',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'branding/pi-studio-icon.png',
            source: readFileSync(resolve('public/branding/pi-studio-icon.png')),
          });
        },
      },
    ],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
  },
});
