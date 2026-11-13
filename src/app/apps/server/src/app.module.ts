import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './db/database.module';
import { loadConfig, type AppConfig } from './config/config';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { DesignsModule } from './modules/designs/designs.module';
import { AiModule } from './modules/ai/ai.module';
import { ExportModule } from './modules/export/export.module';

@Module({})
export class AppModule {
  /** 以显式配置组装（main.ts 用 loadConfig()；测试用 sqljs 配置覆盖）。 */
  static forConfig(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forValue(config),
        DatabaseModule.forRoot(config),
        AuthModule,
        UsersModule,
        CatalogModule,
        DesignsModule,
        AiModule,
        ExportModule,
      ],
    };
  }
}
