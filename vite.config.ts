import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'src/renderer',
  publicDir: resolve('public'),
  resolve: { alias: { '@': resolve('src/renderer') } },
  plugins: [react()],
  base: './',
});
