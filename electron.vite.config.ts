import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  preload: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  renderer: {
    base: './',
    resolve: { alias: { '@': resolve('src/renderer') } },
    publicDir: resolve('public'),
    plugins: [react()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
  },
});
