/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const pkgSrc = (name: string) => resolve(__dirname, `../../packages/${name}/src/index.ts`);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@modatu/catalog': pkgSrc('catalog'),
      '@modatu/design-model': pkgSrc('design-model'),
      '@modatu/bom': pkgSrc('bom'),
      '@modatu/safety-rules': pkgSrc('safety-rules'),
      '@modatu/editor-state': pkgSrc('editor-state'),
      '@modatu/llm-adapter': pkgSrc('llm-adapter'),
    },
    // workspace 包开发期 alias 到 TS 源码保证热更新
    extensions: ['.ts', '.tsx', '.js'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    globals: true,
  },
});
