import { TypeOrmModule } from '@nestjs/typeorm';
import { DynamicModule, Module } from '@nestjs/common';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import {
  CompatibilityEntity,
  ConnectorEntity,
  PanelMaterialEntity,
  ProfileSpecEntity,
  SafetyRuleEntity,
} from './entities/catalog.entity';
import { DesignEntity, DesignVersionEntity } from './entities/design.entity';
import { SessionEntity, UserEntity } from './entities/user.entity';
import type { AppConfig } from '../config/config';

export const ENTITIES = [
  UserEntity,
  SessionEntity,
  ProfileSpecEntity,
  ConnectorEntity,
  CompatibilityEntity,
  PanelMaterialEntity,
  SafetyRuleEntity,
  DesignEntity,
  DesignVersionEntity,
];

export function makeDbOptions(config: AppConfig): TypeOrmModuleOptions {
  if (config.dbType === 'sqljs') {
    // 测试环境：内存 SQLite（sql.js，纯 WASM，无原生依赖）
    return {
      type: 'sqljs' as const,
      entities: ENTITIES,
      synchronize: true,
      autoSave: false,
    } as TypeOrmModuleOptions;
  }
  return {
    type: 'postgres' as const,
    host: config.pg.host,
    port: config.pg.port,
    username: config.pg.user,
    password: config.pg.password,
    database: config.pg.database,
    entities: ENTITIES,
    synchronize: true, // 一期：开发期自动同步；上线前换 migration
  };
}

@Module({})
export class DatabaseModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [TypeOrmModule.forRoot(makeDbOptions(config))],
      exports: [TypeOrmModule],
    };
  }
}
