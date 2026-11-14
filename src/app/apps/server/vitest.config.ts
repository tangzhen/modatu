import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// 说明：服务端测试依赖 tsc 的 emitDecoratorMetadata（Nest DI 元数据），
// esbuild 不支持，因此测试统一 import 编译产物 dist/，先 build 再跑。
// env：实体类在模块加载期读取 MODATU_DB 选择便携列类型，必须先注入。
export default defineConfig({
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    environment: 'node',
    testTimeout: 60000,
    env: {
      MODATU_DB: 'sqljs',
      MODATU_SECRET: 'test-secret',
      MODATU_DEV_PASSWORD_LOGIN: 'true',
      NODE_ENV: 'test',
    },
  },
});
