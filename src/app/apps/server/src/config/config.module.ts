import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_CONFIG_TOKEN, loadConfig, type AppConfig } from '../config/config';

/** 全局配置模块：AppConfig 值提供者（测试可覆盖）。 */
@Global()
@Module({})
export class ConfigModule {
  static forValue(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG_TOKEN, useValue: config }],
      exports: [{ provide: APP_CONFIG_TOKEN, useValue: config }],
    };
  }
}

export function makeDefaultConfigModule(): DynamicModule {
  return ConfigModule.forValue(loadConfig());
}
