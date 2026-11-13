import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// 说明：服务端测试依赖 tsc 的 emitDecoratorMetadata（Nest DI 元数据），
// esbuild 不支持，因此测试统一 import 编译产物 dist/，先 build 再跑。
export default defineConfig({
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
});
