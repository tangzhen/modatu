/** 环境配置（全量读取 process.env，测试通过 env 注入）。 */
export interface AppConfig {
  port: number;
  corsOrigin: string;
  /** 生产 pg；测试 sqljs（内存） */
  dbType: 'pg' | 'sqljs';
  pg: { host: string; port: number; user: string; password: string; database: string };
  /** spec-03：dev 账密登录开关（生产关闭；隐藏登录页不受此开关影响） */
  devPasswordLogin: boolean;
  /** AES-256-GCM 主密钥（AI Key 等静态加密） */
  secret: string;
  /** 中文字体路径（PDF 水印/表格）；缺省用内置 assets/fonts */
  fontPath?: string;
  nodeEnv: string;
}

/** DI 令牌（AppConfig 是纯接口，无运行时实体）。 */
export const APP_CONFIG_TOKEN = 'APP_CONFIG';

function boolEnv(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env['PORT'] ?? 3001),
    corsOrigin: env['CORS_ORIGIN'] ?? 'http://localhost:5173',
    dbType: env['MODATU_DB'] === 'sqljs' ? 'sqljs' : 'pg',
    pg: {
      host: env['PGHOST'] ?? '127.0.0.1',
      port: Number(env['PGPORT'] ?? 5432),
      user: env['PGUSER'] ?? 'postgres',
      password: env['PGPASSWORD'] ?? 'postgres',
      database: env['PGDATABASE'] ?? 'modatu',
    },
    devPasswordLogin: boolEnv('MODATU_DEV_PASSWORD_LOGIN', false),
    secret: env['MODATU_SECRET'] ?? 'dev-secret-change-me',
    fontPath: env['MODATU_FONT_PATH'] || undefined,
    nodeEnv: env['NODE_ENV'] ?? 'development',
  };
}
