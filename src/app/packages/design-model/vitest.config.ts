import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@modatu/catalog': resolve(__dirname, '../catalog/src/index.ts'),
      '@modatu/design-model': resolve(__dirname, '../design-model/src/index.ts'),
      '@modatu/bom': resolve(__dirname, '../bom/src/index.ts'),
      '@modatu/safety-rules': resolve(__dirname, '../safety-rules/src/index.ts'),
      '@modatu/editor-state': resolve(__dirname, '../editor-state/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
