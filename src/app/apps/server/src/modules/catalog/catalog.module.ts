import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CompatibilityEntity,
  ConnectorEntity,
  PanelMaterialEntity,
  ProfileSpecEntity,
  SafetyRuleEntity,
} from '../../db/entities/catalog.entity';
import { AuthModule } from '../auth/auth.module';
import { CatalogService } from './catalog.service';
import { AdminCatalogController, CatalogController } from './catalog.controller';

/** 字符串别名令牌：测试/跨模块按 token 取用，规避打包器双实例下的 class 身份问题。 */
export const CATALOG_SERVICE = 'CATALOG_SERVICE';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProfileSpecEntity,
      ConnectorEntity,
      CompatibilityEntity,
      PanelMaterialEntity,
      SafetyRuleEntity,
    ]),
    AuthModule,
  ],
  controllers: [CatalogController, AdminCatalogController],
  providers: [CatalogService, { provide: CATALOG_SERVICE, useExisting: CatalogService }],
  exports: [CatalogService, CATALOG_SERVICE],
})
export class CatalogModule {}
