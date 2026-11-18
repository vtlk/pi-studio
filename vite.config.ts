import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'src/renderer',
  publicDir: resolve('public'),
  resolve: {
    alias: {
      '@': resolve('src/renderer'),
      'monaco-editor': resolve('node_modules/monaco-editor/esm/vs'),
    },
  },
  plugins: [
    react(),
    {
      name: 'studio-web-entry',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) => html.replace('src="/main.tsx"', 'src="/main.web.tsx"'),
      },
    },
  ],
  base: './',
});
